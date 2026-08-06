import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, Gauge, Globe, ImagePlus, Paperclip, Send, Square } from 'lucide-react'
import './ChatComposer.css'

export type ChatComposerProps = {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onAbort?: () => void
  busy?: boolean
  disabled?: boolean
  placeholder?: string
  /** Enter 发送（Shift 换行）；false 时需 Ctrl/Cmd+Enter */
  enterSend?: boolean
  /** 紧凑模式（助手侧栏） */
  compact?: boolean
  className?: string
  /** 斜杠菜单等：焦点时的键盘扩展 */
  onKeyDownExtra?: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean | void
  /** 本轮联网搜索（会话级，与设置 smartSearch 独立） */
  webSearch?: boolean
  onWebSearchChange?: (on: boolean) => void
  /** 深度思考档；空数组则按钮禁用 */
  thinkingLevel?: string
  thinkingLevels?: string[]
  /** 点击思考按钮直接循环切换（旧行为） */
  onThinkingCycle?: () => void
  /** 从浮动面板选定具体档位（新行为，优先于 onThinkingCycle） */
  onThinkingSelect?: (level: string) => void
  onPickImage?: (file: File) => void | Promise<void>
  onPickFile?: (file: File) => void | Promise<void>
  uploading?: boolean
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  onAbort,
  busy = false,
  disabled = false,
  placeholder,
  enterSend = true,
  compact = false,
  className = '',
  onKeyDownExtra,
  webSearch = false,
  onWebSearchChange,
  thinkingLevel = '',
  thinkingLevels = [],
  onThinkingCycle,
  onThinkingSelect,
  onPickImage,
  onPickFile,
  uploading = false,
}: ChatComposerProps) {
  const { t } = useTranslation()
  const uid = useId()
  const taRef = useRef<HTMLTextAreaElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const thinkWrapRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(false)
  const hasText = value.trim().length > 0
  const canThink = (thinkingLevels?.length ?? 0) >= 2
  const expanded = focused || hasText || busy
  const ph = placeholder || t('chat.composerPlaceholder')

  // 点击面板外部关闭
  useEffect(() => {
    if (!thinkOpen) return
    const onDocDown = (e: MouseEvent) => {
      const el = thinkWrapRef.current
      if (el && !el.contains(e.target as Node)) setThinkOpen(false)
    }
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setThinkOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onDocKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onDocKey)
    }
  }, [thinkOpen])

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = compact ? 72 : 88
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
  }, [value, compact])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onKeyDownExtra?.(e) === true) return
    if (e.key === 'Enter' && !e.shiftKey) {
      if (enterSend) {
        e.preventDefault()
        if (e.repeat) return
        if (!busy && !disabled && hasText) onSend()
      }
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !enterSend) {
      e.preventDefault()
      if (e.repeat) return
      if (!busy && !disabled && hasText) onSend()
    }
  }

  const pickImage = (list: FileList | null) => {
    const f = list?.[0]
    if (f && onPickImage) void onPickImage(f)
    if (imageRef.current) imageRef.current.value = ''
  }

  const pickFile = (list: FileList | null) => {
    const f = list?.[0]
    if (f && onPickFile) void onPickFile(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  const thinkLabel = canThink
    ? `${t('chat.thinkingCycle')}: ${thinkingLevel || t('chat.thinkingOff')}`
    : t('chat.thinkingUnsupported')

  return (
    <div
      className={`dd-composer${compact ? ' is-compact' : ''}${expanded ? ' is-expanded' : ''}${
        hasText ? ' has-text' : ''
      }${webSearch ? ' is-web-on' : ''}${busy ? ' is-busy' : ''}${className ? ` ${className}` : ''}`}
    >
      <input
        ref={imageRef}
        id={`${uid}-img`}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => pickImage(e.target.files)}
      />
      <input
        ref={fileRef}
        id={`${uid}-file`}
        type="file"
        accept="*/*"
        hidden
        onChange={(e) => pickFile(e.target.files)}
      />

      <div className="dd-composer-tools" aria-hidden={expanded}>
        <button
          type="button"
          className={`dd-composer-tool${webSearch ? ' is-on' : ''}`}
          title={webSearch ? t('chat.webSearchOn') : t('chat.webSearchOff')}
          aria-pressed={webSearch}
          disabled={disabled || !onWebSearchChange}
          onClick={() => onWebSearchChange?.(!webSearch)}
        >
          <Globe size={compact ? 15 : 17} strokeWidth={1.85} />
        </button>
        <button
          type="button"
          className="dd-composer-tool"
          title={t('chat.pickImage')}
          disabled={disabled || uploading || !onPickImage}
          onClick={() => imageRef.current?.click()}
        >
          <ImagePlus size={compact ? 15 : 17} strokeWidth={1.85} />
        </button>
        <button
          type="button"
          className="dd-composer-tool"
          title={t('chat.pickFile')}
          disabled={disabled || uploading || !onPickFile}
          onClick={() => fileRef.current?.click()}
        >
          <FileUp size={compact ? 15 : 17} strokeWidth={1.85} />
        </button>
      </div>

      <button
        type="button"
        className="dd-composer-attach"
        title={t('chat.pickFile')}
        disabled={disabled || uploading || !onPickFile}
        tabIndex={expanded ? 0 : -1}
        onClick={() => fileRef.current?.click()}
      >
        <Paperclip size={compact ? 15 : 16} strokeWidth={1.9} />
      </button>

      <div className="dd-composer-field">
        <textarea
          ref={taRef}
          className="dd-composer-input"
          value={value}
          rows={1}
          placeholder={ph}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="dd-composer-end">
        <div className="dd-think-wrap" ref={thinkWrapRef}>
          <button
            type="button"
            className={`dd-composer-think${canThink && thinkingLevel && !/^(off|none|disabled|false|0)$/i.test(thinkingLevel) ? ' is-on' : ''}`}
            title={thinkLabel}
            aria-label={thinkLabel}
            aria-expanded={thinkOpen}
            disabled={disabled || !canThink}
            onClick={() => {
              if (!canThink) return
              if (onThinkingSelect) {
                setThinkOpen((v) => !v)
              } else {
                onThinkingCycle?.()
              }
            }}
          >
            <Gauge size={compact ? 15 : 16} strokeWidth={1.85} />
            {!compact && canThink && thinkingLevel ? (
              <span className="dd-composer-think-lv">{thinkingLevel}</span>
            ) : null}
          </button>
          {canThink && onThinkingSelect && thinkOpen ? (
            <div className="dd-think-popover" role="menu">
              <div className="dd-think-popover-title">{t('chat.thinkingLevel')}</div>
              {thinkingLevels.map((lv) => {
                const active = lv === thinkingLevel
                return (
                  <button
                    key={lv}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`dd-think-opt${active ? ' is-active' : ''}`}
                    onClick={() => {
                      onThinkingSelect?.(lv)
                      setThinkOpen(false)
                    }}
                  >
                    <span className="dd-think-opt-name">{lv}</span>
                    {active ? <span className="dd-think-opt-check">✓</span> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        {busy ? (
          <button
            type="button"
            className="dd-composer-send is-stop"
            title={t('chat.stop')}
            onClick={() => onAbort?.()}
          >
            <Square size={compact ? 13 : 14} />
          </button>
        ) : (
          <button
            type="button"
            className="dd-composer-send"
            title={t('chat.send')}
            disabled={disabled || !hasText || uploading}
            onClick={() => onSend()}
          >
            <Send size={compact ? 14 : 15} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}
