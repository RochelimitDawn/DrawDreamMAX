import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Bookmark,
  ChevronRight,
  Crown,
  Flame,
  MessageCircle,
  Share2,
  Sparkles,
  Star,
  ThumbsUp,
} from 'lucide-react'
import type { PlazaPost } from '../data/mock'
import { formatCount } from '../utils/formatCount'
import { HeartLikeButton } from './HeartLikeButton'
import { ShareSheet } from './ShareSheet'
import './PlazaPostCard.css'

interface Props {
  post: PlazaPost
}

export function PlazaPostCard({ post }: Props) {
  const { t, i18n } = useTranslation()
  const en = i18n.language === 'en'
  const [liked, setLiked] = useState(false)
  const [supported, setSupported] = useState(false)
  const [bookmarked, setBookmarked] = useState(!!post.bookmarked)
  const [following, setFollowing] = useState(!!post.following)
  const [likes, setLikes] = useState(post.likes)
  const [supports, setSupports] = useState(post.supports)
  const [shareOpen, setShareOpen] = useState(false)

  const title = en ? post.titleEn : post.title
  const body = en ? post.bodyEn : post.body
  const withChar = en ? post.withCharacterEn : post.withCharacter
  const timeAgo = en ? post.timeAgoEn : post.timeAgo
  const region = en ? post.regionEn : post.region
  const rank = en ? post.rankBadgeEn : post.rankBadge

  return (
    <article className="plaza-post">
      <header className="plaza-author">
        <div className="plaza-avatar" style={{ background: post.avatarGradient }}>
          <Star size={16} fill="currentColor" />
        </div>
        <div className="plaza-author-meta">
          <div className="plaza-author-name">{post.author}</div>
          <div className="plaza-author-sub">
            {t('plaza.storyWith', { name: withChar })}
          </div>
        </div>
        <button
          type="button"
          className={`plaza-follow ${following ? 'is-on' : ''}`}
          onClick={() => setFollowing((v) => !v)}
        >
          {following ? t('plaza.followingBtn') : t('plaza.follow')}
        </button>
      </header>

      <div className="plaza-content">
        <h3 className="plaza-title">{title}</h3>
        {rank && (
          <Link to={`/cards/${post.characterId}`} className="plaza-rank">
            <Crown size={13} />
            <span>{rank}</span>
            <ChevronRight size={13} />
          </Link>
        )}
        <p className="plaza-body">{body}</p>
        <div className="plaza-tags">
          {post.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </div>

      <div className="plaza-meta">
        <span className="plaza-heat">
          <Flame size={13} />
          {formatCount(post.heat, i18n.language)}
        </span>
        <span className="plaza-dot">·</span>
        <span>{timeAgo}</span>
        <span className="plaza-dot">·</span>
        <span>{region}</span>
      </div>

      {post.works.length > 0 && (
        <div className="plaza-works">
          <div className="plaza-works-head">
            <span className="plaza-works-icon">
              <Star size={12} fill="currentColor" />
            </span>
            <span>{t('plaza.popularWorks')}</span>
          </div>
          <div className="plaza-works-scroll">
            {post.works.map((w) => (
              <Link key={w.id} to={`/cards/${w.id}`} className="plaza-work-card">
                <div className="plaza-work-cover" style={{ background: w.gradient }}>
                  <Sparkles size={16} />
                </div>
                <div className="plaza-work-body">
                  <div className="plaza-work-title">{en ? w.titleEn : w.title}</div>
                  <div className="plaza-work-heat">
                    <Flame size={10} />
                    {formatCount(w.heat, i18n.language)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <footer className="plaza-actions">
        <div className="plaza-actions-left">
          <HeartLikeButton
            className="plaza-heart-like"
            size="sm"
            checked={liked}
            onChange={(v) => {
              setLiked(v)
              setLikes((n) => n + (v ? 1 : -1))
            }}
            labelOff={formatCount(likes, i18n.language)}
            labelOn={formatCount(likes, i18n.language)}
            ariaLabel={t('common.like')}
          />
          <button type="button" className="plaza-act is-comment">
            <MessageCircle size={18} />
            <span>{formatCount(post.comments, i18n.language)}</span>
          </button>
          <button
            type="button"
            className={`plaza-act ${supported ? 'is-support' : ''}`}
            onClick={() => {
              setSupported((v) => !v)
              setSupports((n) => n + (supported ? -1 : 1))
            }}
          >
            <ThumbsUp size={18} />
            <span>{formatCount(supports, i18n.language)}</span>
          </button>
        </div>
        <div className="plaza-actions-right">
          <button
            type="button"
            className={`plaza-act ${bookmarked ? 'is-bookmark' : ''}`}
            onClick={() => setBookmarked((v) => !v)}
            aria-label={t('common.favorite')}
          >
            <Bookmark size={18} fill={bookmarked ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="plaza-act"
            aria-label={t('common.share')}
            onClick={() => setShareOpen(true)}
          >
            <Share2 size={18} />
          </button>
        </div>
      </footer>

      <ShareSheet
        open={shareOpen}
        url={
          typeof window !== 'undefined'
            ? `${window.location.origin}/cards/${encodeURIComponent(post.characterId)}`
            : ''
        }
        title={t('common.share')}
        onClose={() => setShareOpen(false)}
      />
    </article>
  )
}
