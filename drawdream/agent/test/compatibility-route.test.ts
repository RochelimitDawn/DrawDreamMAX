import assert from 'node:assert/strict'
import test from 'node:test'
import { getCompatibilityContract } from '../../src/tavern/compat/inventory.ts'
import { unsupportedCompatibility } from '../../src/tavern/compat/errors.ts'

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
