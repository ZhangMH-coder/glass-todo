import type { Task } from '@shared/types'
import TaskItem from './TaskItem'

interface Props {
  tasks: Task[]
  onToggle: (id: string) => void
  onRename: (id: string, title: string) => void
  onCyclePriority: (id: string) => void
  onRemove: (id: string) => void
  emptyTitle: string
  emptyHint: React.ReactNode
}

export default function TaskList({
  tasks,
  onToggle,
  onRename,
  onCyclePriority,
  onRemove,
  emptyTitle,
  emptyHint
}: Props): React.JSX.Element {
  if (tasks.length === 0) {
    return (
      <div className="empty">
        <div className="empty__icon" aria-hidden="true">
          ◌
        </div>
        <div className="empty__title">{emptyTitle}</div>
        <p className="empty__hint">{emptyHint}</p>
      </div>
    )
  }

  const ids = new Set(tasks.map((t) => t.id))

  return (
    <ul className="task-list" role="list">
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          // 父任务不在当前视图时按顶层展示，避免出现悬空缩进
          isChild={task.parentId !== undefined && ids.has(task.parentId)}
          onToggle={onToggle}
          onRename={onRename}
          onCyclePriority={onCyclePriority}
          onRemove={onRemove}
        />
      ))}
    </ul>
  )
}
