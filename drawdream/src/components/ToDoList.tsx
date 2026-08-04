import { useState } from 'react'
import type { AssistantTodoItem } from '../agent/wire.types'
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
            ▸
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
