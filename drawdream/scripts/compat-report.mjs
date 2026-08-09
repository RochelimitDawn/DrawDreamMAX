import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compatibilityInventory } from '../src/tavern/compat/inventory.ts'
import { buildCompatibilityReport, compatibilityReportMarkdown } from '../src/tavern/compat/report.ts'

const root = new URL('..', import.meta.url).pathname
const fixtureManifest = JSON.parse(readFileSync(join(root, 'fixtures/puretavern/manifest.json'), 'utf8'))
const report = buildCompatibilityReport(compatibilityInventory, fixtureManifest.fixtures, new Date().toISOString())
writeFileSync(join(root, 'docs/puretavern-compatibility-matrix.json'), `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(join(root, 'docs/puretavern-compatibility-matrix.md'), compatibilityReportMarkdown(report))
process.stdout.write(`[compat] ${report.totals.coveredContracts}/${report.totals.contracts} contracts fully fixture-covered\n`)
if (report.contracts.some((contract) => contract.missingFixtureIds.length > 0)) process.exitCode = 1
