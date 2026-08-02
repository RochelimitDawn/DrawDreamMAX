import { sessionStore } from '../../agent/session-store'
import {
  fetchCard,
  fetchLorebooks,
  fetchLorebookView,
  fetchPresets,
  fetchActivePreset,
  selectLorebooks,
  selectPreset,
  putLoreEntry,
  apiPost,
} from '../../agent/rest'
import { tavernRuntime } from '../runtime-adapter'
import { unavailableRuntimeCapability } from './errors'
import type { CardBridgeRequest, CardBridgeRequestType } from '../../utils/cardBridge'

export type ExtensionRuntimeRequestType =
  | CardBridgeRequestType
  | 'generate'
  | 'worldbook.list'
  | 'worldbook.get'
  | 'worldbook.select'
  | 'worldbook.entry.put'
  | 'preset.list'
  | 'preset.get'
  | 'preset.select'
  | 'character.get'
  | 'inject.prompt'
  | 'audio.speak'
  | 'parent.resize'
  | 'http.fetch'

export type ExtensionRuntimeRequest = {
  type: ExtensionRuntimeRequestType
  payload?: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function bridgeRequest(type: CardBridgeRequestType, payload?: unknown): CardBridgeRequest {
  return {
    protocol: 'drawdream-tavern-frame',
    version: 1,
    frameId: 'extension-runtime',
    capabilityToken: 'extension-runtime',
    requestId: `ext-${Date.now()}`,
    type,
    ...(payload !== undefined ? { payload } : {}),
  }
}

export async function handleExtensionRuntimeRequest(request: ExtensionRuntimeRequest): Promise<unknown> {
  const payload = asRecord(request.payload)
  switch (request.type) {
    case 'ready':
    case 'context.get':
    case 'variables.get':
    case 'variables.patch':
    case 'variables.schema':
    case 'message.send':
    case 'message.create':
    case 'message.snapshot':
    case 'message.update':
    case 'event.subscribe':
    case 'slash.execute':
    case 'asset.resolve':
    case 'module.authorize':
    case 'dom.query':
    case 'dom.text':
    case 'dom.class':
    case 'frame.resize':
      return tavernRuntime.handle(bridgeRequest(request.type, request.payload))
    case 'generate': {
      const text = String(payload.text ?? payload.prompt ?? payload.message ?? '').trim()
      if (!text) throw new Error('generate requires text')
      if (!sessionStore.prompt(text, payload.webSearch === true)) throw new Error('当前会话无法生成')
      await tavernRuntime.events.emit('generation_started', { text })
      return { accepted: true, generation: sessionStore.getSnapshot().generation }
    }
    case 'worldbook.list':
      return fetchLorebooks()
    case 'worldbook.get': {
      const path = String(payload.path ?? '').trim()
      if (!path) throw new Error('worldbook.get requires path')
      return fetchLorebookView(path)
    }
    case 'worldbook.select': {
      const paths = Array.isArray(payload.paths)
        ? payload.paths.filter((value): value is string => typeof value === 'string')
        : typeof payload.path === 'string'
          ? [payload.path]
          : []
      await selectLorebooks(paths)
      return { ok: true, active: paths }
    }
    case 'worldbook.entry.put': {
      const fingerprint = String(payload.fingerprint ?? payload.fp ?? '').trim()
      if (!fingerprint) throw new Error('worldbook.entry.put requires fingerprint')
      return putLoreEntry({
        fingerprint,
        keys: Array.isArray(payload.keys) ? payload.keys.filter((value): value is string => typeof value === 'string') : undefined,
        secondaryKeys: Array.isArray(payload.secondaryKeys) ? payload.secondaryKeys.filter((value): value is string => typeof value === 'string') : undefined,
        content: typeof payload.content === 'string' ? payload.content : undefined,
        comment: typeof payload.comment === 'string' ? payload.comment : undefined,
        constant: typeof payload.constant === 'boolean' ? payload.constant : undefined,
        order: typeof payload.order === 'number' ? payload.order : undefined,
        selective: typeof payload.selective === 'boolean' ? payload.selective : undefined,
      })
    }
    case 'preset.list':
      return fetchPresets()
    case 'preset.get':
      return fetchActivePreset({ working: true })
    case 'preset.select': {
      const file = payload.file === null || payload.file === '' ? null : String(payload.file ?? '')
      await selectPreset(file)
      return { ok: true, file }
    }
    case 'character.get':
      return fetchCard()
    case 'inject.prompt': {
      const text = String(payload.text ?? payload.content ?? '').trim()
      if (!text) throw new Error('inject.prompt requires text')
      if (!sessionStore.customMessage('extension-inject', text, {
        source: 'extension',
        role: payload.role ?? 'system',
        depth: payload.depth ?? 0,
      })) throw new Error('当前会话无法注入提示词')
      return { accepted: true }
    }
    case 'audio.speak': {
      const text = String(payload.text ?? '').trim()
      if (!text) throw new Error('audio.speak requires text')
      return apiPost('/api/tts', { text, caption: payload.caption })
    }
    case 'parent.resize':
      return { accepted: true, height: Number(payload.height ?? 0) || 0 }
    case 'http.fetch': {
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
      throw unavailableRuntimeCapability(String(request.type), 'Use DrawDream extension runtime methods')
  }
}
