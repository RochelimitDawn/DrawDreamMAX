import assert from 'node:assert/strict'
import test from 'node:test'
import { createLegacyApiFacade } from '../../src/tavern/compat/legacy-api.ts'

test('legacy API facade maps supported SillyTavern and TavernHelper calls', async () => {
  const calls: string[] = []
  const api = createLegacyApiFacade({
    request: async ({ type, payload }) => {
      calls.push(type)
      if (type === 'context.get') return { chatId: 'chat-1' }
      if (type === 'variables.get') return { scope: (payload as { scope?: string })?.scope ?? 'chat' }
      if (type === 'message.update') return { accepted: true }
      if (type === 'generate') return { accepted: true, text: (payload as { text?: string })?.text }
      if (type === 'worldbook.list') return { books: [] }
      if (type === 'preset.get') return { name: 'active' }
      if (type === 'character.get') return { name: '青梧' }
      if (type === 'inject.prompt') return { accepted: true }
      if (type === 'audio.speak') return { src: '/audio/x.mp3' }
      return { ok: true }
    },
  })
  assert.deepEqual(await api.SillyTavern.getContext(), { chatId: 'chat-1' })
  assert.deepEqual(await api.TavernHelper.getVariables({ scope: 'chat' }), { scope: 'chat' })
  await api.TavernHelper.setChatMessages([{ id: 'bulk', text: 'x' }])
  assert.deepEqual(await api.TavernHelper.generate('hello'), { accepted: true, text: 'hello' })
  assert.deepEqual(await api.TavernHelper.getWorldBooks(), { books: [] })
  assert.deepEqual(await api.TavernHelper.getActivePreset(), { name: 'active' })
  assert.deepEqual(await api.TavernHelper.getCharacter(), { name: '青梧' })
  assert.deepEqual(await api.TavernHelper.injectPrompt('system note'), { accepted: true })
  assert.deepEqual(await api.TavernHelper.speak('hi'), { src: '/audio/x.mp3' })
  assert.ok(calls.includes('generate'))
  assert.ok(calls.includes('worldbook.list'))
  assert.ok(calls.includes('inject.prompt'))
})

test('legacy API facade returns typed errors for unsupported methods', () => {
  const api = createLegacyApiFacade({
    request: async () => ({ ok: true }),
  })
  assert.throws(() => api.unsupported('legacy.eval', 'DrawDream extension runtime'), (error: unknown) => {
    return error && typeof error === 'object' && 'code' in error && error.code === 'RUNTIME_CAPABILITY_UNAVAILABLE'
  })
})
