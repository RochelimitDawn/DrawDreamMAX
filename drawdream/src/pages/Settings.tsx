import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  AlignJustify,
  ArrowUpRight,
  Bold,
  BookOpen,
  Brain,
  BrainCog,
  ChevronDown,
  ChevronsDown,
  Clock,
  Cpu,
  DatabaseBackup,
  EyeOff,
  FileText,
  GitBranch,
  GripHorizontal,
  Highlighter,
  IndentIncrease,
  Info,
  Languages,
  Layers,
  Lock,
  MessageCircle,
  MessageSquare,
  Minus,
  Package,
  Palette,
  PenLine,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows3,
  Search,
  Send,
  Server,
  ServerCog,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  StretchHorizontal,
  Tag,
  TextCursorInput,
  Trash2,
  Type,
  Waves,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import i18n from '../i18n'
import {
  createChannel,
  deleteChannel,
  fetchChannelModels,
  fetchChannels,
  fetchConfig,
  fetchModels,
  putConfig,
  probeThinking,
  selectModel,
  setThinkingLevel,
  testChannel,
  updateChannel,
  type ChannelPublic,
  type ChannelTestResult,
  type CurrentModelInfo,
  type ModelInfo,
} from '../agent/rest'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EnvironmentPanel } from '../components/EnvironmentPanel'
import { PresetPicker } from '../components/PresetPicker'
import { ProviderIcon } from '../components/ProviderIcon'
import { ColorPicker } from '../components/ColorPicker'
import { Select } from '../components/Select'
import { Slider } from '../components/Slider'
import {
  ThinkingIntensityWheel,
  type ThinkingIntensity,
} from '../components/ThinkingIntensityWheel'
import { Toggle } from '../components/Toggle'
import { applyTheme, getStoredTheme, type ThemeMode } from '../theme'
import { applyDensity, getChatPrefs, setChatPrefs, type ChatPrefs } from '../utils/prefs'
import {
  COLOR_RULE_IDS,
  getReadingPrefs,
  resetReadingColors,
  setReadingPrefs,
  type ColorRuleId,
  type ReadingPrefs,
} from '../utils/reading-prefs'
import {
  agentPatchFromBackup,
  applyClientSettings,
  collectClientSettings,
  downloadSettingsBackup,
  parseSettingsBackup,
  type SettingsBackupAgent,
} from '../utils/settings-backup'
import { putUserSettings } from '../auth/auth-api'
import { toast } from '../utils/toast'
import './Settings.css'

type Tab =
  | 'general'
  | 'api'
  | 'ui'
  | 'chat'
  | 'reading'
  | 'advanced'
  | 'environment'
  | 'about'

const TAB_KEYS: Tab[] = [
  'general',
  'api',
  'ui',
  'chat',
  'reading',
  'advanced',
  'environment',
  'about',
]

/**
 * 设置导航三大分区：
 * - 基础与模型：通用 + API
 * - 观感：界面 + 阅读
 * - 对话与系统：对话行为 + 高级 + 环境 + 关于
 */
const NAV_GROUPS: Array<{ id: string; keys: Tab[]; groupKey?: string }> = [
  { id: 'core', keys: ['general', 'api'], groupKey: 'settings.groupCore' },
  { id: 'look', keys: ['ui', 'reading'], groupKey: 'settings.groupLook' },
  { id: 'system', keys: ['chat', 'advanced', 'environment', 'about'], groupKey: 'settings.groupSystem' },
]

/** 每个设置子页对应的图标（平板/移动端导航项展示，桌面端仅 hover 高亮） */
const TAB_ICONS: Record<Tab, LucideIcon> = {
  general: SlidersHorizontal,
  api: Server,
  ui: Palette,
  chat: MessageCircle,
  reading: BookOpen,
  advanced: Settings2,
  environment: Cpu,
  about: Info,
}

const RULE_LABEL_KEY: Record<ColorRuleId, string> = {
  dialogue: 'settings.readRuleDialogue',
  name: 'settings.readRuleName',
  thought: 'settings.readRuleThought',
  action: 'settings.readRuleAction',
  emphasis: 'settings.readRuleEmphasis',
  narration: 'settings.readRuleNarration',
}

const RULE_ICONS: Record<ColorRuleId, LucideIcon> = {
  dialogue: MessageSquare,
  name: Tag,
  thought: Brain,
  action: Zap,
  emphasis: Bold,
  narration: BookOpen,
}

/** 设置项便当盒左上角小图标 */
const SIcon = ({ icon: Icon, size = 16 }: { icon: LucideIcon; size?: number }) => (
  <span className="settings-item-icon" aria-hidden>
    <Icon size={size} strokeWidth={2} />
  </span>
)

const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI 兼容' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
]

/**
 * LLM 渠道预设（参考 proma 多协议供应商表）：
 * - OpenAI Completions / Responses
 * - Anthropic Messages（含各厂 /anthropic 兼容根）
 * - Google Generative AI
 * 名称与 baseUrl 对齐常见官方端点，自定义中转仍走 openai-completions。
 */
const PROVIDER_PRESETS: Array<{ name: string; baseUrl: string; api: string; label: string }> = [
  { name: 'deepseek', baseUrl: 'https://api.deepseek.com', api: 'openai-completions', label: 'DeepSeek' },
  { name: 'deepseek-anthropic', baseUrl: 'https://api.deepseek.com/anthropic', api: 'anthropic-messages', label: 'DeepSeek · Anthropic 协议' },
  { name: 'openai', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions', label: 'OpenAI' },
  { name: 'openai-responses', baseUrl: 'https://api.openai.com/v1', api: 'openai-responses', label: 'OpenAI · Responses' },
  { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', label: 'OpenRouter' },
  { name: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions', label: 'SiliconFlow' },
  { name: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions', label: 'Kimi / Moonshot' },
  { name: 'kimi-anthropic', baseUrl: 'https://api.moonshot.cn/anthropic', api: 'anthropic-messages', label: 'Kimi · Anthropic 协议' },
  { name: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding/v1', api: 'anthropic-messages', label: 'Kimi Coding Plan' },
  { name: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', label: '通义千问' },
  { name: 'qwen-anthropic', baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic', api: 'anthropic-messages', label: '通义千问 · Anthropic 协议' },
  { name: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', label: '智谱 GLM' },
  { name: 'zhipu-coding', baseUrl: 'https://open.bigmodel.cn/api/anthropic', api: 'anthropic-messages', label: '智谱 Coding Plan' },
  { name: 'doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions', label: '豆包' },
  { name: 'ark-coding', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan', api: 'anthropic-messages', label: '火山方舟 Coding Plan' },
  { name: 'minimax', baseUrl: 'https://api.minimaxi.com/anthropic', api: 'anthropic-messages', label: 'MiniMax · Anthropic 协议' },
  { name: 'xai', baseUrl: 'https://api.x.ai/v1', api: 'openai-completions', label: 'xAI · Grok' },
  { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions', label: 'Groq Cloud（非 xAI）' },
  { name: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', api: 'openai-completions', label: 'Ollama' },
  { name: 'anthropic', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages', label: 'Anthropic' },
  { name: 'anthropic-compatible', baseUrl: 'https://api.example.com/v1', api: 'anthropic-messages', label: 'Anthropic 兼容（自定义）' },
  { name: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-generative-ai', label: 'Google Gemini' },
  { name: 'xiaomi', baseUrl: 'https://api.xiaomimimo.com/anthropic', api: 'anthropic-messages', label: '小米 MiMo' },
  { name: 'custom', baseUrl: 'https://api.example.com/v1', api: 'openai-completions', label: '自定义中转 · OpenAI 兼容' },
]

function mapThinkingFromAgent(level: string | undefined): ThinkingIntensity {
  const l = (level ?? '').toLowerCase()
  if (l === 'off' || l === 'low' || l === 'minimal') return 'low'
  if (l === 'high' || l === 'xhigh' || l === 'max') return 'high'
  return 'medium'
}

function mapThinkingToAgent(v: ThinkingIntensity, available: string[]): string {
  const set = new Set(available.map((x) => x.toLowerCase()))
  if (v === 'low') {
    if (set.has('off')) return 'off'
    if (set.has('low')) return 'low'
    if (set.has('minimal')) return 'minimal'
    return available[0] ?? 'off'
  }
  if (v === 'high') {
    if (set.has('xhigh')) return 'xhigh'
    if (set.has('high')) return 'high'
    if (set.has('max')) return 'max'
    return available[available.length - 1] ?? 'high'
  }
  if (set.has('medium')) return 'medium'
  if (set.has('high')) return 'high'
  return available[Math.floor(available.length / 2)] ?? 'medium'
}

function actualEndpoint(baseUrl: string, api: string, modelId: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '')
  const clean = root.replace(/\/(responses|chat\/completions|completions|messages|models)$/i, '')
  switch (api.toLowerCase()) {
    case 'anthropic-messages':
      return `${clean.replace(/\/v1$/i, '')}/v1/messages`
    case 'google-generative-ai': {
      const googleRoot = /\/v1beta$/i.test(clean) ? clean : `${clean}/v1beta`
      return `${googleRoot}/models/${modelId || '{model}'}:generateContent`
    }
    case 'openai-responses':
      return `${clean}/responses`
    default:
      return `${clean}/chat/completions`
  }
}

export function SettingsPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialPrefs = getChatPrefs()
  const initialReading = getReadingPrefs()
  const tabFromUrl = searchParams.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(
    tabFromUrl && TAB_KEYS.includes(tabFromUrl) ? tabFromUrl : 'general',
  )
  /** 移动端：分区列表 → 点进详情；桌面端始终双栏 */
  const [mobileDetail, setMobileDetail] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 899px)').matches && !!tabFromUrl
  })
  const [reading, setReading] = useState<ReadingPrefs>(initialReading)
  const [lang, setLang] = useState(i18n.language.startsWith('en') ? 'en' : 'zh')
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme())
  const [density, setDensity] = useState<ChatPrefs['density']>(initialPrefs.density)
  const [autoScroll, setAutoScroll] = useState(initialPrefs.autoScroll)
  const [stream, setStream] = useState(initialPrefs.streamReply)
  const [enterSend, setEnterSend] = useState(initialPrefs.enterSend)
  const [timestamps, setTimestamps] = useState(initialPrefs.showTimestamps)
  const [blurNsfw, setBlurNsfw] = useState(initialPrefs.blurNsfw)

  const [channels, setChannels] = useState<ChannelPublic[]>([])
  const [defaultProvider, setDefaultProvider] = useState<string | null>(null)
  const [channelName, setChannelName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [current, setCurrent] = useState<CurrentModelInfo | null>(null)
  const [modelKey, setModelKey] = useState('')
  const [, setApiLoading] = useState(false)
  const [probe, setProbe] = useState<ChannelTestResult | null>(null)
  const [probing, setProbing] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBaseUrl, setNewBaseUrl] = useState('')
  const [newApi, setNewApi] = useState('openai-completions')
  const [newKey, setNewKey] = useState('')
  const [newPreset, setNewPreset] = useState('deepseek')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [manualModel, setManualModel] = useState('')
  /** 独立向量模型区块：渠道 + 该渠道向量模型 */
  const [vectorChannel, setVectorChannel] = useState('')
  const [vectorModelId, setVectorModelId] = useState('')
  /** 独立向量模型卡片：默认折叠，点头部展开/收起 */
  const [vectorOpen, setVectorOpen] = useState(false)
  /** 思考强度显式探测：目标 = 默认模型（current） */
  const [probingThinking, setProbingThinking] = useState(false)
  const [thinkingProbeMsg, setThinkingProbeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // 自动更新：检查中状态（由全局 UpdateChecker 同步）；对话框/Toast 由全局处理
  const [updateChecking, setUpdateChecking] = useState(false)
  const autoPullRef = useRef<string>('')

  const [wiDepth, setWiDepth] = useState('4')
  const [maxLore, setMaxLore] = useState('3')
  const [creationMode, setCreationMode] = useState<'ask' | 'silent'>('ask')
  const [narrativePreset, setNarrativePreset] = useState<'short' | 'default' | 'long' | 'custom'>('default')
  const [narrativeMin, setNarrativeMin] = useState('400')
  const [narrativeMax, setNarrativeMax] = useState('900')
  const [narrativeHardCap, setNarrativeHardCap] = useState(true)
  const [backendControl, setBackendControl] = useState(false)
  const [greetingOn, setGreetingOn] = useState(true)
  const [pipelineMode, setPipelineMode] = useState<'off' | 'merged' | 'full'>('merged')
  const [pipelineMaxSummaries, setPipelineMaxSummaries] = useState('40')
  const [smartSearchEnabled, setSmartSearchEnabled] = useState(true)
  const [smartSearchApiKey, setSmartSearchApiKey] = useState('')
  const [smartSearchBaseUrl, setSmartSearchBaseUrl] = useState('https://api.tavily.com')
  const [smartSearchMode, setSmartSearchMode] = useState<'simple' | 'multi'>('simple')
  const [smartSearchMaxQueries, setSmartSearchMaxQueries] = useState('3')
  const [smartSearchDepth, setSmartSearchDepth] = useState<'basic' | 'advanced' | 'fast' | 'ultra-fast'>('basic')
  const [smartSearchTopic, setSmartSearchTopic] = useState<'general' | 'news' | 'finance'>('general')
  const [thinking, setThinking] = useState<ThinkingIntensity>('medium')
  const [availableLevels, setAvailableLevels] = useState<string[]>([])
  const importFileRef = useRef<HTMLInputElement>(null)
  const [importingSettings, setImportingSettings] = useState(false)

  const loadAgentApi = useCallback(async () => {
    setApiLoading(true)
    try {
      const [ch, md, cfg] = await Promise.all([fetchChannels(), fetchModels(), fetchConfig()])
      setChannels(ch.channels)
      setDefaultProvider(ch.defaultProvider)
      // 默认不展开编辑区：仅同步列表/当前模型；点渠道卡片后再写入 channelName 展开
      setModels(md.models)
      setCurrent(md.current)
      if (md.current) {
        setModelKey(`${md.current.provider}::${md.current.id}`)
        setAvailableLevels(md.current.availableLevels ?? [])
        setThinking(mapThinkingFromAgent(md.current.thinkingLevel))
      } else if (md.models[0]) {
        setModelKey(`${md.models[0].provider}::${md.models[0].id}`)
      }
      // 若用户已点开某渠道且该渠道仍在，保留展开并刷新 endpoint；否则保持收起
      setChannelName((prev) => {
        if (prev && ch.channels.some((c) => c.name === prev)) {
          const keep = ch.channels.find((c) => c.name === prev)
          if (keep) setEndpoint(keep.baseUrl)
          return prev
        }
        return ''
      })
      // 独立向量模型区块：从渠道里找已标记 kind=embedding 的渠道+模型回填
      {
        let found: { channel: string; model: string } | null = null
        for (const c of ch.channels) {
          const m = c.models.find(
            (x) => x.kind === 'embedding' || x.kind === 'embed' || x.kind === 'embeddings',
          )
          if (m) {
            found = { channel: c.name, model: m.id }
            break
          }
        }
        setVectorChannel(found?.channel ?? '')
        setVectorModelId(found?.model ?? '')
      }
      setWiDepth(String(cfg.config.scanDepth ?? 4))
      setMaxLore(String(cfg.config.maxLoreInjections ?? 3))
      setCreationMode(cfg.config.creationMode === 'silent' ? 'silent' : 'ask')
      {
        const min = cfg.config.narrativeLength?.min ?? 400
        const max = cfg.config.narrativeLength?.max ?? 900
        setNarrativeMin(String(min))
        setNarrativeMax(String(max))
        setNarrativeHardCap(cfg.config.narrativeLength?.hardCap !== false)
        if (min === 200 && max === 400) setNarrativePreset('short')
        else if (min === 800 && max === 1500) setNarrativePreset('long')
        else if (min === 400 && max === 900) setNarrativePreset('default')
        else setNarrativePreset('custom')
      }
      setBackendControl(cfg.config.backendControl !== false)
      setGreetingOn(cfg.config.greeting !== false)
      const pm = cfg.config.pipeline?.mode
      setPipelineMode(pm === 'off' || pm === 'full' ? pm : 'merged')
      setPipelineMaxSummaries(String(cfg.config.pipeline?.maxSummaries ?? 40))
      setSmartSearchEnabled(cfg.config.smartSearch?.enabled !== false)
      setSmartSearchApiKey(cfg.config.smartSearch?.apiKey ?? '')
      setSmartSearchBaseUrl(cfg.config.smartSearch?.baseUrl?.trim() || 'https://api.tavily.com')
      setSmartSearchMode(cfg.config.smartSearch?.mode === 'multi' ? 'multi' : 'simple')
      setSmartSearchMaxQueries(String(cfg.config.smartSearch?.maxQueries ?? 3))
      {
        const d = cfg.config.smartSearch?.searchDepth
        setSmartSearchDepth(
          d === 'advanced' || d === 'fast' || d === 'ultra-fast' || d === 'basic' ? d : 'basic',
        )
        const tp = cfg.config.smartSearch?.topic
        setSmartSearchTopic(tp === 'news' || tp === 'finance' ? tp : 'general')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setApiLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAgentApi()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [])

  const checkUpdate = () => {
    const g = (window as unknown as { __ddCheckUpdate?: (l?: (c: boolean) => void) => void }).__ddCheckUpdate
    if (!g) {
      toast(t('settings.updateUnsupported'), 'info')
      return
    }
    g((checking) => setUpdateChecking(checking))
  }

  useEffect(() => {
    applyDensity(density)
  }, [density])

  const activeChannel = channels.find((c) => c.name === channelName)

  const channelModels = useMemo(
    () => (channelName ? models.filter((m) => m.provider === channelName) : models),
    [models, channelName],
  )

  const modelOptions = useMemo(
    () =>
      channelModels.map((m) => ({
        value: `${m.provider}::${m.id}`,
        label: m.name || m.id,
        meta: m.providerName || m.provider,
         icon: (
           <ProviderIcon
             name={m.provider}
             baseUrl={channels.find((c) => c.name === m.provider)?.baseUrl || ''}
             model={m.id || m.name}
             size={18}
           />
         ),
      })),
    [channelModels, channels],
  )

  const patchPrefs = (patch: Partial<ChatPrefs>) => {
    const next = setChatPrefs(patch)
    setDensity(next.density)
    setAutoScroll(next.autoScroll)
    setStream(next.streamReply)
    setEnterSend(next.enterSend)
    setTimestamps(next.showTimestamps)
    setBlurNsfw(next.blurNsfw)
  }

  const patchReading = (patch: Partial<ReadingPrefs>) => {
    const next = setReadingPrefs(patch)
    setReading(next)
  }

  const onThinking = async (v: ThinkingIntensity) => {
    setThinking(v)
    localStorage.setItem('dd-thinking', v)
    try {
      const level = mapThinkingToAgent(v, availableLevels)
      const cur = await setThinkingLevel(level)
      setCurrent(cur)
      setAvailableLevels(cur.availableLevels ?? availableLevels)
      toast(t('common.saved'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const onLang = (v: string) => {
    setLang(v)
    void i18n.changeLanguage(v)
    localStorage.setItem('dd-lang', v)
  }

  const onTheme = (v: string) => {
    const mode = (v === 'dark' || v === 'system' ? v : 'light') as ThemeMode
    setTheme(mode)
    applyTheme(mode)
  }

  /** 点击渠道：选中并立即设为默认 + 切到该渠道首个模型 */
  const onPickChannel = async (name: string) => {
    if (channelName === name) {
      setChannelName('')
      setEndpoint('')
      setApiKey('')
      setProbe(null)
      return
    }
    setChannelName(name)
    const ch = channels.find((c) => c.name === name)
    if (ch) {
      setEndpoint(ch.baseUrl)
    }
    setApiKey('')
    setProbe(null)
    const first = models.find((m) => m.provider === name)
    if (first) setModelKey(`${first.provider}::${first.id}`)
    try {
      const r = await updateChannel({
        name,
        setDefault: true,
        modelId: first?.id,
      })
      setDefaultProvider(name)
      if (r && typeof r === 'object' && r.current) {
        setCurrent(r.current)
        setModelKey(`${r.current.provider}::${r.current.id}`)
        setAvailableLevels(r.current.availableLevels ?? [])
      } else if (first) {
        const cur = await selectModel(first.provider, first.id)
        setCurrent(cur)
        setAvailableLevels(cur.availableLevels ?? [])
      }
      toast(t('settings.channelActive', { name }), 'success')
      // 选中默认模型后自动探测思考档位并应用最低档 → 完成后提示
      const lv = await pollThinkingProbe()
      if (lv) {
        setThinking(mapThinkingFromAgent(lv))
        toast(t('settings.thinkingAuto', { level: lv }), 'info')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  /** 后台思考档位探测进行中：轮询 /api/models 直到自动应用档位（或超时），返回最终思考档位 */
  const pollThinkingProbe = async (): Promise<string | null> => {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        const { current } = await fetchModels()
        if (current?.thinkingLevel) return current.thinkingLevel
      } catch {
        /* 网络波动忽略，下一轮再试 */
      }
    }
    return null
  }

  const applyPreset = (presetName: string) => {
    setNewPreset(presetName)
    const p = PROVIDER_PRESETS.find((x) => x.name === presetName)
    if (!p) return
    setNewName(p.name === 'custom' ? '' : p.name)
    setNewBaseUrl(p.baseUrl)
    setNewApi(p.api)
  }

  const saveChannel = async () => {
    if (!channelName) {
      toast(t('settings.pickChannelFirst'), 'error')
      return
    }
    try {
      const [provider, id] = modelKey.split('::')
      await updateChannel({
        name: channelName,
        baseUrl: endpoint.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        setDefault: true,
        modelId: provider === channelName ? id : undefined,
      })
      setApiKey('')
      setDefaultProvider(channelName)
      if (provider === channelName && id) {
        const cur = await selectModel(provider, id)
        setCurrent(cur)
        setAvailableLevels(cur.availableLevels ?? [])
      }
      await loadAgentApi()
      toast(t('common.saved'), 'success')
      // 保存默认对话模型后自动探测思考档位并应用最低档 → 完成后提示
      const lv = await pollThinkingProbe()
      if (lv) {
        setThinking(mapThinkingFromAgent(lv))
        toast(t('settings.thinkingAuto', { level: lv }), 'info')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  /** 显式探测默认模型的真实思考档位：成功应用最低档并同步思考控件 */
  const runThinkingProbe = async () => {
    setProbingThinking(true)
    setThinkingProbeMsg(null)
    try {
      const r = await probeThinking()
      setCurrent(r.current)
      setAvailableLevels(r.current.availableLevels ?? [])
      setThinking(mapThinkingFromAgent(r.current.thinkingLevel))
      if (r.reason === 'probe' || r.reason === 'cache') {
        setThinkingProbeMsg({
          ok: true,
          text: t('settings.thinkingProbeOk', {
            levels: r.levels.length ? r.levels.join(' / ') : '—',
            level: r.current.thinkingLevel,
          }),
        })
      } else if (r.reason === 'no-config') {
        setThinkingProbeMsg({ ok: false, text: t('settings.thinkingProbeNoConfig') })
      } else if (r.reason === 'no-reasoning') {
        setThinkingProbeMsg({ ok: false, text: t('settings.thinkingProbeNoReasoning') })
      } else {
        setThinkingProbeMsg({ ok: false, text: t('settings.thinkingProbeFail') })
      }
    } catch (e) {
      setThinkingProbeMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setProbingThinking(false)
    }
  }

  /** 独立向量模型区块保存：给所选渠道的所选模型打 kind=embedding，其余模型保留原样 */
  const saveVectorModel = async () => {
    if (!vectorChannel) {
      toast(t('settings.vectorPickChannel'), 'error')
      return
    }
    const ch = channels.find((c) => c.name === vectorChannel)
    if (!ch) {
      toast(t('settings.vectorChannelMissing'), 'error')
      return
    }
    const target = vectorModelId.trim()
    try {
      const models = ch.models.map((m) => ({
        id: m.id,
        name: m.name,
        ...(m.reasoning !== undefined ? { reasoning: m.reasoning } : {}),
        ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
        ...(m.id === target ? { kind: 'embedding' } : {}),
      }))
      await updateChannel({ name: vectorChannel, models })
      await loadAgentApi()
      if (target) {
        const name = ch.models.find((m) => m.id === target)?.name || target
        toast(t('settings.embeddingApplied', { name }), 'success')
      } else {
        toast(t('settings.embeddingCleared'), 'info')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const runProbe = async () => {
    setProbing(true)
    setProbe(null)
    try {
      const r = await testChannel({
        name: channelName || undefined,
        baseUrl: endpoint.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        api: (activeChannel?.api as string | undefined) || newApi || undefined,
      })
      setProbe(r)
      if (r.ok) toast(`${t('settings.testOk')} · ${r.latencyMs} ms`, 'success')
      else toast(r.detail || t('settings.testFail'), 'error')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setProbe({ ok: false, status: 0, detail: msg, latencyMs: 0 })
      toast(msg, 'error')
    } finally {
      setProbing(false)
    }
  }

  const pullModels = useCallback(
    async (opts?: { silent?: boolean; name?: string; baseUrl?: string; apiKey?: string }) => {
      const name = opts?.name ?? channelName
      if (!name) {
        if (!opts?.silent) toast(t('settings.pickChannelFirst'), 'error')
        return
      }
      setFetchingModels(true)
      try {
        const r = await fetchChannelModels({
          name,
          baseUrl: (opts?.baseUrl ?? endpoint).trim() || undefined,
          apiKey: (opts?.apiKey ?? apiKey).trim() || undefined,
          api: (activeChannel?.api as string | undefined) || newApi || undefined,
          apply: true,
        })
        if (!opts?.silent) toast(t('settings.modelsPulled', { n: r.models.length }), 'success')
        await loadAgentApi()
      } catch (e) {
        if (!opts?.silent) toast(e instanceof Error ? e.message : String(e), 'error')
      } finally {
        setFetchingModels(false)
      }
    },
    [channelName, endpoint, apiKey, activeChannel?.api, newApi, loadAgentApi, t],
  )

  // 选中渠道且有 Key 时自动拉取模型（静默）
  useEffect(() => {
    if (!channelName || !activeChannel?.hasKey) return
    if (channelModels.length > 0) return
    if (autoPullRef.current === channelName) return
    autoPullRef.current = channelName
    void pullModels({ silent: true, name: channelName })
  }, [channelName, activeChannel?.hasKey, channelModels.length, pullModels])

  const addChannel = async () => {
    const name = newName.trim()
    const baseUrl = newBaseUrl.trim()
    if (!name || !baseUrl) {
      toast(t('settings.channelRequired'), 'error')
      return
    }
    try {
      await createChannel({
        name,
        baseUrl,
        api: newApi,
        apiKey: newKey.trim() || undefined,
        models: [],
        setDefault: true,
      })
      setShowAdd(false)
      setNewKey('')
      setChannelName(name)
      setEndpoint(baseUrl)
      setDefaultProvider(name)
      autoPullRef.current = ''
      await loadAgentApi()
      if (newKey.trim()) {
        void pullModels({ silent: false, name, baseUrl, apiKey: newKey.trim() })
      }
      toast(t('settings.channelAdded'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const removeChannel = async (name: string) => {
    setDeleting(true)
    try {
      await deleteChannel(name)
      if (channelName === name) {
        setChannelName('')
        setEndpoint('')
        setModelKey('')
      }
      autoPullRef.current = ''
      setDeleteTarget(null)
      await loadAgentApi()
      toast(t('settings.channelDeleted', { name }), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const applyManualModel = async () => {
    const id = manualModel.trim()
    if (!channelName || !id) {
      toast(t('settings.manualModelRequired'), 'error')
      return
    }
    try {
      const existing = activeChannel?.modelIds ?? []
      const models = existing.includes(id)
        ? existing.map((x) => ({ id: x }))
        : [...existing.map((x) => ({ id: x })), { id }]
      await updateChannel({
        name: channelName,
        models,
        setDefault: true,
        modelId: id,
      })
      const cur = await selectModel(channelName, id)
      setCurrent(cur)
      setModelKey(`${channelName}::${id}`)
      setDefaultProvider(channelName)
      setAvailableLevels(cur.availableLevels ?? [])
      setManualModel('')
      await loadAgentApi()
      toast(t('settings.modelApplied', { name: `${channelName}/${id}` }), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const applyNarrativePreset = (preset: 'short' | 'default' | 'long' | 'custom') => {
    setNarrativePreset(preset)
    if (preset === 'short') {
      setNarrativeMin('200')
      setNarrativeMax('400')
    } else if (preset === 'default') {
      setNarrativeMin('400')
      setNarrativeMax('900')
    } else if (preset === 'long') {
      setNarrativeMin('800')
      setNarrativeMax('1500')
    }
  }

  const saveAdvanced = async () => {
    try {
      let min = Math.max(50, Math.min(5000, Number(narrativeMin) || 400))
      let max = Math.max(min, Math.min(8000, Number(narrativeMax) || 900))
      if (narrativePreset === 'short') {
        min = 200
        max = 400
      } else if (narrativePreset === 'default') {
        min = 400
        max = 900
      } else if (narrativePreset === 'long') {
        min = 800
        max = 1500
      }
      await putConfig({
        scanDepth: Number(wiDepth) || 4,
        maxLoreInjections: Number(maxLore) || 3,
        creationMode,
        narrativeLength: {
          min,
          max,
          hardCap: narrativeHardCap,
        },
        backendControl,
        greeting: greetingOn,
        pipeline: {
          mode: pipelineMode,
          maxSummaries: Math.min(200, Math.max(5, Number(pipelineMaxSummaries) || 40)),
        },
        smartSearch: {
          enabled: smartSearchEnabled,
          mode: smartSearchMode,
          maxQueries: Math.min(4, Math.max(1, Number(smartSearchMaxQueries) || 3)),
          searchDepth: smartSearchDepth,
          topic: smartSearchTopic,
          ...(smartSearchApiKey.trim() ? { apiKey: smartSearchApiKey.trim() } : {}),
          ...(smartSearchBaseUrl.trim() && smartSearchBaseUrl.trim() !== 'https://api.tavily.com'
            ? { baseUrl: smartSearchBaseUrl.trim() }
            : {}),
        },
      })
      toast(t('common.saved'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const buildAgentSnapshotForExport = useCallback(() => {
    let min = Math.max(50, Math.min(5000, Number(narrativeMin) || 400))
    let max = Math.max(min, Math.min(8000, Number(narrativeMax) || 900))
    if (narrativePreset === 'short') {
      min = 200
      max = 400
    } else if (narrativePreset === 'default') {
      min = 400
      max = 900
    } else if (narrativePreset === 'long') {
      min = 800
      max = 1500
    }
    return {
      scanDepth: Number(wiDepth) || 4,
      maxLoreInjections: Number(maxLore) || 3,
      creationMode,
      narrativeLength: { min, max, hardCap: narrativeHardCap },
      backendControl,
      greeting: greetingOn,
      pipeline: {
        mode: pipelineMode,
        maxSummaries: Math.min(200, Math.max(5, Number(pipelineMaxSummaries) || 40)),
      },
      smartSearch: {
        enabled: smartSearchEnabled,
        baseUrl: smartSearchBaseUrl,
        mode: smartSearchMode,
        maxQueries: Math.min(4, Math.max(1, Number(smartSearchMaxQueries) || 3)),
        searchDepth: smartSearchDepth,
        topic: smartSearchTopic,
        hasApiKey: Boolean(smartSearchApiKey.trim()),
      },
    }
  }, [
    backendControl,
    creationMode,
    greetingOn,
    maxLore,
    narrativeHardCap,
    narrativeMax,
    narrativeMin,
    narrativePreset,
    pipelineMaxSummaries,
    pipelineMode,
    smartSearchApiKey,
    smartSearchBaseUrl,
    smartSearchDepth,
    smartSearchEnabled,
    smartSearchMaxQueries,
    smartSearchMode,
    smartSearchTopic,
    wiDepth,
  ])

  const exportAllSettings = () => {
    try {
      const payload = collectClientSettings({
        thinking,
        agent: buildAgentSnapshotForExport(),
      })
      downloadSettingsBackup(payload)
      void putUserSettings(payload).catch(() => {
        /* 服务端同步失败不阻断本地下载 */
      })
      toast(t('settings.exportOk'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const syncSettingsToServer = useCallback(async () => {
    try {
      const payload = collectClientSettings({
        thinking,
        agent: buildAgentSnapshotForExport(),
      })
      await putUserSettings(payload)
    } catch {
      /* ignore */
    }
  }, [thinking, buildAgentSnapshotForExport])

  const applyAgentFromBackup = async (agent?: SettingsBackupAgent) => {
    if (!agent) return
    if (typeof agent.scanDepth === 'number') setWiDepth(String(agent.scanDepth))
    if (typeof agent.maxLoreInjections === 'number') setMaxLore(String(agent.maxLoreInjections))
    if (agent.creationMode === 'ask' || agent.creationMode === 'silent') setCreationMode(agent.creationMode)
    if (agent.narrativeLength && typeof agent.narrativeLength === 'object') {
      const min = typeof agent.narrativeLength.min === 'number' ? agent.narrativeLength.min : 400
      const max = typeof agent.narrativeLength.max === 'number' ? agent.narrativeLength.max : 900
      setNarrativeMin(String(min))
      setNarrativeMax(String(max))
      setNarrativeHardCap(agent.narrativeLength.hardCap !== false)
      if (min === 200 && max === 400) setNarrativePreset('short')
      else if (min === 800 && max === 1500) setNarrativePreset('long')
      else if (min === 400 && max === 900) setNarrativePreset('default')
      else setNarrativePreset('custom')
    }
    if (typeof agent.backendControl === 'boolean') setBackendControl(agent.backendControl)
    if (typeof agent.greeting === 'boolean') setGreetingOn(agent.greeting)
    if (agent.pipeline?.mode === 'off' || agent.pipeline?.mode === 'merged' || agent.pipeline?.mode === 'full') {
      setPipelineMode(agent.pipeline.mode)
    }
    if (typeof agent.pipeline?.maxSummaries === 'number') {
      setPipelineMaxSummaries(String(agent.pipeline.maxSummaries))
    }
    if (agent.smartSearch) {
      const ss = agent.smartSearch
      if (typeof ss.enabled === 'boolean') setSmartSearchEnabled(ss.enabled)
      if (typeof ss.baseUrl === 'string' && ss.baseUrl.trim()) setSmartSearchBaseUrl(ss.baseUrl.trim())
      if (ss.mode === 'simple' || ss.mode === 'multi') setSmartSearchMode(ss.mode)
      if (typeof ss.maxQueries === 'number') setSmartSearchMaxQueries(String(ss.maxQueries))
      if (
        ss.searchDepth === 'basic' ||
        ss.searchDepth === 'advanced' ||
        ss.searchDepth === 'fast' ||
        ss.searchDepth === 'ultra-fast'
      ) {
        setSmartSearchDepth(ss.searchDepth)
      }
      if (ss.topic === 'general' || ss.topic === 'news' || ss.topic === 'finance') {
        setSmartSearchTopic(ss.topic)
      }
      if (typeof ss.apiKey === 'string' && ss.apiKey.trim()) setSmartSearchApiKey(ss.apiKey.trim())
    }
    const patch = agentPatchFromBackup(agent)
    if (patch) await putConfig(patch)
  }

  const importAllSettingsFromFile = async (file: File) => {
    if (importingSettings) return
    setImportingSettings(true)
    // 先给反馈，避免大文件/写配置时按钮长时间无响应
    toast(t('settings.importing'), 'info')
    let agentErr: string | null = null
    try {
      const text = await file.text()
      const payload = parseSettingsBackup(text)
      const applied = applyClientSettings(payload)
      setTheme(applied.theme)
      setLang(applied.lang)
      void i18n.changeLanguage(applied.lang)
      setDensity(applied.prefs.density)
      setAutoScroll(applied.prefs.autoScroll)
      setStream(applied.prefs.streamReply)
      setEnterSend(applied.prefs.enterSend)
      setTimestamps(applied.prefs.showTimestamps)
      setBlurNsfw(applied.prefs.blurNsfw)
      setReading(applied.reading)
      applyDensity(applied.prefs.density)
      if (applied.thinking === 'low' || applied.thinking === 'medium' || applied.thinking === 'high') {
        setThinking(applied.thinking)
        try {
          await onThinking(applied.thinking)
        } catch {
          /* 本地 thinking 已写入；运行时档位可稍后切换 */
        }
      }
      try {
        await applyAgentFromBackup(applied.agent)
      } catch (e) {
        agentErr = e instanceof Error ? e.message : String(e)
      }
      try {
        await putUserSettings(
          collectClientSettings({
            thinking: applied.thinking,
            agent: applied.agent,
          }),
        )
      } catch {
        /* 服务端偏好同步失败不阻断本地导入 */
      }
      // 重新拉配置，确保高级页 UI 与磁盘一致
      try {
        await loadAgentApi()
      } catch {
        /* ignore */
      }
      if (agentErr) {
        toast(t('settings.importPartial', { reason: agentErr }), 'warning')
      } else {
        toast(t('settings.importOk'), 'success')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'invalid_json' || msg === 'invalid_shape') toast(t('settings.importInvalid'), 'error')
      else if (msg === 'unknown_format') toast(t('settings.importUnknownFormat'), 'error')
      else if (msg === 'version_too_new') toast(t('settings.importVersionTooNew'), 'error')
      else toast(msg, 'error')
    } finally {
      setImportingSettings(false)
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }


  const channelCards: ReactNode = (
    <div className="provider-grid">
      {channels.length === 0 ? (
        <div className="provider-empty">{t('settings.noChannels')}</div>
      ) : (
        channels.map((c) => {
          const active = c.name === channelName || c.name === defaultProvider
          const isDefault = c.name === defaultProvider
          return (
            <div
              key={c.name}
              className={`provider-card ${active ? 'is-active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => void onPickChannel(c.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void onPickChannel(c.name)
                }
              }}
            >
              <ProviderIcon name={c.name} baseUrl={c.baseUrl} size={28} />
              <div className="provider-card-main">
                <strong>{c.name}</strong>
                <span>
                  {c.modelCount} {t('settings.modelsUnit')}
                  {c.hasKey ? ` · ${t('settings.keyReady')}` : ` · ${t('settings.keyMissing')}`}
                </span>
              </div>
              <div className="provider-card-side">
                {isDefault ? <span className="chip chip-brand">{t('settings.inUse')}</span> : null}
                <button
                  type="button"
                  className="icon-btn provider-del"
                  title={t('common.delete')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(c.name)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <h1 className="section-title">{t('settings.title')}</h1>
        </div>
      </header>

      <div className={`settings-layout${mobileDetail ? ' is-mobile-detail' : ' is-mobile-menu'}`}>
        <aside className="settings-nav surface" aria-label={t('settings.title')}>
          <div className="settings-nav-stack">
            {NAV_GROUPS.map((group) => {
              const multi = group.keys.length > 1
              return (
                <div
                  key={group.id}
                  className={`settings-nav-group${multi ? ' is-cluster' : ' is-solo'}`}
                >
                  {multi && group.groupKey ? (
                    <div className="settings-nav-group-label">{t(group.groupKey)}</div>
                  ) : null}
                  <div className={`settings-nav-group-body${multi ? ' is-cluster' : ''}`}>
                    {group.keys.map((key) => {
                      const Icon = TAB_ICONS[key]
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`settings-nav-item ${tab === key ? 'is-active' : ''}`}
                          aria-current={tab === key ? 'page' : undefined}
                          onClick={() => {
                            setTab(key)
                            setSearchParams(key === 'general' ? {} : { tab: key }, { replace: true })
                            setMobileDetail(true)
                          }}
                        >
                          {Icon ? (
                            <span className="settings-nav-item-icon" aria-hidden>
                              <Icon size={18} strokeWidth={1.8} />
                            </span>
                          ) : null}
                          <span className="settings-nav-item-label">{t(`settings.${key}`)}</span>
                          <span className="settings-nav-item-chevron" aria-hidden>
                            ›
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        <section className="settings-panel surface">
          <div className="settings-mobile-backbar">
            <button
              type="button"
              className="settings-mobile-back"
              onClick={() => {
                setMobileDetail(false)
                setSearchParams({}, { replace: true })
              }}
            >
              ‹ {t('common.back')}
            </button>
            <strong>{t(`settings.${tab}`)}</strong>
          </div>
          <header className="settings-panel-heading">
            <span className="settings-panel-kicker">
              {t(NAV_GROUPS.find((group) => group.keys.includes(tab))?.groupKey ?? 'settings.title')}
            </span>
            <h2>{t(`settings.${tab}`)}</h2>
            <p>{t(`settings.tab${tab[0].toUpperCase()}${tab.slice(1)}Hint`)}</p>
          </header>
          {tab === 'general' && (
            <div className="settings-list">
              <div className="settings-item">
                <SIcon icon={Languages} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('common.language')}</div>
                  <div className="settings-item-desc">{t('settings.langDesc')}</div>
                </div>
                <Select
                  value={lang}
                  onChange={(v) => {
                    onLang(v)
                    void syncSettingsToServer()
                  }}
                  options={[
                    { value: 'zh', label: t('common.chinese') },
                    { value: 'en', label: t('common.english') },
                  ]}
                  size="sm"
                />
              </div>
              <div className="settings-item">
                <SIcon icon={Palette} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.theme')}</div>
                </div>
                <Select
                  value={theme}
                  onChange={(v) => {
                    onTheme(v)
                    void syncSettingsToServer()
                  }}
                  options={[
                    { value: 'light', label: t('settings.themeLight') },
                    { value: 'dark', label: t('settings.themeDark') },
                    { value: 'system', label: t('settings.themeSystem') },
                  ]}
                  size="sm"
                />
              </div>
              <div className="settings-item settings-item-stack">
                <SIcon icon={DatabaseBackup} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.backupTitle')}</div>
                  <div className="settings-item-desc">{t('settings.backupDesc')}</div>
                </div>
                <div className="settings-backup-actions">
                  <input
                    ref={importFileRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void importAllSettingsFromFile(f)
                    }}
                  />
                  <button type="button" className="btn btn-dark btn-sm" onClick={exportAllSettings}>
                    {t('settings.exportAll')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={importingSettings}
                    onClick={() => importFileRef.current?.click()}
                  >
                    {importingSettings ? t('settings.importing') : t('settings.importAll')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'api' && (
            <div className="settings-form">
              {current ? (
                <div className="chip chip-brand api-current-chip">
                  {t('settings.currentModel')}: {current.provider}/{current.id}
                </div>
              ) : null}

              <div className="provider-section-head">
                <h3 className="settings-subhead">{t('settings.providersTitle')}</h3>
                <div className="form-actions" style={{ marginTop: 0 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadAgentApi()}>
                    <RefreshCw size={14} />
                    {t('settings.refresh')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setShowAdd((v) => !v)
                      if (!showAdd) applyPreset(newPreset)
                    }}
                  >
                    <Plus size={14} />
                    {t('settings.addChannel')}
                  </button>
                </div>
              </div>

              {channelCards}
              {channelName ? (
                <div className="api-edit-block surface-inset">
                  <h3 className="settings-subhead">
                    <ProviderIcon name={channelName} baseUrl={endpoint} size={20} />
                    {channelName}
                    {defaultProvider === channelName ? (
                      <span className="chip chip-brand">{t('settings.default')}</span>
                    ) : null}
                  </h3>
                  <div>
                    <label className="field-label">{t('settings.apiEndpoint')}</label>
                    <input
                      className="field-input"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                    <p className="settings-endpoint-preview">
                      {t('settings.actualEndpoint')}: {actualEndpoint(endpoint, activeChannel?.api || newApi, modelKey.split('::')[1] || '{model}')}
                    </p>
                  </div>
                  <div>
                    <label className="field-label">{t('settings.apiKey')}</label>
                    <input
                      className="field-input"
                      type="password"
                      value={apiKey}
                      placeholder={
                        activeChannel?.hasKey
                          ? t('settings.apiKeyKeep')
                          : t('settings.apiKeyPlaceholder')
                      }
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="field-label">{t('settings.modelName')}</label>
                    <Select
                      fullWidth
                      value={modelKey}
                      onChange={(v) => {
                        setModelKey(v)
                        void (async () => {
                          const [provider, id] = v.split('::')
                          if (!provider || !id) return
                          try {
                            const cur = await selectModel(provider, id)
                            setCurrent(cur)
                            setChannelName(provider)
                            setDefaultProvider(provider)
                            setAvailableLevels(cur.availableLevels ?? [])
                            toast(t('settings.modelApplied', { name: `${provider}/${id}` }), 'success')
                          } catch (e) {
                            toast(e instanceof Error ? e.message : String(e), 'error')
                          }
                        })()
                      }}
                      options={
                        modelOptions.length
                          ? modelOptions
                          : [{ value: '', label: t('settings.noModels') }]
                      }
                    />
                    {fetchingModels ? (
                      <p className="settings-item-desc" style={{ marginTop: 6 }}>
                        {t('settings.autoPulling')}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="field-label">{t('settings.manualModel')}</label>
                    <div className="manual-model-row">
                      <input
                        className="field-input"
                        value={manualModel}
                        onChange={(e) => setManualModel(e.target.value)}
                        placeholder={t('settings.manualModelPlaceholder')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void applyManualModel()
                          }
                        }}
                      />
                      <button type="button" className="btn btn-ghost" onClick={() => void applyManualModel()}>
                        {t('settings.manualModelApply')}
                      </button>
                    </div>
                  </div>
                  {probe ? (
                    <div className={`probe-result ${probe.ok ? 'is-ok' : 'is-fail'}`}>
                      <Activity size={16} />
                      <div>
                        <strong>
                          {probe.ok ? t('settings.testOk') : t('settings.testFail')}
                          {probe.latencyMs > 0 ? ` · ${probe.latencyMs} ms` : ''}
                        </strong>
                        <p>{probe.detail}</p>
                      </div>
                    </div>
                  ) : null}
                  <div className="form-actions">
                    <button type="button" className="btn btn-primary" onClick={() => void saveChannel()}>
                      {t('settings.saveChannel')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={probing}
                      onClick={() => void runProbe()}
                    >
                      <Wifi size={14} />
                      {probing ? t('settings.testing') : t('settings.testConnection')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={fetchingModels}
                      onClick={() => {
                        autoPullRef.current = ''
                        void pullModels({ silent: false })
                      }}
                    >
                      {fetchingModels ? t('settings.pulling') : t('settings.pullModels')}
                    </button>
                  </div>
                </div>
              ) : null}


              {/* 思考强度显式探测：默认探测默认模型 */}
              <div className="provider-section-head" style={{ marginTop: 20 }}>
                <h3 className="settings-subhead">{t('settings.thinkingProbeTitle')}</h3>
              </div>
              <div className="thinking-probe-panel">
                <div className="thinking-probe-main">
                  <div className="thinking-probe-target">
                    <span className="thinking-probe-label">{t('settings.thinkingProbeTarget')}</span>
                    <span className="thinking-probe-value">
                      {current ? `${current.provider}/${current.id}` : t('settings.noModelSelected')}
                    </span>
                  </div>
                  <p className="settings-item-desc">{t('settings.thinkingProbeDesc')}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={probingThinking || !current}
                  onClick={() => void runThinkingProbe()}
                >
                  <RefreshCw size={14} className={probingThinking ? 'is-spin' : ''} />
                  {probingThinking ? t('settings.thinkingProbing') : t('settings.thinkingProbe')}
                </button>
                {thinkingProbeMsg ? (
                  <div className={`probe-result ${thinkingProbeMsg.ok ? 'is-ok' : 'is-fail'}`}>
                    <Activity size={16} />
                    <div>
                      <strong>
                        {thinkingProbeMsg.ok ? t('settings.testOk') : t('settings.testFail')}
                      </strong>
                      <p>{thinkingProbeMsg.text}</p>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* 独立向量模型区块：与对话模型分开配置，可折叠卡片（默认折叠） */}
              <div className="provider-section-head" style={{ marginTop: 20 }}>
                <h3 className="settings-subhead">{t('settings.vectorSectionTitle')}</h3>
              </div>
              <div className="vector-card">
                <button
                  type="button"
                  className="vector-card-head"
                  aria-expanded={vectorOpen}
                  onClick={() => setVectorOpen((v) => !v)}
                >
                  <span className="vector-card-icon" aria-hidden>
                    <BrainCog size={16} strokeWidth={2} />
                  </span>
                  <span className="vector-card-title">{t('settings.vectorSectionTitle')}</span>
                  <span className="vector-card-summary">
                    {vectorChannel
                      ? vectorModelId
                        ? `${vectorChannel} · ${vectorModelId}`
                        : vectorChannel
                      : t('settings.vectorChannelNone')}
                  </span>
                  <span className={`vector-card-chev${vectorOpen ? ' is-open' : ''}`} aria-hidden>
                    <ChevronDown size={16} strokeWidth={2} />
                  </span>
                </button>
                {vectorOpen ? (
                  <div className="vector-card-body surface-inset">
                    <div>
                      <label className="field-label">{t('settings.vectorChannel')}</label>
                      <Select
                        fullWidth
                        value={vectorChannel}
                        onChange={(v) => {
                          setVectorChannel(v)
                          setVectorModelId('')
                        }}
                        options={[
                          { value: '', label: t('settings.vectorChannelNone'), meta: '' },
                          ...channels.map((c) => ({ value: c.name, label: c.name, meta: c.name })),
                        ]}
                      />
                    </div>
                    <div>
                      <label className="field-label">{t('settings.vectorModel')}</label>
                      <Select
                        fullWidth
                        value={vectorModelId}
                        onChange={(v) => setVectorModelId(v)}
                        disabled={!vectorChannel}
                        options={[
                          { value: '', label: t('settings.embeddingNone'), meta: '' },
                          ...(channels.find((c) => c.name === vectorChannel)?.models.map((m) => ({
                            value: m.id,
                            label: m.name || m.id,
                            meta: vectorChannel,
                          })) ?? []),
                        ]}
                      />
                      <p className="settings-item-desc" style={{ marginTop: 6 }}>
                        {t('settings.embeddingModelHint')}
                      </p>
                    </div>
                    <div className="form-actions">
                      <button type="button" className="btn btn-primary" onClick={() => void saveVectorModel()}>
                        {t('settings.vectorSave')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {showAdd ? (
                <div className="provider-add surface-inset">
                  <PresetPicker
                    label={t('settings.preset')}
                    value={newPreset}
                    options={PROVIDER_PRESETS}
                    onChange={applyPreset}
                  />
                  <div>
                    <label className="field-label">{t('settings.channelName')}</label>
                    <input
                      className="field-input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="my-proxy"
                    />
                  </div>
                  <div>
                    <label className="field-label">{t('settings.apiEndpoint')}</label>
                    <input
                      className="field-input"
                      value={newBaseUrl}
                      onChange={(e) => setNewBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                    <p className="settings-endpoint-preview">
                      {t('settings.actualEndpoint')}: {actualEndpoint(newBaseUrl, newApi, '{model}')}
                    </p>
                  </div>
                  <div>
                    <label className="field-label">{t('settings.apiKey')}</label>
                   <input
                      className="field-input"
                      type="password"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder={t('settings.apiKeyPlaceholder')}
                      autoComplete="off"
                    />
                  </div>
                  <details className="api-advanced">
                    <summary>{t('settings.advancedApi')}</summary>
                    <label className="field-label">{t('settings.apiType')}</label>
                    <Select
                      fullWidth
                      value={newApi}
                      onChange={setNewApi}
                      options={API_TYPES.map((x) => ({ value: x.value, label: x.label }))}
                    />
                  </details>
                  <div className="form-actions">
                    <button type="button" className="btn btn-primary" onClick={() => void addChannel()}>
                      {t('settings.createChannel')}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : null}

            </div>
          )}

          {tab === 'ui' && (
            <div className="settings-list">
              <div className="settings-item">
                <SIcon icon={Rows3} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.density')}</div>
                </div>
                <Select
                  value={density}
                  onChange={(v) => {
                    const next = v === 'compact' ? 'compact' : 'comfort'
                    patchPrefs({ density: next })
                    toast(t('common.saved'), 'success')
                  }}
                  options={[
                    { value: 'comfort', label: t('settings.densityComfort') },
                    { value: 'compact', label: t('settings.densityCompact') },
                  ]}
                  size="sm"
                />
              </div>
              <div className="settings-item">
                <SIcon icon={EyeOff} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.blurNSFW')}</div>
                </div>
                <Toggle
                  checked={blurNsfw}
                  onChange={(v) => patchPrefs({ blurNsfw: v })}
                  ariaLabel={t('settings.blurNSFW')}
                />
              </div>
              <div className="settings-item">
                <SIcon icon={Clock} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.showTimestamps')}</div>
                </div>
                <Toggle
                  checked={timestamps}
                  onChange={(v) => patchPrefs({ showTimestamps: v })}
                  ariaLabel={t('settings.showTimestamps')}
                />
              </div>
            </div>
          )}

          {tab === 'reading' && (
            <div className="settings-list">
              <div className="settings-item">
                <SIcon icon={Highlighter} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readColorize')}</div>
                  <div className="settings-item-desc">{t('settings.readColorizeDesc')}</div>
                </div>
                <Toggle
                  checked={reading.colorizeEnabled}
                  onChange={(v) => patchReading({ colorizeEnabled: v })}
                  ariaLabel={t('settings.readColorize')}
                />
              </div>
              {COLOR_RULE_IDS.map((id) => (
                <div
                  key={id}
                  className={`settings-item${reading.colorizeEnabled ? '' : ' is-dimmed'}`}
                >
                  <SIcon icon={RULE_ICONS[id]} />
                  <div className="settings-item-main">
                    <div className="settings-item-title">{t(RULE_LABEL_KEY[id])}</div>
                  </div>
                  <div className="settings-read-rule-row">
                    <ColorPicker
                      value={reading.colors[id] || '#888888'}
                      disabled={!reading.colorizeEnabled}
                      onChange={(hex) =>
                        patchReading({ colors: { ...reading.colors, [id]: hex } })
                      }
                      ariaLabel={t(RULE_LABEL_KEY[id])}
                    />
                    <Toggle
                      checked={reading.colorizeRules[id]}
                      onChange={(v) => {
                        if (!reading.colorizeEnabled) return
                        patchReading({
                          colorizeRules: { ...reading.colorizeRules, [id]: v },
                        })
                      }}
                      ariaLabel={t(RULE_LABEL_KEY[id])}
                    />
                  </div>
                </div>
              ))}

              <div className="settings-item">
                <SIcon icon={Type} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readFontFamily')}</div>
                </div>
                <Select
                  value={reading.fontFamily}
                  onChange={(v) =>
                    patchReading({
                      fontFamily: v === 'serif' || v === 'sans' ? v : 'body',
                    })
                  }
                  options={[
                    { value: 'body', label: t('settings.readFontBody') },
                    { value: 'serif', label: t('settings.readFontSerif') },
                    { value: 'sans', label: t('settings.readFontSans') },
                  ]}
                  size="sm"
                />
              </div>
              <div className="settings-item">
                <SIcon icon={TextCursorInput} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readFontSize')}</div>
                </div>
                <Slider
                  min={12}
                  max={28}
                  step={1}
                  value={reading.fontSizePx}
                  onChange={(v) => patchReading({ fontSizePx: v })}
                  ariaLabel={t('settings.readFontSize')}
                  formatValue={(v) => `${v}px`}
                />
              </div>
              <div className="settings-item">
                <SIcon icon={AlignJustify} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readLineHeight')}</div>
                </div>
                <Slider
                  min={12}
                  max={24}
                  step={1}
                  value={Math.round(reading.lineHeight * 10)}
                  onChange={(v) => patchReading({ lineHeight: v / 10 })}
                  ariaLabel={t('settings.readLineHeight')}
                  formatValue={(v) => (v / 10).toFixed(1)}
                />
              </div>
              <div className="settings-item">
                <SIcon icon={StretchHorizontal} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readWidth')}</div>
                </div>
                <Select
                  value={reading.width}
                  onChange={(v) =>
                    patchReading({
                      width:
                        v === 'narrow' || v === 'wide' || v === 'full' || v === 'medium'
                          ? v
                          : 'medium',
                    })
                  }
                  options={[
                    { value: 'narrow', label: t('settings.readWidthNarrow') },
                    { value: 'medium', label: t('settings.readWidthMedium') },
                    { value: 'wide', label: t('settings.readWidthWide') },
                    { value: 'full', label: t('settings.readWidthFull') },
                  ]}
                  size="sm"
                />
              </div>
              <div className="settings-item">
                <SIcon icon={Minus} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readCompressBlank')}</div>
                  <div className="settings-item-desc">{t('settings.readCompressBlankDesc')}</div>
                </div>
                <Toggle
                  checked={reading.compressBlankLines}
                  onChange={(v) => patchReading({ compressBlankLines: v })}
                  ariaLabel={t('settings.readCompressBlank')}
                />
              </div>
              <div className="settings-item">
                <SIcon icon={GripHorizontal} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readParagraphGap')}</div>
                </div>
                <Select
                  value={reading.paragraphGap}
                  onChange={(v) =>
                    patchReading({
                      paragraphGap: v === 'tight' || v === 'loose' ? v : 'normal',
                    })
                  }
                  options={[
                    { value: 'tight', label: t('settings.readGapTight') },
                    { value: 'normal', label: t('settings.readGapNormal') },
                    { value: 'loose', label: t('settings.readGapLoose') },
                  ]}
                  size="sm"
                />
              </div>
              <div className="settings-item">
                <SIcon icon={IndentIncrease} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readFirstIndent')}</div>
                </div>
                <Toggle
                  checked={reading.firstLineIndent}
                  onChange={(v) => patchReading({ firstLineIndent: v })}
                  ariaLabel={t('settings.readFirstIndent')}
                />
              </div>

              <div className="settings-item">
                <SIcon icon={RotateCcw} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readColors')}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const next = resetReadingColors()
                    setReading(next)
                    toast(t('common.saved'), 'success')
                  }}
                >
                  {t('settings.readResetColors')}
                </button>
              </div>
              <div className="settings-item">
                <SIcon icon={FileText} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readColorBody')}</div>
                </div>
                <ColorPicker
                  value={reading.colors.body || '#e8e6e3'}
                  onChange={(hex) =>
                    patchReading({ colors: { ...reading.colors, body: hex } })
                  }
                  ariaLabel={t('settings.readColorBody')}
                />
              </div>
              <div className="settings-item">
                <SIcon icon={Layers} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readColorSurface')}</div>
                </div>
                <ColorPicker
                  value={reading.colors.surface || '#1a1b22'}
                  onChange={(hex) =>
                    patchReading({ colors: { ...reading.colors, surface: hex } })
                  }
                  ariaLabel={t('settings.readColorSurface')}
                />
              </div>
              <div className="settings-item">
                <SIcon icon={Pin} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.readStickyChapter')}</div>
                  <div className="settings-item-desc">{t('settings.readStickyChapterDesc')}</div>
                </div>
                <Toggle
                  checked={reading.stickyChapterEnabled}
                  onChange={(v) => patchReading({ stickyChapterEnabled: v })}
                  ariaLabel={t('settings.readStickyChapter')}
                />
              </div>
            </div>
          )}

          {tab === 'chat' && (
            <div className="settings-list">
              {availableLevels.filter((lv) => !/^(off|none|disabled|false|0)$/i.test(lv)).length > 0 ? (
                <div className="settings-intensity-card" data-intensity={thinking}>
                  <div className="settings-intensity-main">
                    <div className="settings-intensity-kicker">{t('settings.thinkingKicker')}</div>
                    <h3 className="settings-intensity-title">{t('settings.thinkingIntensity')}</h3>
                    <p className="settings-intensity-desc">{t(`settings.thinkingDesc.${thinking}`)}</p>
                    <div className="settings-intensity-meta">
                      {(
                        [
                          { level: 'low' as const, label: t('settings.thinkingLow') },
                          { level: 'medium' as const, label: t('settings.thinkingMedium') },
                          { level: 'high' as const, label: t('settings.thinkingHigh') },
                        ] as const
                      ).map(({ level, label }) => (
                        <button
                          key={level}
                          type="button"
                          className={`settings-intensity-chip ${thinking === level ? 'is-on' : ''}`}
                          onClick={() => void onThinking(level)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-intensity-wheel-wrap">
                    <ThinkingIntensityWheel value={thinking} onChange={(v) => void onThinking(v)} />
                  </div>
                </div>
              ) : null}
              <div className="settings-item">
                <SIcon icon={ChevronsDown} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.autoScroll')}</div>
                </div>
                <Toggle
                  checked={autoScroll}
                  onChange={(v) => patchPrefs({ autoScroll: v })}
                  ariaLabel={t('settings.autoScroll')}
                />
              </div>
              <div className="settings-item">
                <SIcon icon={Waves} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.streamReply')}</div>
                  <div className="settings-item-desc">{t('settings.streamReplyDesc')}</div>
                </div>
                <Toggle
                  checked={stream}
                  onChange={(v) => patchPrefs({ streamReply: v })}
                  ariaLabel={t('settings.streamReply')}
                />
              </div>
              <div className="settings-item">
                <SIcon icon={Send} />
                <div className="settings-item-main">
                  <div className="settings-item-title">{t('settings.enterSend')}</div>
                  <div className="settings-item-desc">{t('settings.enterSendDesc')}</div>
                </div>
                <Toggle
                  checked={enterSend}
                  onChange={(v) => patchPrefs({ enterSend: v })}
                  ariaLabel={t('settings.enterSend')}
                />
              </div>
            </div>
          )}

          {tab === 'advanced' && (
            <div className="settings-form">
              <div className="grid-2">
                <div>
                  <label className="field-label">{t('settings.worldInfoDepth')}</label>
                  <Select
                    fullWidth
                    value={wiDepth}
                    onChange={setWiDepth}
                    options={['2', '4', '6', '8', '12', '20'].map((v) => ({ value: v, label: v }))}
                  />
                </div>
                <div>
                  <label className="field-label">{t('settings.lorebookBudget')}</label>
                  <Select
                    fullWidth
                    value={maxLore}
                    onChange={setMaxLore}
                    options={['0', '1', '2', '3', '5', '8', '10'].map((v) => ({ value: v, label: v }))}
                  />
                </div>
              </div>

              <h3 className="settings-subhead">{t('settings.agentBehavior')}</h3>
              <div className="settings-list" style={{ marginTop: 8 }}>
                <div className="settings-item">
                  <SIcon icon={Sparkles} />
                  <div className="settings-item-main">
                    <div className="settings-item-title">{t('settings.creationMode')}</div>
                    <div className="settings-item-desc">{t('settings.creationModeDesc')}</div>
                  </div>
                  <Select
                    value={creationMode}
                    onChange={(v) => setCreationMode(v === 'silent' ? 'silent' : 'ask')}
                    options={[
                      { value: 'ask', label: t('settings.creationModeAsk') },
                      { value: 'silent', label: t('settings.creationModeSilent') },
                    ]}
                    size="sm"
                  />
                </div>
                <div className="settings-item">
                  <SIcon icon={PenLine} />
                  <div className="settings-item-main">
                    <div className="settings-item-title">{t('settings.narrativeLength')}</div>
                    <div className="settings-item-desc">{t('settings.narrativeLengthDesc')}</div>
                  </div>
                  <Select
                    value={narrativePreset}
                    onChange={(v) =>
                      applyNarrativePreset(
                        v === 'short' || v === 'long' || v === 'custom' ? v : 'default',
                      )
                    }
                    options={[
                      { value: 'short', label: t('settings.narrativeLengthShort') },
                      { value: 'default', label: t('settings.narrativeLengthDefault') },
                      { value: 'long', label: t('settings.narrativeLengthLong') },
                      { value: 'custom', label: t('settings.narrativeLengthCustom') },
                    ]}
                    size="sm"
                  />
                </div>
                {narrativePreset === 'custom' ? (
                  <div className="settings-item settings-item-stack">
                    <div className="settings-item-main">
                      <div className="settings-item-title">{t('settings.narrativeLengthMin')}</div>
                    </div>
                    <input
                      className="settings-input"
                      type="number"
                      min={50}
                      max={5000}
                      value={narrativeMin}
                      onChange={(e) => setNarrativeMin(e.target.value)}
                    />
                    <div className="settings-item-main" style={{ marginTop: 8 }}>
                      <div className="settings-item-title">{t('settings.narrativeLengthMax')}</div>
                    </div>
                    <input
                      className="settings-input"
                      type="number"
                      min={50}
                      max={8000}
                      value={narrativeMax}
                      onChange={(e) => setNarrativeMax(e.target.value)}
                    />
                  </div>
                ) : null}
                <div className="settings-item">
                  <SIcon icon={Lock} />
                  <div className="settings-item-main">
                    <div className="settings-item-title">{t('settings.narrativeLengthHardCap')}</div>
                    <div className="settings-item-desc">{t('settings.narrativeLengthHardCapDesc')}</div>
                  </div>
                  <Toggle
                    checked={narrativeHardCap}
                    onChange={setNarrativeHardCap}
                    ariaLabel={t('settings.narrativeLengthHardCap')}
                  />
                </div>
                <div className="settings-item">
                  <SIcon icon={ServerCog} />
                  <div className="settings-item-main">
                    <div className="settings-item-title">{t('settings.backendControl')}</div>
                    <div className="settings-item-desc">{t('settings.backendControlDesc')}</div>
                  </div>
                  <Toggle
                    checked={backendControl}
                    onChange={setBackendControl}
                    ariaLabel={t('settings.backendControl')}
                  />
                </div>
                <div className="settings-item">
                  <SIcon icon={MessageCircle} />
                  <div className="settings-item-main">
                    <div className="settings-item-title">{t('settings.greeting')}</div>
                    <div className="settings-item-desc">{t('settings.greetingDesc')}</div>
                  </div>
                  <Toggle
                    checked={greetingOn}
                    onChange={setGreetingOn}
                    ariaLabel={t('settings.greeting')}
                  />
                </div>
              </div>

              <h3 className="settings-subhead">{t('settings.pipeline')}</h3>
              <div className="grid-2">
                <div>
                  <label className="field-label">{t('settings.pipelineMode')}</label>
                  <Select
                    fullWidth
                    value={pipelineMode}
                    onChange={(v) =>
                      setPipelineMode(v === 'off' || v === 'full' ? v : 'merged')
                    }
                    options={[
                      { value: 'off', label: t('settings.pipelineOff') },
                      { value: 'merged', label: t('settings.pipelineMerged') },
                      { value: 'full', label: t('settings.pipelineFull') },
                    ]}
                  />
                </div>
                <div>
                  <label className="field-label">{t('settings.pipelineMaxSummaries')}</label>
                  <Select
                    fullWidth
                    value={pipelineMaxSummaries}
                    onChange={setPipelineMaxSummaries}
                    options={['10', '20', '40', '80', '120'].map((v) => ({ value: v, label: v }))}
                  />
                </div>
              </div>

              <h3 className="settings-subhead">{t('settings.smartSearch')}</h3>
              <div className="settings-list" style={{ marginTop: 8 }}>
                <div className="settings-item">
                  <SIcon icon={Search} />
                  <div className="settings-item-main">
                    <div className="settings-item-title">{t('settings.smartSearchEnabled')}</div>
                    <div className="settings-item-desc">{t('settings.smartSearchEnabledDesc')}</div>
                  </div>
                  <Toggle
                    checked={smartSearchEnabled}
                    onChange={setSmartSearchEnabled}
                    ariaLabel={t('settings.smartSearchEnabled')}
                  />
                </div>
              </div>
              <div className="grid-2" style={{ marginTop: 12 }}>
                <div>
                  <label className="field-label">{t('settings.smartSearchApiKey')}</label>
                  <input
                    className="field-input"
                    type="password"
                    autoComplete="off"
                    value={smartSearchApiKey}
                    onChange={(e) => setSmartSearchApiKey(e.target.value)}
                    placeholder={t('settings.smartSearchApiKeyPlaceholder')}
                    disabled={!smartSearchEnabled}
                  />
                </div>
                <div>
                  <label className="field-label">{t('settings.smartSearchBaseUrl')}</label>
                  <input
                    className="field-input"
                    type="url"
                    value={smartSearchBaseUrl}
                    onChange={(e) => setSmartSearchBaseUrl(e.target.value)}
                    placeholder="https://api.tavily.com"
                    disabled={!smartSearchEnabled}
                  />
                </div>
              </div>
              {smartSearchEnabled ? (
                <>
                  <div className="grid-2" style={{ marginTop: 12 }}>
                    <div>
                      <label className="field-label">{t('settings.smartSearchDepth')}</label>
                      <Select
                        fullWidth
                        value={smartSearchDepth}
                        onChange={(v) =>
                          setSmartSearchDepth(
                            v === 'advanced' || v === 'fast' || v === 'ultra-fast' || v === 'basic'
                              ? v
                              : 'basic',
                          )
                        }
                        options={[
                          { value: 'basic', label: t('settings.smartSearchDepthBasic') },
                          { value: 'advanced', label: t('settings.smartSearchDepthAdvanced') },
                          { value: 'fast', label: t('settings.smartSearchDepthFast') },
                          { value: 'ultra-fast', label: t('settings.smartSearchDepthUltraFast') },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="field-label">{t('settings.smartSearchTopic')}</label>
                      <Select
                        fullWidth
                        value={smartSearchTopic}
                        onChange={(v) =>
                          setSmartSearchTopic(v === 'news' || v === 'finance' ? v : 'general')
                        }
                        options={[
                          { value: 'general', label: t('settings.smartSearchTopicGeneral') },
                          { value: 'news', label: t('settings.smartSearchTopicNews') },
                          { value: 'finance', label: t('settings.smartSearchTopicFinance') },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: 12 }}>
                    <div>
                      <label className="field-label">{t('settings.smartSearchMode')}</label>
                      <Select
                        fullWidth
                        value={smartSearchMode}
                        onChange={(v) => setSmartSearchMode(v === 'multi' ? 'multi' : 'simple')}
                        options={[
                          { value: 'simple', label: t('settings.smartSearchModeSimple') },
                          { value: 'multi', label: t('settings.smartSearchModeMulti') },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="field-label">{t('settings.smartSearchMaxQueries')}</label>
                      <Select
                        fullWidth
                        value={smartSearchMaxQueries}
                        onChange={setSmartSearchMaxQueries}
                        options={['1', '2', '3', '4'].map((v) => ({ value: v, label: v }))}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              <div className="form-actions">
                <button type="button" className="btn btn-primary" onClick={() => void saveAdvanced()}>
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    patchPrefs({
                      autoScroll: true,
                      streamReply: true,
                      enterSend: true,
                      showTimestamps: false,
                      blurNsfw: true,
                      density: 'comfort',
                    })
                    setCreationMode('ask')
                    setBackendControl(true)
                    setGreetingOn(true)
                    setPipelineMode('merged')
                    setPipelineMaxSummaries('40')
                    setWiDepth('4')
                    setMaxLore('3')
                    void onThinking('medium')
                    toast(t('common.reset'), 'info')
                  }}
                >
                  {t('settings.resetAll')}
                </button>
              </div>
            </div>
          )}

          {tab === 'environment' && <EnvironmentPanel />}

          {tab === 'about' && (
            <div className="about-block">
              <div className="about-logo">
                <img src="/brand/logo-mark.svg" alt="" width={36} height={36} />
                <span>DrawDream</span>
              </div>
              <p>{t('settings.aboutText')}</p>
              <div className="chip">
                {t('settings.version')} 2.0.0-alpha.1 · mobile.79 · DrawDream Agent
              </div>
              <div className="form-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="learn-more update-learn"
                  disabled={updateChecking}
                  onClick={checkUpdate}
                >
                  <span className="circle" aria-hidden />
                  <span className="button-text">
                    <RefreshCw size={14} className={`update-learn-icon${updateChecking ? ' is-spin' : ''}`} />
                    {updateChecking ? t('settings.updating') : t('settings.checkUpdate')}
                  </span>
                </button>
              </div>
              <div className="settings-list" style={{ marginTop: 16 }}>
                <a
                  className="settings-item"
                  href="https://github.com/RochelimitDawn/DrawDreamMAX"
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <SIcon icon={GitBranch} />
                  <div className="settings-item-main">
                    <div className="settings-item-title">GitHub</div>
                    <div className="settings-item-desc">github.com/RochelimitDawn/DrawDreamMAX</div>
                  </div>
                  <span className="settings-link-go" aria-hidden>
                    <ArrowUpRight size={16} />
                  </span>
                </a>
                <a
                  className="settings-item"
                  href="https://github.com/RochelimitDawn/DrawDreamMAX/releases"
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <SIcon icon={Package} />
                  <div className="settings-item-main">
                    <div className="settings-item-title">{t('settings.releases')}</div>
                    <div className="settings-item-desc">{t('settings.releasesDesc')}</div>
                  </div>
                  <span className="settings-link-go" aria-hidden>
                    <ArrowUpRight size={16} />
                  </span>
                </a>
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        danger
        busy={deleting}
        title={t('settings.confirmDeleteTitle')}
        description={
          deleteTarget
            ? t('settings.confirmDeleteChannel', { name: deleteTarget })
            : undefined
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void removeChannel(deleteTarget)
        }}
      />

    </div>
  )
}
