import { useEffect, useId, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Lightbulb } from 'lucide-react'
import './ThinkingBlock.css'

export type ThinkingBlockProps = {
  text: string
  streaming?: boolean
  /** 结束后默认是否展开；流式中始终可展开，默认开 */
  defaultOpen?: boolean
  /** 结束后自动收起（DeepSeek 风格） */
  autoCollapseOnEnd?: boolean
  labelIdle?: string
  labelLive?: string
  labelDone?: string
  className?: string
}

/**
 * 可折叠思考块：流式时扫光标题 + 呼吸图标；结束后可自动收起。
 * 主对话与侧栏助手共用。
 */
export function ThinkingBlock({
  text,
  streaming = false,
  defaultOpen,
  autoCollapseOnEnd = true,
  labelIdle = '思考过程',
  labelLive = '思考中…',
  labelDone = '已思考',
  className = '',
}: ThinkingBlockProps) {
  const body = (text || '').trim()
  const panelId = useId()
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  useEffect(() => {
    if (streaming) {
      setUserOpen(null)
      return
    }
    if (autoCollapseOnEnd) setUserOpen(false)
  }, [streaming, autoCollapseOnEnd])

  if (!body && !streaming) return null

  const fallbackOpen = streaming ? true : defaultOpen ?? false
  const open = userOpen ?? fallbackOpen
  const title = streaming ? labelLive : body ? labelDone : labelIdle

  return (
    <div
      className={`dd-think${streaming ? ' is-live' : ''}${open ? ' is-open' : ''} ${className}`.trim()}
    >
      <button
        type="button"
        className="dd-think-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setUserOpen(!open)}
      >
        <span className="dd-think-icon" aria-hidden>
          {streaming ? <Bot size={14} strokeWidth={1.85} /> : <Lightbulb size={14} strokeWidth={1.85} />}
        </span>
        <span className={`dd-think-title${streaming ? ' is-shiny' : ''}`}>{title}</span>
        <span className="dd-think-chevron" aria-hidden>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && body ? (
        <div id={panelId} className="dd-think-body" role="region">
          <pre className="dd-think-pre">{body}</pre>
        </div>
      ) : null}
      {open && streaming && !body ? (
        <div id={panelId} className="dd-think-body is-waiting" role="status">
          <span className="dd-think-breath-dot" />
          <span className="dd-think-breath-dot" />
          <span className="dd-think-breath-dot" />
        </div>
      ) : null}
    </div>
  )
}
