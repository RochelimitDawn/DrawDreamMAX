import { useEffect, useId, useRef, useState } from 'react'
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

/** 思考实时计时：直接写 DOM 文本，不触发父组件重渲染；结束后冻结显示耗时 */
function ThinkTimer({ streaming }: { streaming: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const startRef = useRef(performance.now())
  const lastRef = useRef('0.0s')

  useEffect(() => {
    if (!streaming) {
      if (ref.current && ref.current.textContent !== lastRef.current) {
        ref.current.textContent = lastRef.current
        ref.current.setAttribute('aria-label', lastRef.current)
      }
      return
    }
    let raf = 0
    const loop = () => {
      const ms = performance.now() - startRef.current
      const s = (ms / 1000).toFixed(1)
      lastRef.current = `${s}s`
      if (ref.current && ref.current.textContent !== `${s}s`) {
        ref.current.textContent = `${s}s`
        ref.current.setAttribute('aria-label', `${s}s`)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [streaming])

  return (
    <span className="dd-think-timer" ref={ref} aria-label="0.0s">
      0.0s
    </span>
  )
}

/**
 * 可折叠思考块：流式时扫光标题 + 呼吸图标 + 实时计时；结束后可自动收起。
 * 主对话与侧栏助手共用。
 */
export function ThinkingBlock({
  text,
  streaming = false,
  defaultOpen,
  autoCollapseOnEnd = true,
  labelIdle = '思考过程',
  labelLive = '思考中',
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
        {body || streaming ? <ThinkTimer streaming={streaming} /> : null}
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
