import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import './Toggle.css'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel?: string
  size?: 'sm' | 'md'
  showLabels?: boolean
}

export function Toggle({
  checked,
  onChange,
  ariaLabel,
  size = 'sm',
  showLabels = true,
}: ToggleProps) {
  const id = useId()
  const { t } = useTranslation()

  return (
    <label
      className={`liquid-toggle size-${size} ${checked ? 'is-on' : 'is-off'}`}
      htmlFor={id}
    >
      {showLabels && (
        <span className="liquid-toggle-label liquid-toggle-label-off" aria-hidden>
          {t('common.off')}
        </span>
      )}
      <span className="liquid-toggle-track">
        <input
          id={id}
          type="checkbox"
          className="theme-checkbox"
          checked={checked}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.checked)}
        />
      </span>
      {showLabels && (
        <span className="liquid-toggle-label liquid-toggle-label-on" aria-hidden>
          {t('common.on')}
        </span>
      )}
    </label>
  )
}
