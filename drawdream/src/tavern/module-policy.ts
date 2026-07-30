export type ModulePermission = 'deny' | 'prompt' | 'allow'

export type ModuleCacheRecord = {
  url: string
  fingerprint: string
  cachedAt: number
  permission: ModulePermission
}

export function modulePermission(url: string, declaredUrls: string[], grantedUrls: string[] = []): ModulePermission {
  if (!/^https:\/\//i.test(url) || !declaredUrls.includes(url)) return 'deny'
  return grantedUrls.includes(url) ? 'allow' : 'prompt'
}

export function recordModuleCache(records: ModuleCacheRecord[], record: ModuleCacheRecord, limit = 64): ModuleCacheRecord[] {
  const next = records.filter((item) => item.url !== record.url)
  next.push({ ...record })
  return next.slice(-Math.max(1, limit))
}

export function findModuleCache(records: ModuleCacheRecord[], url: string, fingerprint?: string): ModuleCacheRecord | null {
  const hit = records.find((record) => record.url === url)
  if (!hit || (fingerprint && hit.fingerprint !== fingerprint)) return null
  return { ...hit }
}
