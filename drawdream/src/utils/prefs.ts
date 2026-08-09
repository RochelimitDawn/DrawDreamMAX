export type ChatPrefs = {
  autoScroll: boolean
  streamReply: boolean
  enterSend: boolean
  showTimestamps: boolean
  blurNsfw: boolean
  density: 'comfort' | 'compact'
}

const KEY = 'dd-chat-prefs'

const defaults: ChatPrefs = {
  autoScroll: true,
  streamReply: true,
  enterSend: true,
  showTimestamps: false,
  blurNsfw: true,
  density: 'comfort',
}

export function getChatPrefs(): ChatPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return { ...defaults }
  }
}

export function setChatPrefs(patch: Partial<ChatPrefs>) {
  const next = { ...getChatPrefs(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  document.documentElement.dataset.density = next.density
  window.dispatchEvent(new CustomEvent('dd-prefs', { detail: next }))
  return next
}

export function applyDensity(density: ChatPrefs['density']) {
  document.documentElement.dataset.density = density
}

export function isEnLang(lang: string) {
  return lang.toLowerCase().startsWith('en')
}

/** 封面是否按「敏感」处理（blurNsfw 开启时） */
export function isSensitiveCard(input: {
  rating?: string
  tags?: string[]
}): boolean {
  const rating = (input.rating || '').toLowerCase()
  if (rating === 'questionable' || rating === 'explicit') return true
  const tags = input.tags || []
  return tags.some((t) => /nsfw|r-?18|explicit|18\+|成人|色情/i.test(String(t)))
}
