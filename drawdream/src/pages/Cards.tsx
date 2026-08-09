import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Heart,
  Library,
  MessageCircle,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  cardLibToUi,
  deleteCard,
  fetchCards,
  importCardFile,
  setCardFav,
  switchCard,
  type CardLibItem,
} from '../agent/rest'
import { CharacterCardView } from '../components/CharacterCard'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { CharacterCard } from '../types/character'
import { MagneticButton, MotionText, Reveal } from '../motion'
import { toast } from '../utils/toast'
import './Cards.css'

type UiCard = CharacterCard & { path?: string; source?: 'agent'; fav?: boolean }

export function CardsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [agentCards, setAgentCards] = useState<UiCard[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [manageMode, setManageMode] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UiCard | null>(null)
  const [deleteLore, setDeleteLore] = useState(false)
  const [deleteData, setDeleteData] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchCards()
      setCurrentPath(data.current)
      setAgentCards(data.cards.map((c: CardLibItem, i: number) => cardLibToUi(c, i) as UiCard))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setAgentCards([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') {
        if (manageMode) {
          setManageMode(false)
          return
        }
        if (query) {
          setQuery('')
          searchRef.current?.blur()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, manageMode])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = agentCards.filter((c) => {
      if (!q) return true
      const name = i18n.language === 'en' ? c.nameEn : c.name
      const text = `${name} ${c.author} ${c.tags.join(' ')} ${c.path ?? ''}`.toLowerCase()
      return text.includes(q)
    })
    // 当前使用中置顶，其余按最近修改
    return [...rows].sort((a, b) => {
      const ac = a.path === currentPath ? 1 : 0
      const bc = b.path === currentPath ? 1 : 0
      if (bc !== ac) return bc - ac
      return (b.mtimeMs || 0) - (a.mtimeMs || 0)
    })
  }, [agentCards, query, currentPath, i18n.language])

  const currentCard = useMemo(
    () => agentCards.find((c) => c.path === currentPath) || null,
    [agentCards, currentPath],
  )

  const favCount = useMemo(() => agentCards.filter((c) => c.fav).length, [agentCards])

  const onImport = async (file: File) => {
    try {
      const r = await importCardFile(file)
      toast(t('cards.importOk', { name: r.name }), 'success')
      await load()
      if (r.switched && r.path) {
        setCurrentPath(r.path)
        navigate('/chat')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const onUseCard = async (path: string) => {
    setBusyPath(path)
    try {
      await switchCard(path)
      setCurrentPath(path)
      toast(t('common.applied'), 'success')
      navigate('/chat')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusyPath(null)
    }
  }

  const onToggleFav = async (card: UiCard) => {
    if (!card.path) return
    const next = !card.fav
    try {
      await setCardFav(card.path, next)
      setAgentCards((prev) =>
        prev.map((c) =>
          c.path === card.path ? { ...c, fav: next, likes: next ? Math.max(1, c.likes) : c.likes } : c,
        ),
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const onConfirmDelete = async () => {
    if (!deleteTarget?.path) return
    const targetPath = deleteTarget.path
    setDeleting(true)
    try {
      await deleteCard(targetPath, { lore: deleteLore, data: deleteData })
      toast(t('cards.cardDeleted'), 'success')
      setDeleteTarget(null)
      setDeleteLore(false)
      setDeleteData(false)
      await load()
      setAgentCards((prev) => prev.filter((card) => card.path !== targetPath))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const deleteName = deleteTarget
    ? i18n.language === 'en'
      ? deleteTarget.nameEn
      : deleteTarget.name
    : ''

  const currentName = currentCard
    ? i18n.language === 'en'
      ? currentCard.nameEn
      : currentCard.name
    : ''

  return (
    <div className={`page cards-page is-emby${manageMode ? ' is-managing' : ''}`}>
      <header className="lib-hero">
        <div className="lib-hero-copy">
          <MotionText as="h1" className="lib-title" mode="chars" y={20}>
            {t('cards.title')}
          </MotionText>
          <p className="lib-sub">
            {loading
              ? t('cards.loading')
              : t('cards.libSummary', {
                  count: agentCards.length,
                  fav: favCount,
                })}
          </p>
        </div>
        <div className="lib-hero-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.png,application/json,image/png"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void onImport(f)
            }}
          />
          <label
            className={`lib-hamburger${manageMode ? ' is-on' : ''}`}
            title={manageMode ? t('cards.doneManage') : t('cards.manage')}
          >
            <input
              type="checkbox"
              checked={manageMode}
              onChange={(e) => setManageMode(e.target.checked)}
              aria-label={manageMode ? t('cards.doneManage') : t('cards.manage')}
            />
            <svg viewBox="0 0 32 32" aria-hidden>
              <path
                className="lib-ham-line lib-ham-top-bottom"
                d="M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22"
              />
              <path className="lib-ham-line" d="M7 16 27 16" />
            </svg>
            <span className="lib-hamburger-label">
              {manageMode ? t('cards.doneManage') : t('cards.manage')}
            </span>
          </label>
          <MagneticButton className="btn btn-primary lib-import-btn" strength={0.24} onClick={() => fileRef.current?.click()}>
            <Upload size={16} />
            {t('cards.importCard')}
          </MagneticButton>
        </div>
      </header>

      {manageMode ? (
        <div className="lib-manage-banner" role="status">
          <span className="lib-manage-dot" aria-hidden />
          <p>{t('cards.manageHint')}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManageMode(false)}>
            {t('cards.doneManage')}
          </button>
        </div>
      ) : null}

      {currentCard ? (
        <Reveal as="section" className="lib-now-playing" y={18}>
          <div className="lib-now-cover" style={{ background: currentCard.gradient }}>
            {currentCard.coverUrl ? (
              <img src={currentCard.coverUrl} alt="" loading="lazy" />
            ) : (
              <span>{currentName.slice(0, 1)}</span>
            )}
          </div>
          <div className="lib-now-meta">
            <span className="lib-now-kicker">{t('cards.nowPlaying')}</span>
            <strong>{currentName}</strong>
            <em>{currentCard.path?.split('/').pop()}</em>
          </div>
          <div className="lib-now-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/chat')}>
              <MessageCircle size={14} />
              {t('cards.continueChat')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigate(`/cards/${currentCard.id}`)}
            >
              {t('cards.viewDetail')}
            </button>
          </div>
        </Reveal>
      ) : null}

      <section className="lib-toolbar" aria-label={t('cards.searchPlaceholder')}>
        <div className="lib-search-shell">
          <label className="lib-search">
            <Search size={16} className="lib-search-icon" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('cards.searchPlaceholder')}
              aria-label={t('cards.searchPlaceholder')}
            />
            {query ? (
              <button
                type="button"
                className="lib-search-clear"
                onClick={() => setQuery('')}
                aria-label={t('common.cancel')}
              >
                <X size={14} />
              </button>
            ) : (
              <kbd className="lib-search-kbd">⌘K</kbd>
            )}
          </label>
        </div>
      </section>

      <section className="lib-wall" aria-busy={loading}>
        <div className="lib-wall-head">
          <h2>
            <Library size={16} />
            {t('cards.posterWall')}
          </h2>
          <span className="lib-wall-count">{filtered.length}</span>
        </div>

        {loading ? (
          <div className="lib-skeleton-grid" aria-hidden>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="lib-skeleton-card" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="lib-empty">
            <div className="lib-empty-art" aria-hidden>
              <Library size={28} />
            </div>
            <h3>{query ? t('cards.emptyFilter') : t('cards.emptyAgent')}</h3>
            <p>{t('cards.emptyHint')}</p>
            <MagneticButton className="btn btn-primary" onClick={() => fileRef.current?.click()}>
              <Upload size={16} />
              {t('cards.importCard')}
            </MagneticButton>
          </div>
        ) : (
          <div className={`lib-poster-grid${manageMode ? ' is-manage' : ''}`}>
            {filtered.map((c, i) => (
              <div
                key={c.id}
                className={`lib-poster-cell${c.path === currentPath ? ' is-active' : ''}${
                  manageMode ? ' is-manage' : ''
                }`}
              >
                <CharacterCardView
                  card={c}
                  poster
                  emby
                  delay={Math.min(i * 0.035, 0.42)}
                  badgeLabel={c.path === currentPath ? t('cards.inUse') : undefined}
                  badgeTone={c.path === currentPath ? 'hot' : 'soft'}
                  onStartChat={
                    !manageMode && c.path ? () => void onUseCard(c.path!) : undefined
                  }
                  onToggleFav={
                    !manageMode && c.path ? () => void onToggleFav(c) : undefined
                  }
                  startBusy={busyPath === c.path}
                />
                {manageMode && c.path ? (
                  <div className="lib-manage-overlay">
                    <div className="lib-manage-actions">
                      <button
                        type="button"
                        className={`lib-manage-btn ${c.fav ? 'is-fav' : ''}`}
                        title={c.fav ? t('cards.favOff') : t('cards.favOn')}
                        onClick={() => void onToggleFav(c)}
                      >
                        <Heart size={15} fill={c.fav ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        className="lib-manage-btn is-danger"
                        title={t('cards.deleteCard')}
                        onClick={() => {
                          setDeleteTarget(c)
                          setDeleteLore(false)
                          setDeleteData(false)
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                      <button
                        type="button"
                        className="lib-manage-btn is-primary"
                        disabled={busyPath === c.path}
                        onClick={() => void onUseCard(c.path!)}
                      >
                        <MessageCircle size={14} />
                        {t('common.startChat')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        danger
        busy={deleting}
        title={t('cards.deleteCard')}
        description={
          deleteTarget ? (
            <div className="cards-delete-body">
              <p>{t('cards.deleteCardConfirm', { name: deleteName })}</p>
              <label className="cards-delete-opt">
                <input
                  type="checkbox"
                  checked={deleteLore}
                  onChange={(e) => setDeleteLore(e.target.checked)}
                  disabled={deleting}
                />
                <span>{t('cards.deleteWithLore')}</span>
              </label>
              <label className="cards-delete-opt">
                <input
                  type="checkbox"
                  checked={deleteData}
                  onChange={(e) => setDeleteData(e.target.checked)}
                  disabled={deleting}
                />
                <span>{t('cards.deleteWithData')}</span>
              </label>
            </div>
          ) : undefined
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={() => void onConfirmDelete()}
      />
    </div>
  )
}
