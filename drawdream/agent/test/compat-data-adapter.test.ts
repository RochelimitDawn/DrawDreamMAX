import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adaptCharacterCard,
  adaptSillyTavernChat,
  exportSillyTavernChat,
} from '../src/compat/data-adapter.ts'

test('角色卡适配保留原始未知字段 sidecar', () => {
  const input = {
    spec: 'chara_card_v3',
    data: {
      name: 'Adapter Fixture',
      first_mes: 'hello',
      extensions: { custom_plugin: { enabled: true } },
      unknown_field: { keep: 'me' },
    },
  }
  const result = adaptCharacterCard(input)
  assert.equal(result.card.name, 'Adapter Fixture')
  assert.deepEqual(result.sidecar.raw, input)
  assert.deepEqual((result.sidecar.raw.data as Record<string, unknown>).unknown_field, { keep: 'me' })
})

test('聊天适配保留 metadata、variables、swipes 和原文 sidecar', () => {
  const jsonl = [
    JSON.stringify({ user_name: '旅人', character_name: '角色', create_date: '2026-07-30' }),
    JSON.stringify({ is_user: true, name: '旅人', mes: '你好', send_date: '2026-07-30T00:00:00Z', metadata: { x: 1 }, variables: { mood: 'calm' } }),
    JSON.stringify({ is_user: false, name: '角色', mes: '', swipes: ['a', 'b'], swipe_id: 1, extra: { source: 'test' } }),
  ].join('\n')
  const chat = adaptSillyTavernChat(jsonl)
  assert.equal(chat.messages.length, 2)
  assert.equal(chat.messages[1]?.text, 'b')
  assert.deepEqual(chat.messages[0]?.source?.metadata, { x: 1 })
  assert.deepEqual(chat.messages[1]?.source?.swipes, ['a', 'b'])
})

test('聊天适配支持规范化文本的 JSONL round-trip', () => {
  const original = [
    JSON.stringify({ user_name: '旅人', character_name: '角色' }),
    JSON.stringify({ is_user: true, name: '旅人', mes: '正文', send_date: 'now', metadata: { source: 'fixture' } }),
  ].join('\n')
  const first = adaptSillyTavernChat(original)
  const second = adaptSillyTavernChat(exportSillyTavernChat(first))
  assert.deepEqual(second.meta, first.meta)
  assert.equal(second.messages[0]?.text, first.messages[0]?.text)
  assert.deepEqual(second.messages[0]?.source?.metadata, { source: 'fixture' })
})
