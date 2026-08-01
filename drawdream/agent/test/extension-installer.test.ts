import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installExtensionBytes } from '../src/extension-installer.ts'

function archive(entries: Record<string, string>): Buffer {
  const root = mkdtempSync(join(tmpdir(), 'dd-extension-source-'))
  for (const [name, value] of Object.entries(entries)) {
    const path = join(root, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, value)
  }
  const zip = join(tmpdir(), `dd-extension-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`)
  execFileSync('zip', ['-qr', zip, '.'], { cwd: root })
  return readFileSync(zip)
}

test('extension installer validates manifest and installs entrypoints', () => {
  const bytes = archive({
    'demo/manifest.json': JSON.stringify({ display_name: 'Demo', version: '1.0.0', js: 'dist/index.js', css: 'dist/index.css' }),
    'demo/dist/index.js': 'window.demo = true',
    'demo/dist/index.css': '.demo{}',
  })
  const destination = mkdtempSync(join(tmpdir(), 'dd-extension-install-'))
  const installed = installExtensionBytes(bytes, destination)
  assert.equal(installed.displayName, 'Demo')
  assert.equal(installed.js, 'dist/index.js')
  assert.equal(readFileSync(join(destination, installed.id, 'dist/index.js'), 'utf8'), 'window.demo = true')
})

test('extension installer rejects archives with multiple roots and missing entries', () => {
  const bytes = archive({
    'one/manifest.json': JSON.stringify({ display_name: 'One', version: '1', js: 'index.js' }),
    'one/index.js': '1',
    'two/extra.txt': '2',
  })
  const destination = mkdtempSync(join(tmpdir(), 'dd-extension-reject-'))
  assert.throws(() => installExtensionBytes(bytes, destination), /one root directory/)
})

test('extension installer rejects manifest path traversal', () => {
  const bytes = archive({
    'demo/manifest.json': JSON.stringify({ display_name: 'Demo', version: '1', js: '../index.js' }),
  })
  const destination = mkdtempSync(join(tmpdir(), 'dd-extension-traversal-'))
  assert.throws(() => installExtensionBytes(bytes, destination), /Unsafe extension archive path|entry is missing/)
})
