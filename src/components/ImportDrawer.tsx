/**
 * 导入预览抽屉。
 * 导入不直接写库：先在此确认，可逐条勾选、就地编辑、批量设优先级与目标清单。
 * 这是防垃圾数据与防误覆盖的关键一层。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PRIORITY_LABEL,
  type CandidateTask,
  type ImportAnalysis,
  type Priority,
  type TodoList
} from '@shared/types'
import { formatDue, PRIORITY_SHORT, truncate } from '../utils'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface Props {
  analysis: ImportAnalysis
  lists: TodoList[]
  defaultListId: string
  committing: boolean
  onCancel: () => void
  onCommit: (listId: string, candidates: CandidateTask[]) => void
}

const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low']

export default function ImportDrawer({
  analysis,
  lists,
  defaultListId,
  committing,
  onCancel,
  onCommit
}: Props): React.JSX.Element {
  const [items, setItems] = useState<CandidateTask[]>(analysis.candidates)
  const [listId, setListId] = useState(defaultListId)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => setItems(analysis.candidates), [analysis])

  // 焦点陷阱：Tab 在面板内循环，卸载时焦点还给触发按钮
  useFocusTrap(panelRef, true)

  // 打开时把焦点移入抽屉，Esc 关闭
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const selectedCount = useMemo(() => items.filter((i) => i.selected).length, [items])

  const patch = (tempId: string, next: Partial<CandidateTask>): void => {
    setItems((prev) => prev.map((i) => (i.tempId === tempId ? { ...i, ...next } : i)))
  }

  const setAll = (selected: boolean): void => {
    setItems((prev) => prev.map((i) => ({ ...i, selected })))
  }

  const selectOnlyNew = (): void => {
    setItems((prev) => prev.map((i) => ({ ...i, selected: i.dedupe === 'new' })))
  }

  const applyPriority = (priority: Priority): void => {
    setItems((prev) => prev.map((i) => (i.selected ? { ...i, priority } : i)))
  }

  return (
    <div
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="drawer__panel" ref={panelRef} tabIndex={-1}>
        <div className="drawer__head">
          <div>
            <h2 className="drawer__title" id="import-title">
              导入预览 · {truncate(analysis.fileName, 40)}
            </h2>
            <p className="drawer__sub">
              扫描 {analysis.stats.totalLines} 行，识别 {analysis.stats.matched} 条
              {analysis.stats.duplicates > 0 ? `，其中 ${analysis.stats.duplicates} 条疑似重复` : ''}
              　·　确认后才会写入
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            style={{ marginLeft: 'auto' }}
            onClick={onCancel}
            aria-label="关闭导入预览"
          >
            ✕
          </button>
        </div>

        <div className="drawer__toolbar">
          <button type="button" className="btn btn--sm" onClick={() => setAll(true)}>
            全选
          </button>
          <button type="button" className="btn btn--sm" onClick={() => setAll(false)}>
            全不选
          </button>
          <button type="button" className="btn btn--sm" onClick={selectOnlyNew}>
            仅选新增项
          </button>

          <div className="drawer__toolbar-group">
            <label htmlFor="import-list">导入到</label>
            <select
              id="import-list"
              className="field"
              value={listId}
              onChange={(e) => setListId(e.target.value)}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="drawer__toolbar-group">
            <label htmlFor="import-priority">批量优先级</label>
            <select
              id="import-priority"
              className="field"
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value as Priority | ''
                if (v !== '') applyPriority(v)
                e.currentTarget.value = ''
              }}
            >
              <option value="">应用到已选…</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_SHORT[p]} {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="drawer__body">
          {analysis.warnings.length > 0 ? (
            <ul className="warnings">
              {analysis.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}

          {items.length === 0 ? (
            <div className="empty">
              <div className="empty__icon" aria-hidden="true">
                ∅
              </div>
              <div className="empty__title">没有识别到待办事项</div>
              <p className="empty__hint">
                试试使用 Markdown 复选框（- [ ] 任务）、列表项，
                <br />
                或带「任务 / 截止 / 优先级」表头的表格。
              </p>
            </div>
          ) : (
            <ul className="cand__list" role="list">
              {items.map((c) => {
                const due = c.due ? formatDue(c.due) : undefined
                const cls = [
                  'cand',
                  c.dedupe === 'duplicate' ? 'cand--dup' : '',
                  c.selected ? '' : 'cand--off'
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <li key={c.tempId} className={cls} style={{ paddingLeft: 11 + c.depth * 18 }}>
                    <input
                      type="checkbox"
                      className="cand__check"
                      checked={c.selected}
                      onChange={(e) => patch(c.tempId, { selected: e.target.checked })}
                      aria-label={`导入「${c.title}」`}
                    />
                    <div className="cand__body">
                      <input
                        className="cand__input"
                        value={c.title}
                        maxLength={200}
                        aria-label="编辑待办标题"
                        onChange={(e) => patch(c.tempId, { title: e.target.value })}
                      />
                      <div className="cand__meta">
                        {c.dedupe === 'duplicate' ? (
                          <span
                            className="chip chip--overdue"
                            title={`与已有待办「${c.duplicateOf ?? ''}」重复`}
                          >
                            重复
                          </span>
                        ) : null}
                        {c.status === 'done' ? <span className="chip">已完成</span> : null}
                        {c.priority !== 'normal' ? (
                          <span className={`chip chip--p-${c.priority}`}>
                            {PRIORITY_SHORT[c.priority]}
                          </span>
                        ) : null}
                        {due ? <span className="chip chip--due">⏱ {due.text}</span> : null}
                        {c.assignee ? <span className="chip">@{c.assignee}</span> : null}
                        {c.tags.map((t) => (
                          <span key={t} className="chip chip--tag">
                            #{t}
                          </span>
                        ))}
                        <span className="chip chip--source">
                          {c.rule}
                          {c.line ? ` · 第 ${c.line} 行` : ''}
                        </span>
                        <span className="conf">
                          <span className="conf__bar">
                            <span
                              className="conf__fill"
                              style={{ width: `${Math.round(c.confidence * 100)}%` }}
                            />
                          </span>
                          {Math.round(c.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="drawer__foot">
          <span className="drawer__foot-info">
            已选 {selectedCount} / {items.length} 条
          </span>
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={selectedCount === 0 || committing}
            onClick={() => onCommit(listId, items)}
          >
            {committing ? '导入中…' : `导入 ${selectedCount} 条`}
          </button>
        </div>
      </div>
    </div>
  )
}
