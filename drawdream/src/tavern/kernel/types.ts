export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type ChatRuntimeMode = 'drawdream' | 'tavern' | 'hybrid'

export type TavernEventType =
  | 'app_ready'
  | 'chat_changed'
  | 'character_selected'
  | 'message_sent'
  | 'message_received'
  | 'message_updated'
  | 'message_swiped'
  | 'generation_started'
  | 'generation_ended'
  | 'variables_updated'
  | 'chat_metadata_updated'

export interface TavernMessage {
  id: string
  parentId: string | null
  role: 'user' | 'assistant' | 'system'
  name: string
  text: string
  swipeId: number
  swipes: string[]
  metadata: JsonObject
  variables: JsonObject
  activities: TavernActivity[]
}

export interface TavernActivity {
  kind: 'tool_start' | 'tool_end' | 'note'
  name: string
  detail?: string
  query?: string
  isError?: boolean
}

export interface TavernContext {
  chatId: string
  characterId: string
  name1: string
  name2: string
  chat: TavernMessage[]
  chatMetadata: JsonObject
  extensionSettings: JsonObject
  onlineStatus: 'connected' | 'connecting' | 'disconnected'
  maxContext: number | null
  runtimeMode: ChatRuntimeMode
}

export interface TavernEvent<T = JsonValue> {
  sequence: number
  sessionRevision: number
  type: TavernEventType
  payload: T
}

export type TavernEventHandler<T = JsonValue> = (event: TavernEvent<T>) => void | Promise<void>

export interface MvuStore {
  sessionId: string
  global: JsonObject
  chat: JsonObject
  messages: Record<string, JsonObject>
  revisions: Record<string, number>
}

export type MvuSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  properties?: Record<string, MvuSchema>
  required?: string[]
  items?: MvuSchema
  additionalProperties?: boolean
}

export type VariableOperation =
  | { op: 'set'; path: string; value: JsonValue }
  | { op: 'delete'; path: string }
  | { op: 'merge'; path: string; value: JsonObject }
  | { op: 'add'; path: string; value: number }
  | { op: 'append'; path: string; value: JsonValue }

export interface VariableTransaction {
  transactionId: string
  sessionId: string
  baseRevision: number
  scope: 'global' | 'chat' | 'message'
  messageId?: string
  operations: VariableOperation[]
}

export interface VariableCommit {
  revision: number
  value: JsonObject
  transactionId: string
}

export class VariableConflictError extends Error {
  readonly currentRevision: number

  constructor(currentRevision: number) {
    super(`MVU revision conflict: expected current revision ${currentRevision}`)
    this.name = 'VariableConflictError'
    this.currentRevision = currentRevision
  }
}
