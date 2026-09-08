import { useEffect, useRef, useState } from 'react'
import { PRIORITY_LABEL, type Task } from '@shared/types'
import { formatDue, isOverdue, PRIORITY_SHORT, truncate } from '../utils'

interface Props {
  task: Task
  isChild: boolean
  onToggle: (id: string) => void
  onRename: (id: string, title: string) => void
  onCyclePriority: (id: string) => void
  onRemove: (id: string) => void
}

export default function TaskItem({
  task,
  isChild,
  onToggle,
  onRename,
  onCyclePriority,
  onRemove
}: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = (): void => {
    const clean = draft.trim()
    if (clean.length > 0 && clean !== task.title) onRename(task.id, clean)
    else setDraft(task.title)
    setEditing(false)
  }

  const due = task.due ? formatDue(task.due) : undefined
  const dueClass = isOverdue(task)
    ? 'chip chip--overdue'
    : due?.kind === 'today'
      ? 'chip chip--today'
      : 'chip chip--due'

  const classes = [
    'task',
    `task--${task.priority}`,
    task.status === 'done' ? 'task--done' : '',
    isChild ? 'task--child' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li className={classes}>
      <input
        type="checkbox"
        className="task__check"
        checked={task.status === 'done'}
        onChange={() => onToggle(task.id)}
        aria-label={`标记「${task.title}」为${task.status === 'done' ? '未完成' : '已完成'}`}
      />

      <div className="task__body">
        {editing ? (
          <input
            ref={inputRef}
            className="task__title-input"
            value={draft}
            maxLength={200}
            aria-label="编辑待办标题"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(task.title)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span
            className="task__title"
            role="button"
            tabIndex={0}
            onClick={() => setEditing(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setEditing(true)
              }
            }}
            title="点击编辑"
          >
            {task.title}
          </span>
        )}

        {task.notes ? <p className="task__notes">{truncate(task.notes, 220)}</p> : null}

        <div className="task__meta">
          {task.priority !== 'normal' ? (
            <span className={`chip chip--p-${task.priority}`}>
              {PRIORITY_SHORT[task.priority]} {PRIORITY_LABEL[task.priority]}
            </span>
          ) : null}

          {due ? <span className={dueClass}>⏱ {due.text}</span> : null}

          {task.assignee ? <span className="chip">@{task.assignee}</span> : null}

          {task.tags.map((tag) => (
            <span key={tag} className="chip chip--tag">
              #{tag}
            </span>
          ))}

          {task.source ? (
            <span
              className="chip chip--source"
              title={`导入自 ${task.source.fileName}${
                task.source.line ? ` 第 ${task.source.line} 行` : ''
              }`}
            >
              来自 {truncate(task.source.fileName, 22)}
              {task.source.line ? `:${task.source.line}` : ''}
            </span>
          ) : null}
        </div>
      </div>

      <div className="task__actions">
        <button
          type="button"
          className="icon-btn"
          onClick={() => onCyclePriority(task.id)}
          aria-label={`切换优先级，当前为${PRIORITY_LABEL[task.priority]}`}
          title="切换优先级"
        >
          ⚑
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onRemove(task.id)}
          aria-label={`删除「${task.title}」`}
          title="删除"
        >
          ✕
        </button>
      </div>
    </li>
  )
}
