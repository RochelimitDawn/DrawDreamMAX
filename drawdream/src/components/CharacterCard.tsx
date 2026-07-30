import { Heart, MessageCircle, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { CharacterCard } from '../types/character'
import { getChatPrefs, isSensitiveCard, type ChatPrefs } from '../utils/prefs'
import { CardCover } from './CardCover'
import { MotionCard } from '../motion'
import './CharacterCard.css'

interface Props {
  card: CharacterCard
  compact?: boolean
  poster?: boolean
  /** Emby-like dense poster with hover play */
  emby?: boolean
  badgeLabel?: string
  badgeTone?: 'hot' | 'soft' | 'dark'
  delay?: number
  onStartChat?: () => void
  onToggleFav?: () => void
  startBusy?: boolean
}

export function CharacterCardView({
  card,
  compact,
  poster,
  emby,
  badgeLabel,
  badgeTone = 'soft',
  delay = 0,
  onStartChat,
  onToggleFav,
  startBusy,
}: Props) {
  const { t, i18n } = useTranslation()
  const name = i18n.language === 'en' ? card.nameEn : card.name
  const desc = i18n.language === 'en' ? card.descriptionEn : card.description
  const cat = t(`discover.categories.${card.category}`)
  const resolvedBadge = badgeLabel ?? (emby ? undefined : cat)
  const [prefs, setPrefs] = useState<ChatPrefs>(() => getChatPrefs())
  useEffect(() => {
    const onPrefs = (e: Event) => {
      const d = (e as CustomEvent<ChatPrefs>).detail
      if (d) setPrefs(d)
      else setPrefs(getChatPrefs())
    }
    window.addEventListener('dd-prefs', onPrefs as EventListener)
    return () => window.removeEventListener('dd-prefs', onPrefs as EventListener)
  }, [])
  const blurSensitive = prefs.blurNsfw && isSensitiveCard(card)

  if (poster) {
    return (
      <MotionCard
        className={`dd-card is-poster ${emby ? 'is-emby' : ''}`}
        delay={delay}
        maxTilt={emby ? 5 : 8}
        lift={emby ? 5 : 7}
      >
        <Link to={`/cards/${card.id}`} className="dd-card-link">
          <CardCover
            className="dd-card-cover"
            name={name}
            gradient={card.gradient}
            accent={card.accent}
            coverUrl={card.coverUrl}
            monoClassName="dd-card-mono"
            blurSensitive={blurSensitive}
          >
            {resolvedBadge ? (
              <span className={`dd-card-chip tone-${badgeTone}`}>{resolvedBadge}</span>
            ) : null}
            {card.fav ? (
              <span className="dd-card-fav-dot" title={t('common.favorited')} aria-label={t('common.favorited')}>
                <Heart size={11} fill="currentColor" />
              </span>
            ) : null}
            <div className="dd-card-poster-mask">
              <h3 className="dd-card-poster-title">{name}</h3>
              {!emby ? <p className="dd-card-poster-desc">{desc}</p> : null}
              <div className="dd-card-poster-meta">
                <span className="dd-card-poster-file">
                  {(card.path || card.author || 'Local').split('/').pop()}
                </span>
                {emby ? null : (
                  <span>
                    {card.fav ? (
                      <>
                        <Heart size={11} fill="currentColor" />
                        Fav
                      </>
                    ) : (
                      'Local'
                    )}
                  </span>
                )}
              </div>
            </div>
            {emby ? (
              <div className="dd-card-emby-hover" aria-hidden>
                <span className="dd-card-play">
                  <Play size={18} fill="currentColor" />
                </span>
              </div>
            ) : null}
          </CardCover>
        </Link>
        {emby && (onStartChat || onToggleFav) ? (
          <div className="dd-card-emby-actions">
            {onToggleFav ? (
              <button
                type="button"
                className={`dd-card-icon-btn ${card.fav ? 'is-fav' : ''}`}
                title={card.fav ? t('cards.favOff') : t('cards.favOn')}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onToggleFav()
                }}
              >
                <Heart size={14} fill={card.fav ? 'currentColor' : 'none'} />
              </button>
            ) : null}
            {onStartChat ? (
              <button
                type="button"
                className="dd-card-icon-btn is-play"
                title={t('common.startChat')}
                disabled={startBusy}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onStartChat()
                }}
              >
                <MessageCircle size={14} />
              </button>
            ) : null}
          </div>
        ) : null}
      </MotionCard>
    )
  }

  return (
    <MotionCard
      className={`dd-card ${compact ? 'is-compact' : ''}`}
      style={{ minHeight: compact ? 220 : card.height }}
      delay={delay}
      maxTilt={6}
    >
      <Link to={`/cards/${card.id}`} className="dd-card-link">
        <CardCover
          className="dd-card-cover"
          name={name}
          gradient={card.gradient}
          accent={card.accent}
          coverUrl={card.coverUrl}
          monoClassName="dd-card-mono"
          blurSensitive={blurSensitive}
        >
          <div className="dd-card-badge">{cat}</div>
          <div className="dd-card-hover">
            <p>{desc}</p>
            <div className="dd-card-tags">
              {card.tags.slice(0, 3).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </CardCover>
        <div className="dd-card-body">
          <h3 className="dd-card-title">{name}</h3>
          <div className="dd-card-meta">
            <span className="dd-card-author">@{card.author}</span>
            <div className="dd-card-stats">
              <span title={t('common.favorite')}>
                <Heart size={13} fill={card.fav ? 'currentColor' : 'none'} />
                {card.fav ? t('common.favorited') : 'Local'}
              </span>
              <span title={t('common.tags')}>
                <MessageCircle size={13} />
                {card.tags.slice(0, 1).join('') || 'Agent'}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </MotionCard>
  )
}
