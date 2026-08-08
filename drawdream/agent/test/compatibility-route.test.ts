import assert from 'node:assert/strict'
import test from 'node:test'
import { getCompatibilityContract } from '../../src/tavern/compat/inventory.ts'
import { unsupportedCompatibility } from '../../src/tavern/compat/errors.ts'
import { isStCompatPath } from '../server/rest/routes.ts'

test('兼容 API 契约可按 id 查询且返回 DrawDream 映射', () => {
  const contract = getCompatibilityContract('characters.card-runtime')
  assert.ok(contract)
  assert.equal(contract?.drawdreamTarget, 'agent/server/rest/routes/cards.ts')
  assert.ok(contract?.fixtureIds.length)
})

test('未知兼容契约返回结构化 unsupported 错误', () => {
  const error = unsupportedCompatibility('missing.contract', 'compatibility.contracts')
  assert.deepEqual(error.toJSON(), {
    code: 'COMPATIBILITY_UNSUPPORTED',
    error: 'Compatibility contract is unsupported: missing.contract',
    capability: 'compatibility.contracts',
    details: { contractId: 'missing.contract' },
  })
})

test('路由分发：/api/presets/preview 归 DrawDream，/api/presets/save 归 ST 兼容层', () => {
  // DrawDream 自有 presets 方法（preview/import/select/saveas/rename/export）→ 非 ST
  assert.equal(isStCompatPath('/api/presets/preview', 'POST'), false)
  assert.equal(isStCompatPath('/api/presets/import', 'POST'), false)
  assert.equal(isStCompatPath('/api/presets/select', 'POST'), false)
  assert.equal(isStCompatPath('/api/presets/saveas', 'POST'), false)
  assert.equal(isStCompatPath('/api/presets/rename', 'POST'), false)
  assert.equal(isStCompatPath('/api/presets/export', 'GET'), false)
  // SillyTavern 兼容层接管的 presets 方法 → ST
  assert.equal(isStCompatPath('/api/presets/save', 'POST'), true)
  assert.equal(isStCompatPath('/api/presets/delete', 'POST'), true)
  assert.equal(isStCompatPath('/api/presets/restore', 'POST'), true)
  // 其它 ST 段（characters/worldinfo）仍归兼容层
  assert.equal(isStCompatPath('/api/characters/all', 'GET'), true)
  assert.equal(isStCompatPath('/api/worldinfo/get', 'GET'), true)
})
