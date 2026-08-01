import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, normalize, relative } from 'node:path'
import type { BundledExtensionCompatibility } from '../../src/tavern/compat/bundled-extensions.ts'

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_FILES = 512
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export type InstalledExtension = {
  id: string
  displayName: string
  version: string
  root: string
  js: string | null
  css: string | null
  capabilities: string[]
  runtimeStatus: 'requires-adapter' | 'blocked'
  archiveSha256: string
}

export type ExtensionArchiveReader = {
  list: () => string[]
  read: (entry: string) => Buffer
}

function assertSafeEntry(entry: string): void {
  const normalized = entry.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || normalized.includes('\0')) {
    throw new Error(`Unsafe extension archive path: ${entry}`)
  }
}

function rootForEntries(entries: string[]): string {
  const files = entries.filter((entry) => !entry.endsWith('/'))
  if (!files.length) throw new Error('Extension archive is empty')
  const roots = new Set(files.map((entry) => entry.split('/')[0]))
  if (roots.size !== 1) throw new Error('Extension archive must have one root directory')
  return `${[...roots][0]}/`
}

function parseManifest(reader: ExtensionArchiveReader, root: string): Record<string, unknown> {
  const candidates = reader.list().filter((entry) => entry === `${root}manifest.json`)
  if (candidates.length !== 1) throw new Error('Extension archive must contain one root manifest.json')
  let value: unknown
  try {
    value = JSON.parse(reader.read(candidates[0]).toString('utf8'))
  } catch (error) {
    throw new Error(`Invalid extension manifest: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Extension manifest must be an object')
  return value as Record<string, unknown>
}

export function createZipReader(archivePath: string): ExtensionArchiveReader {
  if (!existsSync(archivePath)) throw new Error('Extension archive does not exist')
  const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean)
  for (const entry of entries) assertSafeEntry(entry)
  return {
    list: () => [...entries],
    read: (entry) => execFileSync('unzip', ['-p', archivePath, entry], { maxBuffer: MAX_FILE_BYTES + 1 }),
  }
}

export function validateExtensionArchive(reader: ExtensionArchiveReader, archiveSha256: string): InstalledExtension {
  const entries = reader.list()
  if (entries.length > MAX_FILES) throw new Error(`Extension archive has too many files: ${entries.length}`)
  const root = rootForEntries(entries)
  const manifest = parseManifest(reader, root)
  const id = String(manifest.id ?? manifest.name ?? basename(root)).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  if (!SAFE_ID.test(id)) throw new Error(`Invalid extension id: ${id}`)
  const displayName = String(manifest.display_name ?? manifest.name ?? id).trim()
  const version = String(manifest.version ?? '').trim()
  if (!displayName || !version) throw new Error('Extension manifest requires display_name/name and version')
  const js = typeof manifest.js === 'string' ? manifest.js.trim() : null
  const css = typeof manifest.css === 'string' && manifest.css.trim() ? manifest.css.trim() : null
  if (!js && !css) throw new Error('Extension manifest requires a JS or CSS entry')
  for (const entry of [js, css].filter((value): value is string => Boolean(value))) {
    assertSafeEntry(`${root}${entry}`)
    if (!entries.includes(`${root}${entry}`)) throw new Error(`Extension entry is missing: ${entry}`)
  }
  const capabilities = Array.isArray(manifest.drawdreamCapabilities)
    ? manifest.drawdreamCapabilities.filter((value): value is string => typeof value === 'string')
    : ['context.read', 'events.subscribe', 'card.ui']
  return { id, displayName, version, root, js, css, capabilities, runtimeStatus: 'requires-adapter', archiveSha256 }
}

export function installExtensionArchive(archivePath: string, destination: string, expected?: Pick<BundledExtensionCompatibility, 'archiveBytes' | 'archiveSha256' | 'manifestVersion'>): InstalledExtension {
  const archive = readFileSync(archivePath)
  return installExtensionBytes(archive, destination, expected)
}

export function installExtensionBytes(archive: Buffer, destination: string, expected?: Pick<BundledExtensionCompatibility, 'archiveBytes' | 'archiveSha256' | 'manifestVersion'>): InstalledExtension {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Extension archive exceeds size limit')
  const archiveSha256 = createHash('sha256').update(archive).digest('hex')
  if (expected?.archiveBytes != null && expected.archiveBytes !== archive.byteLength) throw new Error('Extension archive size mismatch')
  if (expected?.archiveSha256 && expected.archiveSha256 !== archiveSha256) throw new Error('Extension archive SHA-256 mismatch')
  const archivePath = join(destination, `.incoming-${archiveSha256}.zip`)
  mkdirSync(destination, { recursive: true })
  if (!existsSync(archivePath)) writeFileSync(archivePath, archive, { flag: 'wx' })
  const installed = validateExtensionArchive(createZipReader(archivePath), archiveSha256)
  if (expected?.manifestVersion && expected.manifestVersion !== installed.version) throw new Error('Extension manifest version mismatch')
  const target = join(destination, installed.id)
  const root = normalize(target)
  if (relative(normalize(destination), root).startsWith('..')) throw new Error('Extension destination escapes root')
  mkdirSync(root, { recursive: true })
  for (const entry of createZipReader(archivePath).list().filter((value) => !value.endsWith('/'))) {
    const relativeEntry = entry.slice(installed.root.length)
    const targetFile = normalize(join(root, relativeEntry))
    if (!targetFile.startsWith(`${root}/`)) throw new Error(`Extension path escapes destination: ${entry}`)
    const content = createZipReader(archivePath).read(entry)
    if (content.byteLength > MAX_FILE_BYTES) throw new Error(`Extension file exceeds size limit: ${entry}`)
    mkdirSync(join(targetFile, '..'), { recursive: true })
    if (!existsSync(targetFile)) writeFileSync(targetFile, content, { flag: 'wx' })
  }
  writeFileSync(join(root, 'drawdream-install.json'), JSON.stringify({ ...installed, installedAt: new Date().toISOString() }, null, 2))
  return { ...installed, root }
}
