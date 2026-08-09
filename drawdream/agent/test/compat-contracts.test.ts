import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compatibilityInventory,
  compatibilityMatrix,
  getCompatibilityContract,
} from '../../src/tavern/compat/inventory.ts'
import {
  CompatibilityError,
  invalidCompatibilityRequest,
  unavailableRuntimeCapability,
  unsupportedCompatibility,
} from '../../src/tavern/compat/errors.ts'

test('兼容矩阵包含 PureTavern 参考、状态和移动端信息', () => {
  assert.ok(compatibilityInventory.length >= 10)
  for (const contract of compatibilityInventory) {
    assert.match(contract.id, /^[a-z0-9-]+\.[a-z0-9-]+$/)
    assert.ok(contract.reference?.commit)
    assert.ok(['supported', 'partial', 'fixture-covered', 'unsupported'].includes(contract.status))
    assert.ok(['supported', 'partial', 'unsupported'].includes(contract.mobile))
    assert.ok(contract.fixtureIds.length > 0)
  }
})

test('兼容矩阵返回防御性副本', () => {
  const copy = getCompatibilityContract('runtime.card-ui')!
  copy.fixtureIds.push('mutated')
  copy.reference!.path = 'mutated'
  const fresh = getCompatibilityContract('runtime.card-ui')!
  assert.equal(fresh.fixtureIds.includes('mutated'), false)
  assert.notEqual(fresh.reference?.path, 'mutated')
  assert.equal(compatibilityMatrix().length, compatibilityInventory.length)
})

test('结构化兼容错误保留代码、能力和诊断字段', () => {
  const errors = [
    unsupportedCompatibility('runtime.card-ui', 'card.ui'),
    invalidCompatibilityRequest('chats.jsonl-import-export', ['messages']),
    unavailableRuntimeCapability('TavernHelper.foo', 'TavernFrame.context.get'),
  ]
  for (const error of errors) {
    assert.ok(error instanceof CompatibilityError)
    const json = error.toJSON()
    assert.equal(typeof json.code, 'string')
    assert.equal(typeof json.error, 'string')
  }
})
