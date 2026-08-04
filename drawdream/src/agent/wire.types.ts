/** DrawDream wire 协议类型（对齐 agent/server/wire.ts） */

export type WireChannel =
  | 'user'
  | 'narrative'
  | 'greeting'
  | 'import'
  | 'info'
  | 'backstage'
  | 'image'
  | 'audio'
  | 'video'
  | 'choice'
  | 'html'

export interface WireSwipe {
  index: number
  total: number
}

export interface WireChoice {
  id?: string
  question: string
  options: string[]
  placeholder?: string
  answer?: string
  stopped?: boolean
}

export interface WireMsgMeta {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cost?: number
  durationMs?: number
  ttftMs?: number
}

export interface WireMsg {
  id?: string
  index?: number
  revision?: number
  channel: WireChannel
  name?: string
  text: string
  thinking?: string
  backstage?: boolean
  src?: string
  choice?: WireChoice
  html?: string
  scripts?: boolean
  swipe?: WireSwipe
  greetingPick?: { index: number; total: number }
  meta?: WireMsgMeta
  /** 历史重放 / 落泡后的工具活动（ToolCallChip） */
  activities?: WireActivity[]
}

export interface WireSessionInfo {
  path: string
  id: string
  name?: string
  firstMessage: string
  modified: number
  messageCount: number
  current: boolean
  preview?: string
  cardName?: string
  /** 所属角色卡路径（PNG 可作历史头像） */
  cardPath?: string
}

export interface WireStats {
  userMessages: number
  assistantMessages: number
  totalTokens: number
  cost: number
  contextPercent: number | null
  contextTokens?: number | null
  contextWindow?: number | null
}

export interface WireActivity {
  kind: 'tool_start' | 'tool_end' | 'note'
  name: string
  detail?: string
  query?: string
  isError?: boolean
}

export interface WorldState {
  time: string
  location: string
  /** 当前章节/幕次标题；粘性章节条优先读取 */
  chapter?: string
  characters: Record<
    string,
    {
      affinity: number
      status: string
      notes: string
    }
  >
  inventory: string[]
  flags: Record<string, string>
  plot_threads: string[]
}

export interface RpPanel {
  name: string
  kind: string
  content: string
  [key: string]: unknown
}

export interface AssistantMsg {
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  mid?: boolean
  activities?: WireActivity[]
  media?: { src: string; kind: 'image' | 'audio' | 'video'; caption?: string }
}

export interface AssistantModelInfo {
  provider: string
  id: string
  name: string
}

/** 子任务清单项（Plan 模式；todo_write/todo_list 维护） */
export interface AssistantTodoItem {
  text: string
  status: 'pending' | 'in_progress' | 'done' | 'cancelled'
}

export type ServerFrame =
  | {
      type: 'hello'
      sequence?: number
      sessionRevision?: number
      sessionId: string
      charName: string
      userName: string
      /** 当前角色卡路径；有值表示已选用角色 */
      cardPath?: string
      messages: WireMsg[]
      state: WorldState | null
      stats: WireStats | null
      panels: RpPanel[]
    }
  | { type: 'message'; message: WireMsg; sequence?: number; sessionRevision?: number }
  | { type: 'delta'; kind: 'text' | 'thinking'; delta: string; sequence?: number; sessionRevision?: number }
  | {
      type: 'generation'
      generationId: string
      phase: 'start' | 'retry' | 'end'
      outcome?: 'completed' | 'aborted' | 'failed'
      attempt?: number
      error?: string
      sequence?: number
      sessionRevision?: number
    }
  | { type: 'stream'; state: 'clear'; sequence?: number; sessionRevision?: number }
  | { type: 'agent'; state: 'start' | 'end'; sequence?: number; sessionRevision?: number }
  | { type: 'activity'; activity: WireActivity; sequence?: number; sessionRevision?: number }
  | { type: 'state'; state: WorldState; sequence?: number; sessionRevision?: number }
  | { type: 'panels'; panels: RpPanel[]; sequence?: number; sessionRevision?: number }
  | { type: 'stats'; stats: WireStats; sequence?: number; sessionRevision?: number }
  | { type: 'notify'; level: 'info' | 'warning' | 'error'; text: string; sequence?: number; sessionRevision?: number }
  | { type: 'compaction'; state: 'start' | 'end'; ok?: boolean; sequence?: number; sessionRevision?: number }
  | { type: 'sessions'; list: WireSessionInfo[] }
  | { type: 'choice'; id: string; question: string; options: string[]; placeholder?: string }
  | { type: 'choice_resolved'; id: string; answer?: string; stopped?: boolean }
  | {
      type: 'assistant_hello'
      messages: AssistantMsg[]
      busy: boolean
      model: AssistantModelInfo | null
      follow: boolean
      todos?: AssistantTodoItem[]
    }
  | { type: 'assistant_message'; message: AssistantMsg }
  | { type: 'assistant_delta'; kind: 'text' | 'thinking'; delta: string }
  | { type: 'assistant_state'; state: 'start' | 'end' }
  | { type: 'assistant_activity'; activity: WireActivity }
  | { type: 'assistant_todo'; todos: AssistantTodoItem[] }
  | {
      type: 'forge_progress'
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
    }
  | { type: 'error'; text: string; sequence?: number; sessionRevision?: number }

export type ClientFrame =
  | { type: 'prompt'; text: string; webSearch?: boolean }
  | { type: 'command'; text: string }
  | { type: 'custom_message'; customType: string; content: string; display?: boolean; details?: unknown }
  | { type: 'message_update'; id: string; content?: unknown; display?: boolean; details?: unknown }
  | { type: 'message_delete'; id: string }
  | { type: 'abort' }
  | { type: 'reroll'; text?: string }
  | { type: 'swipe'; dir: 'prev' | 'next' | 'new' }
  | { type: 'compact' }
  | { type: 'sessions' }
  | { type: 'open'; path: string }
  | { type: 'choice_reply'; id: string; value?: string; stop?: boolean; via?: 'option' | 'free' }
  | { type: 'assistant_prompt'; text: string; webSearch?: boolean }
  | { type: 'assistant_abort' }
  | { type: 'assistant_new' }
  | { type: 'assistant_sync' }
  | { type: 'assistant_model'; provider?: string; id?: string }
  | { type: 'new' }
