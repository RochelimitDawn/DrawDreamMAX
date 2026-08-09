import assert from 'node:assert/strict'
import test from 'node:test'
import { compatibilityInventory } from '../../src/tavern/compat/inventory.ts'
import { buildCompatibilityReport, compatibilityReportMarkdown } from '../../src/tavern/compat/report.ts'

test('compatibility report covers every inventory fixture id', () => {
  const fixtures = compatibilityInventory.flatMap((contract) => contract.fixtureIds.map((id) => ({ id, domain: contract.domain, file: `${id}.json` })))
  const report = buildCompatibilityReport(compatibilityInventory, fixtures, '2026-08-01T00:00:00.000Z')
  assert.equal(report.totals.coveredContracts, report.totals.contracts)
  assert.equal(report.totals.fixtures, 22)
  assert.ok(compatibilityReportMarkdown(report).includes('| `runtime.card-ui` |'))
})

test('compatibility report identifies missing fixture ids', () => {
  const report = buildCompatibilityReport(compatibilityInventory.slice(0, 1), [], 'fixed')
  assert.deepEqual(report.contracts[0]?.missingFixtureIds, ['card-v1', 'card-v2', 'card-v3', 'card-png'])
  assert.equal(report.totals.coveredContracts, 0)
})
