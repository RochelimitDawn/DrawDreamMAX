import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ProviderIcon } from './ProviderIcon'
import './PresetPicker.css'

export type PresetOption = {
  name: string
  baseUrl: string
  api: string
  label: string
}

type Props = {
  value: string
  options: PresetOption[]
  onChange: (name: string) => void
  label?: string
}

export function PresetPicker({ value, options, onChange, label }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const current = options.find((o) => o.name === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="preset-picker" ref={rootRef}>
      {label ? <label className="field-label">{label}</label> : null}
      <button
        type="button"
        className={`preset-picker-trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="preset-picker-current">
          {current ? (
            <>
              <ProviderIcon name={current.name} baseUrl={current.baseUrl} size={18} />
              <strong>{current.label}</strong>
            </>
          ) : (
            <strong>…</strong>
          )}
        </span>
        <ChevronDown size={16} className="preset-picker-chevron" />
      </button>
      {open ? (
        <ul id={listId} className="preset-picker-menu" role="listbox">
          {options.map((p) => (
            <li key={p.name} role="option" aria-selected={p.name === value}>
              <button
                type="button"
                className={`preset-picker-item ${p.name === value ? 'is-on' : ''}`}
                onClick={() => {
                  onChange(p.name)
                  setOpen(false)
                }}
              >
                <ProviderIcon name={p.name} baseUrl={p.baseUrl} size={18} />
                <span className="preset-picker-item-main">
                  <strong>{p.label}</strong>
                  <small>{p.baseUrl}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
