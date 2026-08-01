export type CardAssetRequest = {
  path: string
  cardPath?: string
  externalModules?: string[]
}

export type CardAssetResolution = {
  path: string
  url: string
  kind: 'local' | 'external'
}

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value)

export function resolveCardAsset(request: CardAssetRequest, _workspaceRoot: string): CardAssetResolution {
  const path = request.path.trim()
  if (!path || path.length > 512 || path.includes('\0')) throw new Error('Invalid asset path')
  if (isHttpUrl(path)) {
    if (!/^https:\/\//i.test(path)) throw new Error('Only HTTPS external assets are allowed')
    const allowed = (request.externalModules ?? []).some((module) => module === path)
    if (!allowed) throw new Error('External asset is not declared by the card')
    return { path, url: path, kind: 'external' }
  }
  const normalized = path.replace(/^\.\//, '').replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error('Asset path escapes card workspace')
  const cardRoot = request.cardPath ? request.cardPath.split('/').slice(0, -1).join('/') : ''
  if (!/^assets\//i.test(normalized) && !request.cardPath) throw new Error('Local asset is outside assets')
  const combined = cardRoot ? `${cardRoot}/${normalized}` : normalized
  return { path: combined, url: `/api/assets/${encodeURIComponent(combined)}`, kind: 'local' }
}
