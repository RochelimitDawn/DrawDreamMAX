import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AssistantSubagent, AssistantTodoItem } from '../agent/wire.types'
import './ToDoList.css'

/** 子任务清单（Plan 模式）：由模型 todo_write 维护，前端只读展示。
 *  动效参考 Uiverse checklist（打勾/删除线/完成烟花），配色融合 DrawDream 暖金主题。 */
export function ToDoList({ todos }: { todos: AssistantTodoItem[] }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!todos.length) return null
  const done = todos.filter((t) => t.status === 'done').length
  const active = todos.filter((t) => t.status === 'in_progress').length
  return (
    <div className={`asst-todos${collapsed ? ' is-collapsed' : ''}`} id="checklist">
      <div className="asst-todos-head">
        <button
          type="button"
          className="asst-todos-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开任务清单' : '折叠任务清单'}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className={`asst-todos-chevron${collapsed ? ' is-closed' : ''}`} aria-hidden>
            {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          </span>
        </button>
        <span className="asst-todos-title">任务清单</span>
        <span className="asst-todos-count">
          {done}/{todos.length}
          {active > 0 ? <span className="asst-todos-active">{active} 进行中</span> : null}
        </span>
      </div>
      {collapsed ? null : (
        <div className="asst-todos-body">
          {todos.map((t, i) => {
            const checked = t.status === 'done'
            const isActive = t.status === 'in_progress'
            const cancelled = t.status === 'cancelled'
            return (
              <label
                key={`${i}-${t.text.slice(0, 12)}`}
                className={`asst-todo-item${isActive ? ' is-active' : ''}${cancelled ? ' is-cancelled' : ''}`}
              >
                <input type="checkbox" checked={checked} readOnly tabIndex={-1} />
                <span className="asst-todo-text">{t.text}</span>
                {isActive ? <span className="asst-todo-state is-active">进行中</span> : null}
                {cancelled ? <span className="asst-todo-state is-cancelled">已取消</span> : null}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子拓展（子 agent）实时状态面板：复用 .asst-todos 视觉，与任务清单并列展示。

const SUBAGENT_STATUS_META: Record<AssistantSubagent['status'], { label: string; cls: string }> = {
  starting: { label: '启动中', cls: 'is-starting' },
  active: { label: '执行中', cls: 'is-active' },
  waiting: { label: '等待中', cls: 'is-waiting' },
  stalled: { label: '停滞', cls: 'is-stalled' },
  running: { label: '运行中', cls: 'is-running' },
  done: { label: '已完成', cls: 'is-done' },
  error: { label: '失败', cls: 'is-error' },
}

const SUBAGENT_TERMINAL = new Set<AssistantSubagent['status']>(['done', 'error'])

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** 子拓展实时状态面板：状态彩点 + 名称 + 任务 + 时长；已完成条目可展开查看结果。 */
export function SubagentList({ subagents }: { subagents: AssistantSubagent[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(() => Date.now())

  // 仅在有运行中子拓展时每秒刷新时长；全部结束即停表
  useEffect(() => {
    if (!subagents.some((s) => !SUBAGENT_TERMINAL.has(s.status))) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [subagents])

  if (!subagents.length) return null
  const running = subagents.filter((s) => !SUBAGENT_TERMINAL.has(s.status)).length

  return (
    <div className={`asst-todos asst-subagents${collapsed ? ' is-collapsed' : ''}`} id="subagents">
      <div className="asst-todos-head">
        <button
          type="button"
          className="asst-todos-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开子拓展' : '折叠子拓展'}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className={`asst-todos-chevron${collapsed ? ' is-closed' : ''}`} aria-hidden>
            {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          </span>
        </button>
        <span className="asst-todos-title">子拓展</span>
        <span className="asst-todos-count">
          {subagents.length} 个
          {running > 0 ? <span className="asst-todos-active">{running} 运行中</span> : null}
        </span>
      </div>
      {collapsed ? null : (
        <div className="asst-todos-body">
          {subagents.map((s) => {
            const meta = SUBAGENT_STATUS_META[s.status]
            const expandable = s.status === 'done' || s.status === 'error'
            const open = !!expanded[s.id]
            const body = s.status === 'error' ? s.error : s.result
            return (
              <div key={s.id} className={`asst-subagent-item status-${s.status}`}>
                <button
                  type="button"
                  className="asst-subagent-row"
                  disabled={!expandable}
                  aria-expanded={open}
                  title={expandable ? (open ? '收起结果' : '查看结果') : undefined}
                  onClick={() => setExpanded((p) => ({ ...p, [s.id]: !p[s.id] }))}
                >
                  <span className={`asst-subagent-dot ${meta.cls}`} aria-hidden />
                  <span className="asst-subagent-main">
                    <span className="asst-subagent-name">{s.name}</span>
                    <span className="asst-subagent-task">{s.task}</span>
                  </span>
                  <span className="asst-subagent-meta">
                    <span className={`asst-subagent-state ${meta.cls}`}>{meta.label}</span>
                    <span className="asst-subagent-time">{formatElapsed(now - s.startedAt)}</span>
                    {expandable ? (
                      <ChevronRight size={12} strokeWidth={2} className={`asst-subagent-chev${open ? ' is-open' : ''}`} />
                    ) : null}
                  </span>
                </button>
                {open && body ? (
                  <div className="asst-subagent-detail">
                    <pre>{body}</pre>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
