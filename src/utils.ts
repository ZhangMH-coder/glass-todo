/** 渲染层通用工具 */
import type { Priority, Task } from '@shared/types'

export function todayIso(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function addDaysIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 相对化日期显示：今天 / 明天 / 逾期 N 天 / 09-12 周五 */
export function formatDue(iso: string): { text: string; kind: 'overdue' | 'today' | 'future' } {
  const today = todayIso()
  if (iso === today) return { text: '今天', kind: 'today' }
  if (iso === addDaysIso(1)) return { text: '明天', kind: 'future' }
  if (iso === addDaysIso(-1)) return { text: '昨天（逾期）', kind: 'overdue' }

  const target = new Date(`${iso}T00:00:00`)
  const base = new Date(`${today}T00:00:00`)
  const diff = Math.round((target.getTime() - base.getTime()) / 86_400_000)
  const label = `${iso.slice(5)} ${WEEKDAY[target.getDay()]}`

  if (diff < 0) return { text: `逾期 ${-diff} 天`, kind: 'overdue' }
  if (diff <= 7) return { text: label, kind: 'future' }
  return { text: label, kind: 'future' }
}

export function isOverdue(task: Task): boolean {
  return task.status !== 'done' && task.due !== undefined && task.due < todayIso()
}

export const PRIORITY_SHORT: Record<Priority, string> = {
  urgent: 'P0',
  high: 'P1',
  normal: 'P2',
  low: 'P3'
}

/** 截断长文本用于展示 */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
