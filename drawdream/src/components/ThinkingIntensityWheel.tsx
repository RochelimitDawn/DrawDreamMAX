import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import './ThinkingIntensityWheel.css'

export type ThinkingIntensity = 'low' | 'medium' | 'high'

export interface ThinkingIntensityOption {
  value: ThinkingIntensity
  num: string
  label: string
  angle: number
}

interface ThinkingIntensityWheelProps {
  value: ThinkingIntensity
  onChange: (value: ThinkingIntensity) => void
  options?: ThinkingIntensityOption[]
  className?: string
  showHint?: boolean
}

const DEFAULT_ANGLES: Record<ThinkingIntensity, number> = {
  low: -30,
  medium: 0,
  high: 30,
}

export function ThinkingIntensityWheel({
  value,
  onChange,
  options,
  className = '',
  showHint = true,
}: ThinkingIntensityWheelProps) {
  const uid = useId()
  const { t } = useTranslation()

  const items: ThinkingIntensityOption[] =
    options ??
    ([
      { value: 'low', num: '01', label: t('settings.thinkingLow'), angle: DEFAULT_ANGLES.low },
      {
        value: 'medium',
        num: '02',
        label: t('settings.thinkingMedium'),
        angle: DEFAULT_ANGLES.medium,
      },
      { value: 'high', num: '03', label: t('settings.thinkingHigh'), angle: DEFAULT_ANGLES.high },
    ] satisfies ThinkingIntensityOption[])

  const order = items.map((o) => o.value)
  const activeIndex = Math.max(0, order.indexOf(value))
  const nextValue = order[(activeIndex + 1) % order.length]

  return (
    <div
      className={`wheel-selector intensity-${value} ${className}`.trim()}
      data-intensity={value}
    >
      {showHint && (
        <span className="wheel-hint" aria-hidden>
          {t('settings.thinkingHint')}
        </span>
      )}
      <div
        className="radio-input"
        role="radiogroup"
        aria-label={t('settings.thinkingIntensity')}
      >
        <span className="glass-overlay" aria-hidden />
        {items.map((item) => {
          const inputId = `${uid}-${item.value}`
          const checked = value === item.value
          return (
            <div key={item.value} className="wheel-slot">
              <input
                id={inputId}
                className="wheel-radio"
                type="radio"
                name={`${uid}-thinking`}
                value={item.value}
                checked={checked}
                onChange={() => onChange(item.value)}
              />
              <label
                htmlFor={inputId}
                className={`wheel-label ${checked ? 'is-active' : ''}`}
                style={{ ['--angle' as string]: `${item.angle}deg` }}
              >
                <span className="wheel-num">{item.num}</span>
                <span className="wheel-text">{item.label}</span>
              </label>
            </div>
          )
        })}
        <button
          type="button"
          className="wheel-next-trigger"
          tabIndex={-1}
          aria-label={t('settings.thinkingNext')}
          onClick={() => onChange(nextValue)}
        />
      </div>
    </div>
  )
}
