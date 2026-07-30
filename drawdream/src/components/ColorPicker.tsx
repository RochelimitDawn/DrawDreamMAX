import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import './ColorPicker.css'

export type ColorPickerProps = {
  value: string
  onChange: (hex: string) => void
  ariaLabel?: string
  disabled?: boolean
  /** 弹出方向，默认 bottom */
  placement?: 'bottom' | 'top'
  presets?: string[]
}

const DEFAULT_PRESETS = [
  '#e8e6e3',
  '#f4f7fb',
  '#c9a46c',
  '#f5c542',
  '#e06c75',
  '#7ec8e3',
  '#98c379',
  '#c678dd',
  '#56b6c2',
  '#c47a3a',
  '#1a1b22',
  '#121826',
]

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return `#${s.toLowerCase()}`
}

/** hex → HSV (h 0–360, s/v 0–1) */
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = normalizeHex(hex) || '#888888'
  const r = parseInt(n.slice(1, 3), 16) / 255
  const g = parseInt(n.slice(3, 5), 16) / 255
  const b = parseInt(n.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (hh < 60) [r, g, b] = [c, x, 0]
  else if (hh < 120) [r, g, b] = [x, c, 0]
  else if (hh < 180) [r, g, b] = [0, c, x]
  else if (hh < 240) [r, g, b] = [0, x, c]
  else if (hh < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

function hueCss(h: number) {
  return hsvToHex(h, 1, 1)
}

export function ColorPicker({
  value,
  onChange,
  ariaLabel,
  disabled,
  placement = 'bottom',
  presets = DEFAULT_PRESETS,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const hex = normalizeHex(value) || '#888888'
  const hsv = useMemo(() => hexToHsv(hex), [hex])
  const [hexDraft, setHexDraft] = useState(hex)

  useEffect(() => {
    if (open) setHexDraft(hex)
  }, [open, hex])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const commitHsv = (h: number, s: number, v: number) => {
    onChange(hsvToHex(h, s, v))
  }

  const bindDrag = (
    el: HTMLElement | null,
    onPos: (clientX: number, clientY: number, rect: DOMRect) => void,
  ) => {
    if (!el) return
    const move = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      onPos(e.clientX, e.clientY, rect)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onSvPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.preventDefault()
    const el = svRef.current
    if (!el) return
    const apply = (cx: number, cy: number, rect: DOMRect) => {
      const s = clamp((cx - rect.left) / rect.width, 0, 1)
      const v = clamp(1 - (cy - rect.top) / rect.height, 0, 1)
      commitHsv(hsv.h, s, v)
    }
    apply(e.clientX, e.clientY, el.getBoundingClientRect())
    bindDrag(el, apply)
  }

  const onHuePointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.preventDefault()
    const el = hueRef.current
    if (!el) return
    const apply = (cx: number, _cy: number, rect: DOMRect) => {
      const h = clamp(((cx - rect.left) / rect.width) * 360, 0, 359.999)
      commitHsv(h, hsv.s, hsv.v)
    }
    apply(e.clientX, e.clientY, el.getBoundingClientRect())
    bindDrag(el, apply)
  }

  const applyHexDraft = () => {
    const n = normalizeHex(hexDraft)
    if (n) onChange(n)
    else setHexDraft(hex)
  }

  return (
    <div
      className={`dd-color${disabled ? ' is-disabled' : ''}${open ? ' is-open' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="dd-color-swatch"
        style={{ ['--swatch' as string]: hex }}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((v) => !v)
        }}
      >
        <span className="dd-color-swatch-fill" />
      </button>

      {open ? (
        <div
          id={panelId}
          className={`dd-color-pop placement-${placement}`}
          role="dialog"
          aria-label={ariaLabel}
        >
          <div
            ref={svRef}
            className="dd-color-sv"
            style={{ backgroundColor: hueCss(hsv.h) }}
            onPointerDown={onSvPointer}
          >
            <div className="dd-color-sv-white" />
            <div className="dd-color-sv-black" />
            <span
              className="dd-color-sv-thumb"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                background: hex,
              }}
            />
          </div>

          <div
            ref={hueRef}
            className="dd-color-hue"
            onPointerDown={onHuePointer}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            aria-label="Hue"
            tabIndex={0}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault()
                commitHsv(clamp(hsv.h - 2, 0, 360), hsv.s, hsv.v)
              } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault()
                commitHsv(clamp(hsv.h + 2, 0, 360), hsv.s, hsv.v)
              }
            }}
          >
            <span
              className="dd-color-hue-thumb"
              style={{ left: `${(hsv.h / 360) * 100}%`, background: hueCss(hsv.h) }}
            />
          </div>

          <div className="dd-color-hex-row">
            <span className="dd-color-hex-prefix">#</span>
            <input
              className="dd-color-hex-input"
              value={hexDraft.replace(/^#/, '')}
              spellCheck={false}
              maxLength={6}
              aria-label="Hex"
              onChange={(e) => setHexDraft(`#${e.target.value.replace(/[^0-9a-fA-F]/g, '')}`)}
              onBlur={applyHexDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyHexDraft()
                }
              }}
            />
            <span className="dd-color-preview" style={{ background: hex }} />
          </div>

          {presets.length > 0 ? (
            <div className="dd-color-presets" role="list">
              {presets.map((p) => {
                const ph = normalizeHex(p) || p
                const active = ph === hex
                return (
                  <button
                    key={ph}
                    type="button"
                    role="listitem"
                    className={`dd-color-preset${active ? ' is-active' : ''}`}
                    style={{ background: ph }}
                    aria-label={ph}
                    onClick={() => onChange(ph)}
                  />
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
