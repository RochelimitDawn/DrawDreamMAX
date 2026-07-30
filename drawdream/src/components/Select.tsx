import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import './Select.css'

export interface SelectOption {
  value: string
  label: string
  icon?: ReactNode
  meta?: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  fullWidth?: boolean
  size?: 'md' | 'sm'
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  fullWidth,
  size = 'md',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const resolvedPlaceholder = placeholder ?? '…'
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
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
  }, [])

  return (
    <div className={`dd-select ${fullWidth ? 'is-full' : ''} size-${size}`} ref={rootRef}>
      <button
        type="button"
        className={`dd-select-trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`dd-select-value ${selected ? '' : 'is-placeholder'}`}>
          {selected?.icon ? <span className="dd-select-icon">{selected.icon}</span> : null}
          <span className="dd-select-label-text">{selected?.label ?? resolvedPlaceholder}</span>
          {selected?.meta ? <span className="dd-select-meta">{selected.meta}</span> : null}
        </span>
        <ChevronDown size={16} className={`dd-select-chevron ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <ul className="dd-select-menu" role="listbox" id={listId}>
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`dd-select-option ${active ? 'is-active' : ''}`}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                >
                  {opt.icon ? <span className="dd-select-icon">{opt.icon}</span> : null}
                  <span className="dd-select-option-main">
                    <span>{opt.label}</span>
                    {opt.meta ? <small>{opt.meta}</small> : null}
                  </span>
                  {active && <Check size={15} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
