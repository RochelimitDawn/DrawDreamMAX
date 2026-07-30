export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'dd-theme'

export function getStoredTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system'
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return 'system'
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/** 当前页面实际亮/暗（跟随 data-theme 与系统） */
export function getResolvedTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark' || attr === 'light') return attr
  return resolveTheme(getStoredTheme())
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode)
  document.documentElement.setAttribute('data-theme', resolved)
  document.documentElement.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#161210' : '#faf6f0')
  localStorage.setItem(STORAGE_KEY, mode)
  try {
    window.dispatchEvent(new CustomEvent('dd-theme-change', { detail: { mode, resolved } }))
  } catch {
    /* ignore */
  }
  return resolved
}

export function initTheme() {
  const mode = getStoredTheme()
  applyTheme(mode)

  if (typeof window === 'undefined') return mode

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (getStoredTheme() === 'system') applyTheme('system')
  }
  mq.addEventListener('change', onChange)
  return mode
}
