import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildBundledExtensionReport, bundledExtensionReportMarkdown } from '../src/tavern/compat/bundled-extensions.ts'

const root = new URL('..', import.meta.url).pathname
const source = JSON.parse(readFileSync(join(root, 'fixtures/puretavern/bundled-extensions.json'), 'utf8'))
const report = buildBundledExtensionReport(source.extensions, source.referenceCommit)
writeFileSync(join(root, 'docs/puretavern-bundled-extension-report.json'), `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(join(root, 'docs/puretavern-bundled-extension-report.md'), bundledExtensionReportMarkdown(report))
process.stdout.write(`[extensions] ${report.totals.manifestLoadable}/${report.totals.extensions} manifest-loadable; ${report.totals.runnable}/${report.totals.extensions} directly runnable\n`)
