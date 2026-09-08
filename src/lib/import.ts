/**
 * S0 前端导入链路：读文件文本 → 复用 TS 解析层（parser/dedupe）→ 候选转 Task。
 * 表格/二进制文件（docx/xlsx/pdf）解析在 S1 由 Rust crate 承接；S0 先走纯文本。
 */
import type {
  CandidateTask,
  ImportAnalysis,
  RawDocument,
  Task
} from '@shared/types'
import { markDuplicates } from '@shared/import/dedupe'
import { parseDocument } from '@shared/import/parser'

export function analyzeText(text: string, fileName: string, existing: Task[]): ImportAnalysis {
  const lines = text.split(/\r?\n/)
  const doc: RawDocument = { fileName, text, lines, warnings: [] }
  const candidates = parseDocument(doc)
  markDuplicates(candidates, existing)
  return {
    fileName,
    candidates,
    warnings: doc.warnings,
    stats: {
      totalLines: lines.length,
      matched: candidates.length,
      duplicates: candidates.filter((c) => c.dedupe === 'duplicate').length
    }
  }
}

/** 选中的候选 → Task（S0 前端生成，落库走 save_store 全量写回） */
export function candidatesToTasks(
  candidates: CandidateTask[],
  listId: string,
  existing: Task[]
): Task[] {
  const now = new Date().toISOString()
  const maxOrder = existing.reduce((m, t) => (t.order > m ? t.order : m), -1)
  const selected = candidates.filter((c) => c.dedupe !== 'duplicate' && c.selected !== false)
  // tempId → 新任务 id，父子引用在同一批次内闭环
  const idByTemp = new Map(selected.map((c) => [c.tempId, `task_${crypto.randomUUID()}`]))
  return selected.map((c, i) => ({
    id: idByTemp.get(c.tempId) ?? `task_${crypto.randomUUID()}`,
    title: c.title,
    notes: c.notes,
    status: c.status ?? 'todo',
    priority: c.priority ?? 'normal',
    due: c.due,
    tags: c.tags ?? [],
    assignee: c.assignee,
    parentId: c.parentTempId ? idByTemp.get(c.parentTempId) : undefined,
    listId,
    order: maxOrder + 1 + i,
    createdAt: now,
    updatedAt: now,
    completedAt: c.status === 'done' ? now : undefined
  }))
}
