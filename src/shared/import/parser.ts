/**
 * 解析层：把提取出的中间表示（RawDocument）转成候选待办。
 * 纯规则、离线、零 AI 依赖；纯函数，可直接单测。
 */
import type { CandidateTask, Priority, RawDocument, Status } from '../types'
import { enrich } from './enricher'
import {
  detectHeader,
  parsePriorityCell,
  parseStatusCell,
  parseTagsCell,
  type ColumnKind
} from './table'

/** 单条待办标题的长度上限，超出部分转入备注 */
const TITLE_MAX = 160
/** 兜底策略下，短于该长度的行不视为待办 */
const MIN_TITLE_LEN = 2

interface Matched {
  raw: string
  line: number
  depth: number
  rule: string
  confidence: number
  status?: Status
  priority?: Priority
}

/* ---------------- 行级规则 ---------------- */

const RE_CHECKBOX = /^[-*+]?\s*\[([ xX✓√])\]\s*(.+)$/
const RE_BULLET = /^([-*+]|[•·▪▫◦‣⁃])\s+(.+)$/
const RE_ORDERED = /^(\d{1,3}[.)、]|[（(]\d{1,3}[)）])\s*(.+)$/
const RE_CN_ORDERED =
  /^([一二三四五六七八九十]{1,3}[、.)]|[（(][一二三四五六七八九十]{1,3}[)）])\s*(.+)$/
const RE_KEYWORD_TAGGED =
  /^(?:.*?\b)?(TODO|FIXME|XXX|HACK|TASK|待办|待处理|待完成|需要|任务)\s*[:：\-—]\s*(.+)$/i
const RE_KEYWORD_LOOSE = /(TODO|FIXME|待办|待处理|需要完成|需完成)/i
const RE_HEADING = /^#{1,6}\s+/
const RE_SEPARATOR = /^\s*([-=*_~·—]{3,}|\|[\s|:-]*\|)\s*$/
const RE_TABLE_ROW = /^\s*\|.*\|\s*$/
const RE_FENCE = /^\s*(```|~~~)/

function indentWidth(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 4
    else break
  }
  return width
}

/** 把离散的缩进宽度归一为 0,1,2… 层级 */
function normalizeDepths(widths: number[]): number[] {
  const unique = [...new Set(widths)].sort((a, b) => a - b)
  const rank = new Map(unique.map((w, i) => [w, i]))
  return widths.map((w) => Math.min(rank.get(w) ?? 0, 4))
}

function statusFromCheckbox(mark: string): Status {
  return mark === ' ' ? 'todo' : 'done'
}

/** 扫描所有行，返回命中结构化规则的行；同时统计兜底候选 */
function scanLines(lines: string[]): { structured: Matched[]; plain: Matched[] } {
  const structured: Matched[] = []
  const plain: Matched[] = []
  let inFence = false

  lines.forEach((line, idx) => {
    if (RE_FENCE.test(line)) {
      inFence = !inFence
      return
    }
    if (inFence) return

    const trimmedEnd = line.replace(/\s+$/, '')
    const body = trimmedEnd.trim()
    if (body.length === 0) return
    if (RE_SEPARATOR.test(body) || RE_TABLE_ROW.test(body)) return

    const depthWidth = indentWidth(trimmedEnd)
    const lineNo = idx + 1

    const checkbox = RE_CHECKBOX.exec(body)
    if (checkbox) {
      structured.push({
        raw: checkbox[2],
        line: lineNo,
        depth: depthWidth,
        rule: 'markdown 复选框',
        confidence: 0.98,
        status: statusFromCheckbox(checkbox[1])
      })
      return
    }

    if (RE_HEADING.test(body)) return

    const keyword = RE_KEYWORD_TAGGED.exec(body)
    if (keyword) {
      structured.push({
        raw: keyword[2],
        line: lineNo,
        depth: depthWidth,
        rule: `关键字 ${keyword[1].toUpperCase()}`,
        confidence: 0.85
      })
      return
    }

    const bullet = RE_BULLET.exec(body)
    if (bullet) {
      structured.push({
        raw: bullet[2],
        line: lineNo,
        depth: depthWidth,
        rule: '列表项',
        confidence: 0.8
      })
      return
    }

    const ordered = RE_ORDERED.exec(body) ?? RE_CN_ORDERED.exec(body)
    if (ordered) {
      structured.push({
        raw: ordered[2],
        line: lineNo,
        depth: depthWidth,
        rule: '有序列表',
        confidence: 0.8
      })
      return
    }

    if (RE_KEYWORD_LOOSE.test(body)) {
      structured.push({
        raw: body,
        line: lineNo,
        depth: depthWidth,
        rule: '关键字行',
        confidence: 0.7
      })
      return
    }

    if (body.length >= MIN_TITLE_LEN) {
      plain.push({
        raw: body,
        line: lineNo,
        depth: depthWidth,
        rule: '整行',
        confidence: 0.4
      })
    }
  })

  return { structured, plain }
}

/* ---------------- 候选构造 ---------------- */

function splitTitle(raw: string): { title: string; notes?: string } {
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (clean.length <= TITLE_MAX) return { title: clean }
  const cut = clean.lastIndexOf(' ', TITLE_MAX)
  const at = cut > TITLE_MAX * 0.6 ? cut : TITLE_MAX
  return { title: clean.slice(0, at).trim(), notes: clean.slice(at).trim() }
}

function toCandidates(matches: Matched[], now: Date): CandidateTask[] {
  const depths = normalizeDepths(matches.map((m) => m.depth))
  const stack: Array<{ depth: number; tempId: string }> = []
  const out: CandidateTask[] = []

  matches.forEach((m, i) => {
    const depth = depths[i]
    const meta = enrich(m.raw, now)
    const { title, notes } = splitTitle(meta.title)
    if (title.length === 0) return

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack[stack.length - 1]
    const tempId = `c${i}_${m.line}`

    out.push({
      tempId,
      title,
      notes,
      status: m.status ?? 'todo',
      priority: m.priority ?? meta.priority ?? 'normal',
      due: meta.due,
      tags: meta.tags,
      assignee: meta.assignee,
      depth,
      parentTempId: parent?.tempId,
      line: m.line,
      rule: m.rule,
      confidence: m.confidence,
      dedupe: 'new',
      selected: true
    })

    stack.push({ depth, tempId })
  })

  return out
}

/* ---------------- 表格策略 ---------------- */

function parseTable(rows: string[][], now: Date): CandidateTask[] | undefined {
  if (rows.length < 2) return undefined
  const kinds = detectHeader(rows[0])
  if (!kinds) return undefined

  const indexOf = (kind: ColumnKind): number => kinds.indexOf(kind)
  const titleIdx = indexOf('title')
  const cell = (row: string[], idx: number): string => (idx >= 0 ? (row[idx] ?? '').trim() : '')

  const out: CandidateTask[] = []
  rows.slice(1).forEach((row, i) => {
    const rawTitle = cell(row, titleIdx)
    if (rawTitle.length === 0) return

    const meta = enrich(rawTitle, now)
    const dueCell = cell(row, indexOf('due'))
    const { title, notes } = splitTitle(meta.title)
    if (title.length === 0) return

    const notesCell = cell(row, indexOf('notes'))
    const tagsCell = cell(row, indexOf('tags'))
    const assigneeCell = cell(row, indexOf('assignee'))
    const mergedNotes = [notesCell, notes].filter((s) => s && s.length > 0).join(' / ')

    out.push({
      tempId: `t${i}`,
      title,
      notes: mergedNotes.length > 0 ? mergedNotes : undefined,
      status: parseStatusCell(cell(row, indexOf('status'))) ?? 'todo',
      priority: parsePriorityCell(cell(row, indexOf('priority'))) ?? meta.priority ?? 'normal',
      due: (dueCell.length > 0 ? enrich(dueCell, now).due : undefined) ?? meta.due,
      tags: tagsCell.length > 0 ? parseTagsCell(tagsCell) : meta.tags,
      assignee: assigneeCell.length > 0 ? assigneeCell : meta.assignee,
      depth: 0,
      line: i + 2,
      rule: '表格列映射',
      confidence: 0.95,
      dedupe: 'new',
      selected: true
    })
  })

  return out.length > 0 ? out : undefined
}

/* ---------------- 入口 ---------------- */

/**
 * @param doc 提取层输出
 * @param now 基准日期（注入以便测试）
 */
export function parseDocument(doc: RawDocument, now: Date = new Date()): CandidateTask[] {
  if (doc.tableRows && doc.tableRows.length > 0) {
    const fromTable = parseTable(doc.tableRows, now)
    if (fromTable) return fromTable
  }

  const { structured, plain } = scanLines(doc.lines)
  // 有结构化命中就只用结构化结果，避免把说明性文字一起吞进来
  if (structured.length > 0) return toCandidates(structured, now)
  return toCandidates(plain, now)
}
