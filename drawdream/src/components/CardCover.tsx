import { useId, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import './CardCover.css'

interface CardCoverProps {
  name: string
  gradient?: string
  accent?: string
  coverUrl?: string
  className?: string
  monoClassName?: string
  children?: React.ReactNode
  style?: CSSProperties
  /** 敏感封面模糊（设置 blurNsfw） */
  blurSensitive?: boolean
}

/** 角色卡封面：PNG 立绘优先，失败回退渐变+首字；敏感封面可点锁开关揭开/隐藏 */
export function CardCover({
  name,
  gradient,
  accent,
  coverUrl,
  className = '',
  monoClassName = '',
  children,
  style,
  blurSensitive = false,
}: CardCoverProps) {
  const [broken, setBroken] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const lockId = useId()
  const showImg = !!coverUrl && !broken
  const sensitive = blurSensitive && !revealed

  /** 阻止 Link 导航；不可 preventDefault，否则 label 无法切换 checkbox */
  const stopCardNav = (e: MouseEvent) => {
    e.stopPropagation()
  }

  const setReveal = (next: boolean) => {
    if (!blurSensitive) return
    setRevealed(next)
  }

  const onLockActivate = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!blurSensitive) return
    setRevealed((v) => !v)
  }

  const face = (
    <>
      {showImg ? (
        <img
          className="card-cover-img"
          src={coverUrl}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <>
          {accent ? <div className="card-cover-glow" style={{ background: accent }} /> : null}
          <div className={`card-cover-mono ${monoClassName}`.trim()} aria-hidden>
            {(name || '?').slice(0, 1)}
          </div>
        </>
      )}
    </>
  )

  if (!blurSensitive) {
    return (
      <div
        className={`card-cover ${className}`.trim()}
        style={{
          background: showImg ? undefined : gradient,
          ...style,
        }}
      >
        {face}
        {children}
      </div>
    )
  }

  return (
    <div
      className={`card-cover card-flip ${className}${sensitive ? ' is-blur-sensitive' : ' is-revealed'}`.trim()}
      style={{
        background: showImg ? undefined : gradient,
        ...style,
      }}
    >
      <div className={`card-flip-inner${revealed ? ' is-flipped' : ''}`}>
        <div className="card-flip-face card-flip-front">{face}</div>
        <div className="card-flip-face card-flip-back">{face}</div>
      </div>
      {/* Uiverse lock toggle — Javierrocadev；checked = 已揭开 */}
      <label
        className="card-nsfw-lock"
        htmlFor={lockId}
        onClick={onLockActivate}
        onPointerDown={stopCardNav}
      >
        <input
          id={lockId}
          type="checkbox"
          className="card-nsfw-lock-input"
          checked={revealed}
          onChange={(e) => setReveal(e.target.checked)}
          onClick={stopCardNav}
          aria-label={revealed ? 'Hide NSFW cover' : 'Reveal NSFW cover'}
        />
        <span className="card-nsfw-lock-track" aria-hidden>
          <svg className="card-nsfw-lock-icon is-open" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            <path d="M50,18A19.9,19.9,0,0,0,30,38v8a8,8,0,0,0-8,8V74a8,8,0,0,0,8,8H70a8,8,0,0,0,8-8V54a8,8,0,0,0-8-8H38V38a12,12,0,0,1,23.6-3,4,4,0,1,0,7.8-2A20.1,20.1,0,0,0,50,18Z" />
          </svg>
          <svg className="card-nsfw-lock-icon is-closed" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            <path
              d="M30,46V38a20,20,0,0,1,40,0v8a8,8,0,0,1,8,8V74a8,8,0,0,1-8,8H30a8,8,0,0,1-8-8V54A8,8,0,0,1,30,46Zm32-8v8H38V38a12,12,0,0,1,24,0Z"
              fillRule="evenodd"
            />
          </svg>
        </span>
      </label>
      {children}
    </div>
  )
}
