/** DrawDream Agent REST 客户端（/api/*，同源） */

import { cardAccent, cardGradient } from '../utils/cardVisual'
import type { CharacterCard } from '../types/character'

const getCache = new Map<string, { at: number; data: unknown }>()
const getInflight = new Map<string, Promise<unknown>>()
const GET_TTL_MS = 180_000

export function apiGetCacheClear(prefix?: string): void {
  if (!prefix) {
    getCache.clear()
    return
  }
  for (const k of [...getCache.keys()]) {
    if (k === prefix || k.startsWith(prefix)) getCache.delete(k)
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* non-json */
  }
  const err = (data as { error?: string } | null)?.error
  if (res.status === 401) {
    const code = (data as { code?: string } | null)?.code
    if (code === 'AUTH_REQUIRED' || !code) {
      if (typeof window !== 'undefined') {
        try {
          const r = await fetch('/api/auth/local-session', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          if (r.ok) {
            window.location.reload()
            throw new Error('会话已恢复，正在刷新…')
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes('会话已恢复')) throw e
        }
        throw new Error(err || '本地会话不可用，请重启应用')
      }
    }
  }
  if (!res.ok || err) throw new Error(err || `请求失败（HTTP ${res.status}）`)
  if (method !== 'GET' && method !== 'HEAD') {
    apiGetCacheClear()
  }
  return data as T
}

export async function apiGet<T>(path: string, opts?: { bypassCache?: boolean }): Promise<T> {
  if (!opts?.bypassCache) {
    const hit = getCache.get(path)
    if (hit && Date.now() - hit.at < GET_TTL_MS) return hit.data as T
    const inflight = getInflight.get(path)
    if (inflight) return inflight as Promise<T>
  }
  const p = api<T>(path).then((d) => {
    getCache.set(path, { at: Date.now(), data: d })
    getInflight.delete(path)
    return d
  })
  if (!opts?.bypassCache) getInflight.set(path, p)
  try {
    return await p
  } catch (e) {
    getInflight.delete(path)
    throw e
  }
}

export const apiPost = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) })
export const apiPut = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) })

// ---- 环境信息（设置 → 环境分页） ----

export interface EnvToolProbe {
  ok: boolean
  version?: string
}

export interface EnvironmentInfo {
  runtime: {
    name: 'node' | 'bun'
    version?: string
    pid: number
    platform: string
    arch: string
    uptimeMs: number
  }
  service: { port: number; cwd: string; agentDir: string; streaming: boolean }
  disk: Record<string, number>
  toolchain: { node: EnvToolProbe; bun: EnvToolProbe; ffmpeg: EnvToolProbe; python: EnvToolProbe }
}

export function fetchEnvironment(): Promise<EnvironmentInfo> {
  return apiGet<EnvironmentInfo>('/api/environment', { bypassCache: true })
}

// ---- MCP 外设（设置 → 环境 → 工具，JSON 配置） ----

export type McpTransport = 'stdio' | 'http' | 'sse'

export interface McpServerItem {
  id: string
  name: string
  enabled: boolean
  defaultEnabled?: boolean
  transport: McpTransport
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  tools: Array<{ name: string; qualifiedName: string; description?: string }>
  summary?: string
  source?: string
  sources?: string[]
  discovered?: boolean
}

export interface McpConfigEntry {
  id: string
  name: string
  enabled: boolean
  transport: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

export interface McpListResponse {
  servers: McpServerItem[]
  sessionEnabled: string[]
  config: McpConfigEntry[]
  discovered: number
}

export function fetchMcpServers(): Promise<McpListResponse> {
  return apiGet<McpListResponse>('/api/mcp', { bypassCache: true })
}

export function mcpSync(): Promise<{ ok: boolean; servers: McpServerItem[] }> {
  return apiPost('/api/mcp/sync', {})
}

export function mcpSetEnabled(id: string, enabled: boolean, persistDefault?: boolean): Promise<{ ok: boolean }> {
  return apiPost('/api/mcp/enable', { id, enabled, persistDefault })
}

export function mcpAddServer(body: Partial<McpConfigEntry>): Promise<{ ok: boolean; server: McpConfigEntry }> {
  return apiPost('/api/mcp/servers', body)
}

export function mcpUpdateServer(body: Partial<McpConfigEntry>): Promise<{ ok: boolean; server: McpConfigEntry }> {
  return apiPut('/api/mcp/servers', body)
}

export function mcpDeleteServer(id: string): Promise<{ ok: boolean }> {
  return apiDelete(`/api/mcp/servers?id=${encodeURIComponent(id)}`)
}
export const apiDelete = <T,>(path: string) => api<T>(path, { method: 'DELETE' })

export async function importSillyTavernChat(content: string, tag?: string): Promise<{ messages: number; warnings: string[] }> {
  return apiPost('/api/import', { content, ...(tag?.trim() ? { tag: tag.trim() } : {}) })
}

/** 上传附件到 `.drawdream-uploads/`（原始字节 + query name，免 multipart） */
export async function uploadFile(
  file: File | Blob,
  name?: string,
): Promise<{ file: string; bytes: number; size: string }> {
  const rawName = (name || (file instanceof File ? file.name : 'upload.bin') || 'upload.bin').trim()
  const res = await fetch(`/api/upload?name=${encodeURIComponent(rawName)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* non-json */
  }
  const err = (data as { error?: string } | null)?.error
  if (!res.ok || err) throw new Error(err || `上传失败（HTTP ${res.status}）`)
  const body = data as { file?: string; bytes?: number; size?: string }
  if (!body.file) throw new Error('上传失败：无返回路径')
  return { file: body.file, bytes: body.bytes ?? 0, size: body.size ?? '' }
}

/** 按卡库路径更新字段（标签等） */
export async function updateLibraryCardFields(
  path: string,
  patch: {
    name?: string
    description?: string
    personality?: string
    scenario?: string
    tags?: string[]
  },
): Promise<void> {
  await apiPut('/api/cards/fields', { path, ...patch })
  apiGetCacheClear('/api/cards')
  apiGetCacheClear(`/api/cards/detail?path=`)
}

// ---------- Novel Forge ----------

export type ForgeMode = 'quick' | 'standard' | 'deep'

export interface ForgeJobListItem {
  id: string
  sourceName: string
  sourceChars: number
  stage: string
  mode: ForgeMode
  title?: string
  createdAt: number
  updatedAt: number
  result: { cardPath?: string; lorebookPath?: string; cardName?: string } | null
}

export interface ForgeCastItem {
  name: string
  aliases: string[]
  roleHint: string
  traits: string[]
  count: number
  chunkSpan: number
}

export interface ForgeEstimate {
  sourceChars: number
  mode: ForgeMode
  chunkTotal: number
  mapChunks: number
  mapCalls: number
  outlineCalls?: number
  elevateCalls: number
  totalCalls: number
  approxInputTokens: number
  approxOutputTokens: number
  note: string
  approxMinutes: number
  recommendedMode?: ForgeMode
  recommendReason?: string
  recommendConfidence?: number
  recommendAlternatives?: Array<{ mode: ForgeMode; blurb: string }>
}

export interface ForgeTimelineEvent {
  title: string
  order: number
  summary: string
  keys: string[]
  chapterHint?: string
}

export type ForgeErrorClass = 'timeout' | 'json' | 'quota' | 'unknown'
export type ForgeRetryFrom =
  | 'auto'
  | 'indexing'
  | 'outlining'
  | 'extracting'
  | 'reducing'
  | 'elevating'
  | 'full'

export interface ForgeOutlineView {
  blurb?: string
  themes: string[]
  conflicts: string[]
  chapterCount: number
  chapters: { title: string; summary: string; castHints: string[] }[]
  source?: 'auto' | 'user'
}

export interface ForgeCastSelection {
  protagonist: string
  selected: string[]
  renames: Record<string, string>
  manual: string[]
}

export interface ForgeDraftCard {
  name: string
  description: string
  personality: string
  scenario: string
  firstMes: string
  mesExample?: string
  systemPrompt?: string
  postHistoryInstructions?: string
  tags?: string[]
}

export interface ForgeLoreDraftEntry {
  title: string
  keys: string[]
  content: string
  constant: boolean
  order: number
}

export interface ForgeJobView {
  job: {
    id: string
    sourceName: string
    sourceChars: number
    stage: string
    options: {
      mode: ForgeMode
      title?: string
      protagonist?: string
      multiCard?: boolean
      multiCardLimit?: number
      extractModel?: string
      elevateModel?: string
    }
    result?: { cardPath?: string; lorebookPath?: string; cardName?: string }
  }
  progress: {
    stage: string
    percent: number
    message: string
    chunkTotal: number
    chunkDone: number
    error?: string
    errorClass?: ForgeErrorClass
    failedStage?: string
    updatedAt: number
  } | null
  running: boolean
  cast: ForgeCastItem[]
  selection?: ForgeCastSelection | null
  outline?: ForgeOutlineView | null
  draft: {
    cardName: string
    descriptionPreview: string
    loreCount: number
    extraCardNames?: string[]
    card?: ForgeDraftCard
    lore?: ForgeLoreDraftEntry[]
    extraCards?: ForgeDraftCard[]
  } | null
  timeline?: ForgeTimelineEvent[]
  versions?: {
    version: number
    savedAt: number
    cardName?: string
    loreCount: number
    extraCount: number
  }[]
  stats?: {
    sourceChars: number
    mode: ForgeMode
    castCount: number
    selectedCount: number
    outlineChapters: number
    loreCount: number
    extraCards: number
    versionCount: number
    enableOutline: boolean
  }
  estimate?: ForgeEstimate
  result: { cardPath?: string; lorebookPath?: string; cardName?: string } | null
}

export const listForgeJobs = () => apiGet<{ jobs: ForgeJobListItem[] }>('/api/forge/jobs', { bypassCache: true })

export const getForgeJob = (id: string) =>
  apiGet<ForgeJobView>(`/api/forge/job?id=${encodeURIComponent(id)}`, { bypassCache: true })

export const estimateForgeJobApi = (body: {
  sourceChars?: number
  text?: string
  textSample?: string
  mode?: ForgeMode
  sampleChunks?: number
  chunkChars?: number
  extraCards?: number
  enableOutline?: boolean
  hasUserOutline?: boolean
  outlineText?: string
}) => apiPost<ForgeEstimate>('/api/forge/estimate', body)

export const createForgeJob = (body: {
  text: string
  name?: string
  mode?: ForgeMode
  title?: string
  sampleChunks?: number
  concurrency?: number
  multiCard?: boolean
  multiCardLimit?: number
  extractModel?: string
  elevateModel?: string
  extractProvider?: string
  elevateProvider?: string
  enableOutline?: boolean
  outlineText?: string
}) =>
  apiPost<{ ok: boolean; id: string; started: boolean; message: string; estimate?: ForgeEstimate }>(
    '/api/forge/jobs',
    body,
  )

export const startForgeJob = (id: string) => apiPost<{ ok: boolean; started: boolean; message: string }>('/api/forge/start', { id })

export const cancelForgeJob = (id: string) =>
  apiPost<{ ok: boolean; message: string }>('/api/forge/cancel', { id })

export const retryForgeJob = (
  id: string,
  opts?: { from?: ForgeRetryFrom; lowTemp?: boolean },
) =>
  apiPost<{ ok: boolean; started: boolean; message: string }>('/api/forge/retry', {
    id,
    from: opts?.from ?? 'auto',
    lowTemp: opts?.lowTemp === true,
  })

export const saveForgeCastSelection = (id: string, selection: ForgeCastSelection) =>
  apiPut<{ ok: boolean; selection: ForgeCastSelection }>('/api/forge/cast-selection', {
    id,
    ...selection,
  })

export const saveForgeDraft = (
  id: string,
  draft: {
    card?: ForgeDraftCard
    lore?: ForgeLoreDraftEntry[]
    extraCards?: ForgeDraftCard[]
  },
) => apiPut<{ ok: boolean; stage: string }>('/api/forge/draft', { id, ...draft })

export const saveForgeOutline = (
  id: string,
  outline: {
    blurb?: string
    themes?: string[]
    conflicts?: string[]
    chapters?: { title: string; summary: string; castHints?: string[]; beats?: string[] }[]
  },
) => apiPut<{ ok: boolean; outline: ForgeOutlineView }>('/api/forge/outline', { id, ...outline })

export const elevateForgeJob = (
  id: string,
  protagonist?: string,
  opts?: {
    multiCard?: boolean
    multiCardLimit?: number
    sideNames?: string[]
    selection?: ForgeCastSelection
  },
) =>
  apiPost<{ ok: boolean; stage: string; protagonist?: string }>('/api/forge/elevate', {
    id,
    protagonist,
    ...opts,
  })

export const refineForgeJob = (id: string, instruction: string) =>
  apiPost<{ ok: boolean; stage: string }>('/api/forge/refine', { id, instruction })

export const deleteForgeJob = (id: string) =>
  apiDelete<{ ok: boolean }>(`/api/forge/job?id=${encodeURIComponent(id)}`)

export const applyForgeJob = (id: string, opts?: { switchCard?: boolean; mountLore?: boolean }) =>
  apiPost<{
    ok: boolean
    cardPath: string
    lorebookPath: string
    cardName: string
    entryCount: number
    extraCardPaths?: string[]
  }>('/api/forge/apply', { id, ...opts })

export const restoreForgeVersion = (id: string, version: number) =>
  apiPost<{ ok: boolean; stage: string; version: number }>('/api/forge/restore-version', {
    id,
    version,
  })

export const exportForgePack = (id: string) =>
  apiGet<Record<string, unknown>>(`/api/forge/export?id=${encodeURIComponent(id)}`, {
    bypassCache: true,
  })

export interface CurrentModelInfo {
  provider: string
  id: string
  name: string
  thinkingLevel: string
  availableLevels: string[]
  contextWindow: number
  maxTokens?: number
}

export interface ModelInfo {
  provider: string
  providerName: string
  id: string
  name: string
  reasoning: boolean
  vision: boolean
  contextWindow: number
  maxTokens?: number
}

export interface ModelsResponse {
  current: CurrentModelInfo | null
  models: ModelInfo[]
}

export interface CardLibItem {
  path: string
  name: string
  tags: string[]
  isPng: boolean
  mtimeMs: number
  fav: boolean
}

export interface CardsResponse {
  current: string
  cards: CardLibItem[]
}

export interface CardResponse {
  path: string
  displayName: string | null
  greetingIndex: number
  name: string
  description: string
  personality: string
  scenario: string
  creatorNotes: string
  tags: string[]
  embeddedLoreCount?: number
  isPng?: boolean
  greetings: Array<{ index: number; label: string; text: string }>
  runtimeManifest?: TavernRuntimeManifest | null
}

export interface RuntimeDiagnostic {
  code: string
  level: 'info' | 'warning' | 'error'
  message: string
  path?: string
}

export interface TavernRuntimeManifest {
  version: 1
  cardFingerprint: string
  entrypoints: {
    html: string[]
    css: string[]
    javascript: string[]
  }
  uiModules: Array<{ name: string; placeholder: string; surface: 'state-panel' | 'card-ui' }>
  csp: { scriptSrc: string[]; styleSrc: string[]; connectSrc: string[] }
  mobile: { supported: boolean; safeArea: boolean; responsiveHeight: boolean; touchEvents: boolean }
  requiredCapabilities: string[]
  regexScripts: Array<{
    id: string
    scriptName: string
    findRegex: string
    replaceString: string
    trimStrings: string[]
    placement: number[]
    disabled: boolean
    markdownOnly: boolean
    promptOnly: boolean
  }>
  extensionScripts: Record<string, unknown>[]
  externalModules: Array<{ url: string; hash?: string }>
  placeholders: string[]
  worldBooks: string[]
  initialVariables: Record<string, unknown>
  diagnostics: RuntimeDiagnostic[]
}

export interface CardRuntimeResponse {
  path: string
  name: string
  manifest: TavernRuntimeManifest
  grantedModules?: string[]
}

export interface CompatibilityContractResponse {
  version: 1
  contract: {
    id: string
    domain: string
    status: 'supported' | 'partial' | 'fixture-covered' | 'unsupported'
    drawdreamTarget: string
    fixtureIds: string[]
    mobile: 'supported' | 'partial' | 'unsupported'
    reuse: 'clean-room' | 'adapted-with-notice' | 'pending-review'
  }
}

export const compatibilityContracts = () =>
  apiGet<{ version: 1; contracts: CompatibilityContractResponse['contract'][]; reference: { repository: string; commit: string; license: string } }>('/api/compatibility/contracts')

export const compatibilityContract = (id: string) =>
  apiGet<CompatibilityContractResponse>(`/api/compatibility/contract?id=${encodeURIComponent(id)}`)

export interface ChannelPublic {
  name: string
  baseUrl: string
  api: string
  models: Array<{ id: string; name?: string; reasoning?: boolean; contextWindow?: number; kind?: string }>
  hasKey: boolean
  keyKind?: string
  modelCount: number
  modelIds: string[]
}

export interface ChannelsResponse {
  path: string
  configPath: string
  channels: ChannelPublic[]
  defaultProvider: string | null
  defaultModel: string | null
}

export interface RpConfig {
  card: string
  userName: string
  userPersona: string
  language: string
  scanDepth: number
  maxLoreInjections: number
  greeting: boolean
  backendControl?: boolean
  creationMode?: 'ask' | 'silent' | string
  narrativeLength?: {
    min?: number
    max?: number
    hardCap?: boolean
  }
  importStripTags?: string[]
  greetingIndex?: number
  preset?: string
  lorebooks?: string[]
  pipeline?: {
    mode?: 'off' | 'merged' | 'full'
    maxSummaries?: number
  }
  smartSearch?: {
    enabled?: boolean
    apiKey?: string
    baseUrl?: string
    searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
    topic?: 'general' | 'news' | 'finance'
    mode?: 'simple' | 'multi'
    maxQueries?: number
  }
  documentParse?: {
    enabled?: boolean
    apiKey?: string
    modelVersion?: string
    maxChars?: number
  }
  tavernModuleGrants?: Record<string, string[]>
}

export interface PersonaItem {
  id: string
  name: string
  persona: string
  avatar?: string | null
}

export interface PersonasResponse {
  personas: PersonaItem[]
  current: string | null
  lockedForCard: string | null
  activeId: string | null
}

export interface PresetListItem {
  file: string
  name: string
}

export interface PresetsResponse {
  active: string | null
  presets: PresetListItem[]
}

export interface PresetReportItem {
  identifier: string
  name: string
  action: string
  contentChars: number
}

export interface PresetConvertSummary {
  system: number
  postHistory: number
  marker: number
  disabled: number
  missing: number
  blockCount: number
  samplerKeys: string[]
}

export interface PresetBlockMeta {
  id: string
  name: string
  channel: 'system' | 'postHistory'
  role: string
  enabled: boolean
  chars: number
  depth?: number
  content?: string
}

export interface PresetPreviewResult {
  ok: boolean
  converted: boolean
  name: string
  samplers: Record<string, number>
  summary: PresetConvertSummary
  report: PresetReportItem[]
  blocks: PresetBlockMeta[]
}

export interface PresetImportResult {
  ok: boolean
  file: string
  report: PresetReportItem[]
  summary: PresetConvertSummary
  blockCount: number
  converted: boolean
  activated: boolean
}

export interface ActivePresetView {
  path: string | null
  dirty: boolean
  missing?: string
  preset: {
    name: string
    samplers: Record<string, number>
    blocks: PresetBlockMeta[]
  } | null
}

export interface LorebookListItem {
  path: string
  name: string
  entryCount: number
}

export interface LorebooksResponse {
  active: string[]
  activeOne: string | null
  books: LorebookListItem[]
}

export interface LoreEntryListItem {
  fingerprint: string
  comment: string
  keys: string[]
  secondaryKeys: string[]
  constant: boolean
  enabled: boolean
  selective: boolean
  order: number
  chars: number
  source: string
  preview: string
}

export interface LorebookViewResponse {
  lorebookPath: string | null
  lorebookPaths: string[]
  viewPath: string | null
  viewSource: string | null
  viewName: string | null
  total: number
  entries: LoreEntryListItem[]
}

export interface LoreEntryDetail {
  content: string
  comment: string
  keys: string[]
  secondaryKeys: string[]
  constant: boolean
  enabled: boolean
  selective: boolean
  order: number
  source: string
  fingerprint: string
}

export async function fetchModels(): Promise<ModelsResponse> {
  return apiGet<ModelsResponse>('/api/models', { bypassCache: true })
}

export async function fetchCards(): Promise<CardsResponse> {
  return apiGet<CardsResponse>('/api/cards', { bypassCache: true })
}

export async function fetchCard(): Promise<CardResponse> {
  return apiGet<CardResponse>('/api/card', { bypassCache: true })
}

/** 按卡库路径读完整详情（任意卡，不限当前） */
export async function fetchCardDetail(path: string): Promise<CardResponse> {
  return apiGet<CardResponse>(
    `/api/cards/detail?path=${encodeURIComponent(path)}`,
    { bypassCache: true },
  )
}

export async function fetchCardRuntime(path: string): Promise<CardRuntimeResponse> {
  return apiGet<CardRuntimeResponse>(
    `/api/cards/runtime?path=${encodeURIComponent(path)}`,
    { bypassCache: true },
  )
}

export async function grantCardRuntimeModule(fingerprint: string, url: string, allow = true): Promise<{ granted: string[] }> {
  return apiPost<{ granted: string[] }>('/api/cards/runtime/module-grant', { fingerprint, url, allow })
}

export function cardImageUrl(path: string): string {
  return `/api/cards/image?path=${encodeURIComponent(path)}`
}

export type SessionListItem = {
  path: string
  id: string
  name?: string
  firstMessage: string
  modified: number
  messageCount: number
  current: boolean
  preview?: string
  cardName?: string
  cardPath?: string
}

export async function fetchSessions(): Promise<SessionListItem[]> {
  const r = await apiGet<{ sessions: SessionListItem[] }>('/api/sessions', { bypassCache: true })
  return r.sessions ?? []
}

export async function renameSession(path: string, name: string): Promise<void> {
  await apiPost('/api/sessions/rename', { path, name })
}

export async function deleteSession(path: string): Promise<void> {
  await apiDelete(`/api/sessions?path=${encodeURIComponent(path)}`)
}

export function sessionExportUrl(path: string): string {
  return `/api/sessions/export?path=${encodeURIComponent(path)}`
}

export async function selectModel(provider: string, id: string): Promise<CurrentModelInfo> {
  const r = await apiPost<{ current: CurrentModelInfo }>('/api/models/select', { provider, id })
  return r.current
}

export async function setThinkingLevel(level: string): Promise<CurrentModelInfo> {
  const r = await apiPost<{ current?: CurrentModelInfo } | CurrentModelInfo>('/api/models/thinking', {
    level,
  })
  if (r && typeof r === 'object' && 'current' in r && r.current) return r.current
  return r as CurrentModelInfo
}

export interface ProbeThinkingResult {
  current: CurrentModelInfo
  levels: string[]
  reason: string
}

/** 显式探测默认模型（或指定模型）的真实思考档位，成功即应用最低档 */
export async function probeThinking(
  provider?: string,
  id?: string,
): Promise<ProbeThinkingResult> {
  return apiPost<ProbeThinkingResult>('/api/models/probe-thinking', {
    ...(provider && id ? { provider, id } : {}),
  })
}

export interface CommandMeta {
  name: string
  usage: string
  description: string
  takesArgs: boolean
}

export async function fetchCommands(): Promise<CommandMeta[]> {
  const r = await apiGet<{ commands: CommandMeta[] }>('/api/commands', { bypassCache: true })
  return r.commands ?? []
}

export async function healthCheck(): Promise<boolean> {
  try {
    await apiGet('/api/config', { bypassCache: true })
    return true
  } catch {
    try {
      const res = await fetch('/api/models', { credentials: 'include' })
      return res.ok
    } catch {
      return false
    }
  }
}

export async function fetchChannels(): Promise<ChannelsResponse> {
  return apiGet<ChannelsResponse>('/api/channels', { bypassCache: true })
}

export async function updateChannel(body: {
  name: string
  baseUrl?: string
  api?: string
  apiKey?: string
  models?: unknown
  setDefault?: boolean
  modelId?: string
}): Promise<{ current?: CurrentModelInfo } | void> {
  return apiPut<{ current?: CurrentModelInfo }>('/api/channels', body)
}

export async function createChannel(body: {
  name: string
  baseUrl: string
  api: string
  apiKey?: string
  models?: unknown
  setDefault?: boolean
}): Promise<void> {
  await apiPost('/api/channels', body)
}

export async function deleteChannel(name: string): Promise<void> {
  await apiDelete(`/api/channels?name=${encodeURIComponent(name)}`)
}

export interface ChannelTestResult {
  ok: boolean
  status: number
  detail: string
  latencyMs: number
  modelCount?: number
}

export async function testChannel(body: {
  name?: string
  baseUrl?: string
  apiKey?: string
  api?: string
}): Promise<ChannelTestResult> {
  return apiPost<ChannelTestResult>('/api/channels/test', body)
}

export async function fetchChannelModels(body: {
  name?: string
  baseUrl?: string
  apiKey?: string
  api?: string
  apply?: boolean
}): Promise<{ ok: boolean; models: string[] }> {
  return apiPost<{ ok: boolean; models: string[] }>('/api/channels/fetch-models', body)
}

export async function fetchConfig(): Promise<{ config: RpConfig }> {
  return apiGet<{ config: RpConfig }>('/api/config', { bypassCache: true })
}

export async function putConfig(patch: Partial<RpConfig>): Promise<void> {
  await apiPut('/api/config', patch)
}

export async function switchCard(card: string): Promise<void> {
  await apiPost('/api/card/switch', { card })
}

export async function setCardFav(path: string, fav: boolean): Promise<void> {
  await apiPost('/api/cards/fav', { path, fav })
}

/** 删除角色卡；lore/data 与后端 query 一致 */
export async function deleteCard(
  path: string,
  opts?: { lore?: boolean; data?: boolean },
): Promise<void> {
  const q = new URLSearchParams({ path })
  if (opts?.lore) q.set('lore', '1')
  if (opts?.data) q.set('data', '1')
  await apiDelete(`/api/cards?${q.toString()}`)
  apiGetCacheClear()
}

export async function importCardFile(
  file: File,
): Promise<{ path: string; name: string; switched?: boolean }> {
  let name = (file.name || '').replace(/[\\/:*?"<>|]/g, '-').trim()
  // Android WebView 选文件时 name 可能为空 / content URI 末段无扩展名
  if (!/\.(png|json)$/i.test(name)) {
    const t = (file.type || '').toLowerCase()
    if (t.includes('json') || t === 'application/json') name = name ? `${name}.json` : `import-${Date.now()}.json`
    else if (t.includes('png') || t === 'image/png') name = name ? `${name}.png` : `import-${Date.now()}.png`
    else if (name.toLowerCase().endsWith('.png') || name.toLowerCase().endsWith('.json')) {
      /* keep */
    } else {
      // 读魔数：PNG 签名 89 50 4E 47；否则按 JSON 试
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
      const isPng =
        head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
      name = isPng ? `import-${Date.now()}.png` : `import-${Date.now()}.json`
    }
  }
  if (!/\.(png|json)$/i.test(name)) throw new Error('仅支持 .png 或 .json 角色卡')
  const buf = await file.arrayBuffer()
  if (buf.byteLength === 0) throw new Error('文件内容为空，请重新选择角色卡文件')
  const res = await fetch(`/api/cards/import?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/octet-stream' },
    body: buf,
  })
  let data: { error?: string; path?: string; name?: string; switched?: boolean }
  try {
    data = (await res.json()) as { error?: string; path?: string; name?: string; switched?: boolean }
  } catch {
    throw new Error(`导入失败（HTTP ${res.status}）`)
  }
  if (!res.ok || data.error) throw new Error(data.error || `导入失败（HTTP ${res.status}）`)
  apiGetCacheClear()
  return { path: data.path!, name: data.name!, switched: data.switched === true }
}

export async function fetchPersonas(): Promise<PersonasResponse> {
  return apiGet<PersonasResponse>('/api/personas', { bypassCache: true })
}

export async function createPersona(name: string, persona = ''): Promise<string> {
  const r = await apiPost<{ id: string }>('/api/personas', { name, persona })
  return r.id
}

export async function updatePersona(id: string, patch: { name?: string; persona?: string }): Promise<void> {
  await apiPut('/api/personas', { id, ...patch })
}

export async function deletePersona(id: string): Promise<void> {
  await apiDelete(`/api/personas?id=${encodeURIComponent(id)}`)
}

export async function selectPersona(id: string, lockToCard?: boolean): Promise<void> {
  await apiPost('/api/personas/select', { id, lockToCard })
}

export async function fetchPresets(): Promise<PresetsResponse> {
  return apiGet<PresetsResponse>('/api/presets', { bypassCache: true })
}

export async function selectPreset(file: string | null): Promise<void> {
  await apiPost('/api/presets/select', { file })
}

export async function savePresetAs(name: string): Promise<string> {
  const r = await apiPost<{ file: string }>('/api/presets/saveas', { name })
  return r.file
}

export async function renamePreset(file: string, name: string): Promise<void> {
  await apiPost('/api/presets/rename', { file, name })
}

export async function deletePreset(file: string): Promise<void> {
  await apiDelete(`/api/presets?file=${encodeURIComponent(file)}`)
}

export async function fetchPresetFromUrl(url: string): Promise<{
  ok: boolean
  json: Record<string, unknown>
  finalUrl: string
  suggestedName: string
  bytes: number
  isSt: boolean
}> {
  return apiPost('/api/presets/fetch-url', { url })
}

export async function previewPresetJson(
  name: string,
  json: Record<string, unknown>,
): Promise<PresetPreviewResult> {
  return apiPost<PresetPreviewResult>('/api/presets/preview', { name, json })
}

export async function importPresetJson(
  name: string,
  json: Record<string, unknown>,
  opts?: { activate?: boolean },
): Promise<PresetImportResult> {
  return apiPost<PresetImportResult>('/api/presets/import', {
    name,
    json,
    activate: opts?.activate !== false,
  })
}

/** 当前启用预设的块列表（默认磁盘版；working=1 含未保存草稿） */
export async function fetchActivePreset(opts?: {
  working?: boolean
  full?: boolean
}): Promise<ActivePresetView> {
  const q = new URLSearchParams()
  if (opts?.working) q.set('working', '1')
  if (opts?.full) q.set('full', '1')
  const qs = q.toString()
  return apiGet<ActivePresetView>(`/api/preset${qs ? `?${qs}` : ''}`, { bypassCache: true })
}

export async function patchPresetDraft(body: {
  samplers?: Record<string, number>
  blocks?: Array<{
    id: string
    enabled?: boolean
    name?: string
    content?: string
    channel?: 'system' | 'postHistory'
  }>
}): Promise<{ ok: boolean; dirty: boolean }> {
  return apiPut('/api/preset', body)
}

export async function savePresetDraft(): Promise<{ ok: boolean; dirty: boolean; path?: string }> {
  return apiPost('/api/preset/save', {})
}

export async function revertPresetDraft(): Promise<{ ok: boolean; dirty: boolean }> {
  return apiPost('/api/preset/revert', {})
}

export async function fetchPresetBlock(id: string): Promise<PresetBlockMeta & { content: string }> {
  return apiGet(`/api/preset/block?id=${encodeURIComponent(id)}`, { bypassCache: true })
}

export async function fetchLorebooks(): Promise<LorebooksResponse> {
  return apiGet<LorebooksResponse>('/api/lorebooks', { bypassCache: true })
}

export async function selectLorebooks(paths: string[]): Promise<void> {
  await apiPost('/api/lorebooks/select', { paths })
}

export async function deleteLorebook(path: string): Promise<void> {
  await apiDelete(`/api/lorebooks?path=${encodeURIComponent(path)}`)
}

export async function fetchLorebookView(path: string): Promise<LorebookViewResponse> {
  return apiGet<LorebookViewResponse>(`/api/lorebook?path=${encodeURIComponent(path)}`, {
    bypassCache: true,
  })
}

export async function fetchLoreEntry(fp: string): Promise<LoreEntryDetail> {
  return apiGet<LoreEntryDetail>(`/api/lorebook/entry?fp=${encodeURIComponent(fp)}`, {
    bypassCache: true,
  })
}

export async function putLoreEntry(body: {
  fingerprint: string
  constant?: boolean
  order?: number
  keys?: string[]
  secondaryKeys?: string[]
  selective?: boolean
  comment?: string
  content?: string
}): Promise<{ fingerprint: string }> {
  return apiPut('/api/lorebook/entry', body)
}

/**
 * 将 Agent 卡路径编码为单段路由 id。
 * 禁止用 encodeURIComponent：Android WebView 会把路径里的 %2F 解码成 /，
 * 导致 /cards/:id 只吃到 "assets"，详情页「未找到」、删除路径错乱。
 * 使用 base64url（无 / + =），全平台路径安全。
 */
export function encodeCardPath(path: string): string {
  const norm = path.replace(/\\/g, '/').trim()
  if (!norm) return ''
  // btoa 仅 latin1；中文文件名走 UTF-8 → binary string
  const bytes = new TextEncoder().encode(norm)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function decodeCardPath(id: string): string | null {
  try {
    let raw = (id || '').trim()
    if (!raw) return null

    // 新格式：base64url
    if (/^[A-Za-z0-9_-]+$/.test(raw) && !raw.includes('.') && raw.length >= 8) {
      try {
        const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
        const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
        const bin = atob(b64 + pad)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const p = new TextDecoder().decode(bytes).replace(/\\/g, '/').trim()
        if (p.includes('/') || /\.(json|png)$/i.test(p)) return p
      } catch {
        /* fall through 兼容旧 id */
      }
    }

    // 旧格式：encodeURIComponent / 明文路径（桌面书签兼容）
    let p = raw
    try {
      p = decodeURIComponent(raw)
    } catch {
      p = raw
    }
    if (p.includes('%')) {
      try {
        p = decodeURIComponent(p)
      } catch {
        /* keep */
      }
    }
    p = p.replace(/\\/g, '/').trim()
    if (!p) return null
    // WebView 把 %2F 拆成多段时，RR 可能只给首段 "assets"——无法恢复，返回 null
    if (p === 'assets' || p === 'cards') return null
    if (p.includes('/') || /\.(json|png)$/i.test(p)) return p
    if (/^[\w.-]+$/i.test(p)) return `assets/cards/${p}`
  } catch {
    /* ignore */
  }
  return null
}

export function cardLibToUi(item: CardLibItem, index: number): CharacterCard {
  const fileName = item.path.split('/').pop() || item.path
  const displayName = (item.name || '').trim() || fileName.replace(/\.(png|json)$/i, '').replace(/[-_]+/g, ' ').trim() || item.path
  const coverUrl = item.isPng ? cardImageUrl(item.path) : undefined
  return {
    id: encodeCardPath(item.path),
    path: item.path,
    name: displayName,
    nameEn: displayName,
    author: 'Local',
    category: 'original',
    rating: 'safe',
    likes: item.fav ? 1 : 0,
    views: 0,
    chats: 0,
    tags: item.tags?.length ? item.tags : ['Agent'],
    description: item.name || fileName,
    descriptionEn: item.name || fileName,
    personality: '',
    scenario: '',
    firstMessage: '',
    gradient: cardGradient(index),
    accent: cardAccent(index),
    height: 300,
    isPng: item.isPng,
    coverUrl,
    fav: item.fav,
    mtimeMs: item.mtimeMs,
    source: 'agent',
  }
}
