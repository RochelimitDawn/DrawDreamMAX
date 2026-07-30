import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  BookOpen,
  Bot,
  Clock,
  Download,
  FileUp,
  Hash,
  LayoutPanelLeft,
  MoreHorizontal,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  RefreshCw,
  Trash2,
  Wifi,
  X,
  ChevronLeft,
  ChevronRight,
  Zap,
  SlidersHorizontal,
} from 'lucide-react'
import { ChatComposer } from '../components/ChatComposer'

/** 贴底阈值（px）：距底部更近才自动跟随流式输出 */
const STICK_BOTTOM_PX = 96
/** 显示「回到顶部」的滚动距离 */
const SHOW_BACK_TOP_PX = 220
import { Select } from '../components/Select'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useSession } from '../agent/useSession'
import {
  cardImageUrl,
  deleteSession,
  encodeCardPath,
  fetchCommands,
  fetchChannels,
  fetchModels,
  renameSession,
  selectModel,
  sessionExportUrl,
  setThinkingLevel,
  switchCard,
  testChannel,
  uploadFile,
  importSillyTavernChat,
  type CommandMeta,
  type ModelInfo,
} from '../agent/rest'
import type { LiveBubble } from '../agent/session-store'
import type { WorldState } from '../agent/wire.types'
import { textLooksLikeChoice } from '../agent/rp/parse-rp'
import { ProviderIcon } from '../components/ProviderIcon'
import { CardHtmlFrame } from '../components/CardHtmlFrame'
import { RichMessage } from '../components/RichMessage'
import { StickyChapterBar } from '../components/StickyChapterBar'
import { ToolCallList, coalesceActivities } from '../components/ToolCallChip'
import { AssistantPanel } from '../components/AssistantPanel'
import { ThinkingBlock } from '../components/ThinkingBlock'
import { gsap, prefersReducedMotion, useGSAP } from '../motion'
import { getChatPrefs, type ChatPrefs } from '../utils/prefs'
import {
  applyReadingPrefsToDom,
  getReadingPrefs,
  type ReadingPrefs,
} from '../utils/reading-prefs'
import {
  clearComposerDraft,
  getComposerDraft,
  setComposerDraft,
} from '../utils/composer-draft'
import { extractAnchorsFromMessages } from '../utils/chapter-anchors'
import {
  harvestCharNamesFromText,
  mergeNameSources,
} from '../utils/rule-colorize'
import { toast } from '../utils/toast'
import './Chat.css'

type RightTab = 'state' | 'assistant' | 'panels' | null

function bubbleRole(channel: LiveBubble['channel']): 'user' | 'assistant' | 'system' {
  if (channel === 'user') return 'user'
  if (channel === 'info' || channel === 'import') return 'system'
  return 'assistant'
}

function formatSessionTime(ms: number) {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return ''
  }
}

function formatDurationMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.round(ms / 1000)} s`
}

function formatTokenCount(n: number) {
  if (!Number.isFinite(n)) return ''
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}

function StateView({
  state,
  highlight,
  onSelectChar,
}: {
  state: WorldState
  highlight?: string | null
  onSelectChar?: (name: string) => void
}) {
  const { t } = useTranslation()
  const chars = Object.entries(state.characters ?? {})
  const milestones = Object.entries(state.flags ?? {})
  return (
    <div className="state-view">
      <div className="state-row">
        <span>{t('chat.state.chapter')}</span>
        <strong>{state.chapter || '—'}</strong>
      </div>
      <div className="state-row">
        <span>{t('chat.state.time')}</span>
        <strong>{state.time || '—'}</strong>
      </div>
      <div className="state-row">
        <span>{t('chat.state.location')}</span>
        <strong>{state.location || '—'}</strong>
      </div>
      {chars.length > 0 ? (
        <div className="state-block">
          <h4>{t('chat.state.characters')}</h4>
          {chars.map(([name, c]) => (
            <button
              key={name}
              type="button"
              className={`state-char ${highlight === name ? 'is-active' : ''}`}
              onClick={() => onSelectChar?.(name)}
            >
              <strong>{name}</strong>
              <span>
                {t('chat.state.affinity')} {c.affinity} · {c.status || '—'}
              </span>
              {c.notes ? <p>{c.notes}</p> : null}
            </button>
          ))}
        </div>
      ) : null}
      {(state.inventory?.length ?? 0) > 0 ? (
        <div className="state-block">
          <h4>{t('chat.state.inventory')}</h4>
          <div className="state-chips">
            {state.inventory.map((item) => (
              <span key={item} className="chip">
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {milestones.length > 0 ? (
        <div className="state-block state-milestones">
          <h4>{t('chat.state.milestones')}</h4>
          <ol className="stepper-box" aria-label={t('chat.state.milestones')}>
             {milestones.map(([k, v], idx) => {
               const s = String(v ?? '').trim().toLowerCase()
               const done = ['true', '1', 'done', 'completed'].includes(s)
               const pending = ['false', '0'].includes(s)
               const phase = done ? 'completed' : pending && idx === milestones.length - 1 ? 'pending' : idx === milestones.length - 1 ? 'active' : 'completed'
               const desc = v != null && String(v).trim() && !['true', '1', 'false', '0', 'done', 'completed', 'pending'].includes(String(v).trim().toLowerCase()) ? String(v) : null
              return (
                <li key={k} className={`stepper-step is-${phase}`}>
                  <span className="stepper-indicator" aria-hidden>
                    <span className="stepper-num">{idx + 1}</span>
                  </span>
                  <div className="stepper-content">
                    <strong className="stepper-title">{k}</strong>
                    {desc ? <span className="stepper-desc">{desc}</span> : null}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}
      {(state.plot_threads?.length ?? 0) > 0 ? (
        <div className="state-block">
          <h4>{t('chat.state.plotThreads')}</h4>
          <ul>
            {state.plot_threads.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function ChatPage() {
  const { t, i18n } = useTranslation()
  const toolLocale = i18n.language?.startsWith('en') ? 'en' : 'zh'
  const session = useSession()
  const { store } = session
  const [searchParams, setSearchParams] = useSearchParams()
  const cardQuery = searchParams.get('card')

  const [prefs, setPrefs] = useState<ChatPrefs>(() => getChatPrefs())
  const [readingPrefs, setReadingPrefs] = useState<ReadingPrefs>(() => getReadingPrefs())
  const [input, setInput] = useState('')
  const [ctxPanelOpen, setCtxPanelOpen] = useState(false)
  const draftSessionRef = useRef<string>('')
  const inputRef = useRef('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(() => {
    try {
      return localStorage.getItem('dd-history-collapsed') === '1'
    } catch {
      return false
    }
  })
  const [rightTab, setRightTab] = useState<RightTab>(null)
  /** 移动端顶栏工具托盘 */
  const [topTrayOpen, setTopTrayOpen] = useState(false)
  const topTrayRef = useRef<HTMLDivElement>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [providerBaseUrls, setProviderBaseUrls] = useState<Record<string, string>>({})
  const [modelKey, setModelKey] = useState('')
  const [currentProvider, setCurrentProvider] = useState('')
  const [thinkingLevel, setThinkingLevelState] = useState('')
  const [availableLevels, setAvailableLevels] = useState<string[]>([])
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [probing, setProbing] = useState(false)
  const [commands, setCommands] = useState<CommandMeta[] | null>(null)
  const [cmdIndex, setCmdIndex] = useState(0)
  const [asstInput, setAsstInput] = useState('')
  const [choiceFree, setChoiceFree] = useState('')
  const [focusChar, setFocusChar] = useState<string | null>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const appliedCardRef = useRef<string | null>(null)
  const asstDraftKeyRef = useRef<string>('')
  const asstInputRef = useRef('')
  /** 用户是否贴在底部；上滑阅读时为 false，流式不会强行拽回 */
  const stickBottomRef = useRef(true)
  const scrollRafRef = useRef(0)
  const [showBackTop, setShowBackTop] = useState(false)
  /** 斜杠指令待确认文案 */
  const [slashPending, setSlashPending] = useState<string | null>(null)
  /** 本轮联网策略：关闭时服务端从模型工具中移除 smart_search */
  const [sessionWebSearch, setSessionWebSearch] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [asstWebSearch, setAsstWebSearch] = useState(false)
  const [asstUploading, setAsstUploading] = useState(false)

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const detail = (e as CustomEvent<ChatPrefs>).detail
      if (detail) setPrefs(detail)
      else setPrefs(getChatPrefs())
    }
    window.addEventListener('dd-prefs', onPrefs)
    return () => window.removeEventListener('dd-prefs', onPrefs)
  }, [])

  useEffect(() => {
    if (!topTrayOpen) return
    const onDoc = (e: MouseEvent) => {
      const el = topTrayRef.current
      if (el && !el.contains(e.target as Node)) setTopTrayOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTopTrayOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [topTrayOpen])

  useEffect(() => {
    applyReadingPrefsToDom(getReadingPrefs())
    const onRead = (e: Event) => {
      const detail = (e as CustomEvent<ReadingPrefs>).detail
      const next = detail || getReadingPrefs()
      setReadingPrefs(next)
      applyReadingPrefsToDom(next)
    }
    window.addEventListener('dd-reading-prefs', onRead)
    return () => window.removeEventListener('dd-reading-prefs', onRead)
  }, [])

  inputRef.current = input
  asstInputRef.current = asstInput

  // 按会话恢复/切换输入框草稿（防误触刷新丢失）
  useEffect(() => {
    const sid = session.sessionId || ''
    const prev = draftSessionRef.current
    if (prev && prev !== sid) {
      setComposerDraft(prev, inputRef.current)
    }
    draftSessionRef.current = sid
    setInput(sid ? getComposerDraft(sid) : '')
  }, [session.sessionId])

  useEffect(() => {
    const sid = session.sessionId
    if (!sid) return
    const t = window.setTimeout(() => setComposerDraft(sid, inputRef.current), 280)
    return () => window.clearTimeout(t)
  }, [input, session.sessionId])

  // 助手输入框草稿：按剧情 sessionId 隔离（右栏助手随主会话）
  useEffect(() => {
    const sid = session.sessionId || ''
    const key = sid ? `asst:${sid}` : ''
    const prev = asstDraftKeyRef.current
    if (prev && prev !== key) {
      setComposerDraft(prev, asstInputRef.current)
    }
    asstDraftKeyRef.current = key
    setAsstInput(key ? getComposerDraft(key) : '')
  }, [session.sessionId])

  useEffect(() => {
    const key = asstDraftKeyRef.current
    if (!key) return
    const t = window.setTimeout(() => setComposerDraft(key, asstInputRef.current), 280)
    return () => window.clearTimeout(t)
  }, [asstInput, session.sessionId])

  useEffect(() => {
    if (!ctxPanelOpen) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      // 桌面 / 移动端各有一份上下文环，点在任意 .ctx-usage-wrap 内都保留面板
      if (target?.closest?.('.ctx-usage-wrap')) return
      setCtxPanelOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxPanelOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [ctxPanelOpen])

  const chapterAnchors = useMemo(
    () =>
      readingPrefs.stickyChapterEnabled
        ? extractAnchorsFromMessages(session.messages)
        : [],
    [session.messages, readingPrefs.stickyChapterEnabled],
  )

  useEffect(() => {
    if (!cardQuery || appliedCardRef.current === cardQuery) return
    appliedCardRef.current = cardQuery
    void switchCard(cardQuery)
      .then(() => {
        toast(t('common.applied'), 'success')
        const next = new URLSearchParams(searchParams)
        next.delete('card')
        setSearchParams(next, { replace: true })
      })
      .catch((e) => {
        appliedCardRef.current = null
        toast(e instanceof Error ? e.message : String(e), 'error')
      })
  }, [cardQuery, searchParams, setSearchParams, t])

  const newSessionParam = searchParams.get('new')
  useEffect(() => {
    if (!newSessionParam || session.conn !== 'open') return
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
    store.newSession()
  }, [newSessionParam, session.conn, searchParams, setSearchParams, store])

  useEffect(() => {
    void fetchModels()
      .then((r) => {
        setModels(r.models)
        if (r.current) {
          setModelKey(`${r.current.provider}::${r.current.id}`)
          setCurrentProvider(r.current.provider)
          setThinkingLevelState(r.current.thinkingLevel || '')
          setAvailableLevels(r.current.availableLevels ?? [])
        }
      })
      .catch(() => {
        /* agent offline */
      })
    void fetchChannels()
      .then((r) => {
        setProviderBaseUrls(Object.fromEntries(r.channels.map((c) => [c.name, c.baseUrl])))
      })
      .catch(() => {
        /* agent offline */
      })
  }, [session.conn])

  useEffect(() => {
    if (session.conn === 'open') store.assistantSync()
  }, [session.conn, store])

  const seenNotifyAt = useRef(0)
  const seenErrorAt = useRef(0)

  useEffect(() => {
    const n = session.lastNotify
    if (!n || n.at === seenNotifyAt.current) return
    // 忽略挂载前已存在的旧通知，避免切回 Chat 时弹出上一页/上一操作的提示
    if (seenNotifyAt.current === 0) {
      seenNotifyAt.current = n.at
      return
    }
    seenNotifyAt.current = n.at
    const level =
      n.level === 'error'
        ? 'error'
        : n.level === 'warning'
          ? 'warning'
          : n.level === 'info'
            ? 'info'
            : 'success'
    toast(n.text, level)
  }, [session.lastNotify])

  useEffect(() => {
    const e = session.lastError
    if (!e || e.at === seenErrorAt.current) return
    if (seenErrorAt.current === 0) {
      seenErrorAt.current = e.at
      return
    }
    seenErrorAt.current = e.at
    toast(e.text, 'error')
  }, [session.lastError])

  // 监听用户滚动：离开底部则暂停自动贴底，避免流式把人拽回
  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      stickBottomRef.current = dist <= STICK_BOTTOM_PX
      setShowBackTop(el.scrollTop > SHOW_BACK_TOP_PX)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [session.sessionId])

  // 仅在「偏好开 + 用户贴底」时跟随内容增高；rAF 合并同帧多次 delta，减轻抖动
  useEffect(() => {
    if (!prefs.autoScroll || !stickBottomRef.current) return
    const el = streamRef.current
    if (!el) return
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      if (!stickBottomRef.current || !streamRef.current) return
      // 直接赋值 scrollTop，避免 smooth 与流式增量叠加造成抖动
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    })
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [session.messages, session.busy, session.pendingChoice, prefs.autoScroll])

  // 助手面板内部自管贴底滚动（含 streamThinking）

  const scrollStreamToTop = () => {
    const el = streamRef.current
    if (!el) return
    stickBottomRef.current = false
    el.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    setShowBackTop(false)
  }

  const scrollStreamToBottom = () => {
    const el = streamRef.current
    if (!el) return
    stickBottomRef.current = true
    el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    if (input.startsWith('/') && commands === null) {
      void fetchCommands()
        .then(setCommands)
        .catch(() => setCommands([]))
    }
  }, [input, commands])

  const cmdMatches = useMemo(() => {
    const m = input.match(/^\/([a-zA-Z0-9_-]*)$/)
    if (!m || !commands) return []
    const q = m[1].toLowerCase()
    return commands.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 8)
  }, [input, commands])

  useEffect(() => {
    setCmdIndex(0)
  }, [cmdMatches.length, input])

  useGSAP(
    () => {
      const root = streamRef.current
      if (!root || prefersReducedMotion()) return
      // 跳过流式气泡：入场位移会与内容增高叠加重绘，导致阅读抖动
      const nodes = root.querySelectorAll('.msg:not(.is-animated):not(.is-streaming)')
      nodes.forEach((n) => n.classList.add('is-animated'))
      if (!nodes.length) return
      gsap.fromTo(
        nodes,
        { y: 14, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.35, stagger: 0.04, ease: 'power2.out' },
      )
    },
    { dependencies: [session.messages.length, session.sessionId] },
  )

  const modelOptions = useMemo(() => {
    if (!models.length) {
      return [{ value: '', label: t('chat.agentOffline') }]
    }
    return models.map((m) => ({
      value: `${m.provider}::${m.id}`,
      label: m.name || m.id,
      meta: m.providerName || m.provider,
       icon: <ProviderIcon name={m.provider} baseUrl={providerBaseUrls[m.provider] || ''} model={m.id || m.name} size={16} />,
     }))
  }, [models, providerBaseUrls, t])

  /** 仅当模型支持「可切换」思考档时展示（空 / 仅 off / 仅一档 → 隐藏） */
  const thinkingOptions = useMemo(() => {
    const levels = availableLevels.map((lv) => lv.trim()).filter(Boolean)
    if (levels.length < 2) return []
    const meaningful = levels.filter((lv) => !/^(off|none|disabled|false|0)$/i.test(lv))
    if (meaningful.length === 0) return []
    return levels.map((lv) => ({ value: lv, label: lv }))
  }, [availableLevels])

  const connLabel =
    session.conn === 'open'
      ? t('chat.connOpen')
      : session.conn === 'connecting'
        ? t('chat.connConnecting')
        : t('chat.connClosed')

  const charName = session.charName || t('chat.assistant')

  const applyCmd = (name: string) => {
    const meta = commands?.find((c) => c.name === name)
    setInput(meta?.takesArgs ? `/${name} ` : `/${name}`)
  }

  const doSend = (text: string) => {
    if (!text || session.busy) return
    if (session.conn !== 'open') {
      toast(t('chat.connClosed'), 'error')
      return
    }
    // 用户主动发送后贴回底部，跟随本轮回复
    stickBottomRef.current = true
    if (!store.prompt(text, sessionWebSearch)) return
    setInput('')
    if (session.sessionId) clearComposerDraft(session.sessionId)
    requestAnimationFrame(() => scrollStreamToBottom())
  }

  const send = () => {
    const text = input.trim()
    if (!text || session.busy) return
    // 以 / 开头视为系统斜杠指令：先确认再发（服务端不会广播用户气泡）
    if (text.startsWith('/')) {
      setSlashPending(text)
      return
    }
    doSend(text)
  }

  const confirmSlash = () => {
    const text = slashPending
    setSlashPending(null)
    if (!text) return
    doSend(text)
    const cmd = text.split(/\s+/)[0] || text
    toast(t('chat.slashSent', { cmd }), 'info')
  }

  const sendAsst = () => {
    const text = asstInput.trim()
    if (!text || session.assistant.busy) return
    store.assistantPrompt(text, asstWebSearch)
    setAsstInput('')
    const key = asstDraftKeyRef.current
    if (key) clearComposerDraft(key)
  }

  const handleComposerUpload = async (file: File, kind: 'image' | 'file') => {
    if (session.conn !== 'open') {
      toast(t('chat.connClosed'), 'error')
      return
    }
    setUploading(true)
    try {
      const saved = await uploadFile(file)
      const path = saved.file
      const name = file.name || path
      toast(t('chat.uploadOk', { name }), 'success')
      const hint =
        kind === 'image'
          ? `请用 read 查看图片「${name}」（路径：${path}），识别画面内容后回复。`
          : `请用 read 查看并解析文件「${name}」（路径：${path}），总结要点后回复。`
      const extra = input.trim()
      const text = extra ? `${extra}\n\n${hint}` : hint
      setInput('')
      doSend(text)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('chat.uploadFail'), 'error')
    } finally {
      setUploading(false)
    }
  }

  const handleAsstUpload = async (file: File, kind: 'image' | 'file') => {
    if (session.conn !== 'open') {
      toast(t('chat.connClosed'), 'error')
      return
    }
    setAsstUploading(true)
    try {
      const saved = await uploadFile(file)
      const path = saved.file
      const name = file.name || path
      toast(t('chat.uploadOk', { name }), 'success')
      const hint =
        kind === 'image'
          ? `请用 read 查看图片「${name}」（路径：${path}），识别画面内容后回复。`
          : `请用 read 查看并解析文件「${name}」（路径：${path}），总结要点后回复。`
      const extra = asstInput.trim()
      const text = extra ? `${extra}\n\n${hint}` : hint
      setAsstInput('')
      store.assistantPrompt(text, asstWebSearch)
      const key = asstDraftKeyRef.current
      if (key) clearComposerDraft(key)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('chat.uploadFail'), 'error')
    } finally {
      setAsstUploading(false)
    }
  }

  const onSessionWebSearch = (on: boolean) => {
    setSessionWebSearch(on)
    toast(on ? t('chat.webSearchOn') : t('chat.webSearchOff'), 'info')
  }

  const onAsstWebSearch = (on: boolean) => {
    setAsstWebSearch(on)
    toast(on ? t('chat.webSearchOn') : t('chat.webSearchOff'), 'info')
  }

  const onModelChange = async (value: string) => {
    setModelKey(value)
    const [provider, id] = value.split('::')
    if (!provider || !id) return
    try {
      const cur = await selectModel(provider, id)
      setCurrentProvider(cur.provider)
      setThinkingLevelState(cur.thinkingLevel || '')
      setAvailableLevels(cur.availableLevels ?? [])
      toast(t('chat.toastModel'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('chat.agentOffline'), 'error')
    }
  }

  const onThinkingChange = async (level: string) => {
    setThinkingLevelState(level)
    try {
      const cur = await setThinkingLevel(level)
      setThinkingLevelState(cur.thinkingLevel || level)
      setAvailableLevels(cur.availableLevels ?? availableLevels)
      toast(t('chat.toastThinking'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('chat.agentOffline'), 'error')
    }
  }

  const cycleThinking = () => {
    if (thinkingOptions.length < 2) return
    const vals = thinkingOptions.map((o) => o.value)
    const idx = Math.max(0, vals.indexOf(thinkingLevel))
    const next = vals[(idx + 1) % vals.length]!
    void onThinkingChange(next)
  }

  const onProbe = async () => {
    if (!currentProvider) {
      toast(t('chat.agentOffline'), 'error')
      return
    }
    setProbing(true)
    try {
      const r = await testChannel({ name: currentProvider })
      setLatencyMs(r.latencyMs)
      if (r.ok) toast(`${t('chat.probeOk')} · ${r.latencyMs} ms`, 'success')
      else toast(r.detail || t('chat.probeFail'), 'error')
    } catch (e) {
      setLatencyMs(null)
      toast(e instanceof Error ? e.message : t('chat.probeFail'), 'error')
    } finally {
      setProbing(false)
    }
  }

  const toggleRight = (tab: Exclude<RightTab, null>) => {
    setRightTab((prev) => (prev === tab ? null : tab))
  }

  const charMap = useMemo(() => {
    const m: Record<string, { affinity?: number; status?: string; notes?: string }> = {}
    const chars = session.state?.characters ?? {}
    for (const [name, c] of Object.entries(chars)) {
      m[name] = { affinity: c.affinity, status: c.status, notes: c.notes }
    }
    return m
  }, [session.state])

  /** 会话级人名词典：世界状态 + 卡名 + <char> 标签（跨气泡复用；无出场即染） */
  const knownNames = useMemo(() => {
    const bag: string[] = []
    for (const n of Object.keys(charMap)) bag.push(n)
    if (session.charName?.trim()) bag.push(session.charName.trim())
    for (const m of session.messages) {
      if (m.channel !== 'narrative' && m.channel !== 'greeting') continue
      if (!m.text) continue
      bag.push(...harvestCharNamesFromText(m.text))
    }
    return mergeNameSources(bag)
  }, [charMap, session.charName, session.messages])

  const onCharSelect = (name: string) => {
    setFocusChar(name)
    setRightTab('state')
  }

  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [renamePath, setRenamePath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const stChatImportRef = useRef<HTMLInputElement>(null)
  const [stChatImporting, setStChatImporting] = useState(false)

  const importStChatFile = async (file: File) => {
    if (stChatImporting) return
    setStChatImporting(true)
    try {
      const content = await file.text()
      const result = await importSillyTavernChat(content)
      toast(`已导入酒馆聊天记录（${result.messages} 条正文）`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setStChatImporting(false)
      if (stChatImportRef.current) stChatImportRef.current.value = ''
    }
  }
  const [deletePath, setDeletePath] = useState<string | null>(null)
  const [sessionBusy, setSessionBusy] = useState(false)

  useEffect(() => {
    if (!menuPath) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if ((e.target as HTMLElement | null)?.closest?.('.history-act')) return
      setMenuPath(null)
      setMenuPos(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuPath(null)
        setMenuPos(null)
      }
    }
    const onScroll = () => {
      setMenuPath(null)
      setMenuPos(null)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [menuPath])

  const archivedKey = 'dd-archived-sessions'
  const [archived, setArchived] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(archivedKey) || '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })
  const [showArchived, setShowArchived] = useState(false)

  const toggleArchive = (path: string) => {
    setArchived((prev) => {
      const next = { ...prev }
      if (next[path]) delete next[path]
      else next[path] = true
      localStorage.setItem(archivedKey, JSON.stringify(next))
      return next
    })
    setMenuPath(null)
  }

  const doRename = async () => {
    if (!renamePath || !renameValue.trim()) return
    setSessionBusy(true)
    try {
      await renameSession(renamePath, renameValue.trim())
      store.listSessions()
      toast(t('chat.sessionRenamed'), 'success')
      setRenamePath(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSessionBusy(false)
    }
  }

  const doDelete = async () => {
    if (!deletePath) return
    setSessionBusy(true)
    try {
      const target = session.sessions.find((x) => x.path === deletePath)
      if (target?.current) {
        const fallback = session.sessions.find((x) => x.path !== deletePath)
        if (!fallback) {
          throw new Error(t('chat.deleteLastSessionBlocked'))
        }
        store.openSession(fallback.path)
        await new Promise((r) => setTimeout(r, 120))
      }
      await deleteSession(deletePath)
      setArchived((prev) => {
        if (!prev[deletePath]) return prev
        const next = { ...prev }
        delete next[deletePath]
        localStorage.setItem(archivedKey, JSON.stringify(next))
        return next
      })
      store.listSessions()
      toast(t('chat.sessionDeleted'), 'success')
      setDeletePath(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSessionBusy(false)
    }
  }

  const visibleSessions = session.sessions.filter((s) =>
    showArchived ? !!archived[s.path] : !archived[s.path],
  )

  const historyList = (
    <div className="chat-history-list">
      <div className="history-filter">
        <button
          type="button"
          className={`history-filter-btn ${!showArchived ? 'is-on' : ''}`}
          onClick={() => setShowArchived(false)}
        >
          {t('chat.historyActive')}
        </button>
        <button
          type="button"
          className={`history-filter-btn ${showArchived ? 'is-on' : ''}`}
          onClick={() => setShowArchived(true)}
        >
          {t('chat.historyArchived')}
        </button>
      </div>
      {visibleSessions.length === 0 ? (
        <div className="chat-history-empty">
          {showArchived ? t('chat.noArchived') : t('chat.noSessions')}
        </div>
      ) : (
        visibleSessions.map((s) => {
          const title = s.name || s.cardName || s.id
          const itemKey = s.id || s.path
          const label = (s.cardName || s.name || charName).slice(0, 1)
          const coverPath = s.cardPath || (s.current ? session.cardPath : '') || ''
          const coverSrc =
            coverPath && /\.png$/i.test(coverPath) ? cardImageUrl(coverPath) : ''
          return (
            <div
              key={itemKey}
              className={`history-item ${s.current ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="history-item-main"
                onClick={() => {
                  store.openSession(s.path)
                  setHistoryOpen(false)
                  setMenuPath(null)
                }}
              >
                <span className={`history-avatar${coverSrc ? ' has-cover' : ' is-mono'}`}>
                  {coverSrc ? (
                    <img
                      className="history-avatar-img"
                      src={coverSrc}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        const el = e.currentTarget
                        el.style.display = 'none'
                        el.parentElement?.classList.remove('has-cover')
                        el.parentElement?.classList.add('is-mono')
                      }}
                    />
                  ) : null}
                  <span className="history-avatar-letter" aria-hidden>
                    {label}
                  </span>
                </span>
                <span className="history-meta">
                  <strong>{title}</strong>
                  <small className="history-time">
                    {s.cardName && s.cardName !== title ? `${s.cardName} · ` : ''}
                    {formatSessionTime(s.modified)}
                  </small>
                </span>
              </button>
              <div className="history-acts">
                <button
                  type="button"
                  className="history-act"
                  title={t('chat.sessionMenu')}
                  aria-label={t('chat.sessionMenu')}
                  aria-expanded={menuPath === s.path}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (menuPath === s.path) {
                      setMenuPath(null)
                      setMenuPos(null)
                      return
                    }
                    const r = e.currentTarget.getBoundingClientRect()
                    const menuW = 168
                    const menuH = 200
                    let left = r.right - menuW
                    let top = r.bottom + 6
                    if (left < 8) left = 8
                    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8
                    if (top + menuH > window.innerHeight - 8) top = Math.max(8, r.top - menuH - 6)
                    setMenuPos({ top, left })
                    setMenuPath(s.path)
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>
          )
        })
      )}
      {renamePath ? (
        <div className="history-rename-bar">
          <input
            className="history-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={t('chat.renamePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doRename()
              if (e.key === 'Escape') setRenamePath(null)
            }}
            autoFocus
          />
          <button type="button" className="btn btn-sm btn-primary" disabled={sessionBusy} onClick={() => void doRename()}>
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setRenamePath(null)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
      {menuPath && menuPos
        ? (() => {
            const s = session.sessions.find((x) => x.path === menuPath)
            if (!s) return null
            return (
              <div
                ref={menuRef}
                className="history-menu is-fixed"
                role="menu"
                style={{ top: menuPos.top, left: menuPos.left }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRenamePath(s.path)
                    setRenameValue(s.name || '')
                    setMenuPath(null)
                    setMenuPos(null)
                  }}
                >
                  <Pencil size={12} />
                  {t('chat.renameSession')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    toggleArchive(s.path)
                    setMenuPos(null)
                  }}
                >
                  <Archive size={12} />
                  {archived[s.path] ? t('chat.unarchiveSession') : t('chat.archiveSession')}
                </button>
                <a
                  role="menuitem"
                  href={sessionExportUrl(s.path)}
                  download
                  onClick={() => {
                    setMenuPath(null)
                    setMenuPos(null)
                  }}
                >
                  <Download size={12} />
                  {t('chat.exportSession')}
                </a>
                <div className="history-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    setDeletePath(s.path)
                    setMenuPath(null)
                    setMenuPos(null)
                  }}
                >
                  <Trash2 size={12} />
                  {t('chat.deleteSession')}
                </button>
              </div>
            )
          })()
        : null}
      <ConfirmDialog
        open={!!deletePath}
        title={t('chat.deleteSession')}
        description={
          session.sessions.find((x) => x.path === deletePath)?.current
            ? t('chat.deleteCurrentSessionConfirm')
            : t('chat.deleteSessionConfirm')
        }
        confirmLabel={t('chat.deleteSession')}
        danger
        busy={sessionBusy}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeletePath(null)}
      />
    </div>
  )

  // 开场白是静态角色卡内容，不参与自由格式抉择推断。
  const lastChoiceNarrativeId = useMemo(() => {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i]
      if (m.channel !== 'narrative') continue
      if (m.streaming) continue
      if (textLooksLikeChoice(m.text)) return m.id
    }
    return null
  }, [session.messages])

  const lastNarrativeId = useMemo(() => {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i]
      if (m.channel === 'narrative' || m.channel === 'greeting') return m.id
    }
    return null
  }, [session.messages])

  const liveChoiceBubbleId = lastChoiceNarrativeId ?? lastNarrativeId

  const sessionCover =
    session.cardPath && /\.png$/i.test(session.cardPath) ? cardImageUrl(session.cardPath) : ''

  const renderBubble = (m: LiveBubble) => {
    const role = bubbleRole(m.channel)
    const title =
      role === 'user' ? t('chat.user') : role === 'system' ? t('chat.system') : m.name || charName
    const isError = m.channel === 'info' && /失败|错误|鉴权|401|403|404|blocked/i.test(m.text)
    // 仅最新可互动抉择气泡可点；历史岔路只作回顾
    const choiceLive =
      role !== 'user' &&
      !m.streaming &&
      session.conn === 'open' &&
      !session.busy &&
      !session.pendingChoice &&
      !!liveChoiceBubbleId &&
      m.id === liveChoiceBubbleId
    const isNarrative = m.channel === 'narrative' || m.channel === 'greeting'
    const isLatestNarrative = isNarrative && !!lastNarrativeId && m.id === lastNarrativeId
    const canReroll =
      isLatestNarrative && !m.streaming && session.conn === 'open' && !session.busy
    const showReroll = isNarrative && !m.streaming
    const meta = m.meta
    const tokenN =
      meta?.totalTokens ??
      (meta?.inputTokens != null || meta?.outputTokens != null
        ? (meta.inputTokens ?? 0) + (meta.outputTokens ?? 0)
        : undefined)
    // 有 duration/ttft/token 任一即可；TokUI 正文不影响 meta 展示
    const hasMetaRow =
      isNarrative &&
      !m.streaming &&
      !!(
        meta &&
        (meta.durationMs != null ||
          meta.ttftMs != null ||
          (tokenN != null && tokenN > 0) ||
          meta.cost != null)
      )
    const useCardAvatar = role === 'system' || role === 'assistant'
    const avatarLetter =
      role === 'system' ? charName.slice(0, 1) || title.slice(0, 1) : title.slice(0, 1)

    return (
      <div
        key={m.id}
        className={`msg msg-${role} msg-ch-${m.channel}${m.streaming ? ' is-streaming' : ''}${isError ? ' is-error' : ''}`}
      >
        <div className="msg-bubble">
          <div className="msg-head">
            <span
              className={`msg-avatar msg-avatar-${role}${useCardAvatar && sessionCover ? ' has-cover' : ''}`}
              aria-hidden
            >
              {useCardAvatar && sessionCover ? (
                <img
                  className="msg-avatar-img"
                  src={sessionCover}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    const el = e.currentTarget
                    el.style.display = 'none'
                    el.parentElement?.classList.remove('has-cover')
                  }}
                />
              ) : null}
              <span className="msg-avatar-letter">{avatarLetter}</span>
            </span>
            <div className="msg-role">
              <span className="msg-name">{title}</span>
              {m.channel === 'backstage' ? <span className="msg-tag">{t('chat.backstage')}</span> : null}
              {m.streaming ? <span className="msg-tag">{t('chat.typing')}</span> : null}
              {isError ? <span className="msg-tag is-error">{t('chat.errorTag')}</span> : null}
              {prefs.showTimestamps && m.at ? (
                <span className="msg-time">
                  {new Date(m.at).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              ) : null}
            </div>
          </div>
          {m.thinking && (prefs.streamReply || !m.streaming) ? (
            <ThinkingBlock
              text={m.thinking}
              streaming={!!m.streaming}
              autoCollapseOnEnd
              defaultOpen={false}
              labelIdle={t('chat.thinking')}
              labelLive={t('chat.asstThinkingLive')}
              labelDone={t('chat.asstThinkingDone')}
            />
          ) : null}
          {m.activities?.length ? (
            <ToolCallList items={coalesceActivities(m.activities, toolLocale)} max={8} />
          ) : null}
          {m.channel === 'image' && m.src ? (
            <img className="msg-media" src={m.src} alt={m.text || ''} />
          ) : null}
          {m.channel === 'audio' && m.src ? <audio className="msg-media" controls src={m.src} /> : null}
          {m.channel === 'video' && m.src ? <video className="msg-media" controls src={m.src} /> : null}
          {m.channel === 'html' && m.html ? (
            <CardHtmlFrame
              className="msg-html"
              title={m.text || 'html'}
              html={m.html}
              scripts={!!m.scripts}
            />
          ) : null}
          {m.channel === 'choice' && m.choice ? (
            <div className="msg-choice resolved">
              <p>{m.choice.question}</p>
              {m.choice.answer ? <strong>{m.choice.answer}</strong> : null}
              {m.choice.stopped ? <em>{t('chat.choiceStopped')}</em> : null}
            </div>
          ) : null}
          {m.text && m.channel !== 'choice' && (prefs.streamReply || !m.streaming) ? (
            <RichMessage
              text={m.text}
              rich={role !== 'user'}
              streaming={!!m.streaming}
              inferFreeformChoice={m.channel !== 'greeting'}
              className="msg-text"
              charMap={charMap}
              activeChar={focusChar}
              onCharSelect={role !== 'user' ? onCharSelect : undefined}
              onChoice={choiceLive ? (opt) => void store.prompt(opt, sessionWebSearch) : undefined}
              enableReading={isNarrative}
              readingPrefs={isNarrative ? readingPrefs : null}
              messageId={m.id}
              knownNames={isNarrative ? knownNames : undefined}
              userName={session.userName}
               charName={charName}
               statusState={session.state}
             />
          ) : m.streaming && !prefs.streamReply ? (
            <p className="msg-text msg-stream-wait">{t('chat.typing')}</p>
          ) : null}
          {m.swipe && m.swipe.total > 0 ? (
            <div className="msg-swipe">
              <button
                type="button"
                className="icon-btn"
                disabled={session.busy}
                onClick={() => store.swipe('prev')}
                aria-label="prev"
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {m.swipe.index + 1}/{m.swipe.total}
              </span>
              <button
                type="button"
                className="icon-btn"
                disabled={session.busy}
                onClick={() => store.swipe('next')}
                aria-label="next"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ) : null}
          {showReroll || hasMetaRow ? (
            <div className="msg-foot">
              {hasMetaRow ? (
                <div className="msg-meta-row" aria-label={t('chat.replyMeta')}>
                  {meta?.durationMs != null ? (
                    <span className="msg-meta-item" title={t('chat.duration')}>
                      <Clock size={12} aria-hidden />
                      {formatDurationMs(meta.durationMs)}
                    </span>
                  ) : null}
                  {tokenN != null && tokenN > 0 ? (
                    <span
                      className="msg-meta-item"
                      title={
                        meta?.inputTokens != null || meta?.outputTokens != null
                          ? `${t('chat.inputTokens')} ${meta?.inputTokens ?? '—'} · ${t('chat.outputTokens')} ${meta?.outputTokens ?? '—'}`
                          : t('chat.tokens')
                      }
                    >
                      <Hash size={12} aria-hidden />
                      {formatTokenCount(tokenN)}
                    </span>
                  ) : null}
                  {meta?.ttftMs != null ? (
                    <span className="msg-meta-item" title={t('chat.ttft')}>
                      <Zap size={12} aria-hidden />
                      {formatDurationMs(meta.ttftMs)}
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="msg-meta-row" />
              )}
              {showReroll ? (
                <button
                  type="button"
                  className={`msg-reroll icon-btn${canReroll ? '' : ' is-history'}`}
                  disabled={!canReroll}
                  title={canReroll ? t('chat.regenerate') : t('chat.regenerateHistory')}
                  aria-label={canReroll ? t('chat.regenerate') : t('chat.regenerateHistory')}
                  onClick={() => {
                    if (!canReroll) return
                    store.reroll()
                  }}
                >
                  <RefreshCw size={14} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const toggleHistoryCollapsed = () => {
    setHistoryCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem('dd-history-collapsed', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const asst = session.assistant

  return (
    <div className="page chat-page">
      <div
        className={`chat-layout ${rightTab ? 'has-right' : ''} ${historyCollapsed ? 'side-collapsed' : ''}`}
      >
        <aside className={`chat-side surface ${historyCollapsed ? 'is-collapsed' : ''}`}>
          <div className="chat-side-head">
            <h2>{t('chat.history')}</h2>
            <div className="chat-side-actions">
              <input
                ref={stChatImportRef}
                className="sr-only"
                type="file"
                accept="application/json,.json,.jsonl,application/x-ndjson"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void importStChatFile(file)
                }}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  if (session.conn !== 'open') {
                    toast(t('chat.toastNewOffline'), 'error')
                    return
                  }
                  if (!store.newSession()) {
                    toast(t('chat.toastNewOffline'), 'error')
                    return
                  }
                }}
              >
                {t('chat.newChat')}
              </button>
              <button
                type="button"
                className="icon-btn chat-side-collapse"
                title={t('chat.collapseHistory')}
                aria-label={t('chat.collapseHistory')}
                onClick={toggleHistoryCollapsed}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm chat-session-import"
            disabled={stChatImporting || session.busy}
            title="导入 SillyTavern 聊天记录"
            onClick={() => stChatImportRef.current?.click()}
          >
            <FileUp size={14} />
            {stChatImporting ? '导入中…' : t('chat.importSession')}
          </button>
          {historyList}
        </aside>

        <section className="chat-main surface">
          <header className="chat-top">
            <div className="chat-peer">
              <button
                type="button"
                className="chat-history-toggle"
                onClick={() => {
                  if (historyCollapsed) toggleHistoryCollapsed()
                  else setHistoryOpen(true)
                }}
                aria-label={t('chat.history')}
                title={historyCollapsed ? t('chat.expandHistory') : t('chat.history')}
              >
                <PanelLeft size={18} />
              </button>
              {(() => {
                const topCover =
                  session.cardPath && /\.png$/i.test(session.cardPath)
                    ? cardImageUrl(session.cardPath)
                    : ''
                const cardHref = session.cardPath
                  ? `/cards/${encodeCardPath(session.cardPath)}`
                  : '/cards'
                return (
                  <Link
                    to={cardHref}
                    className={`peer-avatar${topCover ? ' has-cover' : ' peer-avatar-fallback is-mono'}`}
                    title={charName}
                  >
                    {topCover ? (
                      <img
                        className="history-avatar-img peer-avatar-img"
                        src={topCover}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          const el = e.currentTarget
                          el.style.display = 'none'
                          el.parentElement?.classList.remove('has-cover')
                          el.parentElement?.classList.add('peer-avatar-fallback', 'is-mono')
                        }}
                      />
                    ) : null}
                    <span className="history-avatar-letter peer-avatar-letter" aria-hidden>
                      {charName.slice(0, 1)}
                    </span>
                  </Link>
                )
              })()}
              <div className={`chat-peer-meta${session.busy ? ' is-busy' : ''}`}>
                <div className="chat-peer-title" aria-live="polite">
                  <h1 className="chat-peer-name-sr">
                    {session.busy ? t('chat.peerSending') : charName}
                  </h1>
                  <div
                    className="chat-peer-name-face chat-peer-name-idle"
                    aria-hidden={session.busy}
                  >
                    {charName}
                  </div>
                  <div
                    className="chat-peer-name-face chat-peer-name-busy"
                    aria-hidden={!session.busy}
                  >
                    <span className="chat-peer-sending-text">{t('chat.peerSending')}</span>
                    <span className="chat-peer-sending-dots" aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                </div>
                <p>
                  <span className={`conn-dot conn-${session.conn}`}>{connLabel}</span>
                  {currentProvider ? (
                    <>
                      {' · '}
                      <span className="chat-provider-inline">
                         <ProviderIcon
                           name={currentProvider}
                           baseUrl={providerBaseUrls[currentProvider] || ''}
                           model={models.find((m) => m.provider === currentProvider && `${m.provider}::${m.id}` === modelKey)?.id || modelKey.split('::')[1] || ''}
                          size={14}
                        />
                        {currentProvider}
                      </span>
                    </>
                  ) : null}
                  {latencyMs != null ? ` · ${latencyMs} ms` : null}
                  {session.stats ? (
                    <>
                      {' · '}
                      <span className="ctx-usage-wrap ctx-usage-desktop">
                        <button
                          type="button"
                          className={`ctx-usage${ctxPanelOpen ? ' is-open' : ''}`}
                          aria-expanded={ctxPanelOpen}
                          aria-haspopup="dialog"
                          title={t('chat.contextPanel')}
                          onClick={() => setCtxPanelOpen((v) => !v)}
                        >
                          <span
                            className="ctx-ring"
                            style={
                              {
                                ['--ctx-pct' as string]: Math.min(
                                  100,
                                  Math.max(0, session.stats.contextPercent ?? 0),
                                ),
                              } as CSSProperties
                            }
                            data-level={
                              (session.stats.contextPercent ?? 0) >= 85
                                ? 'high'
                                : (session.stats.contextPercent ?? 0) >= 60
                                  ? 'mid'
                                  : 'low'
                            }
                            aria-hidden
                          />
                          <span className="ctx-usage-label">
                            {t('chat.context')} {Math.round(session.stats.contextPercent ?? 0)}%
                          </span>
                        </button>
                        {ctxPanelOpen ? (
                          <div className="ctx-panel" role="dialog" aria-label={t('chat.contextPanel')}>
                            <div className="ctx-panel-head">
                              <span
                                className="ctx-ring ctx-ring-lg"
                                style={
                                  {
                                    ['--ctx-pct' as string]: Math.min(
                                      100,
                                      Math.max(0, session.stats.contextPercent ?? 0),
                                    ),
                                  } as CSSProperties
                                }
                                data-level={
                                  (session.stats.contextPercent ?? 0) >= 85
                                    ? 'high'
                                    : (session.stats.contextPercent ?? 0) >= 60
                                      ? 'mid'
                                      : 'low'
                                }
                                aria-hidden
                              />
                              <div>
                                <strong>{t('chat.contextPanel')}</strong>
                                <p>
                                  {t('chat.contextPercent')}{' '}
                                  {Math.round(session.stats.contextPercent ?? 0)}%
                                </p>
                              </div>
                            </div>
                            <dl className="ctx-panel-grid">
                              {session.stats.contextTokens != null ? (
                                <div>
                                  <dt>{t('chat.contextUsed')}</dt>
                                  <dd>{session.stats.contextTokens.toLocaleString()}</dd>
                                </div>
                              ) : null}
                              {session.stats.contextWindow != null ? (
                                <div>
                                  <dt>{t('chat.contextWindow')}</dt>
                                  <dd>{session.stats.contextWindow.toLocaleString()}</dd>
                                </div>
                              ) : null}
                              <div>
                                <dt>{t('chat.contextUserMsgs')}</dt>
                                <dd>{session.stats.userMessages.toLocaleString()}</dd>
                              </div>
                              <div>
                                <dt>{t('chat.contextAsstMsgs')}</dt>
                                <dd>{session.stats.assistantMessages.toLocaleString()}</dd>
                              </div>
                              <div>
                                <dt>{t('chat.contextTotalTokens')}</dt>
                                <dd>{session.stats.totalTokens.toLocaleString()}</dd>
                              </div>
                              {session.stats.cost > 0 ? (
                                <div>
                                  <dt>{t('chat.contextCost')}</dt>
                                  <dd>${session.stats.cost.toFixed(4)}</dd>
                                </div>
                              ) : null}
                            </dl>
                            <p className="ctx-panel-hint">{t('chat.contextHint')}</p>
                          </div>
                        ) : null}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="chat-top-actions" ref={topTrayRef}>
              {/* 移动端紧凑：上下文 Mini 环常显 + 托盘；桌面显示全部 */}
              <div className="chat-top-compact">
                <span className="ctx-usage-wrap ctx-usage-mobile">
                  <button
                    type="button"
                    className={`ctx-usage ctx-usage-compact${ctxPanelOpen ? ' is-open' : ''}${!session.stats ? ' is-idle' : ''}`}
                    aria-expanded={ctxPanelOpen}
                    title={t('chat.contextPanel')}
                    onClick={() => {
                      setTopTrayOpen(false)
                      setCtxPanelOpen((v) => !v)
                    }}
                  >
                    <span
                      className="ctx-ring"
                      style={
                        {
                          ['--ctx-pct' as string]: Math.min(
                            100,
                            Math.max(0, session.stats?.contextPercent ?? 0),
                          ),
                        } as CSSProperties
                      }
                      data-level={
                        (session.stats?.contextPercent ?? 0) >= 85
                          ? 'high'
                          : (session.stats?.contextPercent ?? 0) >= 60
                            ? 'mid'
                            : 'low'
                      }
                      aria-hidden
                    />
                    <span className="ctx-usage-label">
                      {session.stats ? `${Math.round(session.stats.contextPercent ?? 0)}%` : '—'}
                    </span>
                  </button>
                  {ctxPanelOpen ? (
                    <div className="ctx-panel ctx-panel-mobile" role="dialog" aria-label={t('chat.contextPanel')}>
                      <div className="ctx-panel-head">
                        <span
                          className="ctx-ring ctx-ring-lg"
                          style={
                            {
                              ['--ctx-pct' as string]: Math.min(
                                100,
                                Math.max(0, session.stats?.contextPercent ?? 0),
                              ),
                            } as CSSProperties
                          }
                          data-level={
                            (session.stats?.contextPercent ?? 0) >= 85
                              ? 'high'
                              : (session.stats?.contextPercent ?? 0) >= 60
                                ? 'mid'
                                : 'low'
                          }
                          aria-hidden
                        />
                        <div>
                          <strong>{t('chat.contextPanel')}</strong>
                          <p>
                            {t('chat.contextPercent')}{' '}
                            {session.stats ? `${Math.round(session.stats.contextPercent ?? 0)}%` : '—'}
                          </p>
                        </div>
                      </div>
                      {session.stats ? (
                        <dl className="ctx-panel-grid">
                          {session.stats.contextTokens != null ? (
                            <div>
                              <dt>{t('chat.contextUsed')}</dt>
                              <dd>{session.stats.contextTokens.toLocaleString()}</dd>
                            </div>
                          ) : null}
                          {session.stats.contextWindow != null ? (
                            <div>
                              <dt>{t('chat.contextWindow')}</dt>
                              <dd>{session.stats.contextWindow.toLocaleString()}</dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>{t('chat.contextUserMsgs')}</dt>
                            <dd>{session.stats.userMessages.toLocaleString()}</dd>
                          </div>
                          <div>
                            <dt>{t('chat.contextAsstMsgs')}</dt>
                            <dd>{session.stats.assistantMessages.toLocaleString()}</dd>
                          </div>
                          <div>
                            <dt>{t('chat.contextTotalTokens')}</dt>
                            <dd>{session.stats.totalTokens.toLocaleString()}</dd>
                          </div>
                          {session.stats.cost > 0 ? (
                            <div>
                              <dt>{t('chat.contextCost')}</dt>
                              <dd>${session.stats.cost.toFixed(4)}</dd>
                            </div>
                          ) : null}
                        </dl>
                      ) : (
                        <p className="ctx-panel-hint">{t('chat.contextHint')}</p>
                      )}
                      {session.stats ? (
                        <p className="ctx-panel-hint">{t('chat.contextHint')}</p>
                      ) : null}
                    </div>
                  ) : null}
                </span>
                <button
                  type="button"
                  className={`icon-btn chat-tray-toggle${topTrayOpen ? ' is-on' : ''}`}
                  title={t('chat.moreTools')}
                  aria-expanded={topTrayOpen}
                  onClick={() => {
                    setCtxPanelOpen(false)
                    setTopTrayOpen((v) => !v)
                  }}
                >
                  <SlidersHorizontal size={18} />
                </button>
              </div>

              <div className={`chat-top-tools${topTrayOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className={`icon-btn ${rightTab === 'state' ? 'is-on' : ''}`}
                  title={t('chat.statePanel')}
                  onClick={() => {
                    setTopTrayOpen(false)
                    toggleRight('state')
                  }}
                >
                  <BookOpen size={18} />
                </button>
                <button
                  type="button"
                  className={`icon-btn ${rightTab === 'assistant' ? 'is-on' : ''}`}
                  title={t('chat.assistantPanel')}
                  onClick={() => {
                    setTopTrayOpen(false)
                    toggleRight('assistant')
                  }}
                >
                  <Bot size={18} />
                </button>
                <button
                  type="button"
                  className={`icon-btn ${rightTab === 'panels' ? 'is-on' : ''}`}
                  title={t('chat.panels')}
                  onClick={() => {
                    setTopTrayOpen(false)
                    toggleRight('panels')
                  }}
                >
                  <LayoutPanelLeft size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t('chat.testConnection')}
                  disabled={probing || !currentProvider}
                  onClick={() => void onProbe()}
                >
                  <Wifi size={18} />
                </button>
                {thinkingOptions.length > 0 ? (
                  <Select
                    value={thinkingLevel}
                    options={thinkingOptions}
                    onChange={(v) => void onThinkingChange(v)}
                    size="sm"
                    ariaLabel={t('chat.thinkingLevel')}
                  />
                ) : null}
                <Select
                  value={modelKey}
                  options={modelOptions}
                  onChange={(v) => void onModelChange(v)}
                  size="sm"
                  ariaLabel={t('chat.model')}
                />
              </div>
            </div>
          </header>

          <div
            className="chat-stream"
            ref={streamRef}
            data-reading="1"
            data-read-colorize={readingPrefs.colorizeEnabled ? '1' : '0'}
            data-read-width={readingPrefs.width}
            data-read-compress={readingPrefs.compressBlankLines ? '1' : '0'}
            data-read-indent={readingPrefs.firstLineIndent ? '1' : '0'}
          >
            <StickyChapterBar
              anchors={chapterAnchors}
              rootRef={streamRef}
              enabled={readingPrefs.stickyChapterEnabled}
              ledgerChapter={session.state?.chapter || ''}
              ledgerLocation={session.state?.location || ''}
            />
            <div className="chat-flow">
              {session.conn !== 'open' && session.messages.length === 0 ? (
                <div className="chat-empty">
                  <h3>{t('chat.connectingTitle')}</h3>
                  <p>{t('chat.connectingDesc')}</p>
                </div>
              ) : session.messages.length === 0 ? (
                <div className="chat-empty">
                  {session.cardPath || (session.charName && session.charName !== t('chat.assistant')) ? (
                    <>
                      <h3>{t('chat.emptyReadyTitle', { name: charName })}</h3>
                      <p>{t('chat.emptyReadyDesc')}</p>
                    </>
                  ) : (
                    <>
                      <h3>{t('chat.emptyTitle')}</h3>
                      <p>{t('chat.emptyDesc')}</p>
                      <Link to="/cards" className="btn btn-primary btn-sm">
                        {t('nav.cards')}
                      </Link>
                    </>
                  )}
                </div>
              ) : (
                session.messages.map(renderBubble)
              )}

              {session.pendingChoice && !session.pendingChoice.answer && !session.pendingChoice.stopped ? (
                <div className="msg msg-system">
                  <div className="msg-bubble msg-choice live dd-gate-card">
                    <div className="dd-gate-head">
                      <span className="dd-gate-badge">此刻抉择</span>
                      <span className="dd-gate-sub">选一条走向，故事从这里续写</span>
                    </div>
                    <p className="dd-gate-q">{session.pendingChoice.question}</p>
                    <div className="dd-gate-opts">
                      {session.pendingChoice.options.map((opt, i) => {
                        const m = opt.match(/^【([^】]+)】(.*)$/)
                        const title = m ? m[1] : null
                        const body = m ? m[2].trim() : opt
                        return (
                          <button
                            key={`${i}-${opt.slice(0, 24)}`}
                            type="button"
                            className="dd-gate-opt"
                            onClick={() => {
                              store.replyChoice(session.pendingChoice!.id!, opt)
                              setChoiceFree('')
                            }}
                          >
                            <span className="dd-gate-idx" aria-hidden>
                              {String.fromCharCode(65 + (i % 26))}
                            </span>
                            <span className="dd-gate-main">
                              {title ? <strong>{title}</strong> : null}
                              <span>{body || title}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="dd-gate-free">
                      <input
                        type="text"
                        value={choiceFree}
                        onChange={(e) => setChoiceFree(e.target.value)}
                        placeholder={session.pendingChoice.placeholder || t('chat.choiceFree')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = choiceFree.trim()
                            if (v && session.pendingChoice?.id) {
                              store.replyChoice(session.pendingChoice.id, v)
                              setChoiceFree('')
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          const v = choiceFree.trim()
                          if (v && session.pendingChoice?.id) {
                            store.replyChoice(session.pendingChoice.id, v)
                            setChoiceFree('')
                          }
                        }}
                      >
                        {t('common.confirm')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          session.pendingChoice?.id &&
                          store.replyChoice(session.pendingChoice.id, undefined, true)
                        }
                      >
                        {t('chat.choiceStop')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {session.activities.length > 0 ? (
                <ToolCallList items={coalesceActivities(session.activities, toolLocale)} max={8} />
              ) : null}
            </div>
          </div>

          <button
            type="button"
            className={`chat-back-top${showBackTop ? ' is-visible' : ''}`}
            title={t('chat.backToTop')}
            aria-label={t('chat.backToTop')}
            onClick={scrollStreamToTop}
          >
            <svg className="chat-back-top-icon" viewBox="0 0 384 512" aria-hidden>
              <path d="M214.6 41.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 141.2V448c0 17.7 14.3 32 32 32s32-14.3 32-32V141.2L329.4 246.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z" />
            </svg>
          </button>

          <div className="chat-dock">
            <div className="chat-dock-inner">
              <div className="chat-composer">
                {cmdMatches.length > 0 ? (
                  <div className="slash-menu" role="listbox" aria-label={t('chat.slashHint')}>
                    {cmdMatches.map((c, i) => (
                      <button
                        key={c.name}
                        type="button"
                        className={`slash-item ${i === cmdIndex ? 'is-on' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          applyCmd(c.name)
                        }}
                      >
                        <strong>/{c.name}</strong>
                        <span>{c.description}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <ChatComposer
                  value={input}
                  onChange={setInput}
                  onSend={send}
                  onAbort={() => store.abort()}
                  busy={session.busy}
                  disabled={session.conn !== 'open'}
                  placeholder={t('chat.inputPlaceholder')}
                  enterSend={prefs.enterSend}
                  webSearch={sessionWebSearch}
                  onWebSearchChange={onSessionWebSearch}
                  thinkingLevel={thinkingLevel}
                  thinkingLevels={thinkingOptions.map((o) => o.value)}
                  onThinkingCycle={cycleThinking}
                  onPickImage={(f) => handleComposerUpload(f, 'image')}
                  onPickFile={(f) => handleComposerUpload(f, 'file')}
                  uploading={uploading}
                  onKeyDownExtra={(e) => {
                    if (cmdMatches.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setCmdIndex((i) => Math.min(i + 1, cmdMatches.length - 1))
                        return true
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setCmdIndex((i) => Math.max(i - 1, 0))
                        return true
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        applyCmd(cmdMatches[cmdIndex]?.name || cmdMatches[0]!.name)
                        return true
                      }
                      if (e.key === 'Escape') {
                        setInput('')
                        return true
                      }
                    }
                    return false
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {rightTab ? (
          <>
            <button
              type="button"
              className="chat-right-mask"
              aria-label="close"
              onClick={() => setRightTab(null)}
            />
            <aside className="chat-right surface">
              <div className="chat-side-head">
                <h2>
                  {rightTab === 'state'
                    ? t('chat.statePanel')
                    : rightTab === 'assistant'
                      ? t('chat.assistantPanel')
                      : t('chat.panels')}
                </h2>
                <button type="button" className="icon-btn" onClick={() => setRightTab(null)} aria-label="close">
                  <X size={18} />
                </button>
              </div>

            {rightTab === 'state' ? (
              session.state ? (
                <StateView
                  state={session.state}
                  highlight={focusChar}
                  onSelectChar={(name) => setFocusChar(name)}
                />
              ) : (
                <div className="chat-history-empty">{t('chat.noState')}</div>
              )
            ) : null}

            {rightTab === 'panels' ? (
              session.panels.length === 0 ? (
                <div className="chat-history-empty">{t('chat.noPanels')}</div>
              ) : (
                <div className="panel-list">
                  {session.panels.map((p, i) => {
                    const content = String(p.content ?? '')
                    const kind = String(p.kind || '').toLowerCase()
                    // 完整 HTML 文档走沙箱 iframe；其余（md / tokui / rp 标签）复用 RichMessage
                    const fullHtml =
                      kind === 'html' ||
                      /^\s*<(!doctype|html)\b/i.test(content) ||
                      (kind !== 'markdown' &&
                        kind !== 'md' &&
                        kind !== 'text' &&
                        /^\s*<html[\s>]/i.test(content))
                    return (
                      <article key={`${p.name}-${i}`} className="panel-card">
                        <div className="entry-head">
                          <h3>{p.name}</h3>
                          <span className="chip">{p.kind}</span>
                        </div>
                        {fullHtml ? (
                          <CardHtmlFrame
                            className="msg-html panel-html"
                            title={p.name}
                            html={content}
                          />
                        ) : (
                          <RichMessage
                            text={content}
                            rich
                            className="panel-rich"
                            userName={session.userName}
                            charName={charName}
                          />
                        )}
                      </article>
                    )
                  })}
                </div>
              )
            ) : null}

            {rightTab === 'assistant' ? (
              <AssistantPanel
                asst={asst}
                connOpen={session.conn === 'open'}
                input={asstInput}
                onInputChange={setAsstInput}
                onSend={sendAsst}
                onAbort={() => store.assistantAbort()}
                onClear={() => store.assistantNew()}
                userName={session.userName}
                charName={charName}
                toolLocale={toolLocale}
                webSearch={asstWebSearch}
                onWebSearchChange={onAsstWebSearch}
                thinkingLevel={thinkingLevel}
                thinkingLevels={thinkingOptions.map((o) => o.value)}
                onThinkingCycle={cycleThinking}
                onPickImage={(f) => handleAsstUpload(f, 'image')}
                onPickFile={(f) => handleAsstUpload(f, 'file')}
                uploading={asstUploading}
                enterSend={prefs.enterSend}
              />
            ) : null}
          </aside>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!slashPending}
        title={t('chat.slashConfirmTitle')}
        description={t('chat.slashConfirmDesc', {
          cmd: slashPending?.split(/\s+/)[0] || slashPending || '',
        })}
        confirmLabel={t('chat.slashConfirmSend')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmSlash}
        onCancel={() => setSlashPending(null)}
      />

      {historyOpen ? (
        <div className="chat-drawer" role="dialog" aria-label={t('chat.history')}>
          <button
            type="button"
            className="chat-drawer-mask"
            onClick={() => setHistoryOpen(false)}
            aria-label={t('common.cancel')}
          />
          <div className="chat-drawer-panel surface">
            <div className="chat-side-head">
              <h2>{t('chat.history')}</h2>
              <div className="chat-drawer-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    if (session.conn !== 'open') {
                      toast(t('chat.toastNewOffline'), 'error')
                      return
                    }
                    if (!store.newSession()) {
                      toast(t('chat.toastNewOffline'), 'error')
                      return
                    }
                    setHistoryOpen(false)
                  }}
                >
                  {t('chat.newChat')}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setHistoryOpen(false)}
                  aria-label={t('common.cancel')}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            {historyList}
          </div>
        </div>
      ) : null}
    </div>
  )
}
