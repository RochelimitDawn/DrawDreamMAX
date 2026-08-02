import { sessionStore, type SessionSnapshot } from '../agent/session-store'
import { MvuStoreController } from './kernel/mvu'
import { TavernEventBus } from './kernel/event-bus'
import type { JsonObject, MvuSchema, TavernActivity, TavernContext, TavernMessage, VariableTransaction } from './kernel/types'
import type { CardBridgeRequest } from '../utils/cardBridge'
import { resolveCardAsset } from './card-assets'
import { modulePermission } from './module-policy'
import { unavailableRuntimeCapability } from './compat/errors'
import { filterTavernEvents, normalizeTavernSlashCommand } from './compat/tavern-helper'

function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonObject
}

function contextFromSnapshot(snapshot: SessionSnapshot): TavernContext {
  const chat: TavernMessage[] = snapshot.messages.map((message, index) => ({
    id: message.id,
    parentId: index > 0 ? snapshot.messages[index - 1]?.id ?? null : null,
    role: message.channel === 'user' ? 'user' : message.channel === 'info' ? 'system' : 'assistant',
    name: message.name ?? '',
    text: message.text,
    swipeId: message.swipe?.index ?? 0,
    swipes: [],
    metadata: {
      ...(message.activities?.length ? { activities: message.activities as unknown as JsonObject['activities'] } : {}),
      ...(message.meta ? { usage: message.meta as unknown as JsonObject['usage'] } : {}),
    },
    variables: {},
    activities: (message.activities ?? []).map((activity) => ({
      kind: activity.kind,
      name: activity.name,
      ...(activity.detail ? { detail: activity.detail } : {}),
      ...(activity.query ? { query: activity.query } : {}),
      ...(activity.isError ? { isError: true } : {}),
    })) as TavernActivity[],
  }))
  return {
    chatId: snapshot.sessionId,
    characterId: snapshot.cardPath,
    name1: snapshot.userName,
    name2: snapshot.charName,
    chat,
    chatMetadata: {},
    extensionSettings: {},
    onlineStatus: snapshot.conn === 'open' ? 'connected' : snapshot.conn === 'connecting' ? 'connecting' : 'disconnected',
    maxContext: snapshot.stats?.contextWindow ?? null,
    runtimeMode: 'hybrid',
  }
}

export class TavernRuntimeAdapter {
  readonly events = new TavernEventBus()
  private variables = new MvuStoreController('')
  private sessionId = ''
  private lastMessageCount = 0
  private lastMessageId = ''

  constructor() {
    sessionStore.subscribe(() => this.syncSession())
    this.syncSession()
  }

  private syncSession(): void {
    const snapshot = sessionStore.getSnapshot()
    if (snapshot.sessionId !== this.sessionId) {
      this.sessionId = snapshot.sessionId
      this.variables = new MvuStoreController(this.sessionId || 'pending')
      this.lastMessageCount = snapshot.messages.length
      this.lastMessageId = snapshot.messages[snapshot.messages.length - 1]?.id ?? ''
      if (this.sessionId) void this.events.emit('chat_changed', { chatId: this.sessionId })
      return
    }
    const currentCount = snapshot.messages.length
    const currentLastId = snapshot.messages[currentCount - 1]?.id ?? ''
    if (currentCount > this.lastMessageCount) {
      const lastMessage = snapshot.messages[currentCount - 1]
      if (lastMessage) {
        const role = lastMessage.channel === 'user' ? 'user' : 'assistant'
        void this.events.emit(role === 'user' ? 'message_sent' : 'message_received', {
          message: { id: lastMessage.id, role, text: lastMessage.text, name: lastMessage.name ?? '' },
          chatId: this.sessionId,
        })
      }
      this.lastMessageCount = currentCount
      this.lastMessageId = currentLastId
    } else if (currentLastId !== this.lastMessageId && currentLastId !== '') {
      const lastMessage = snapshot.messages[currentCount - 1]
      if (lastMessage) {
        void this.events.emit('message_updated', {
          message: { id: lastMessage.id, text: lastMessage.text },
          chatId: this.sessionId,
        })
      }
      this.lastMessageId = currentLastId
    }
  }

  getContext(): TavernContext {
    return contextFromSnapshot(sessionStore.getSnapshot())
  }

  async handle(request: CardBridgeRequest): Promise<unknown> {
    this.syncSession()
    switch (request.type) {
      case 'ready':
        setTimeout(() => { void this.events.emit('app_ready', { chatId: this.sessionId }) }, 150)
        return { ready: true, context: this.getContext() }
      case 'context.get':
        return this.getContext()
      case 'variables.get': {
        const payload = jsonObject(request.payload)
        const snapshot = this.variables.snapshot()
        const scopeName = payload.scope === 'global' || payload.scope === 'message' ? payload.scope : 'chat'
        const messageId = String(payload.messageId ?? '')
        const scope = scopeName === 'global' ? snapshot.global : scopeName === 'message' ? snapshot.messages[messageId] ?? {} : snapshot.chat
        const revisionKey = scopeName === 'message' ? `message:${messageId}` : scopeName
        return { scope: scopeName, revision: snapshot.revisions[revisionKey] ?? 0, value: scope }
      }
      case 'variables.patch': {
        const transaction = request.payload as VariableTransaction
        const commit = this.variables.commit(transaction)
        await this.events.emit('variables_updated', { revision: commit.revision, transactionId: commit.transactionId })
        return commit
      }
      case 'variables.schema': {
        const payload = jsonObject(request.payload)
        this.variables.setSchema((payload.schema ?? null) as MvuSchema | null)
        return { schema: this.variables.getSchema() }
      }
      case 'asset.resolve': {
        const payload = jsonObject(request.payload)
        return resolveCardAsset({
          path: String(payload.path ?? ''),
          cardPath: this.getContext().characterId,
        }, '/workspace')
      }
      case 'module.authorize': {
        const payload = jsonObject(request.payload)
        const url = String(payload.url ?? '').trim()
        const declared = Array.isArray(payload.declared) ? payload.declared.filter((value): value is string => typeof value === 'string') : []
        const granted = Array.isArray(payload.granted) ? payload.granted.filter((value): value is string => typeof value === 'string') : []
        const permission = modulePermission(url, declared, granted)
        if (permission !== 'allow') throw new Error(permission === 'prompt' ? 'External module authorization required' : 'External module denied')
        return { url, permission }
      }
      case 'dom.query': {
        const selector = String(jsonObject(request.payload).selector ?? '').trim()
        if (!selector || selector.length > 128 || /[{};]/.test(selector)) throw new Error('Invalid DOM selector')
        return { selector, count: 0, elements: [] }
      }
      case 'dom.text':
      case 'dom.class': {
        const payload = jsonObject(request.payload)
        const selector = String(payload.selector ?? '').trim()
        if (!selector || selector.length > 128 || /[{};]/.test(selector)) throw new Error('Invalid DOM selector')
        return { accepted: true, selector }
      }
      case 'message.send': {
        const text = String(jsonObject(request.payload).text ?? '').trim()
        if (!text || !sessionStore.prompt(text)) throw new Error('当前会话无法发送消息')
        await this.events.emit('message_sent', { text })
        return { accepted: true }
      }
      case 'message.create': {
        const payload = jsonObject(request.payload)
        const messages = Array.isArray(payload.messages) ? payload.messages : []
        if (messages.length === 0) throw new Error('message.create requires messages')
        let accepted = 0
        for (const item of messages) {
          const message = jsonObject(item)
          const content = String(message.text ?? message.mes ?? '').trim()
          if (!content) continue
          if (sessionStore.customMessage('tavern-helper', content, { source: 'TavernHelper', message })) accepted += 1
        }
        if (!accepted) throw new Error('没有可创建的消息')
        return { accepted }
      }
      case 'message.snapshot':
        return { chatId: this.sessionId, revision: sessionStore.getSnapshot().sessionRevision, messages: this.getContext().chat }
      case 'message.update': {
        const payload = jsonObject(request.payload)
        const messages = Array.isArray(payload.messages) ? payload.messages : []
        const deleteIds = Array.isArray(payload.deleteIds) ? payload.deleteIds : []
        let accepted = 0
        for (const item of messages) {
          const message = jsonObject(item)
          const id = String(message.id ?? '').trim()
          if (!id) continue
          const html = typeof message.html === 'string' ? message.html : ''
          const text = typeof (message.content ?? message.text ?? message.mes) === 'string'
            ? String(message.content ?? message.text ?? message.mes)
            : ''
          if (html) {
            if (sessionStore.patchMessageLocal(id, { html, text: text || undefined })) accepted += 1
          } else if (text) {
            if (sessionStore.patchMessageLocal(id, { text })) accepted += 1
          }
        }
        for (const id of deleteIds) {
          if (sessionStore.deleteMessage(String(id))) accepted += 1
        }
        if (!accepted) throw new Error('没有可更新或删除的消息')
        return { accepted }
      }
      case 'event.subscribe':
        {
          const requested = jsonObject(request.payload).events
          return { subscribed: true, events: filterTavernEvents(requested) }
        }
      case 'slash.execute': {
        const parsed = normalizeTavernSlashCommand(String(jsonObject(request.payload).command ?? ''))
        if (!parsed) {
          throw unavailableRuntimeCapability('slash.execute', 'Use one of /reroll, /rewind, /compact, /branch, /store, /greeting, /swipe')
        }
        if (!sessionStore.command(parsed.command)) throw new Error('当前会话无法执行命令')
        return { accepted: true, command: parsed.command }
      }
      case 'frame.resize':
        return { accepted: true }
      case 'http.fetch': {
        const payload = jsonObject(request.payload)
        const url = String(payload.url ?? '').trim()
        if (!url) throw new Error('http.fetch requires url')
        const options = payload.options as { method?: string; headers?: Record<string, string>; body?: string } | undefined
        const method = options?.method ?? 'GET'
        const response = await fetch(url, {
          method,
          headers: options?.headers ?? {},
          body: method !== 'GET' && method !== 'HEAD' ? options?.body : undefined,
          credentials: 'include',
        })
        const text = await response.text()
        let json: unknown
        try { json = JSON.parse(text) } catch { json = null }
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          text,
          json,
          headers: Object.fromEntries(response.headers.entries()),
        }
      }
      default:
        throw unavailableRuntimeCapability(request.type, 'Use the documented TavernFrame or TavernHelper methods')
    }
  }
}

export const tavernRuntime = new TavernRuntimeAdapter()
