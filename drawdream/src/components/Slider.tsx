import {
  useId,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import './Slider.css'

export type SliderProps = {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  ariaLabel?: string
  disabled?: boolean
  /** 显示当前值文案，如 "16px" */
  formatValue?: (value: number) => string
  className?: string
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function snap(n: number, min: number, step: number) {
  if (step <= 0) return n
  const steps = Math.round((n - min) / step)
  return min + steps * step
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  disabled,
  formatValue,
  className = '',
}: SliderProps) {
  const id = useId()
  const trackRef = useRef<HTMLDivElement>(null)
  const range = max - min || 1
  const ratio = clamp((value - min) / range, 0, 1)
  const pct = `${ratio * 100}%`
  const display = useMemo(
    () => (formatValue ? formatValue(value) : String(value)),
    [formatValue, value],
  )

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const r = clamp((clientX - rect.left) / rect.width, 0, 1)
    const raw = min + r * range
    const next = clamp(snap(raw, min, step), min, max)
    // 避免浮点噪声
    const rounded = step >= 1 ? Math.round(next) : Math.round(next * 1000) / 1000
    if (rounded !== value) onChange(rounded)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setFromClientX(e.clientX)
    const move = (ev: PointerEvent) => setFromClientX(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    const delta = e.shiftKey ? step * 5 : step
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange(clamp(value - delta, min, max))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange(clamp(value + delta, min, max))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange(min)
    } else if (e.key === 'End') {
      e.preventDefault()
      onChange(max)
    }
  }

  return (
    <div
      className={`dd-slider${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
    >
      <div
        ref={trackRef}
        className="dd-slider-track"
        onPointerDown={onPointerDown}
        style={{ ['--pct' as string]: pct }}
      >
        <div className="dd-slider-fill" />
        <button
          type="button"
          id={id}
          className="dd-slider-thumb"
          role="slider"
          aria-label={ariaLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={display}
          aria-disabled={disabled || undefined}
          disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={onKeyDown}
          style={{ left: pct }}
        />
      </div>
      {formatValue ? <span className="dd-slider-value">{display}</span> : null}
    </div>
  )
}
