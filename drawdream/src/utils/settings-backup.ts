import { applyTheme, getStoredTheme, type ThemeMode } from '../theme'
import { getChatPrefs, setChatPrefs, type ChatPrefs } from './prefs'
import { getReadingPrefs, setReadingPrefs, type ReadingPrefs } from './reading-prefs'

export const SETTINGS_BACKUP_FORMAT = 'drawdream-settings'
export const SETTINGS_BACKUP_VERSION = 1

export type SettingsBackupAgent = {
  scanDepth?: number
  maxLoreInjections?: number
  creationMode?: 'ask' | 'silent'
  narrativeLength?: {
    min?: number
    max?: number
    hardCap?: boolean
  }
  backendControl?: boolean
  greeting?: boolean
  pipeline?: {
    mode?: 'off' | 'merged' | 'full'
    maxSummaries?: number
  }
  smartSearch?: {
    enabled?: boolean
    baseUrl?: string
    mode?: 'simple' | 'multi'
    maxQueries?: number
    searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
    topic?: 'general' | 'news' | 'finance'
    /** 导出时仅标记是否配置过密钥，从不写入明文 */
    hasApiKey?: boolean
    apiKey?: string
  }
}

export type SettingsBackupPayload = {
  format: typeof SETTINGS_BACKUP_FORMAT
  version: number
  exportedAt: string
  theme?: ThemeMode
  lang?: string
  thinking?: 'low' | 'medium' | 'high'
  prefs?: Partial<ChatPrefs>
  reading?: Partial<ReadingPrefs>
  agent?: SettingsBackupAgent
}

export type AppliedClientSettings = {
  theme: ThemeMode
  lang: string
  thinking: 'low' | 'medium' | 'high'
  prefs: ChatPrefs
  reading: ReadingPrefs
  agent?: SettingsBackupAgent
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function asTheme(v: unknown): ThemeMode | undefined {
  return v === 'light' || v === 'dark' || v === 'system' ? v : undefined
}

function asThinking(v: unknown): 'low' | 'medium' | 'high' | undefined {
  return v === 'low' || v === 'medium' || v === 'high' ? v : undefined
}

function asLang(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined
  return v.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

/** 从当前浏览器状态收集可备份的客户端设置（不含 API Key 明文） */
export function collectClientSettings(extra?: {
  thinking?: 'low' | 'medium' | 'high'
  agent?: SettingsBackupAgent
}): SettingsBackupPayload {
  return {
    format: SETTINGS_BACKUP_FORMAT,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    theme: getStoredTheme(),
    lang:
      typeof localStorage !== 'undefined' && localStorage.getItem('dd-lang') === 'en' ? 'en' : 'zh',
    thinking: extra?.thinking ?? asThinking(localStorage.getItem('dd-thinking')) ?? 'medium',
    prefs: getChatPrefs(),
    reading: getReadingPrefs(),
    agent: extra?.agent,
  }
}

export function serializeSettingsBackup(payload: SettingsBackupPayload): string {
  return JSON.stringify(payload, null, 2)
}

export function downloadSettingsBackup(payload: SettingsBackupPayload, filename?: string) {
  const blob = new Blob([serializeSettingsBackup(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || `drawdream-settings-${payload.exportedAt.slice(0, 10)}.json`
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 部分 WebView 在 revoke 过早时会取消下载
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/**
 * 解析备份 JSON。兼容旧版（无 format 字段、仅 theme/lang/prefs/agent）导出。
 */
export function parseSettingsBackup(raw: unknown): SettingsBackupPayload {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      throw new Error('invalid_json')
    }
  }
  if (!isObject(raw)) throw new Error('invalid_shape')

  const format = raw.format
  if (format != null && format !== SETTINGS_BACKUP_FORMAT) {
    throw new Error('unknown_format')
  }

  const version = typeof raw.version === 'number' ? raw.version : 0
  if (version > SETTINGS_BACKUP_VERSION) throw new Error('version_too_new')

  const agentRaw = isObject(raw.agent) ? raw.agent : undefined
  let agent: SettingsBackupAgent | undefined
  if (agentRaw) {
    const pipeline = isObject(agentRaw.pipeline) ? agentRaw.pipeline : undefined
    const smart = isObject(agentRaw.smartSearch) ? agentRaw.smartSearch : undefined
    agent = {
      scanDepth: typeof agentRaw.scanDepth === 'number' ? agentRaw.scanDepth : undefined,
      maxLoreInjections:
        typeof agentRaw.maxLoreInjections === 'number' ? agentRaw.maxLoreInjections : undefined,
      creationMode: agentRaw.creationMode === 'silent' || agentRaw.creationMode === 'ask'
        ? agentRaw.creationMode
        : undefined,
      narrativeLength: isObject(agentRaw.narrativeLength)
        ? {
            min:
              typeof agentRaw.narrativeLength.min === 'number'
                ? agentRaw.narrativeLength.min
                : undefined,
            max:
              typeof agentRaw.narrativeLength.max === 'number'
                ? agentRaw.narrativeLength.max
                : undefined,
            hardCap:
              typeof agentRaw.narrativeLength.hardCap === 'boolean'
                ? agentRaw.narrativeLength.hardCap
                : undefined,
          }
        : undefined,
      backendControl:
        typeof agentRaw.backendControl === 'boolean' ? agentRaw.backendControl : undefined,
      greeting: typeof agentRaw.greeting === 'boolean' ? agentRaw.greeting : undefined,
      pipeline: pipeline
        ? {
            mode:
              pipeline.mode === 'off' || pipeline.mode === 'merged' || pipeline.mode === 'full'
                ? pipeline.mode
                : undefined,
            maxSummaries:
              typeof pipeline.maxSummaries === 'number' ? pipeline.maxSummaries : undefined,
          }
        : undefined,
      smartSearch: smart
        ? {
            enabled: typeof smart.enabled === 'boolean' ? smart.enabled : undefined,
            baseUrl: typeof smart.baseUrl === 'string' ? smart.baseUrl : undefined,
            mode: smart.mode === 'multi' || smart.mode === 'simple' ? smart.mode : undefined,
            maxQueries: typeof smart.maxQueries === 'number' ? smart.maxQueries : undefined,
            searchDepth:
              smart.searchDepth === 'basic' ||
              smart.searchDepth === 'advanced' ||
              smart.searchDepth === 'fast' ||
              smart.searchDepth === 'ultra-fast'
                ? smart.searchDepth
                : undefined,
            topic:
              smart.topic === 'news' || smart.topic === 'finance' || smart.topic === 'general'
                ? smart.topic
                : undefined,

            hasApiKey: typeof smart.hasApiKey === 'boolean' ? smart.hasApiKey : undefined,
            // 仅接受用户主动写入备份的密钥；旧导出只有 hasApiKey 时不会回填
            apiKey: typeof smart.apiKey === 'string' && smart.apiKey.trim() ? smart.apiKey : undefined,
          }
        : undefined,
    }
  }

  // 旧版导出把 density 放在根上
  const prefs: Partial<ChatPrefs> = isObject(raw.prefs) ? { ...(raw.prefs as Partial<ChatPrefs>) } : {}
  if (
    (raw.density === 'comfort' || raw.density === 'compact') &&
    prefs.density == null
  ) {
    prefs.density = raw.density
  }

  return {
    format: SETTINGS_BACKUP_FORMAT,
    version: version || 1,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
    theme: asTheme(raw.theme),
    lang: asLang(raw.lang),
    thinking: asThinking(raw.thinking),
    prefs: Object.keys(prefs).length ? prefs : undefined,
    reading: isObject(raw.reading) ? (raw.reading as Partial<ReadingPrefs>) : undefined,
    agent,
  }
}

/** 应用本地偏好（主题/语言/聊天/阅读/思考强度本地值），返回应用后快照 */
export function applyClientSettings(payload: SettingsBackupPayload): AppliedClientSettings {
  const theme = payload.theme ?? getStoredTheme()
  applyTheme(theme)

  const lang = payload.lang ?? (localStorage.getItem('dd-lang') === 'en' ? 'en' : 'zh')
  localStorage.setItem('dd-lang', lang)

  const thinking = payload.thinking ?? asThinking(localStorage.getItem('dd-thinking')) ?? 'medium'
  localStorage.setItem('dd-thinking', thinking)

  const prefs = payload.prefs ? setChatPrefs(payload.prefs) : getChatPrefs()
  const reading = payload.reading ? setReadingPrefs(payload.reading) : getReadingPrefs()

  return { theme, lang, thinking, prefs, reading, agent: payload.agent }
}

/** 把 agent 段转成 putConfig 可用的 patch（跳过空段；apiKey 仅在备份含明文时写入） */
export function agentPatchFromBackup(agent?: SettingsBackupAgent): Record<string, unknown> | null {
  if (!agent) return null
  const patch: Record<string, unknown> = {}
  if (typeof agent.scanDepth === 'number') patch.scanDepth = agent.scanDepth
  if (typeof agent.maxLoreInjections === 'number') patch.maxLoreInjections = agent.maxLoreInjections
  if (agent.creationMode === 'ask' || agent.creationMode === 'silent') {
    patch.creationMode = agent.creationMode
  }
  if (typeof agent.backendControl === 'boolean') patch.backendControl = agent.backendControl
  if (typeof agent.greeting === 'boolean') patch.greeting = agent.greeting
  if (agent.pipeline) {
    patch.pipeline = {
      ...(agent.pipeline.mode ? { mode: agent.pipeline.mode } : {}),
      ...(typeof agent.pipeline.maxSummaries === 'number'
        ? { maxSummaries: agent.pipeline.maxSummaries }
        : {}),
    }
  }
  if (agent.smartSearch) {
    const ss = agent.smartSearch
    const smart: Record<string, unknown> = {}
    if (typeof ss.enabled === 'boolean') smart.enabled = ss.enabled
    if (ss.baseUrl?.trim()) smart.baseUrl = ss.baseUrl.trim()
    if (ss.mode) smart.mode = ss.mode
    if (typeof ss.maxQueries === 'number') smart.maxQueries = ss.maxQueries
    if (ss.searchDepth) smart.searchDepth = ss.searchDepth
    if (ss.topic) smart.topic = ss.topic

    if (ss.apiKey?.trim()) smart.apiKey = ss.apiKey.trim()
    if (Object.keys(smart).length) patch.smartSearch = smart
  }
  return Object.keys(patch).length ? patch : null
}
