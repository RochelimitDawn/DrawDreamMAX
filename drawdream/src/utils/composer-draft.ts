const KEY = 'dd-composer-drafts'
const MAX_LEN = 20000
const MAX_SESSIONS = 40

type DraftMap = Record<string, string>

function readMap(): DraftMap {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: DraftMap = {}
    for (const [k, v] of Object.entries(parsed as DraftMap)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.slice(0, MAX_LEN)
    }
    return out
  } catch {
    return {}
  }
}

function writeMap(map: DraftMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode */
  }
}

function trimMap(map: DraftMap): DraftMap {
  const keys = Object.keys(map)
  if (keys.length <= MAX_SESSIONS) return map
  const drop = keys.length - MAX_SESSIONS
  const next = { ...map }
  for (let i = 0; i < drop; i++) delete next[keys[i]!]
  return next
}

export function getComposerDraft(sessionId: string): string {
  if (!sessionId) return ''
  return readMap()[sessionId] || ''
}

export function setComposerDraft(sessionId: string, text: string) {
  if (!sessionId) return
  const map = readMap()
  const trimmed = text.slice(0, MAX_LEN)
  if (!trimmed.trim()) {
    if (map[sessionId] == null) return
    delete map[sessionId]
    writeMap(map)
    return
  }
  map[sessionId] = trimmed
  writeMap(trimMap(map))
}

export function clearComposerDraft(sessionId: string) {
  if (!sessionId) return
  const map = readMap()
  if (map[sessionId] == null) return
  delete map[sessionId]
  writeMap(map)
}
