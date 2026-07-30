/** UAPI 二维码：GET /image/qrcode（免费，无需 Key） */

const DEFAULT_BASE = 'https://uapis.cn/api/v1'

export type QrcodeOptions = {
  text: string
  size?: number
  transparent?: boolean
  fgcolor?: string
  bgcolor?: string
  /** API 根，默认 https://uapis.cn/api/v1；可与 smartSearch.baseUrl 共用 */
  baseUrl?: string
}

function normalizeBase(base?: string): string {
  const b = (base || DEFAULT_BASE).trim().replace(/\/+$/, '')
  return b || DEFAULT_BASE
}

/** 直接返回 PNG 的图片 URL（可作 <img src>） */
export function qrcodeImageUrl(opts: QrcodeOptions): string {
  const base = normalizeBase(opts.baseUrl)
  const size = Math.min(2048, Math.max(256, Math.round(opts.size ?? 512)))
  const q = new URLSearchParams()
  q.set('text', opts.text)
  q.set('size', String(size))
  q.set('format', 'image')
  q.set('transparent', opts.transparent === true ? 'true' : 'false')
  q.set('fgcolor', opts.fgcolor || '#000000')
  q.set('bgcolor', opts.bgcolor || '#FFFFFF')
  return `${base}/image/qrcode?${q.toString()}`
}

/** 拉取 base64 data URL（便于下载 / 离线预览） */
export async function fetchQrcodeDataUrl(
  opts: QrcodeOptions,
  signal?: AbortSignal,
): Promise<string> {
  const base = normalizeBase(opts.baseUrl)
  const size = Math.min(2048, Math.max(256, Math.round(opts.size ?? 512)))
  const q = new URLSearchParams()
  q.set('text', opts.text)
  q.set('size', String(size))
  q.set('format', 'json')
  q.set('transparent', opts.transparent === true ? 'true' : 'false')
  q.set('fgcolor', opts.fgcolor || '#000000')
  q.set('bgcolor', opts.bgcolor || '#FFFFFF')
  const res = await fetch(`${base}/image/qrcode?${q.toString()}`, { signal })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t.slice(0, 200) || `HTTP ${res.status}`)
  }
  const json = (await res.json()) as { qrcode_base64?: string }
  if (!json.qrcode_base64) throw new Error('二维码响应缺少 qrcode_base64')
  return json.qrcode_base64
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
