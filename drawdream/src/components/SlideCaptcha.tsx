import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Check, ChevronRight, RefreshCw } from 'lucide-react'
import './SlideCaptcha.css'

export type SlideCaptchaProps = {
  onChange?: (ok: boolean) => void
  resetKey?: number | string
  disabled?: boolean
  label?: string
  hint?: string
  successLabel?: string
  /** 成功后展示「击败了 x% 的用户」 */
  beatTemplate?: string
}

const THRESHOLD = 0.92

function rollBeatPercent(): number {
  // 伪随机：多数落在 72–98，偶尔更高/更低，带一位小数更像真实产品
  const base = 72 + Math.random() * 26
  return Math.round(base * 10) / 10
}

export function SlideCaptcha({
  onChange,
  resetKey,
  disabled = false,
  label = '滑动验证',
  hint = '按住滑块拖到最右侧',
  successLabel = '验证通过',
  beatTemplate = '击败了 {n}% 的用户',
}: SlideCaptchaProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startRatio = useRef(0)
  const [ratio, setRatio] = useState(0)
  const [ok, setOk] = useState(false)
  const [beat, setBeat] = useState<number | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  const [shake, setShake] = useState(false)
  const labelId = useId()

  const reset = useCallback(() => {
    dragging.current = false
    setRatio(0)
    setOk(false)
    setBeat(null)
    setCelebrate(false)
    setShake(false)
    onChange?.(false)
  }, [onChange])

  useEffect(() => {
    reset()
  }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const getMaxTravel = useCallback(() => {
    const el = trackRef.current
    if (!el) return 240
    return Math.max(1, el.clientWidth - 44 - 4)
  }, [])

  const [trackW, setTrackW] = useState(0)
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => setTrackW(el.clientWidth)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [resetKey])

  const commit = (next: number, end: boolean) => {
    const r = Math.min(1, Math.max(0, next))
    setRatio(r)
    if (!end) return
    if (r >= THRESHOLD && !disabled) {
      setRatio(1)
      setOk(true)
      const n = rollBeatPercent()
      setBeat(n)
      setCelebrate(true)
      window.setTimeout(() => setCelebrate(false), 900)
      onChange?.(true)
    } else {
      setShake(true)
      window.setTimeout(() => setShake(false), 420)
      setRatio(0)
      setOk(false)
      setBeat(null)
      onChange?.(false)
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || ok) return
    dragging.current = true
    startX.current = e.clientX
    startRatio.current = ratio
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging.current || ok) return
    const dx = e.clientX - startX.current
    commit(startRatio.current + dx / getMaxTravel(), false)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return
    dragging.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const dx = e.clientX - startX.current
    commit(startRatio.current + dx / getMaxTravel(), true)
  }

  const travel = Math.max(1, (trackW || 280) - 48)
  const thumbLeft = 2 + ratio * travel
  const fillWidth = Math.max(thumbLeft + 22, ratio > 0 ? 44 : 0)
  const beatText =
    beat != null ? beatTemplate.replace('{n}', String(beat)) : ''

  return (
    <div
      className={`dd-slide-captcha ${ok ? 'is-ok' : ''} ${disabled ? 'is-disabled' : ''} ${
        shake ? 'is-shake' : ''
      } ${celebrate ? 'is-celebrate' : ''}`}
    >
      <div className="dd-slide-captcha-label" id={labelId}>
        <span>{label}</span>
        {ok ? (
          <button
            type="button"
            className="dd-slide-captcha-retry"
            onClick={reset}
            disabled={disabled}
            aria-label="reset"
          >
            <RefreshCw size={14} />
          </button>
        ) : null}
      </div>
      <div
        ref={trackRef}
        className="dd-slide-captcha-track"
        role="slider"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-disabled={disabled || ok}
      >
        <div className="dd-slide-captcha-shine" aria-hidden />
        <div className="dd-slide-captcha-fill" style={{ width: ok ? '100%' : fillWidth }} />
        <span className="dd-slide-captcha-hint">{ok ? successLabel : hint}</span>
        <button
          type="button"
          className="dd-slide-captcha-thumb"
          style={ok ? undefined : { left: thumbLeft }}
          disabled={disabled || ok}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label={hint}
        >
          {ok ? <Check size={18} strokeWidth={2.5} /> : <ChevronRight size={18} strokeWidth={2.5} />}
        </button>
        {celebrate
          ? Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className={`dd-slide-captcha-spark s${i}`} aria-hidden />
            ))
          : null}
      </div>
      <div className={`dd-slide-captcha-beat ${ok && beat != null ? 'is-show' : ''}`} aria-live="polite">
        {ok && beat != null ? beatText : '\u00a0'}
      </div>
    </div>
  )
}
