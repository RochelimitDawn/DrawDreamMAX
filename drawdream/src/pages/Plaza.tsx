import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, MessageCircle, Sparkles, Upload } from 'lucide-react'
import { cardLibToUi, fetchCards, type CardLibItem } from '../agent/rest'
import type { CharacterCard } from '../types/character'
import { Reveal } from '../motion'
import { toast } from '../utils/toast'
import './Plaza.css'

export function PlazaPage() {
  const { t, i18n } = useTranslation()
  const [cards, setCards] = useState<CharacterCard[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchCards()
      setCurrentPath(data.current)
      setCards(data.cards.map((c: CardLibItem, i: number) => cardLibToUi(c, i)))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const current = cards.find((c) => c.path === currentPath) ?? cards[0]
  const tips = cards.slice(0, 6)

  return (
    <div className="plaza-page">
      <section className="plaza-topic-hero surface">
        <div
          className="plaza-topic-banner"
          style={{ background: current?.gradient ?? 'linear-gradient(135deg,#1e1b4b,#6366f1)' }}
        >
          <div className="plaza-topic-overlay">
            <div className="plaza-topic-top">
              <span className="plaza-topic-chip">
                <Sparkles size={12} />
                {t('plaza.topicChip')}
              </span>
              <span className="plaza-topic-rank">{t('plaza.topicRank')}</span>
            </div>
            <h2 className="plaza-topic-title"># {t('plaza.topicTitle')}</h2>
            <p className="plaza-topic-stats">
              <span>
                {cards.length} {t('discover.cardsCount')}
              </span>
              <span>·</span>
              <span>{t('plaza.localOnly')}</span>
            </p>
            <div className="plaza-topic-avatars" aria-hidden>
              {tips.map((c) => (
                <span key={c.id} style={{ background: c.gradient }}>
                  {(i18n.language.startsWith('en') ? c.nameEn : c.name).slice(0, 1)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="plaza-topic-actions">
          <Link to="/cards" className="plaza-subscribe">
            <Upload size={15} />
            {t('cards.importCard')}
          </Link>
          <Link
            to={current?.path ? `/chat?card=${encodeURIComponent(current.path)}` : '/chat'}
            className="plaza-compose"
          >
            <MessageCircle size={15} />
            {t('common.startChat')}
          </Link>
        </div>
      </section>

      <Reveal as="section" className="plaza-feed" y={16}>
        <article className="plaza-post plaza-empty-card">
          <header className="plaza-author">
            <div className="plaza-avatar" style={{ background: 'var(--brand, #6366f1)' }}>
              <BookOpen size={16} />
            </div>
            <div className="plaza-author-meta">
              <div className="plaza-author-name">{t('plaza.comingTitle')}</div>
              <div className="plaza-author-sub">{t('plaza.comingSub')}</div>
            </div>
          </header>
          <div className="plaza-content">
            <p className="plaza-body">{t('plaza.comingBody')}</p>
            <div className="plaza-tags">
              <span>#Agent</span>
              <span>#Local</span>
              <span>#RP</span>
            </div>
          </div>
        </article>

        {loading ? <div className="empty-state">{t('common.loading')}</div> : null}

        {!loading && tips.length > 0 ? (
          <div className="plaza-works" style={{ marginTop: 8 }}>
            <div className="plaza-works-head">
              <span className="plaza-works-icon">
                <Sparkles size={12} />
              </span>
              <span>{t('plaza.localWorks')}</span>
            </div>
            <div className="plaza-works-scroll">
              {tips.map((c) => (
                <Link key={c.id} to={`/cards/${c.id}`} className="plaza-work-card">
                  <div className="plaza-work-cover" style={{ background: c.gradient }}>
                    {c.coverUrl ? (
                      <img src={c.coverUrl} alt="" className="plaza-work-cover-img" loading="lazy" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                  </div>
                  <div className="plaza-work-body">
                    <div className="plaza-work-title">{i18n.language.startsWith('en') ? c.nameEn : c.name}</div>
                    <div className="plaza-work-heat">
                      {c.path === currentPath ? t('discover.badges.editor') : c.path?.split('/').pop()}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && cards.length === 0 ? (
          <div className="empty-state">
            <p>{t('discover.emptyAgent')}</p>
            <Link to="/cards" className="btn btn-primary" style={{ marginTop: 12, display: 'inline-flex' }}>
              {t('cards.importCard')}
            </Link>
          </div>
        ) : null}
      </Reveal>
    </div>
  )
}
