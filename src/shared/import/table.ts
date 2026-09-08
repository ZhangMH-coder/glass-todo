/**
 * 表格解析：把 CSV / XLSX 的二维数据映射为候选待办。
 * 通过表头语义识别列，支持中英双语列名。
 */
import type { Priority, Status } from '../types'

export type ColumnKind =
  | 'title'
  | 'notes'
  | 'due'
  | 'priority'
  | 'status'
  | 'tags'
  | 'assignee'
  | 'ignore'

const HEADER_PATTERNS: Array<{ kind: ColumnKind; re: RegExp }> = [
  { kind: 'title', re: /^(标题|任务|事项|待办|内容|名称|title|task|todo|item|name|subject)$/i },
  { kind: 'notes', re: /^(备注|说明|描述|详情|notes?|desc(ription)?|detail|remark|comment)$/i },
  { kind: 'due', re: /^(截止|截止日期|截止时间|到期|期限|deadline|due|due ?date|date)$/i },
  { kind: 'priority', re: /^(优先级|优先|重要程度|priority|prio|importance|level)$/i },
  { kind: 'status', re: /^(状态|进度|完成|是否完成|status|state|progress|done|completed)$/i },
  { kind: 'tags', re: /^(标签|分类|类别|tags?|label|category|categories)$/i },
  { kind: 'assignee', re: /^(负责人|负责|指派|执行人|owner|assignee|responsible|who)$/i }
]

function normalizeHeader(value: string): string {
  return value
    .replace(/[\s_\-]+/g, ' ')
    .replace(/[:：*]/g, '')
    .trim()
}

export function classifyHeader(value: string): ColumnKind {
  const normalized = normalizeHeader(value)
  if (normalized.length === 0) return 'ignore'
  for (const p of HEADER_PATTERNS) {
    if (p.re.test(normalized)) return p.kind
  }
  return 'ignore'
}

/** 表头行必须能识别出标题列，否则视为无表头的普通数据 */
export function detectHeader(row: string[]): ColumnKind[] | undefined {
  const kinds = row.map(classifyHeader)
  return kinds.includes('title') ? kinds : undefined
}

export function parsePriorityCell(value: string): Priority | undefined {
  const v = value.trim().toLowerCase()
  if (v.length === 0) return undefined
  if (/^(p0|0|紧急|加急|最高|urgent|critical|highest)$/.test(v)) return 'urgent'
  if (/^(p1|1|高|重要|high)$/.test(v)) return 'high'
  if (/^(p2|2|中|普通|一般|normal|medium|med)$/.test(v)) return 'normal'
  if (/^(p3|3|低|不急|low|lowest|minor)$/.test(v)) return 'low'
  if (/^!{3,}$/.test(v)) return 'urgent'
  if (/^!{2}$/.test(v)) return 'high'
  if (/^!$/.test(v)) return 'low'
  return undefined
}

export function parseStatusCell(value: string): Status | undefined {
  const v = value.trim().toLowerCase()
  if (v.length === 0) return undefined
  if (/^(done|完成|已完成|已办|结束|closed|finished|yes|y|true|1|✓|√|x)$/.test(v)) return 'done'
  if (/^(doing|进行中|处理中|在办|in ?progress|wip|started)$/.test(v)) return 'doing'
  if (/^(todo|待办|未开始|未完成|待处理|open|pending|no|n|false|0)$/.test(v)) return 'todo'
  return undefined
}

export function parseTagsCell(value: string): string[] {
  return value
    .split(/[,，;；|/、\s]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter((t) => t.length > 0 && t.length <= 24)
}

/**
 * CSV / TSV 解析。支持双引号包裹、字段内换行、`""` 转义。
 * 分隔符缺省时按首行出现频次在 , ; \t 之间自动判定。
 */
export function parseDelimitedText(text: string, delimiter?: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const sep = delimiter ?? guessDelimiter(source)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]

    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === sep) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c.length > 0))
}

function guessDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts: Array<[string, number]> = [
    [',', (firstLine.match(/,/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length]
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}
