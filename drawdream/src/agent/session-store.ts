import type {
  AssistantModelInfo,
  AssistantMsg,
  AssistantSubagent,
  AssistantTodoItem,
  ClientFrame,
  ProcessStep,
  RpPanel,
  ServerFrame,
  WireActivity,
  WireChoice,
  WireMsg,
  WireMsgMeta,
  WireSessionInfo,
  WireStats,
  WorldState,
} from './wire.types'
import { connectWire, type ConnState, type WireClient } from './ws'

export type LiveBubble = {
  id: string
  channel: WireMsg['channel']
  name?: string
  text: string
  thinking?: string
  src?: string
  choice?: WireChoice
  html?: string
  scripts?: boolean
  swipe?: WireMsg['swipe']
  streaming?: boolean
  /** 处理过程时间线（思考/工具交错）；缺省时用 thinking+activities 兜底 */
  timeline?: ProcessStep[]
  /** 本地接收时间戳（ms），用于「显示时间戳」偏好 */
  at?: number
  /** 用量 / 耗时（气泡底栏） */
  meta?: WireMsgMeta
  /** 本条关联的工具活动（历史 hello 还原；直播落泡时挂上） */
  activities?: WireActivity[]
}

export type AssistantSnapshot = {
  ready: boolean
  messages: AssistantMsg[]
  busy: boolean
  model: AssistantModelInfo | null
  follow: boolean
  streamText: string
  streamThinking: string
  /** 流式中按到达顺序构建的处理过程时间线（思考/工具交错） */
  streamTimeline: ProcessStep[]
  liveActs: WireActivity[]
  todos: AssistantTodoItem[]
  /** 子拓展（子 agent）实时状态 */
  subagents: AssistantSubagent[]
}

function normalizeChoiceOptions(options: string[]): string[] {
  return options
    .map((option) => String(option).trim())
    .map((option) => option.replace(/^(?:选项\s*)?(?:[A-Za-z]|[1-9]\d*)[.、．)\]]\s*/i, '').trim())
    .filter(Boolean)
}

export type SessionSnapshot = {
  conn: ConnState
  sessionId: string
  charName: string
  /** 当前角色卡路径（hello 下发；空=未选） */
  cardPath: string
  userName: string
  messages: LiveBubble[]
  sessions: WireSessionInfo[]
  state: WorldState | null
  stats: WireStats | null
  panels: RpPanel[]
  busy: boolean
  activities: WireActivity[]
  pendingChoice: WireChoice | null
  lastNotify: { level: string; text: string; at: number } | null
  /** Novel Forge 最近一次进度推送 */
  forgeProgress: {
    jobId: string
    stage: string
    percent: number
    message: string
    chunkTotal: number
    chunkDone: number
    error?: string
    errorClass?: 'timeout' | 'json' | 'quota' | 'unknown'
    failedStage?: string
    updatedAt: number
  } | null
  lastError: { text: string; at: number } | null
  compacting: boolean
  assistant: AssistantSnapshot
  sessionRevision: number
  eventSequence: number
  generation: {
    id: string
    phase: 'start' | 'retry' | 'end'
    outcome?: 'completed' | 'aborted' | 'failed'
    attempt?: number
    error?: string
  } | null
}

type Listener = () => void

let bubbleSeq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++bubbleSeq}`

function msgToBubble(m: WireMsg, streaming = false): LiveBubble {
  return {
    id: m.id ?? nextId(m.channel),
    channel: m.channel,
    name: m.name,
    text: m.text,
    thinking: m.thinking,
    src: m.src,
    choice: m.choice,
    html: m.html,
    scripts: m.scripts,
    swipe: m.swipe,
    streaming,
    at: Date.now(),
    ...(m.meta ? { meta: m.meta } : {}),
    ...(m.activities?.length ? { activities: m.activities } : {}),
  }
}

function emptyAssistant(): AssistantSnapshot {
  return {
    ready: false,
    messages: [],
    busy: false,
    model: null,
    follow: true,
    streamText: '',
    streamThinking: '',
    streamTimeline: [],
    liveActs: [],
    todos: [],
    subagents: [],
  }
}

function createInitial(): SessionSnapshot {
  return {
    conn: 'closed',
    sessionId: '',
    charName: '',
    cardPath: '',
    userName: '',
    messages: [],
    sessions: [],
    state: null,
    stats: null,
    panels: [],
    busy: false,
    activities: [],
    pendingChoice: null,
    lastNotify: null,
    forgeProgress: null,
    lastError: null,
    compacting: false,
    assistant: emptyAssistant(),
    sessionRevision: 0,
    eventSequence: 0,
    generation: null,
  }
}

class SessionStore {
  private snap = createInitial()
  private listeners = new Set<Listener>()
  /** 本轮 agent 开始时间（客户端墙钟） */
  private turnStartedAt: number | null = null
  /** 本轮首个 text delta 时间（首字延迟） */
  private firstTokenAt: number | null = null
  private client: WireClient | null = null
  private streamId: string | null = null
  /** prompt 发出到服务端 agent/start 回传前的同步防重锁 */
  private promptPending = false
  /** agent end 后保留，message 到时用于去掉临时流气泡 */
  private lastStreamId: string | null = null

  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): SessionSnapshot => this.snap

  private emit() {
    this.snap = { ...this.snap }
    for (const l of this.listeners) l()
  }

  private patch(partial: Partial<SessionSnapshot>) {
    this.snap = { ...this.snap, ...partial }
    for (const l of this.listeners) l()
  }

  start() {
    if (this.client) return
    this.client = connectWire(
      (frame) => this.onFrame(frame),
      (conn) => {
        if (conn !== 'open') this.promptPending = false
        this.patch({ conn })
      },
    )
  }

  stop() {
    this.client?.close()
    this.client = null
    this.streamId = null
    this.lastStreamId = null
    this.promptPending = false
    this.snap = createInitial()
    this.emit()
  }

  send(frame: ClientFrame) {
    this.client?.send(frame)
  }

  prompt(text: string, webSearch = false): boolean {
    if (this.promptPending || this.snap.busy || this.snap.conn !== 'open') return false
    this.promptPending = true
    this.send({ type: 'prompt', text, webSearch })
    return true
  }

  command(text: string): boolean {
    if (this.snap.conn !== 'open' || !text.trim()) return false
    this.send({ type: 'command', text: text.trim() })
    return true
  }

  customMessage(customType: string, content: string, details?: unknown): boolean {
    if (this.snap.conn !== 'open' || !customType.trim()) return false
    this.send({ type: 'custom_message', customType: customType.trim(), content, display: true, details })
    return true
  }

  updateMessage(id: string, patch: { content?: unknown; display?: boolean; details?: unknown }): boolean {
    if (this.snap.conn !== 'open' || !id.trim()) return false
    this.send({ type: 'message_update', id: id.trim(), ...patch })
    return true
  }

  patchMessageLocal(id: string, patch: { text?: string; html?: string; scripts?: boolean }): boolean {
    const tid = id.trim()
    if (!tid) return false
    let found = false
    this.patch({
      messages: this.snap.messages.map((m) => {
        if (m.id === tid) {
          found = true
          const updated = { ...m }
          if (patch.text !== undefined) updated.text = patch.text
          if (patch.html !== undefined) {
            updated.html = patch.html
            updated.scripts = patch.scripts ?? true
            updated.channel = 'html'
          }
          return updated
        }
        return m
      }),
    })
    return found
  }

  deleteMessage(id: string): boolean {
    if (this.snap.conn !== 'open' || !id.trim()) return false
    this.send({ type: 'message_delete', id: id.trim() })
    return true
  }

  abort() {
    this.send({ type: 'abort' })
  }

  reroll(text?: string) {
    this.send({ type: 'reroll', text })
  }

  swipe(dir: 'prev' | 'next' | 'new') {
    this.send({ type: 'swipe', dir })
  }

  compact() {
    this.send({ type: 'compact' })
  }

  listSessions() {
    this.send({ type: 'sessions' })
  }

  openSession(path: string) {
    if (!path) return
    // 乐观清屏：避免仍显示上一会话气泡，直到 hello 对齐
    if (this.snap.busy) this.send({ type: 'abort' })
    this.streamId = null
    this.lastStreamId = null
    this.turnStartedAt = null
    this.firstTokenAt = null
    this.patch({
      messages: [],
      busy: false,
      activities: [],
      pendingChoice: null,
      compacting: false,
      lastError: null,
      sessionId: '',
    })
    this.send({ type: 'open', path })
  }

  newSession(): boolean {
    if (!this.client || this.client.getState() !== 'open') return false
    // 乐观清屏：等 hello 再对齐；忙时先 abort 再 new，避免被 refuseWhileStreaming 挡掉
    if (this.snap.busy) this.send({ type: 'abort' })
    this.streamId = null
    this.lastStreamId = null
    this.turnStartedAt = null
    this.firstTokenAt = null
    this.patch({
      messages: [],
      busy: false,
      activities: [],
      pendingChoice: null,
      compacting: false,
      lastError: null,
    })
    this.send({ type: 'new' })
    // 兜底再拉一次列表（服务端 new 也会 broadcast sessions；双保险）
    this.listSessions()
    return true
  }

  replyChoice(id: string, value?: string, stop?: boolean, via?: 'option' | 'free') {
    this.send({ type: 'choice_reply', id, value, stop, via })
  }

  assistantPrompt(text: string, webSearch = false) {
    this.send({ type: 'assistant_prompt', text, webSearch })
  }

  assistantAbort() {
    this.send({ type: 'assistant_abort' })
  }

  assistantNew() {
    this.send({ type: 'assistant_new' })
  }

  assistantSync() {
    this.send({ type: 'assistant_sync' })
  }

  assistantModel(provider?: string, id?: string) {
    if (provider && id) this.send({ type: 'assistant_model', provider, id })
    else this.send({ type: 'assistant_model' })
  }

  private patchAssistant(partial: Partial<AssistantSnapshot>) {
    this.patch({ assistant: { ...this.snap.assistant, ...partial } })
  }

  private onFrame(frame: ServerFrame) {
    if (frame.type !== 'hello' && 'sequence' in frame && frame.sequence != null) {
      if (frame.sequence <= this.snap.eventSequence) return
      this.patch({
        eventSequence: frame.sequence,
        ...(frame.sessionRevision != null ? { sessionRevision: frame.sessionRevision } : {}),
      })
    }
    switch (frame.type) {
      case 'hello': {
        this.promptPending = false
        this.streamId = null
        this.lastStreamId = null
        this.patch({
          sessionId: frame.sessionId,
          sessionRevision: frame.sessionRevision ?? 0,
          eventSequence: frame.sequence ?? 0,
          charName: frame.charName,
          userName: frame.userName,
          cardPath: frame.cardPath ?? '',
          messages: frame.messages.map((m) => msgToBubble(m)),
          state: frame.state,
          stats: frame.stats,
          panels: frame.panels ?? [],
          busy: false,
          activities: [],
          pendingChoice: null,
          lastError: null,
        })
        this.listSessions()
        break
      }
      case 'message': {
        this.patch({
          ...(frame.sessionRevision != null ? { sessionRevision: frame.sessionRevision } : {}),
          ...(frame.sequence != null ? { eventSequence: frame.sequence } : {}),
        })
        const sid = this.streamId || this.lastStreamId
        this.streamId = null
        this.lastStreamId = null
        const b = msgToBubble(frame.message)
        // 客户端墙钟：补齐本轮 duration / ttft（服务端 meta 可能只有 token）
        if (
          (b.channel === 'narrative' || b.channel === 'greeting' || b.channel === 'backstage') &&
          this.turnStartedAt != null
        ) {
          const durationMs = Math.max(0, Date.now() - this.turnStartedAt)
          const ttftMs =
            this.firstTokenAt != null ? Math.max(0, this.firstTokenAt - this.turnStartedAt) : undefined
          b.meta = {
            ...(b.meta || {}),
            durationMs: b.meta?.durationMs ?? durationMs,
            ...(ttftMs != null && b.meta?.ttftMs == null ? { ttftMs } : {}),
          }
        }
        // 本轮 live 工具条挂到落定气泡，刷新后由 hello 历史还原同构
        const liveActs = this.snap.activities
        const canHangActs =
          liveActs.length > 0 &&
          (b.channel === 'narrative' || b.channel === 'greeting' || b.channel === 'backstage')
        if (canHangActs) {
          b.activities = [...(b.activities ?? []), ...liveActs]
        }
        // 流式气泡上的处理过程时间线（思考/工具交错）随落定保留
        const prevStream = this.snap.messages.find((m) => m.id === sid)
        const streamTimeline = prevStream?.timeline?.length ? prevStream.timeline : undefined
        if (streamTimeline) {
          b.timeline = streamTimeline
        }
        this.turnStartedAt = null
        this.firstTokenAt = null
        // 去掉流式临时气泡（按 id 或 streaming 标记），再挂最终消息
        const rest = this.snap.messages.filter((m) => !m.streaming && m.id !== sid)
        this.patch({
          messages: [...rest, b],
          busy: false,
          ...(canHangActs ? { activities: [] } : {}),
        })
        break
      }
      case 'generation': {
        this.patch({
          generation:
            frame.phase === 'start'
              ? { id: frame.generationId, phase: 'start' }
              : {
                  id: frame.generationId,
                  phase: frame.phase,
                  ...(frame.outcome ? { outcome: frame.outcome } : {}),
                  ...(frame.attempt != null ? { attempt: frame.attempt } : {}),
                  ...(frame.error ? { error: frame.error } : {}),
                },
        })
        break
      }
      case 'delta': {
        const kind = frame.kind
        const delta = frame.delta
        if (kind === 'text' && this.firstTokenAt == null && this.turnStartedAt != null) {
          this.firstTokenAt = Date.now()
        }
        let messages = [...this.snap.messages]
        if (!this.streamId) {
          this.streamId = nextId('stream')
          this.lastStreamId = this.streamId
          messages.push({
            id: this.streamId,
            channel: 'narrative',
            name: this.snap.charName,
            text: kind === 'text' ? delta : '',
            thinking: kind === 'thinking' ? delta : undefined,
            timeline: kind === 'thinking' ? [{ kind: 'think', text: delta, streaming: true }] : [],
            streaming: true,
            at: Date.now(),
          })
        } else {
          this.lastStreamId = this.streamId
          messages = messages.map((m) => {
            if (m.id !== this.streamId) return m
            if (kind === 'text') {
              // 正文首 token：思考段已结束，把 timeline 里 think 步骤标记为非流式，
              // 前端计时器据此暂停（思考完成不再继续计时）。
              const hadText = m.text.length > 0
              const next = { ...m, text: m.text + delta }
              if (!hadText && (m.thinking || (m.timeline ?? []).some((t) => t.kind === 'think'))) {
                const tl = (m.timeline ?? []).map((t) =>
                  t.kind === 'think' ? { ...t, streaming: false } : t,
                )
                next.timeline = tl
              }
              return next
            }
            const thinking = (m.thinking ?? '') + delta
            const tl = [...(m.timeline ?? [])]
            const last = tl[tl.length - 1]
            if (last && last.kind === 'think') {
              tl[tl.length - 1] = { kind: 'think', text: last.text + delta, streaming: true }
            } else {
              tl.push({ kind: 'think', text: delta, streaming: true })
            }
            return { ...m, thinking, timeline: tl }
          })
        }
        this.patch({ messages })
        break
      }
      case 'stream': {
        if (frame.state === 'clear') {
          this.streamId = null
          this.lastStreamId = null
          this.patch({
            messages: this.snap.messages.filter((m) => !m.streaming),
          })
        }
        break
      }
      case 'agent': {
        if (frame.state === 'start') {
          this.promptPending = false
          this.streamId = null
          this.lastStreamId = null
          this.turnStartedAt = Date.now()
          this.firstTokenAt = null
          this.patch({
            busy: true,
            activities: [],
            messages: this.snap.messages.filter((m) => !m.streaming),
          })
        } else {
          this.promptPending = false
          const sid = this.streamId
          this.lastStreamId = sid || this.lastStreamId
          this.streamId = null
          const durationMs =
            this.turnStartedAt != null ? Math.max(0, Date.now() - this.turnStartedAt) : undefined
          const ttftMs =
            this.turnStartedAt != null && this.firstTokenAt != null
              ? Math.max(0, this.firstTokenAt - this.turnStartedAt)
              : undefined
          this.patch({
            busy: false,
            messages: this.snap.messages.map((m) => {
              if (!(m.streaming || m.id === sid)) return m
              const meta =
                durationMs != null
                  ? {
                      ...(m.meta || {}),
                      durationMs: m.meta?.durationMs ?? durationMs,
                      ...(ttftMs != null && m.meta?.ttftMs == null ? { ttftMs } : {}),
                    }
                  : m.meta
              return { ...m, streaming: false, ...(meta ? { meta } : {}) }
            }),
          })
        }
        break
      }
      case 'activity': {
        const next = [...this.snap.activities, frame.activity]
        const patch: Partial<SessionSnapshot> = { activities: next }
        // 流式中把工具事件按发生顺序挂进时间线（与思考段交错）
        if (this.streamId) {
          const messages = this.snap.messages.map((m) => {
            if (m.id !== this.streamId) return m
            return {
              ...m,
              timeline: [
                ...(m.timeline ?? []),
                { kind: 'tool' as const, activity: frame.activity, streaming: true },
              ],
            }
          })
          patch.messages = messages
        }
        this.patch(patch)
        break
      }
      case 'state': {
        this.patch({ state: frame.state })
        break
      }
      case 'panels': {
        this.patch({ panels: frame.panels })
        break
      }
      case 'stats': {
        this.patch({ stats: frame.stats })
        break
      }
      case 'notify': {
        this.patch({ lastNotify: { level: frame.level, text: frame.text, at: Date.now() } })
        break
      }
      case 'forge_progress': {
        this.patch({
          forgeProgress: {
            jobId: frame.jobId,
            stage: frame.stage,
            percent: frame.percent,
            message: frame.message,
            chunkTotal: frame.chunkTotal,
            chunkDone: frame.chunkDone,
            error: frame.error,
            errorClass: frame.errorClass,
            failedStage: frame.failedStage,
            updatedAt: frame.updatedAt,
          },
        })
        break
      }
      case 'compaction': {
        this.patch({
          compacting: frame.state === 'start',
        })
        break
      }
      case 'sessions': {
        this.patch({ sessions: frame.list })
        break
      }
      case 'choice': {
        this.patch({
          pendingChoice: {
            id: frame.id,
            question: frame.question,
            options: normalizeChoiceOptions(frame.options),
            placeholder: frame.placeholder,
          },
        })
        break
      }
      case 'choice_resolved': {
        const pc = this.snap.pendingChoice
        if (pc?.id === frame.id) {
          this.patch({
            pendingChoice: {
              ...pc,
              answer: frame.answer,
              stopped: frame.stopped,
            },
          })
          // 已决后稍后清除未决条
          window.setTimeout(() => {
            if (this.snap.pendingChoice?.id === frame.id) {
              this.patch({ pendingChoice: null })
            }
          }, 400)
        }
        break
      }
      case 'error': {
        this.promptPending = false
        this.streamId = null
        // 错误写入对话流，避免只 toast 一闪而过
        const errBubble: LiveBubble = {
          id: nextId('error'),
          channel: 'info',
          name: '系统',
          text: frame.text,
        }
        this.patch({
          lastError: { text: frame.text, at: Date.now() },
          busy: false,
          messages: [...this.snap.messages.filter((m) => !m.streaming), errBubble],
        })
        break
      }
      case 'assistant_hello': {
        this.patchAssistant({
          ready: true,
          messages: frame.messages ?? [],
          busy: frame.busy,
          model: frame.model,
          follow: frame.follow,
          streamText: '',
          streamThinking: '',
          streamTimeline: [],
          liveActs: [],
          todos: frame.todos ?? [],
          subagents: frame.subagents ?? [],
        })
        break
      }
      case 'assistant_message': {
        let msg = frame.message
        if (msg.role === 'assistant' && this.snap.assistant.liveActs.length) {
          msg = { ...msg, activities: [...(msg.activities ?? []), ...this.snap.assistant.liveActs] }
        }
        this.patchAssistant({
          messages: [...this.snap.assistant.messages, msg],
          streamText: '',
          streamThinking: '',
          streamTimeline: [],
          liveActs: [],
        })
        break
      }
      case 'assistant_delta': {
        if (frame.kind === 'text') {
          this.patchAssistant({ streamText: this.snap.assistant.streamText + frame.delta })
        } else {
          const prev = this.snap.assistant.streamThinking
          const thinking = prev + frame.delta
          const tl = [...this.snap.assistant.streamTimeline]
          const last = tl[tl.length - 1]
          if (last && last.kind === 'think') {
            tl[tl.length - 1] = { kind: 'think', text: last.text + frame.delta, streaming: true }
          } else {
            tl.push({ kind: 'think', text: frame.delta, streaming: true })
          }
          this.patchAssistant({ streamThinking: thinking, streamTimeline: tl })
        }
        break
      }
      case 'assistant_state': {
        if (frame.state === 'start') {
          this.patchAssistant({
            busy: true,
            liveActs: [],
            streamText: '',
            streamThinking: '',
            streamTimeline: [],
          })
        } else {
          this.promptPending = false
          const stream = this.snap.assistant.streamText.trim()
          const thinking = this.snap.assistant.streamThinking.trim()
          const acts = this.snap.assistant.liveActs
          const tl = this.snap.assistant.streamTimeline
          let messages = this.snap.assistant.messages
          if (stream) {
            messages = [
              ...messages,
              {
                role: 'assistant',
                text: stream,
                ...(thinking ? { thinking } : {}),
                ...(acts.length ? { activities: acts } : {}),
                ...(tl.length ? { timeline: tl } : {}),
              },
            ]
          }
          this.patchAssistant({
            busy: false,
            messages,
            streamText: '',
            streamThinking: '',
            streamTimeline: [],
            liveActs: [],
          })
        }
        break
      }
      case 'assistant_activity': {
        this.patchAssistant({
          liveActs: [...this.snap.assistant.liveActs, frame.activity],
          streamTimeline: [
            ...this.snap.assistant.streamTimeline,
            { kind: 'tool', activity: frame.activity, streaming: true },
          ],
        })
        break
      }
      case 'assistant_todo': {
        this.patchAssistant({ todos: frame.todos ?? [] })
        break
      }
      case 'assistant_subagents': {
        this.patchAssistant({ subagents: frame.subagents ?? [] })
        break
      }
      default:
        break
    }
  }
}

export const sessionStore = new SessionStore()
