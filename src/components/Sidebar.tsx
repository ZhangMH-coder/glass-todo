import { useState } from 'react'
import { INBOX_LIST_ID, type Task, type TodoList } from '@shared/types'
import type { ViewKey } from '../store/useAppStore'
import { isOverdue, todayIso } from '../utils'

interface Props {
  lists: TodoList[]
  tasks: Task[]
  view: ViewKey
  onViewChange: (view: ViewKey) => void
  onAddList: (name: string) => void
  onRemoveList: (id: string) => void
  onRevealStore: () => void
}

function countFor(tasks: Task[], view: ViewKey): number {
  const today = todayIso()
  switch (view) {
    case 'inbox':
      return tasks.filter((t) => t.status !== 'done').length
    case 'today':
      return tasks.filter((t) => t.status !== 'done' && (t.due === today || isOverdue(t))).length
    case 'upcoming':
      return tasks.filter((t) => t.status !== 'done' && t.due !== undefined && t.due > today).length
    case 'done':
      return tasks.filter((t) => t.status === 'done').length
    default:
      return tasks.filter((t) => t.status !== 'done' && `list:${t.listId}` === view).length
  }
}

const FIXED: Array<{ key: ViewKey; icon: string; label: string }> = [
  { key: 'inbox', icon: '◉', label: '全部待办' },
  { key: 'today', icon: '★', label: '今天' },
  { key: 'upcoming', icon: '⏱', label: '即将到来' },
  { key: 'done', icon: '✓', label: '已完成' }
]

export default function Sidebar({
  lists,
  tasks,
  view,
  onViewChange,
  onAddList,
  onRemoveList,
  onRevealStore
}: Props): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const submit = (): void => {
    const name = draft.trim()
    if (name.length > 0) onAddList(name)
    setDraft('')
    setAdding(false)
  }

  return (
    <nav className="sidebar" aria-label="清单与视图">
      <div className="sidebar__scroll">
        <h2 className="sidebar__label">视图</h2>
        {FIXED.map((item) => (
          <button
            key={item.key}
            type="button"
            className="nav-item"
            aria-current={view === item.key}
            onClick={() => onViewChange(item.key)}
          >
            <span className="nav-item__icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="nav-item__text">{item.label}</span>
            <span className="nav-item__count">{countFor(tasks, item.key)}</span>
          </button>
        ))}

        <h2 className="sidebar__label">清单</h2>
        {lists.map((list) => {
          const key: ViewKey = `list:${list.id}`
          return (
            <button
              key={list.id}
              type="button"
              className="nav-item"
              aria-current={view === key}
              onClick={() => onViewChange(key)}
              onDoubleClick={() => {
                if (list.id !== INBOX_LIST_ID) onRemoveList(list.id)
              }}
              title={
                list.id === INBOX_LIST_ID
                  ? '默认清单，不可删除'
                  : '双击删除清单（其中的待办会移回收件箱）'
              }
            >
              <span className="dot" style={{ background: list.color, color: list.color }} />
              <span className="nav-item__text">{list.name}</span>
              <span className="nav-item__count">{countFor(tasks, key)}</span>
            </button>
          )
        })}

        {adding ? (
          <input
            className="field"
            autoFocus
            value={draft}
            maxLength={40}
            placeholder="清单名称，回车确认"
            aria-label="新清单名称"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') {
                setDraft('')
                setAdding(false)
              }
            }}
          />
        ) : (
          <button type="button" className="nav-item" onClick={() => setAdding(true)}>
            <span className="nav-item__icon" aria-hidden="true">
              ＋
            </span>
            <span className="nav-item__text">新建清单</span>
          </button>
        )}
      </div>

      <div className="sidebar__footer">
        <button type="button" className="nav-item" onClick={onRevealStore}>
          <span className="nav-item__icon" aria-hidden="true">
            🗀
          </span>
          <span className="nav-item__text">数据文件位置</span>
        </button>
      </div>
    </nav>
  )
}
