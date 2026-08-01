import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, normalize, relative } from 'node:path'
import { installExtensionBytes, knownExtensionStatus, type InstalledExtension } from '../../../src/extension-installer.ts'
import { MAX_UPLOAD, readBody, readBodyRaw, sendJson } from '../http.ts'
import type { RouteCtx } from './context.ts'

const EXTENSIONS_DIR = '.drawdream-extensions'

type GitHubRepo = { provider: 'github'; owner: string; repo: string }
type GitLabRepo = { provider: 'gitlab'; project: string }
type DirectZip = { provider: 'zip'; url: string }
type SourceInfo = GitHubRepo | GitLabRepo | DirectZip

function parseSourceUrl(raw: string): SourceInfo {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('无效的扩展 URL') }
  if (url.username || url.password) throw new Error('URL 不能包含凭据')
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('仅支持 HTTPS 或 HTTP URL')
  const host = url.hostname.toLowerCase()
  if (host === 'github.com') {
    const segs = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean)
    if (segs.length < 2) throw new Error('GitHub URL 必须包含 owner/repo')
    return { provider: 'github', owner: segs[0]!, repo: segs[1]! }
  }
  if (host === 'gitlab.com') {
    const path = url.pathname.split('/-/')[0]?.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '') ?? ''
    if (!path || path.split('/').filter(Boolean).length < 2) throw new Error('GitLab URL 必须包含 namespace/project')
    return { provider: 'gitlab', project: encodeURIComponent(path) }
  }
  if (/\.zip$/i.test(url.pathname)) return { provider: 'zip', url: raw }
  throw new Error('不支持的扩展源。支持 GitHub、GitLab 仓库 URL 或直接 ZIP 下载链接')
}

async function fetchExtensionZip(source: SourceInfo, timeoutMs = 30000): Promise<Buffer> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    let url: string
    if (source.provider === 'github') {
      // Try latest release zipball first, fall back to default branch archive
      const releaseUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/releases/latest`
      const res = await fetch(releaseUrl, { signal: ac.signal, headers: { Accept: 'application/json', 'User-Agent': 'DrawDreamAgent' } })
      if (res.ok) {
        const release = await res.json() as { zipball_url?: string; tag_name?: string }
        url = release.zipball_url ?? `https://github.com/${source.owner}/${source.repo}/archive/refs/heads/main.zip`
      } else {
        url = `https://github.com/${source.owner}/${source.repo}/archive/refs/heads/main.zip`
      }
    } else if (source.provider === 'gitlab') {
      url = `https://gitlab.com/api/v4/projects/${source.project}/repository/archive.zip`
    } else {
      url = source.url
    }
    const response = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'DrawDreamAgent' } })
    if (!response.ok) throw new Error(`扩展下载失败：HTTP ${response.status} ${response.statusText}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_UPLOAD) throw new Error('扩展归档超过大小限制')
    return buffer
  } finally { clearTimeout(timer) }
}

export async function handleExtensionsRoutes(ctx: RouteCtx): Promise<boolean> {
  if (ctx.route === 'GET /api/extensions') {
    const root = join(ctx.host.cwd, EXTENSIONS_DIR)
    const items: InstalledExtension[] = []
    for (const name of (existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
      try {
        const value = JSON.parse(readFileSync(join(root, name, 'drawdream-install.json'), 'utf8'))
        if (value && typeof value === 'object' && value.id) {
          // Re-check known extension status on every list (handles pre-existing installs)
          const known = knownExtensionStatus(value.id, value.displayName)
          if (known) {
            value.runtimeStatus = known.runtimeStatus
            value.capabilities = known.capabilities
          }
          items.push(value as InstalledExtension)
        }
      } catch { /* ignore incomplete directories */ }
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
  if (ctx.route === 'POST /api/extensions/install-url') {
    const body = JSON.parse(await readBody(ctx.req)) as { url?: string }
    const raw = (body.url ?? '').trim()
    if (!raw) throw new Error('缺少扩展 URL')
    const source = parseSourceUrl(raw)
    const root = join(ctx.host.cwd, EXTENSIONS_DIR)
    mkdirSync(root, { recursive: true })
    const zip = await fetchExtensionZip(source)
    const installed = installExtensionBytes(zip, root)
    sendJson(ctx.res, 201, { extension: installed, source: source.provider })
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