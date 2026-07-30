import { useEffect, useState } from 'react'
import './StudioEditor.css'

type Props = {
  title: string
  subtitle?: string
  value: string
  onChange: (v: string) => void
  onSave?: () => void
  saveLabel?: string
  placeholder?: string
  rows?: number
  mono?: boolean
  footer?: React.ReactNode
  toolbar?: React.ReactNode
  dirty?: boolean
}

/** 通用资料编辑器：标题 + 工具条 + 大文本域 + 保存 */
export function StudioEditor({
  title,
  subtitle,
  value,
  onChange,
  onSave,
  saveLabel = '保存',
  placeholder,
  rows = 16,
  mono,
  footer,
  toolbar,
  dirty,
}: Props) {
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])

  return (
    <div className={`studio-editor${dirty ? ' is-dirty' : ''}`}>
      <header className="studio-editor-head">
        <div className="studio-editor-titles">
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="studio-editor-actions">
          {toolbar}
          {onSave ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={!dirty && dirty !== undefined}>
              {saveLabel}
            </button>
          ) : null}
        </div>
      </header>
      <textarea
        className={`studio-editor-area${mono ? ' is-mono' : ''}`}
        value={local}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => {
          setLocal(e.target.value)
          onChange(e.target.value)
        }}
        spellCheck={false}
      />
      {footer ? <footer className="studio-editor-foot">{footer}</footer> : null}
    </div>
  )
}
