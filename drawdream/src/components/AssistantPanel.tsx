import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Sparkles } from 'lucide-react'
import type { AssistantSnapshot } from '../agent/session-store'
import type { AssistantMsg } from '../agent/wire.types'
import { RichMessage } from './RichMessage'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallList, coalesceActivities } from './ToolCallChip'
import { ChatComposer } from './ChatComposer'
import './AssistantPanel.css'

export type AssistantPanelProps = {
  asst: AssistantSnapshot
  connOpen: boolean
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  onAbort: () => void
  onClear: () => void
  userName?: string
  charName?: string
  toolLocale?: 'zh' | 'en'
  webSearch?: boolean
  onWebSearchChange?: (on: boolean) => void
  thinkingLevel?: string
  thinkingLevels?: string[]
  onThinkingCycle?: () => void
  onPickImage?: (file: File) => void | Promise<void>
  onPickFile?: (file: File) => void | Promise<void>
  uploading?: boolean
  enterSend?: boolean
}

function ProcessMeta({
  busy,
  stepCount,
  expanded,
  onToggle,
  labels,
}: {
  busy: boolean
  stepCount: number
  expanded: boolean
  onToggle: () => void
  labels: { processing: string; done: string; steps: (n: number) => string }
}) {
  const main = busy
    ? labels.processing
    : stepCount > 0
      ? labels.steps(stepCount)
      : labels.done
  return (
    <button
      type="button"
      className={`asst-process-meta${busy ? ' is-live' : ''}`}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {busy ? (
        <span className="asst-process-logo" aria-hidden>
          <Bot size={14} strokeWidth={1.8} />
        </span>
      ) : (
        <span className="asst-process-logo is-idle" aria-hidden>
          <Sparkles size={13} strokeWidth={1.85} />
        </span>
      )}
      <span className={`asst-process-label${busy ? ' is-shiny' : ''}`}>{main}</span>
      <span className="asst-process-chevron" aria-hidden>
        {expanded ? '▾' : '▸'}
      </span>
    </button>
  )
}

function AssistantReplyCard({
  m,
  streaming,
  streamThinking,
  streamText,
  liveActs,
  busy,
  userName,
  charName,
  toolLocale,
  t,
}: {
  m?: AssistantMsg
  streaming?: boolean
  streamThinking?: string
  streamText?: string
  liveActs?: AssistantSnapshot['liveActs']
  busy?: boolean
  userName?: string
  charName?: string
  toolLocale: 'zh' | 'en'
  t: (k: string, o?: Record<string, unknown>) => string
}) {
  const thinking = streaming ? streamThinking || '' : m?.thinking || ''
  const text = streaming ? streamText || '' : m?.text || ''
  const acts = streaming ? liveActs || [] : m?.activities || []
  const tools = useMemo(() => coalesceActivities(acts, toolLocale), [acts, toolLocale])
  const hasProcess = Boolean(thinking.trim() || tools.length)
  const [processOpen, setProcessOpen] = useState(true)

  useEffect(() => {
    if (streaming || busy) setProcessOpen(true)
    else if (hasProcess) setProcessOpen(false)
  }, [streaming, busy, hasProcess])

  const showWaiting =
    streaming && busy && !text.trim() && !thinking.trim() && tools.length === 0

  return (
    <article
      className={`asst-card asst-card-assistant${streaming ? ' is-streaming' : ''}`}
      aria-busy={streaming || undefined}
    >
      <header className="asst-card-head">
        <span className="asst-card-avatar" aria-hidden>
          <Bot size={14} strokeWidth={1.9} />
        </span>
        <span className="asst-card-name">{t('chat.assistantPanel')}</span>
        {streaming ? <span className="asst-card-tag is-live">{t('chat.typing')}</span> : null}
      </header>

      {hasProcess ? (
        <div className="asst-process">
          <ProcessMeta
            busy={!!(streaming || busy)}
            stepCount={tools.length + (thinking.trim() ? 1 : 0)}
            expanded={processOpen}
            onToggle={() => setProcessOpen((v) => !v)}
            labels={{
              processing: t('chat.asstProcessing'),
              done: t('chat.asstProcessed'),
              steps: (n) => t('chat.asstProcessSteps', { count: n }),
            }}
          />
          {processOpen ? (
            <div className="asst-process-body">
              {thinking.trim() || (streaming && busy) ? (
                <ThinkingBlock
                  text={thinking}
                  streaming={!!streaming && !!busy && !text.trim()}
                  autoCollapseOnEnd={!streaming}
                  labelIdle={t('chat.thinking')}
                  labelLive={t('chat.asstThinkingLive')}
                  labelDone={t('chat.asstThinkingDone')}
                />
              ) : null}
              {tools.length ? <ToolCallList items={tools} max={12} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {showWaiting ? (
        <div className="asst-waiting" role="status">
          <span className="asst-waiting-orb" aria-hidden />
          <span className="asst-waiting-text is-shiny">{t('chat.asstWorking')}</span>
        </div>
      ) : null}

      {text.trim() ? (
        <div className={`asst-card-body${streaming ? ' is-stream-md' : ''}`}>
          <RichMessage
            text={text}
            rich
            streaming={!!streaming}
            className="msg-text asst-md"
            userName={userName}
            charName={charName}
          />
          {streaming ? <span className="asst-caret" aria-hidden /> : null}
        </div>
      ) : null}
    </article>
  )
}

function UserCard({ text, label }: { text: string; label: string }) {
  return (
    <article className="asst-card asst-card-user">
      <header className="asst-card-head">
        <span className="asst-card-name is-user">{label}</span>
      </header>
      <div className="asst-card-body asst-plain">{text}</div>
    </article>
  )
}

export function AssistantPanel({
  asst,
  connOpen,
  input,
  onInputChange,
  onSend,
  onAbort,
  onClear,
  userName,
  charName,
  toolLocale = 'zh',
  webSearch = false,
  onWebSearchChange,
  thinkingLevel = '',
  thinkingLevels = [],
  onThinkingCycle,
  onPickImage,
  onPickFile,
  uploading = false,
  enterSend = true,
}: AssistantPanelProps) {
  const { t } = useTranslation()
  const streamRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const manualScrollRef = useRef(false)
  const scrollRafRef = useRef(0)
  const STICK_PX = 96

  const liveStreaming =
    asst.busy ||
    Boolean(asst.streamText) ||
    Boolean(asst.streamThinking) ||
    asst.liveActs.length > 0

  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    const syncStick = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      if (dist <= 2) manualScrollRef.current = false
      stickRef.current = !manualScrollRef.current && dist <= STICK_PX
    }
    const releaseStick = (event: WheelEvent | TouchEvent) => {
      if (event instanceof WheelEvent && event.deltaY >= 0) return
      manualScrollRef.current = true
      stickRef.current = false
    }
    el.addEventListener('scroll', syncStick, { passive: true })
    el.addEventListener('wheel', releaseStick, { passive: true })
    el.addEventListener('touchstart', releaseStick, { passive: true })
    syncStick()
    return () => {
      el.removeEventListener('scroll', syncStick)
      el.removeEventListener('wheel', releaseStick)
      el.removeEventListener('touchstart', releaseStick)
    }
  }, [])

  useEffect(() => {
    if (!stickRef.current || !streamRef.current) return
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const el = streamRef.current
      if (!el || !stickRef.current) return
      el.scrollTop = el.scrollHeight
    })
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [asst.messages, asst.streamText, asst.streamThinking, asst.liveActs, asst.busy])

  // 新一轮用户消息发出后重新贴底
  useEffect(() => {
    const last = asst.messages[asst.messages.length - 1]
    if (last?.role !== 'user' || !streamRef.current) return
    manualScrollRef.current = false
    stickRef.current = true
    const el = streamRef.current
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      el.scrollTop = el.scrollHeight
    })
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [asst.messages])

  const empty =
    asst.messages.length === 0 &&
    !asst.streamText &&
    !asst.streamThinking &&
    asst.liveActs.length === 0 &&
    !asst.busy

  return (
    <div className="asst-panel">
      <div className="asst-meta">
        <span className="asst-chip">
          {asst.follow
            ? t('chat.assistantFollow')
            : asst.model
              ? `${asst.model.provider}/${asst.model.id}`
              : t('chat.model')}
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
          {t('chat.assistantNew')}
        </button>
      </div>

      <div className="asst-stream" ref={streamRef}>
        {empty ? (
          <div className="asst-empty">
            <span className="asst-empty-icon" aria-hidden>
              <Sparkles size={22} strokeWidth={1.6} />
            </span>
            <p>{t('chat.assistantEmpty')}</p>
            <p className="asst-empty-hint">{t('chat.assistantHint')}</p>
          </div>
        ) : (
          asst.messages.map((m, i) =>
            m.role === 'user' ? (
              <UserCard key={`u-${i}`} text={m.text} label={t('chat.user')} />
            ) : (
              <AssistantReplyCard
                key={`a-${i}`}
                m={m}
                userName={userName}
                charName={charName}
                toolLocale={toolLocale}
                t={t}
              />
            ),
          )
        )}

        {liveStreaming ? (
          <AssistantReplyCard
            streaming
            busy={asst.busy}
            streamThinking={asst.streamThinking}
            streamText={asst.streamText}
            liveActs={asst.liveActs}
            userName={userName}
            charName={charName}
            toolLocale={toolLocale}
            t={t}
          />
        ) : null}
      </div>

      <div className="asst-composer">
        <ChatComposer
          compact
          value={input}
          onChange={onInputChange}
          onSend={onSend}
          onAbort={onAbort}
          busy={asst.busy}
          disabled={!connOpen}
          placeholder={t('chat.assistantInput')}
          enterSend={enterSend}
          webSearch={webSearch}
          onWebSearchChange={onWebSearchChange}
          thinkingLevel={thinkingLevel}
          thinkingLevels={thinkingLevels}
          onThinkingCycle={onThinkingCycle}
          onPickImage={onPickImage}
          onPickFile={onPickFile}
          uploading={uploading}
        />
      </div>
    </div>
  )
}
