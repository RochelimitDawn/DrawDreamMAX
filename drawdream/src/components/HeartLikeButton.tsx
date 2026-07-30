import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react'
import './HeartLikeButton.css'

interface HeartLikeButtonProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 未选中文案，默认 i18n common.like */
  labelOff?: string
  /** 已选中文案，默认 i18n common.liked */
  labelOn?: string
  showLabel?: boolean
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
  disabled?: boolean
}

export function HeartLikeButton({
  checked,
  onChange,
  labelOff,
  labelOn,
  showLabel = true,
  size = 'md',
  className = '',
  ariaLabel,
  disabled = false,
}: HeartLikeButtonProps) {
  const id = useId()
  const { t } = useTranslation()
  const offText = labelOff ?? t('common.like')
  const onText = labelOn ?? t('common.liked')
  const iconSize = size === 'sm' ? 18 : 24

  return (
    <div className={`heart-like size-${size} ${checked ? 'is-on' : ''} ${className}`.trim()}>
      <input
        id={id}
        type="checkbox"
        className="heart-like-input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel ?? (checked ? onText : offText)}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} className="heart-like-label">
        <Heart
          className="heart-like-icon"
          size={iconSize}
          strokeWidth={1.75}
          fill={checked ? 'currentColor' : 'none'}
          aria-hidden
        />
        {showLabel && (
          <span className="heart-like-action" aria-hidden>
            <span className="heart-like-option option-1">{offText}</span>
            <span className="heart-like-option option-2">{onText}</span>
          </span>
        )}
      </label>
    </div>
  )
}
