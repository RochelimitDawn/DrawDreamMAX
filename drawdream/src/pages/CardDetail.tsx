import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BookOpen,
  Clock3,
  FileText,
  Heart,
  MessageCircle,
  Pencil,
  Play,
  Plus,
  StickyNote,
  Tag,
  X,
} from 'lucide-react'
import {
  cardLibToUi,
  decodeCardPath,
  encodeCardPath,
  fetchCardDetail,
  fetchCards,
  fetchSessions,
  setCardFav,
  switchCard,
  updateLibraryCardFields,
  type CardResponse,
  type SessionListItem,
} from '../agent/rest'
import { replaceMacrosForDisplay } from '../utils/macro-display'
import type { CharacterCard } from '../types/character'
import { CardCover } from '../components/CardCover'
import { CharacterCardView } from '../components/CharacterCard'
import {
  MagneticButton,
  MotionText,
  Reveal,
  gsap,
  prefersReducedMotion,
  useGSAP,
} from '../motion'
import { getChatPrefs, isSensitiveCard } from '../utils/prefs'
import { toast } from '../utils/toast'
import './CardDetail.css'

const detailTabs = ['overview', 'story', 'sessions', 'notes'] as const

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function agentDetailToUi(
  detail: CardResponse & { isPng?: boolean },
  path: string,
  index = 0,
  fav = false,
): CharacterCard {
  const first =
    detail.greetings?.[detail.greetingIndex]?.text || detail.greetings?.[0]?.text || ''
  const desc =
    detail.description?.trim() ||
    detail.creatorNotes?.trim() ||
    (first ? stripTags(first).slice(0, 280) : '') ||
    path
  const base = cardLibToUi(
    {
      path,
      name: (detail.name || '').trim() || path.split('/').pop()?.replace(/\.(png|json)$/i, '').replace(/[-_]+/g, ' ').trim() || path,
      tags: detail.tags ?? [],
      isPng: detail.isPng ?? /\.png$/i.test(path),
      mtimeMs: 0,
      fav,
    },
    index,
  )
  return {
    ...base,
    description: desc,
    descriptionEn: desc,
    personality: detail.personality || '',
    scenario: detail.scenario || '',
    firstMessage: first,
  }
}

function matchCardSessions(sessions: SessionListItem[], path: string, cardName: string): SessionListItem[] {
  const cardBase = path.split('/').pop()?.replace(/\.(png|json)$/i, '') || ''
  const nameKey = (cardName || cardBase).toLowerCase()
  const baseKey = cardBase.toLowerCase()
  return sessions.filter((s) => {
    const cn = (s.cardName || '').toLowerCase()
    const sn = (s.name || '').toLowerCase()
    const sp = s.path.toLowerCase()
    if (!cn && !sn) {
      return sp.includes(baseKey) || sp.includes(nameKey)
    }
    return (
      cn === nameKey ||
      cn.includes(nameKey) ||
      nameKey.includes(cn) ||
      sn.includes(nameKey) ||
      sp.includes(baseKey)
    )
  })
}

function formatTokenEst(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatTime(ms: number, lang: string) {
  try {
    return new Date(ms).toLocaleString(lang.startsWith('en') ? 'en' : 'zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function CardDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const agentPath = id ? decodeCardPath(id) : null
  const [agentCard, setAgentCard] = useState<CharacterCard | null>(null)
  const [related, setRelated] = useState<CharacterCard[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [starting, setStarting] = useState(false)
  const [favBusy, setFavBusy] = useState(false)
  const card = agentCard
  const name = card ? (i18n.language === 'en' ? card.nameEn : card.name) : ''
  const desc = card ? (i18n.language === 'en' ? card.descriptionEn : card.description) : ''
  const [draft, setDraft] = useState('')
  const [localNotes, setLocalNotes] = useState<string[]>([])
  const [favorited, setFavorited] = useState(false)
  const [tab, setTab] = useState<(typeof detailTabs)[number]>('overview')
  const [descOpen, setDescOpen] = useState(false)
  const [cardSessions, setCardSessions] = useState<SessionListItem[]>([])
  const [editingTags, setEditingTags] = useState(false)
  const [tagDraft, setTagDraft] = useState<string[]>([])
  const tagDraftRef = useRef<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [tagSaving, setTagSaving] = useState(false)
  useEffect(() => { tagDraftRef.current = tagDraft }, [tagDraft])
  const heroRef = useRef<HTMLElement | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)
  const macroLocale = i18n.language?.startsWith('en') ? 'en' : 'zh'
  const displayText = (s: string) =>
    replaceMacrosForDisplay(s, { userName: t('chat.user'), charName: name || t('chat.assistant') }, macroLocale)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    ;(async () => {
      try {
        const [lib, sessions] = await Promise.all([
          fetchCards(),
          fetchSessions().catch(() => [] as SessionListItem[]),
        ])
        // 优先 decode；失败则用 id 与库内 encode 反查（兼容旧链接 / WebView 截断后的 id）
        let path = agentPath
        if (!path && id) {
          const hit = lib.cards.find((c) => encodeCardPath(c.path) === id || c.path === id)
          if (hit) path = hit.path
        }
        if (!path) {
          if (!cancelled) {
            setAgentCard(null)
            setRelated([])
            setCardSessions([])
            setLoadError(t('secondary.cardDetail.notFound'))
          }
          return
        }
        const idx = lib.cards.findIndex((c) => c.path === path)
        const item = lib.cards[idx]
        if (!item) {
          if (!cancelled) {
            setAgentCard(null)
            setLoadError(t('secondary.cardDetail.notFound'))
          }
          return
        }
        const detail = await fetchCardDetail(path)
        if (cancelled) return
        const ui = agentDetailToUi(detail, path, idx >= 0 ? idx : 0, !!item.fav)
        setAgentCard(ui)
        setFavorited(!!item.fav)
        setRelated(
          lib.cards
            .filter((c) => c.path !== path)
            .slice(0, 8)
            .map((c, i) => cardLibToUi(c, i)),
        )
        setCardSessions(matchCardSessions(sessions, path, detail.name || item.name || ''))
      } catch (e) {
          if (!cancelled) {
            setAgentCard(null)
            setLoadError(e instanceof Error ? e.message : String(e))
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
      return () => {
        cancelled = true
      }
    }, [agentPath, id, t])

    useEffect(() => {
      if (!agentPath) {
        setLocalNotes([])
        return
      }
    try {
      const raw = localStorage.getItem(`dd-card-notes:${agentPath}`)
      setLocalNotes(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      setLocalNotes([])
    }
  }, [agentPath])

  const startChat = async () => {
    if (!agentPath || starting) return
    setStarting(true)
    try {
      await switchCard(agentPath)
      navigate('/chat')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setStarting(false)
    }
  }

  const toggleFav = async () => {
    if (!agentPath || favBusy) return
    const next = !favorited
    setFavBusy(true)
    try {
      await setCardFav(agentPath, next)
      setFavorited(next)
      setAgentCard((c) => (c ? { ...c, fav: next } : c))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setFavBusy(false)
    }
  }

  const usage = useMemo(() => {
    const totalMsgs = cardSessions.reduce((s, x) => s + (x.messageCount || 0), 0)
    const rounds = Math.max(0, Math.floor(totalMsgs / 2))
    const estTokens = rounds * 800 + totalMsgs * 40
    const recent = [...cardSessions]
      .sort((a, b) => (b.modified || 0) - (a.modified || 0))
      .slice(0, 8)
    return {
      sessions: cardSessions.length,
      messages: totalMsgs,
      rounds,
      estTokens,
      recent,
    }
  }, [cardSessions])

  const fileName = agentPath?.split('/').pop() || ''

  useGSAP(
    () => {
      const root = heroRef.current
      if (!root || prefersReducedMotion() || !card) return
      gsap.fromTo(
        root.querySelectorAll('.emby-hero-poster, .emby-hero-copy, .emby-hero-actions, .emby-meta-chip'),
        { y: 28, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.65, stagger: 0.05, ease: 'power3.out' },
      )
    },
    { dependencies: [card?.id, i18n.language], scope: heroRef },
  )

  useGSAP(
    () => {
      const root = pageRef.current
      if (!root || prefersReducedMotion() || !card) return
      gsap.fromTo(
        root.querySelectorAll('.emby-section'),
        { y: 18, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.5,
          stagger: 0.06,
          delay: 0.15,
          ease: 'power2.out',
        },
      )
    },
    { dependencies: [card?.id, tab], scope: pageRef },
  )

  const submitNote = () => {
    const text = draft.trim()
    if (!text || !agentPath) return
    const next = [text, ...localNotes].slice(0, 40)
    setLocalNotes(next)
    setDraft('')
    try {
      localStorage.setItem(`dd-card-notes:${agentPath}`, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    toast(t('common.saved'), 'success')
  }

  if (loading) {
    return (
      <div className="page card-detail-page is-emby">
        <div className="emby-skeleton">
          <div className="emby-skeleton-hero" />
          <div className="emby-skeleton-rows">
            <div />
            <div />
            <div />
          </div>
        </div>
      </div>
    )
  }

  if (!card || !agentPath) {
    return (
      <div className="page card-detail-page is-emby">
        <Link to="/cards" className="emby-back">
          <ArrowLeft size={16} />
          {t('common.back')}
        </Link>
        <div className="emby-empty">{loadError || t('secondary.cardDetail.notFound')}</div>
      </div>
    )
  }

  return (
    <div className="page card-detail-page is-emby" ref={pageRef}>
      <button type="button" className="emby-back is-float" onClick={() => navigate(-1)} aria-label={t('common.back')}>
        <ArrowLeft size={18} />
      </button>

      <section className="emby-hero" ref={heroRef}>
        <div className="emby-hero-backdrop" aria-hidden>
          {card.coverUrl ? (
            <img src={card.coverUrl} alt="" />
          ) : (
            <div className="emby-hero-fallback" style={{ background: card.gradient }} />
          )}
          <div className="emby-hero-scrim" />
        </div>

        <div className="emby-hero-body">
          <div className="emby-hero-poster">
            <CardCover
              className="emby-poster-cover"
              name={name}
              gradient={card.gradient}
              accent={card.accent}
              coverUrl={card.coverUrl}
              monoClassName="emby-poster-mono"
              blurSensitive={getChatPrefs().blurNsfw && isSensitiveCard(card)}
            />
          </div>

          <div className="emby-hero-main">
            <div className="emby-hero-kicker">
              <span className="emby-meta-chip">{t(`discover.categories.${card.category}`)}</span>
              {card.isPng ? <span className="emby-meta-chip">PNG</span> : <span className="emby-meta-chip">JSON</span>}
              {favorited ? (
                <span className="emby-meta-chip is-fav">
                  <Heart size={11} fill="currentColor" />
                  {t('common.favorited')}
                </span>
              ) : null}
            </div>

            <div className="emby-hero-copy">
              <MotionText as="h1" className="emby-title" mode="chars" y={16}>
                {name}
              </MotionText>
              <p className="emby-subtitle">
                <FileText size={13} />
                <span className="emby-path-text">{fileName}</span>
              </p>
              <p className={`emby-logline ${descOpen ? 'is-open' : ''}`}>
                {desc || t('secondary.cardDetail.storyNote')}
              </p>
              {desc.length > 140 ? (
                <button type="button" className="emby-more" onClick={() => setDescOpen((v) => !v)}>
                  {descOpen ? t('secondary.cardDetail.collapse') : t('secondary.cardDetail.expand')}
                </button>
              ) : null}
            </div>

            <div className="emby-hero-actions">
              <MagneticButton
                className="btn btn-primary emby-play"
                strength={0.28}
                disabled={starting}
                onClick={() => void startChat()}
              >
                <Play size={18} fill="currentColor" />
                {starting ? t('common.loading') : t('common.startChat')}
              </MagneticButton>
              <button
                type="button"
                className={`emby-icon-btn ${favorited ? 'is-on' : ''}`}
                disabled={favBusy}
                title={favorited ? t('cards.favOff') : t('cards.favOn')}
                onClick={() => void toggleFav()}
              >
                <Heart size={18} fill={favorited ? 'currentColor' : 'none'} />
              </button>
            </div>

            <div className="emby-stats-row">
              <div className="emby-stat">
                <strong>{usage.sessions}</strong>
                <span>{t('stats.sessions')}</span>
              </div>
              <div className="emby-stat">
                <strong>{usage.rounds}</strong>
                <span>{t('stats.rounds')}</span>
              </div>
              <div className="emby-stat">
                <strong>{formatTokenEst(usage.estTokens)}</strong>
                <span>{t('stats.estTokens')}</span>
              </div>
              <div className="emby-stat">
                <strong>{localNotes.length}</strong>
                <span>{t('secondary.cardDetail.localNotes')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <nav className="emby-tabs emby-section" role="tablist" aria-label={t('secondary.cardDetail.title')}>
        {detailTabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`emby-tab ${tab === key ? 'is-on' : ''}`}
            onClick={() => setTab(key)}
          >
            {t(`secondary.cardDetail.tabs.${key}`)}
          </button>
        ))}
      </nav>

      <section className="emby-panel emby-section surface" role="tabpanel">
        {tab === 'overview' ? (
          <div className="emby-overview">
            <div className="emby-overview-main">
              {card.personality ? (
                <article className="emby-block">
                  <h3>
                    <SparkIcon />
                    {t('secondary.cardDetail.personality')}
                  </h3>
                  <p>{displayText(card.personality)}</p>
                </article>
              ) : null}
              {card.scenario ? (
                <article className="emby-block">
                  <h3>
                    <BookOpen size={15} />
                    {t('secondary.cardDetail.scenario')}
                  </h3>
                  <p>{displayText(card.scenario)}</p>
                </article>
              ) : null}
              {card.firstMessage ? (
                <article className="emby-block">
                  <h3>
                    <MessageCircle size={15} />
                    {t('secondary.cardDetail.firstMessage')}
                  </h3>
                  <p className="emby-quote">{displayText(stripTags(card.firstMessage).slice(0, 520))}</p>
                </article>
              ) : null}
              {!card.personality && !card.scenario && !card.firstMessage ? (
                <article className="emby-block">
                  <h3>{t('secondary.cardDetail.intro')}</h3>
                  <p>{displayText(desc) || t('common.empty')}</p>
                </article>
              ) : null}
            </div>
            <aside className="emby-overview-side">
              <div className="emby-side-card">
                <h4>
                  <Tag size={14} />
                  {t('common.tags')}
                  {!editingTags ? (
                    <button
                      type="button"
                      className="emby-tag-edit-btn"
                      onClick={() => {
                        setTagDraft([...(card.tags || [])])
                        setTagInput('')
                        setEditingTags(true)
                      }}
                      aria-label={t('secondary.cardDetail.editTags')}
                      title={t('secondary.cardDetail.editTags')}
                    >
                      <Pencil size={12} />
                    </button>
                  ) : null}
                </h4>
                {editingTags ? (
                  <div className="emby-tags-editor">
                    <div className="emby-tags">
                      {tagDraft.map((tag) => (
                        <span key={tag} className="emby-tag is-editable">
                          {tag}
                          <button
                            type="button"
                            className="emby-tag-remove"
                            aria-label={t('secondary.cardDetail.removeTag')}
                            onClick={() => setTagDraft((prev) => prev.filter((x) => x !== tag))}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      {tagDraft.length === 0 ? (
                        <span className="emby-muted">{t('common.empty')}</span>
                      ) : null}
                    </div>
                    <div className="emby-tag-add-row">
                      <input
                        className="field-input emby-tag-input"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        placeholder={t('secondary.cardDetail.addTagPh')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            const v = tagInput.trim()
                            if (!v) return
                            setTagDraft((prev) => (prev.includes(v) ? prev : [...prev, v]))
                            setTagInput('')
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost emby-tag-add-btn"
                        onClick={() => {
                          const v = tagInput.trim()
                          if (!v) return
                          setTagDraft((prev) => (prev.includes(v) ? prev : [...prev, v]))
                          setTagInput('')
                        }}
                      >
                        <Plus size={14} />
                        {t('secondary.cardDetail.addTag')}
                      </button>
                    </div>
                    <div className="emby-tag-quick">
                      <span className="emby-tag-quick-label">快速添加</span>
                      <button
                        type="button"
                        className={`emby-tag-quick-btn nsfw ${tagDraft.includes('NSFW') ? 'is-on' : ''}`}
                        onClick={() =>
                          setTagDraft((prev) =>
                            prev.includes('NSFW') ? prev.filter((x) => x !== 'NSFW') : [...prev.filter((x) => x !== 'SFW'), 'NSFW'],
                          )
                        }
                      >
                        NSFW
                      </button>
                      <button
                        type="button"
                        className={`emby-tag-quick-btn sfw ${tagDraft.includes('SFW') ? 'is-on' : ''}`}
                        onClick={() =>
                          setTagDraft((prev) =>
                            prev.includes('SFW') ? prev.filter((x) => x !== 'SFW') : [...prev.filter((x) => x !== 'NSFW'), 'SFW'],
                          )
                        }
                      >
                        SFW
                      </button>
                    </div>
                    <div className="emby-tag-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={tagSaving}
                        onClick={() => {
                          setEditingTags(false)
                          setTagInput('')
                        }}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={tagSaving || !agentPath}
                        onClick={async () => {
                          if (!agentPath) return
                          setTagSaving(true)
                          const tags = [...tagDraftRef.current]
                          try {
                            await updateLibraryCardFields(agentPath, { tags })
                            setAgentCard((prev) => (prev ? { ...prev, tags } : prev))
                            setEditingTags(false)
                            toast(t('secondary.cardDetail.tagsSaved'), 'success')
                          } catch (e) {
                            toast(
                              e instanceof Error ? e.message : t('secondary.cardDetail.tagsSaveFail'),
                              'error',
                            )
                          } finally {
                            setTagSaving(false)
                          }
                        }}
                      >
                        {t('secondary.cardDetail.saveTags')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="emby-tags">
                    {card.tags.length > 0 ? (
                      card.tags.map((tag) => (
                        <span key={tag} className="emby-tag">
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="emby-muted">{t('common.empty')}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="emby-side-card">
                <h4>
                  <FileText size={14} />
                  {t('secondary.cardDetail.mediaInfo')}
                </h4>
                <dl className="emby-facts">
                  <div>
                    <dt>{t('secondary.cardDetail.fileName')}</dt>
                    <dd>{fileName}</dd>
                  </div>
                  <div>
                    <dt>{t('secondary.cardDetail.format')}</dt>
                    <dd>{card.isPng ? 'PNG Character Card' : 'JSON Character Card'}</dd>
                  </div>
                  <div>
                    <dt>{t('secondary.cardDetail.source')}</dt>
                    <dd>Agent Library</dd>
                  </div>
                </dl>
              </div>
            </aside>
          </div>
        ) : null}

        {tab === 'story' ? (
          <div className="emby-story">
            <article className="emby-block">
              <h3>{t('secondary.cardDetail.story')}</h3>
              <p>
                {displayText(card.firstMessage || card.scenario || desc || t('secondary.cardDetail.storyNote'))}
              </p>
            </article>
            {card.scenario && card.firstMessage ? (
              <article className="emby-block">
                <h3>{t('secondary.cardDetail.scenario')}</h3>
                <p>{displayText(card.scenario)}</p>
              </article>
            ) : null}
          </div>
        ) : null}

        {tab === 'sessions' ? (
          <div className="emby-sessions">
            {usage.recent.length === 0 ? (
              <div className="emby-empty-inline">
                <Clock3 size={22} />
                <p>{t('secondary.cardDetail.noSessions')}</p>
                <MagneticButton className="btn btn-primary btn-sm" onClick={() => void startChat()}>
                  <Play size={14} fill="currentColor" />
                  {t('common.startChat')}
                </MagneticButton>
              </div>
            ) : (
              <ul className="emby-session-list">
                {usage.recent.map((s) => (
                  <li key={s.path}>
                    <button
                      type="button"
                      className="emby-session-item"
                      onClick={() => {
                        void startChat()
                      }}
                    >
                      <span className="emby-session-icon">
                        <MessageCircle size={16} />
                      </span>
                      <span className="emby-session-meta">
                        <strong>{s.name || s.cardName || s.path.split('/').pop()}</strong>
                        <small>
                          {formatTime(s.modified, i18n.language)}
                          {s.messageCount != null ? ` · ${s.messageCount} msg` : ''}
                        </small>
                      </span>
                      <Play size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === 'notes' ? (
          <div className="emby-notes">
            <div className="emby-note-composer">
              <StickyNote size={16} />
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('secondary.cardDetail.notePlaceholder')}
                rows={3}
              />
              <MagneticButton className="btn btn-primary btn-sm" onClick={submitNote} strength={0.2}>
                {t('common.save')}
              </MagneticButton>
            </div>
            {localNotes.length === 0 ? (
              <div className="emby-empty-inline">
                <p>{t('common.empty')}</p>
              </div>
            ) : (
              <ul className="emby-note-list">
                {localNotes.map((note, i) => (
                  <li key={`${i}-${note.slice(0, 12)}`} className="emby-note-item">
                    <p>{note}</p>
                    <button
                      type="button"
                      className="emby-note-del"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      onClick={() => {
                        const next = localNotes.filter((_, idx) => idx !== i)
                        setLocalNotes(next)
                        try {
                          if (agentPath) {
                            localStorage.setItem(`dd-card-notes:${agentPath}`, JSON.stringify(next))
                          }
                        } catch {
                          /* ignore */
                        }
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>

      {related.length > 0 ? (
        <Reveal as="section" className="emby-related emby-section" y={20}>
          <div className="emby-related-head">
            <h2>{t('secondary.cardDetail.related')}</h2>
            <Link to="/cards" className="emby-related-more">
              {t('common.more')}
            </Link>
          </div>
          <div className="emby-related-rail">
            {related.map((c, i) => (
              <div key={c.id} className="emby-related-cell">
                <CharacterCardView card={c} poster emby delay={i * 0.04} />
              </div>
            ))}
          </div>
        </Reveal>
      ) : null}

    </div>
  )
}

function SparkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}
