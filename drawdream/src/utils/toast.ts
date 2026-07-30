type ToastTone = 'info' | 'success' | 'error' | 'warning'

const TONE_PRIORITY: Record<ToastTone, number> = {
  info: 1,
  success: 2,
  warning: 3,
  error: 4,
}

const BASE_DURATION: Record<ToastTone, number> = {
  info: 2400,
  success: 2200,
  warning: 4500,
  error: 6000,
}

const DURATION_MIN = 1800
const DURATION_MAX = 12000
/** 按字符追加展示时长（中文约 1 字 ≈ 1 char） */
const MS_PER_CHAR = 28

type ToastTimers = {
  hide: number
  remove: number
}

const active = new Map<HTMLElement, ToastTimers>()
let lastKey = ''
let lastAt = 0

function ensureHost(): HTMLElement {
  let host = document.getElementById('dd-toast-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'dd-toast-host'
    host.className = 'dd-toast-host'
    document.body.appendChild(host)
  }
  return host
}

function durationFor(text: string, tone: ToastTone): number {
  const base = BASE_DURATION[tone] ?? 2400
  const extra = Math.max(0, text.length - 24) * MS_PER_CHAR
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, base + extra))
}

function lengthClass(text: string): string {
  const n = text.length
  if (n <= 18) return 'is-short'
  if (n <= 48) return 'is-medium'
  if (n <= 120) return 'is-long'
  return 'is-xl'
}

function dismissEl(el: HTMLElement, immediate = false) {
  const timers = active.get(el)
  if (timers) {
    window.clearTimeout(timers.hide)
    window.clearTimeout(timers.remove)
    active.delete(el)
  }
  if (immediate || !el.isConnected) {
    el.remove()
    return
  }
  el.classList.remove('is-in')
  el.classList.add('is-out')
  window.setTimeout(() => el.remove(), 220)
}

/** 清空全部 toast（路由切换时调用，避免旧页提示残留） */
export function clearToasts() {
  if (typeof document === 'undefined') return
  const host = document.getElementById('dd-toast-host')
  if (!host) return
  for (const el of Array.from(host.children) as HTMLElement[]) {
    dismissEl(el, true)
  }
  lastKey = ''
  lastAt = 0
}

export function toast(message: string, tone: ToastTone = 'info') {
  if (typeof document === 'undefined') return
  const text = message.trim()
  if (!text) return
  const safeTone: ToastTone = tone in TONE_PRIORITY ? tone : 'info'

  // 短时间同文案去重，避免连点/重挂载重复刷
  const key = `${safeTone}::${text}`
  const now = Date.now()
  if (key === lastKey && now - lastAt < 800) return
  lastKey = key
  lastAt = now

  const host = ensureHost()
  // 新提示替换旧的，避免叠一堆「上一页」的 toast
  const existing = Array.from(host.children) as HTMLElement[]
  const currentPriority = existing.reduce((max, el) => {
    const current = Number(el.dataset.priority || 0)
    return Math.max(max, current)
  }, 0)
  if (existing.length && currentPriority > TONE_PRIORITY[safeTone]) return
  for (const el of existing) {
    dismissEl(el, true)
  }

  const el = document.createElement('div')
  el.className = `dd-toast tone-${safeTone} ${lengthClass(text)}`
  el.dataset.priority = String(TONE_PRIORITY[safeTone])
  el.setAttribute('role', safeTone === 'error' || safeTone === 'warning' ? 'alert' : 'status')

  const accent = document.createElement('span')
  accent.className = 'dd-toast-accent'
  accent.setAttribute('aria-hidden', 'true')

  const body = document.createElement('div')
  body.className = 'dd-toast-body'
  body.textContent = text

  const icon = document.createElement('span')
  icon.className = 'dd-toast-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = safeTone === 'success' ? '✓' : safeTone === 'error' ? '!' : safeTone === 'warning' ? '!' : 'i'

  el.appendChild(accent)
  el.appendChild(icon)
  el.appendChild(body)
  el.addEventListener('click', () => dismissEl(el))
  host.appendChild(el)
  requestAnimationFrame(() => el.classList.add('is-in'))

  const ms = durationFor(text, safeTone)
  const hide = window.setTimeout(() => {
    el.classList.remove('is-in')
    el.classList.add('is-out')
    const remove = window.setTimeout(() => {
      active.delete(el)
      el.remove()
    }, 220)
    const prev = active.get(el)
    if (prev) prev.remove = remove
    else active.set(el, { hide: 0, remove })
  }, ms)
  active.set(el, { hide, remove: 0 })
}
