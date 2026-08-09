import { describe, expect, it, beforeEach } from 'vitest'
import {
  SETTINGS_BACKUP_FORMAT,
  agentPatchFromBackup,
  applyClientSettings,
  collectClientSettings,
  parseSettingsBackup,
  serializeSettingsBackup,
} from './settings-backup'

function installLocalStorage() {
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
  Object.defineProperty(globalThis, 'document', {
    value: {
      documentElement: {
        dataset: {} as Record<string, string>,
        style: { setProperty() {}, removeProperty() {} },
        setAttribute() {},
        getAttribute() {
          return null
        },
      },
      querySelector() {
        return null
      },
    },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      dispatchEvent() {
        return true
      },
    },
    configurable: true,
  })
}

describe('settings-backup', () => {
  beforeEach(() => {
    installLocalStorage()
    localStorage.clear()
  })

  it('collects format and client prefs', () => {
    const p = collectClientSettings({
      thinking: 'high',
      agent: { scanDepth: 6, creationMode: 'ask' },
    })
    expect(p.format).toBe(SETTINGS_BACKUP_FORMAT)
    expect(p.version).toBe(1)
    expect(p.thinking).toBe('high')
    expect(p.agent?.scanDepth).toBe(6)
    expect(p.prefs).toBeTruthy()
    expect(p.reading).toBeTruthy()
  })

  it('round-trips serialize/parse', () => {
    const p = collectClientSettings({ thinking: 'low' })
    const again = parseSettingsBackup(serializeSettingsBackup(p))
    expect(again.format).toBe(SETTINGS_BACKUP_FORMAT)
    expect(again.thinking).toBe('low')
  })

  it('accepts legacy export without format field', () => {
    const legacy = {
      theme: 'dark',
      lang: 'en',
      density: 'compact',
      thinking: 'medium',
      prefs: { autoScroll: false, streamReply: true },
      agent: { scanDepth: 8, maxLoreInjections: 5 },
    }
    const p = parseSettingsBackup(legacy)
    expect(p.theme).toBe('dark')
    expect(p.lang).toBe('en')
    expect(p.prefs?.density).toBe('compact')
    expect(p.prefs?.autoScroll).toBe(false)
    expect(p.agent?.scanDepth).toBe(8)
  })

  it('rejects unknown format', () => {
    expect(() => parseSettingsBackup({ format: 'other-app', version: 1 })).toThrow('unknown_format')
  })

  it('applies reading and chat prefs to localStorage', () => {
    const payload = parseSettingsBackup({
      format: SETTINGS_BACKUP_FORMAT,
      version: 1,
      theme: 'light',
      lang: 'zh',
      thinking: 'high',
      prefs: { enterSend: false, density: 'compact' },
      reading: { colorizeEnabled: true, fontSizePx: 18, width: 'wide' },
    })
    const applied = applyClientSettings(payload)
    expect(applied.prefs.enterSend).toBe(false)
    expect(applied.prefs.density).toBe('compact')
    expect(applied.reading.colorizeEnabled).toBe(true)
    expect(applied.reading.fontSizePx).toBe(18)
    expect(applied.reading.width).toBe('wide')
    expect(localStorage.getItem('dd-thinking')).toBe('high')
    expect(localStorage.getItem('dd-lang')).toBe('zh')
  })

  it('builds agent putConfig patch without inventing apiKey', () => {
    const patch = agentPatchFromBackup({
      scanDepth: 4,
      smartSearch: { enabled: true, mode: 'multi', hasApiKey: true },
    })
    expect(patch).toMatchObject({
      scanDepth: 4,
      smartSearch: { enabled: true, mode: 'multi' },
    })
    expect((patch!.smartSearch as { apiKey?: string }).apiKey).toBeUndefined()
  })
})
