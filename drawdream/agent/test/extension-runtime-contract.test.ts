import assert from 'node:assert/strict'
import test from 'node:test'
import { createLegacyApiFacade } from '../../src/tavern/compat/legacy-api.ts'

const FULL_METHODS = [
  'context.get',
  'variables.get',
  'variables.patch',
  'message.snapshot',
  'message.update',
  'message.create',
  'slash.execute',
  'event.subscribe',
  'generate',
  'worldbook.list',
  'worldbook.get',
  'worldbook.select',
  'worldbook.entry.put',
  'preset.list',
  'preset.get',
  'preset.select',
  'character.get',
  'inject.prompt',
  'audio.speak',
  'parent.resize',
] as const

test('完整兼容 facade 覆盖 generate/worldbook/preset/character/inject/audio', async () => {
  const seen = new Set<string>()
  const api = createLegacyApiFacade({
    request: async ({ type, payload }) => {
      seen.add(type)
      return { ok: true, type, payload }
    },
  })

  await api.SillyTavern.getContext()
  await api.TavernHelper.getVariables({ scope: 'chat' })
  await api.TavernHelper.updateVariables({
    transactionId: 'tx-1',
    sessionId: 'chat-1',
    baseRevision: 0,
    scope: 'chat',
    operations: [{ op: 'set', path: 'score', value: 1 }],
  })
  await api.TavernHelper.getChatMessages()
  await api.TavernHelper.setChatMessages([{ id: '1', text: 'hi' }])
  await api.TavernHelper.createChatMessages([{ text: 'new' }])
  await api.TavernHelper.triggerSlash('/compact')
  await api.SillyTavern.eventSource.subscribe(['generation_started'])
  await api.TavernHelper.generate('继续剧情')
  await api.TavernHelper.getWorldBooks()
  await api.TavernHelper.getWorldBook('assets/lorebooks/demo.json')
  await api.TavernHelper.selectWorldBooks(['assets/lorebooks/demo.json'])
  await api.TavernHelper.putWorldBookEntry({ fingerprint: 'fp-1', content: 'x' })
  await api.TavernHelper.getPresets()
  await api.TavernHelper.getActivePreset()
  await api.TavernHelper.selectPreset(null)
  await api.TavernHelper.getCharacter()
  await api.TavernHelper.injectPrompt('author note')
  await api.TavernHelper.speak('配音')
  await api.SillyTavern.eventSource.on('message_received', () => undefined)

  for (const method of FULL_METHODS) {
    if (method === 'parent.resize') continue
    assert.ok(seen.has(method), `missing runtime mapping: ${method}`)
  }
})

test('完整兼容 facade 对未知方法返回 RUNTIME_CAPABILITY_UNAVAILABLE', () => {
  const api = createLegacyApiFacade({
    request: async () => ({ ok: true }),
  })
  assert.throws(() => api.unsupported('eval', 'DrawDream extension runtime'), (error: unknown) => {
    return error && typeof error === 'object' && 'code' in error && error.code === 'RUNTIME_CAPABILITY_UNAVAILABLE'
  })
})
