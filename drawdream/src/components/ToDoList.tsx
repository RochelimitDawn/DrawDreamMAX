import type { AssistantTodoItem } from '../agent/wire.types'
import './ToDoList.css'

/** 子任务清单（Plan 模式）：由模型 todo_write 维护，前端只读展示。
 *  动效参考 Uiverse checklist（打勾/删除线/完成烟花），配色融合 DrawDream 暖金主题。 */
export function ToDoList({ todos }: { todos: AssistantTodoItem[] }) {
  if (!todos.length) return null
  const done = todos.filter((t) => t.status === 'done').length
  return (
    <div className="asst-todos" id="checklist">
      <div className="asst-todos-head">
        <span className="asst-todos-title">任务清单</span>
        <span className="asst-todos-count">
          {done}/{todos.length}
        </span>
      </div>
      <div className="asst-todos-body">
        {todos.map((t, i) => {
          const checked = t.status === 'done'
          const active = t.status === 'in_progress'
          const cancelled = t.status === 'cancelled'
          return (
            <label
              key={`${i}-${t.text.slice(0, 12)}`}
              className={`asst-todo-item${active ? ' is-active' : ''}${cancelled ? ' is-cancelled' : ''}`}
            >
              <input type="checkbox" checked={checked} readOnly tabIndex={-1} />
              <span className="asst-todo-text">{t.text}</span>
              {active ? <span className="asst-todo-state is-active">进行中</span> : null}
              {cancelled ? <span className="asst-todo-state is-cancelled">已取消</span> : null}
            </label>
          )
        })}
      </div>
    </div>
  )
}
