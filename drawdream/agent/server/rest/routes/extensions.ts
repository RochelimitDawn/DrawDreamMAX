import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, normalize, relative } from 'node:path'
import { installExtensionBytes, type InstalledExtension } from '../../src/extension-installer.ts'
import { MAX_UPLOAD, readBodyRaw, sendJson } from '../http.ts'
import type { RouteCtx } from './context.ts'

const EXTENSIONS_DIR = '.drawdream-extensions'

export async function handleExtensionsRoutes(ctx: RouteCtx): Promise<boolean> {
  if (ctx.route === 'GET /api/extensions') {
    const root = join(ctx.host.cwd, EXTENSIONS_DIR)
    const items: InstalledExtension[] = []
    for (const name of (existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
      try {
        const value = JSON.parse(readFileSync(join(root, name, 'drawdream-install.json'), 'utf8'))
        if (value && typeof value === 'object' && value.id) items.push(value as InstalledExtension)
      } catch {
        // Ignore incomplete installation directories.
      }
    }
    sendJson(ctx.res, 200, { extensions: items })
    return true
  }
  if (ctx.route === 'POST /api/extensions/install') {
    const body = await readBodyRaw(ctx.req, MAX_UPLOAD)
    const root = join(ctx.host.cwd, EXTENSIONS_DIR)
    mkdirSync(root, { recursive: true })
    const installed = installExtensionBytes(body, root)
    sendJson(ctx.res, 201, { extension: installed })
    return true
  }
  if (ctx.route === 'GET /api/extensions/file') {
    const id = (ctx.query.get('id') ?? '').trim()
    const file = (ctx.query.get('path') ?? '').replace(/\\/g, '/')
    if (!id || !file || file.includes('\0') || file.startsWith('/') || file.split('/').includes('..')) throw new Error('Invalid extension asset path')
    const root = join(ctx.host.cwd, EXTENSIONS_DIR, id)
    const target = normalize(join(root, file))
    if (relative(root, target).startsWith('..') || !existsSync(target) || !statSync(target).isFile()) throw new Error('Extension asset not found')
    const contentType = /\.css$/i.test(target) ? 'text/css; charset=utf-8' : /\.json$/i.test(target) ? 'application/json; charset=utf-8' : 'text/javascript; charset=utf-8'
    ctx.res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' })
    ctx.res.end(readFileSync(target))
    return true
  }
  return false
}
