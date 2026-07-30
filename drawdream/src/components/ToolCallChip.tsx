import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileSearch,
  Globe,
  Loader2,
  MemoryStick,
  NotebookPen,
  PanelRight,
  Search,
  Settings2,
  Wrench,
} from 'lucide-react'
import type { WireActivity } from '../agent/wire.types'
import { toolDisplayName, toolFailSuffix, type ToolLabelLocale } from '../agent/tool-labels'
import './ToolCallChip.css'

export type ToolCallChipItem = {
  id: string
  name: string
  status: 'running' | 'done' | 'error' | 'note'
  detail?: string
  title?: string
  query?: string
}

function parseDetailObject(detail?: string): Record<string, unknown> | null {
  if (!detail) return null
  const t = detail.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return null
  try {
    const v = JSON.parse(t.endsWith('…') ? t.slice(0, -1) : t) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    /* ignore truncated json */
  }
  return null
}

function pickString(obj: Record<string, unknown> | null, keys: string[]): string {
  if (!obj) return ''
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function shortPath(p: string): string {
  const s = p.replace(/\\/g, '/')
  const parts = s.split('/').filter(Boolean)
  if (parts.length <= 2) return s
  return parts.slice(-2).join('/')
}

export function toolCallTitle(
  name: string,
  detail?: string,
  status?: ToolCallChipItem['status'],
  locale: ToolLabelLocale = 'zh',
): string {
  const label = toolDisplayName(name, locale)
  const obj = parseDetailObject(detail)
  const q = pickString(obj, ['query', 'q', 'keyword', 'keywords', 'text', 'prompt', 'question'])
  const path = pickString(obj, ['path', 'file', 'file_path', 'filePath', 'filename', 'target'])
  const key = pickString(obj, ['key', 'keys', 'entry', 'name', 'title', 'id'])
  const quote = (s: string) => (s.length > 48 ? `${s.slice(0, 48)}…` : s)

  if (name === 'smart_search' || name === 'world_time') {
    if (q) return `${label} "${quote(q)}"`
    return label
  }
  if (name.startsWith('lorebook') || name.startsWith('memory') || name.startsWith('world_state') || name === 'codex_write') {
    if (q || key) return `${label}${q || key ? ` "${quote(q || key)}"` : ''}`
    return label
  }
  if (name === 'read' || name === 'write' || name === 'edit' || name === 'grep' || name === 'find' || name === 'ls') {
    if (path) return `${label} "${shortPath(path)}"`
    if (q) return `${label} "${quote(q)}"`
    return label
  }
  if (status === 'error') return `${label}${toolFailSuffix(locale)}`
  if (obj && q) return `${label} "${quote(q)}"`
  if (detail && !obj && detail.length < 80 && !detail.startsWith('{')) {
    return `${label} · ${detail}`
  }
  return label
}

function toolIcon(name: string): ReactNode {
  const cls = 'tool-call-chip-icon'
  if (name === 'smart_search') return <Globe className={cls} size={14} aria-hidden />
  if (name === 'world_time') return <Clock className={cls} size={14} aria-hidden />
  if (name.startsWith('lorebook') || name === 'codex_write') return <BookOpen className={cls} size={14} aria-hidden />
  if (name.startsWith('memory')) return <MemoryStick className={cls} size={14} aria-hidden />
  if (name.startsWith('world_state')) return <NotebookPen className={cls} size={14} aria-hidden />
  if (name.startsWith('panel_')) return <PanelRight className={cls} size={14} aria-hidden />
  if (name === 'grep' || name === 'find' || name === 'read') return <FileSearch className={cls} size={14} aria-hidden />
  if (name === 'bash' || name === 'write' || name === 'edit') return <Settings2 className={cls} size={14} aria-hidden />
  if (name === 'ask_director') return <Search className={cls} size={14} aria-hidden />
  return <Wrench className={cls} size={14} aria-hidden />
}

export function coalesceActivities(
  list: WireActivity[],
  locale: ToolLabelLocale = 'zh',
): ToolCallChipItem[] {
  const out: ToolCallChipItem[] = []
  // 同名工具可并行多次：用栈配对 start/end，避免误合并或残留 running 双行
  const openStacks = new Map<string, number[]>()

  for (let i = 0; i < list.length; i++) {
    const a = list[i]!
    const name = a.name || ''
    if (a.kind === 'tool_start') {
      const id = `run-${name}-${i}`
      const stack = openStacks.get(name) ?? []
      stack.push(out.length)
      openStacks.set(name, stack)
      out.push({
        id,
        name,
        status: 'running',
        detail: a.detail,
        query: a.query,
        title: a.query
          ? `${toolDisplayName(name, locale)} "${a.query.length > 48 ? `${a.query.slice(0, 48)}…` : a.query}"`
          : toolCallTitle(name, a.detail, 'running', locale),
      })
      continue
    }
    if (a.kind === 'tool_end') {
      const stack = openStacks.get(name)
      const idx = stack?.pop()
      if (stack && stack.length === 0) openStacks.delete(name)
      if (idx != null) {
        const prev = out[idx]!
        const status = a.isError ? 'error' : 'done'
        // 标题优先用 start 参数；detail 优先 end 结果（可展开）
        out[idx] = {
          ...prev,
          status,
          detail: a.detail || prev.detail,
          title: prev.query
            ? `${toolDisplayName(name, locale)} "${prev.query.length > 48 ? `${prev.query.slice(0, 48)}…` : prev.query}"`
            : toolCallTitle(name, prev.detail || a.detail, status, locale),
        }
      } else {
        const status = a.isError ? 'error' : 'done'
        out.push({
          id: `end-${name}-${i}`,
          name,
          status,
          detail: a.detail,
          title: toolCallTitle(name, a.detail, status, locale),
        })
      }
      continue
    }
    out.push({
      id: `note-${i}`,
      name: name || 'note',
      status: a.isError ? 'error' : 'note',
      detail: a.detail,
      title: toolCallTitle(name || 'note', a.detail, a.isError ? 'error' : 'note', locale),
    })
  }
  return out
}

function StatusIcon({ status }: { status: ToolCallChipItem['status'] }) {
  if (status === 'running') return <Loader2 className="tool-call-status is-spin" size={14} aria-hidden />
  if (status === 'error') return <AlertTriangle className="tool-call-status is-error" size={14} aria-hidden />
  if (status === 'done') return <CheckCircle2 className="tool-call-status is-ok" size={14} aria-hidden />
  return <Wrench className="tool-call-status" size={14} aria-hidden />
}

function formatDetailBody(detail?: string): string {
  if (!detail) return ''
  const obj = parseDetailObject(detail)
  if (obj) {
    try {
      return JSON.stringify(obj, null, 2)
    } catch {
      return detail
    }
  }
  return detail
}

export function ToolCallChip({ item, defaultOpen = false }: { item: ToolCallChipItem; defaultOpen?: boolean }) {
  const { i18n } = useTranslation()
  const locale: ToolLabelLocale = i18n.language?.startsWith('en') ? 'en' : 'zh'
  const body = useMemo(() => formatDetailBody(item.detail), [item.detail])
  const expandable = Boolean(body && body.length > 0 && item.status !== 'running')
  const [open, setOpen] = useState(defaultOpen)
  const title = item.title || toolDisplayName(item.name, locale)

  if (!expandable) {
    return (
      <div
        className={`tool-call-chip status-${item.status}`}
        role="status"
        aria-busy={item.status === 'running'}
      >
        <StatusIcon status={item.status} />
        {toolIcon(item.name)}
        <span className="tool-call-chip-title">{title}</span>
      </div>
    )
  }

  return (
    <div className={`tool-call-chip-wrap status-${item.status}`}>
      <button
        type="button"
        className={`tool-call-chip is-expandable status-${item.status}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <StatusIcon status={item.status} />
        {toolIcon(item.name)}
        <span className="tool-call-chip-title">{title}</span>
        <span className="tool-call-chip-chevron" aria-hidden>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {open ? (
        <div className="tool-call-chip-detail">
          <pre>{body}</pre>
        </div>
      ) : null}
    </div>
  )
}

export function ToolCallList({
  items,
  label,
  max,
}: {
  items: ToolCallChipItem[]
  label?: string
  max?: number
}) {
  const list = max && items.length > max ? items.slice(-max) : items
  if (!list.length) return null
  return (
    <div className="tool-call-list" role="status" aria-live="polite">
      {label ? <div className="tool-call-list-label">{label}</div> : null}
      {list.map((item) => (
        <ToolCallChip key={item.id} item={item} />
      ))}
    </div>
  )
}

/** 按当前语言合并活动列表（Chat 页使用） */
export function useCoalesceActivities(list: WireActivity[] | undefined | null, max?: number): ToolCallChipItem[] {
  const { i18n } = useTranslation()
  const locale: ToolLabelLocale = i18n.language?.startsWith('en') ? 'en' : 'zh'
  return useMemo(() => {
    const items = coalesceActivities(list ?? [], locale)
    return max && items.length > max ? items.slice(-max) : items
  }, [list, locale, max])
}
