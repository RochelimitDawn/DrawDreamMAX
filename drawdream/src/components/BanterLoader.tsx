import './BanterLoader.css'

type Props = {
  label?: string
  className?: string
  /** rect | triangle | circle — Uiverse mobinkakei */
  variant?: 'rect' | 'triangle' | 'circle'
}

/** 门页 / 鉴权加载：Uiverse geometric path loader */
export function BanterLoader({ label, className, variant = 'rect' }: Props) {
  return (
    <div
      className={className ? `auth-loading-page ${className}` : 'auth-loading-page'}
      role="status"
      aria-live="polite"
    >
      <div className={`dd-geo-loader${variant === 'triangle' ? ' triangle' : ''}`} aria-hidden>
        <svg viewBox="0 0 80 80">
          {variant === 'triangle' ? (
            <polygon points="16 64 40 16 64 64" />
          ) : variant === 'circle' ? (
            <circle r="32" cx="40" cy="40" />
          ) : (
            <rect x="8" y="8" width="64" height="64" rx="8" />
          )}
        </svg>
      </div>
      {label ? <p className="auth-loading-label">{label}</p> : null}
    </div>
  )
}
