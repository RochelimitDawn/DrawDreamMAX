import assert from 'node:assert/strict'
import test from 'node:test'
import { MvuStoreController } from '../../src/tavern/kernel/mvu.ts'
import { unavailableRuntimeCapability } from '../../src/tavern/compat/errors.ts'
import { filterTavernEvents, normalizeTavernSlashCommand } from '../../src/tavern/compat/tavern-helper.ts'

test('MvuStoreController accepts adapter variable transactions with explicit scope', () => {
  const variables = new MvuStoreController('session-1', { chat: { score: 1 } })
  const result = variables.commit({
    transactionId: 'adapter-tx',
    sessionId: 'session-1',
    baseRevision: 0,
    scope: 'chat',
    operations: [{ op: 'add', path: 'score', value: 2 }],
  })
  assert.deepEqual(result.value, { score: 3 })
  assert.equal(result.revision, 1)
})

test('MvuStoreController validates chat schema before committing and preserves state on failure', () => {
  const variables = new MvuStoreController('session-1', { chat: { score: 1 } })
  variables.setSchema({
    type: 'object',
    properties: { score: { type: 'integer' } },
    required: ['score'],
    additionalProperties: false,
  })
  assert.throws(() => variables.commit({
    transactionId: 'invalid',
    sessionId: 'session-1',
    baseRevision: 0,
    scope: 'chat',
    operations: [{ op: 'set', path: 'score', value: 'bad' }],
  }), /schema mismatch/)
  assert.deepEqual(variables.snapshot().chat, { score: 1 })
  assert.equal(variables.snapshot().revisions.chat, undefined)
})

test('MvuStoreController returns a defensive schema snapshot', () => {
  const variables = new MvuStoreController('session-1')
  variables.setSchema({ type: 'object', properties: { enabled: { type: 'boolean' } } })
  const schema = variables.getSchema()
  assert.deepEqual(schema, { type: 'object', properties: { enabled: { type: 'boolean' } } })
  if (schema?.properties?.enabled) schema.properties.enabled.type = 'string'
  assert.equal(variables.getSchema()?.properties?.enabled?.type, 'boolean')
})

test('MvuStoreController keeps the previous schema when a new schema fails validation', () => {
  const variables = new MvuStoreController('session-1', { chat: { score: 1 } })
  variables.setSchema({ type: 'object', properties: { score: { type: 'integer' } } })
  assert.throws(() => variables.setSchema({ type: 'object', required: ['missing'] }), /missing required field/)
  assert.deepEqual(variables.getSchema(), { type: 'object', properties: { score: { type: 'integer' } } })
})

test('unsupported TavernHelper methods expose a structured capability error', () => {
  const error = unavailableRuntimeCapability('tavern.unsupported', 'TavernFrame.context.get')
  assert.deepEqual(error.toJSON(), {
    code: 'RUNTIME_CAPABILITY_UNAVAILABLE',
    error: 'Runtime capability is unavailable: tavern.unsupported',
    capability: 'tavern.unsupported',
    details: { alternative: 'TavernFrame.context.get' },
  })
})

test('TavernHelper filters event subscriptions and allowlists slash commands', () => {
  assert.deepEqual(filterTavernEvents(['generation_started', 'message_received', 'private_event', 1]), ['generation_started', 'message_received'])
  assert.deepEqual(normalizeTavernSlashCommand('  /rewind 2  '), { name: 'rewind', command: '/rewind 2' })
  assert.equal(normalizeTavernSlashCommand('/eval process.env'), null)
})

test('Tavern message projection carries Agent activities as structured metadata', () => {
  const message = {
    id: 'assistant-1',
    channel: 'narrative' as const,
    name: '青梧',
    text: '已查到相关线索。',
    activities: [{ kind: 'tool_end' as const, name: 'smart_search', detail: '2 个来源', query: '朝歌历史' }],
  }
  const activity = message.activities[0]
  assert.deepEqual({ kind: activity.kind, name: activity.name, detail: activity.detail, query: activity.query }, {
    kind: 'tool_end',
    name: 'smart_search',
    detail: '2 个来源',
    query: '朝歌历史',
  })
})

test('asset and DOM bridge handlers reject unsafe requests', async () => {
  const { resolveCardAsset } = await import('../../src/tavern/card-assets.ts')
  assert.throws(() => resolveCardAsset({ path: '../secret.txt' }, '/workspace'), /escapes/)
  assert.throws(() => resolveCardAsset({ path: 'https://example.com/x.js' }, '/workspace'), /declared/)
})

test('external module policy requires HTTPS, declaration and explicit grant', async () => {
  const { modulePermission, recordModuleCache, findModuleCache } = await import('../../src/tavern/module-policy.ts')
  assert.equal(modulePermission('http://example.com/x.js', ['http://example.com/x.js'], ['http://example.com/x.js']), 'deny')
  assert.equal(modulePermission('https://example.com/x.js', ['https://example.com/x.js']), 'prompt')
  assert.equal(modulePermission('https://example.com/x.js', ['https://example.com/x.js'], ['https://example.com/x.js']), 'allow')
  const records = recordModuleCache([], { url: 'https://example.com/x.js', cardFingerprint: 'card-a', fingerprint: 'sha256:a', cachedAt: 1, permission: 'allow' })
  assert.equal(findModuleCache(records, 'https://example.com/x.js', 'sha256:a', 'card-a')?.permission, 'allow')
  assert.equal(findModuleCache(records, 'https://example.com/x.js', 'sha256:a', 'card-b'), null)
  assert.equal(findModuleCache(records, 'https://example.com/x.js', 'sha256:b', 'card-a'), null)
})
