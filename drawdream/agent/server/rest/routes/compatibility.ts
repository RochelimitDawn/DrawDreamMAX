import { getCompatibilityContract, compatibilityMatrix } from '../../../src/tavern/compat/inventory.ts'
import { unsupportedCompatibility } from '../../../src/tavern/compat/errors.ts'
import { readBodyRaw } from '../http.ts'
import { sendJson } from '../http.ts'
import type { RouteCtx } from './context.ts'

export async function handleCompatibilityRoutes(ctx: RouteCtx): Promise<boolean> {
  const { res, route, query } = ctx
  if (route === 'GET /api/compatibility/contracts') {
    sendJson(res, 200, {
      version: 1,
      reference: {
        repository: 'https://github.com/Lianues/PureTavern',
        commit: '847c04235a4fa113bef7994929779f7e1eb50871',
        license: 'AGPL-3.0',
      },
      contracts: compatibilityMatrix(),
    })
    return true
  }

  if (route === 'GET /api/compatibility/contract') {
    const id = (query.get('id') ?? '').trim()
    if (!id) throw new Error('缺少兼容契约 id')
    const contract = getCompatibilityContract(id)
    if (!contract) throw unsupportedCompatibility(id, 'compatibility.contracts')
    sendJson(res, 200, { version: 1, contract })
    return true
  }

  if (route === 'POST /api/compatibility/extension-request') {
    const body = JSON.parse((await readBodyRaw(ctx.req, 256 * 1024)).toString('utf8')) as { type?: string; payload?: Record<string, unknown> }
    const type = body.type ?? ''
    const payload = body.payload ?? {}
    if (type === 'context.get') {
      sendJson(res, 200, {
        chatId: 'drawdream',
        characterId: '',
        name1: '',
        name2: '',
        chat: [],
        runtimeMode: 'hybrid',
        onlineStatus: ctx.host.isStreaming() ? 'connected' : 'connected',
      })
      return true
    }
    if (type === 'slash.execute' || type === 'generate') {
      const command = type === 'slash.execute'
        ? String(payload.command ?? '')
        : String(payload.text ?? payload.prompt ?? payload.message ?? '')
      if (!command.trim()) throw new Error(`${type} requires text`)
      if (type === 'slash.execute') {
        if (!ctx.host.queueCommand(command)) throw new Error('当前会话无法执行扩展命令')
      } else {
        await ctx.host.promptCommand(command)
      }
      sendJson(res, 200, { accepted: true, command, type })
      return true
    }
    if (type === 'event.subscribe') {
      const events = Array.isArray(payload.events) ? payload.events.filter((value): value is string => typeof value === 'string') : []
      sendJson(res, 200, { subscribed: true, events })
      return true
    }
    if (type === 'inject.prompt') {
      const text = String(payload.text ?? payload.content ?? '').trim()
      if (!text) throw new Error('inject.prompt requires text')
      await ctx.host.promptCommand(`/note ${text}`)
      sendJson(res, 200, { accepted: true })
      return true
    }
    if (type === 'audio.speak') {
      const text = String(payload.text ?? '').trim()
      if (!text) throw new Error('audio.speak requires text')
      const result = await ctx.host.ttsSpeak(text, typeof payload.caption === 'string' ? payload.caption : undefined)
      sendJson(res, 200, result)
      return true
    }
    throw new Error(`不支持的扩展请求：${type}`)
  }

  return false
}
