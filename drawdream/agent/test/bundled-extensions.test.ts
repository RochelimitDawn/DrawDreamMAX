import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildBundledExtensionReport, bundledExtensionReportMarkdown, type BundledExtensionCompatibility } from '../../src/tavern/compat/bundled-extensions.ts'

const fixturePath = fileURLToPath(new URL('../../fixtures/puretavern/bundled-extensions.json', import.meta.url))
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  referenceCommit: string
  extensions: BundledExtensionCompatibility[]
}

test('PureTavern bundled extensions all have valid pinned package metadata', () => {
  const report = buildBundledExtensionReport(fixture.extensions, fixture.referenceCommit)
  assert.equal(report.totals.extensions, 2)
  assert.equal(report.totals.manifestLoadable, 2)
  assert.equal(report.totals.runnable, 2)
  assert.equal(report.totals.requiresAdapter, 0)
  assert.match(bundledExtensionReportMarkdown(report), /js-slash-runner-4\.8\.19/)
  assert.match(bundledExtensionReportMarkdown(report), /st-prompt-template-1\.16/)
})

test('DrawDream runtime claims full capability coverage for both bundled extensions', () => {
  const report = buildBundledExtensionReport(fixture.extensions, fixture.referenceCommit)
  for (const extension of report.extensions) {
    assert.equal(extension.loadStatus, 'manifest-loadable')
    assert.equal(extension.runtimeStatus, 'runnable')
    assert.equal(extension.status, 'supported')
    assert.deepEqual(extension.missingCapabilities, [])
    assert.ok(extension.drawdreamCapabilities.includes('generate'))
    assert.ok(extension.drawdreamCapabilities.includes('worldbook') || extension.requiredApis.includes('SillyTavern'))
  }
})
