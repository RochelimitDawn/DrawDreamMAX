/** 浏览器直连 UAPI myip（用户公网出口） */

export type UapiClientConfig = {
  enabled: boolean
  baseUrl: string
  source: 'standard' | 'commercial'
  hasApiKey: boolean
  apiKey?: string
  myipPath: string
}

export type UapiMyIpResult = {
  ip: string
  region?: string
  isp?: string
  llc?: string
  location: string
}

export async function fetchUapiClientConfig(): Promise<UapiClientConfig> {
  const res = await fetch('/api/uapi/client', { credentials: 'include' })
  if (!res.ok) throw new Error(`uapi config ${res.status}`)
  return (await res.json()) as UapiClientConfig
}

/** 在浏览器侧请求 UAPI /network/myip */
export async function fetchMyIpViaUapi(cfg: UapiClientConfig): Promise<UapiMyIpResult | null> {
  if (!cfg.enabled) return null
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}${cfg.myipPath.startsWith('/') ? cfg.myipPath : `/${cfg.myipPath}`}`
  const headers: Record<string, string> = { accept: 'application/json' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 6000)
  try {
    const res = await fetch(url, { headers, signal: ac.signal })
    if (!res.ok) return null
    const o = (await res.json()) as Record<string, unknown>
    const ip = typeof o.ip === 'string' ? o.ip : ''
    if (!ip) return null
    const region = typeof o.region === 'string' ? o.region : undefined
    const isp = typeof o.isp === 'string' ? o.isp : undefined
    const llc = typeof o.llc === 'string' ? o.llc : undefined
    const location = [region, llc || isp].filter(Boolean).join(' · ')
    return { ip, region, isp, llc, location }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function reportSessionGeo(geo: {
  ip?: string
  location?: string
  deviceName?: string
}): Promise<void> {
  await fetch('/api/auth/sessions/geo', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(geo),
  })
}

/** 登录后：浏览器查 myip 并写回当前会话 */
export async function syncCurrentDeviceGeo(): Promise<void> {
  try {
    const cfg = await fetchUapiClientConfig()
    if (!cfg.enabled) return
    const info = await fetchMyIpViaUapi(cfg)
    if (!info) return
    await reportSessionGeo({ ip: info.ip, location: info.location })
  } catch {
    /* 可选增强，失败静默 */
  }
}
