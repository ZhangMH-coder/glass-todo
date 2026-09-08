/**
 * 富化层：从标题文本中抽取元数据（日期 / 优先级 / 标签 / 负责人），
 * 并把已识别的片段从标题里剥离，避免标题残留噪声。
 *
 * 纯函数，不依赖 Node 或 DOM，可直接单测。
 */
import dayjs from 'dayjs'
import type { Priority } from '../types'

export interface Enrichment {
  title: string
  due?: string
  priority?: Priority
  tags: string[]
  assignee?: string
}

const ISO_DATE = 'YYYY-MM-DD'

/** 中文数字 → 阿拉伯数字（仅覆盖 1–12，用于月份/星期/天数） */
const CN_NUM: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12
}

interface Hit {
  start: number
  end: number
}

/** 记录命中区间，最后统一从标题剥离 */
class Slicer {
  private hits: Hit[] = []

  mark(start: number, end: number): void {
    if (end > start) this.hits.push({ start, end })
  }

  apply(text: string): string {
    if (this.hits.length === 0) return text.trim()
    const sorted = [...this.hits].sort((a, b) => b.start - a.start)
    let out = text
    for (const h of sorted) {
      out = out.slice(0, h.start) + ' ' + out.slice(h.end)
    }
    return out.replace(/\s{2,}/g, ' ').replace(/\s*[,，。;；]\s*$/, '').trim()
  }
}

/* ---------------- 优先级 ---------------- */

/**
 * 优先级判定顺序：叹号标记 > P 级标记 > 语义词。
 * 前两类是显式标记，会从标题剥离；语义词保留在标题中更自然。
 */

/** 叹号串：!!! 及以上=紧急，!!=高，!=低。要求两侧有边界，避免误吃 "Hello!world" */
const RE_BANG = /(?:^|[\s(（【[])([!！]{1,6})(?![^\s)）】\]])/
/** P0–P3 */
const RE_PLEVEL = /(?:^|[\s(（【[])[pP]([0-3])(?![0-9a-zA-Z])/

const SEMANTIC_RULES: Array<{ re: RegExp; value: Priority }> = [
  { re: /紧急|加急|立刻|马上|最高优先/, value: 'urgent' },
  { re: /\burgent\b|\bcritical\b|\bblocker\b/i, value: 'urgent' },
  { re: /低优先级|不急|有空|次要/, value: 'low' },
  { re: /\blow\b|\bminor\b|\bnice[- ]to[- ]have\b/i, value: 'low' },
  { re: /高优先级|重要|优先处理/, value: 'high' },
  { re: /\bhigh\b|\bimportant\b/i, value: 'high' },
  { re: /普通优先级|一般/, value: 'normal' }
]

const P_LEVEL_MAP: Priority[] = ['urgent', 'high', 'normal', 'low']

function extractPriority(text: string, slicer: Slicer): Priority | undefined {
  const bang = RE_BANG.exec(text)
  if (bang) {
    const marks = bang[1]
    const at = bang.index + bang[0].indexOf(marks)
    slicer.mark(at, at + marks.length)
    if (marks.length >= 3) return 'urgent'
    if (marks.length === 2) return 'high'
    return 'low'
  }

  const plevel = RE_PLEVEL.exec(text)
  if (plevel) {
    const at = pLevelIndex(plevel)
    slicer.mark(at, at + 2)
    return P_LEVEL_MAP[Number(plevel[1])]
  }

  for (const rule of SEMANTIC_RULES) {
    if (rule.re.test(text)) return rule.value
  }
  return undefined
}

/** P 级匹配可能带一个前导分隔符，定位到 "P" 本身 */
function pLevelIndex(m: RegExpExecArray): number {
  const offset = m[0].search(/[pP]/)
  return m.index + (offset < 0 ? 0 : offset)
}

/* ---------------- 标签与负责人 ---------------- */

function extractTags(text: string, slicer: Slicer): string[] {
  const tags: string[] = []
  // #标签：允许中英文数字下划线连字符，不吃掉 Markdown 标题的 "# "
  const re = /(^|[\s(（【[])#([\p{L}\p{N}_-]{1,24})/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tag = m[2]
    if (!tags.includes(tag)) tags.push(tag)
    slicer.mark(m.index + m[1].length, m.index + m[0].length)
  }
  return tags
}

function extractAssignee(text: string, slicer: Slicer): string | undefined {
  const re = /(^|[\s(（【[])@([\p{L}\p{N}_.-]{1,24})/u
  const m = re.exec(text)
  if (!m) return undefined
  slicer.mark(m.index + m[1].length, m.index + m[0].length)
  return m[2]
}

/* ---------------- 日期 ---------------- */

/** 把 dayjs 对象规范为 ISO 日期串 */
function iso(d: dayjs.Dayjs): string {
  return d.format(ISO_DATE)
}

/** 解析「下周一 / 本周五 / 周三」→ ISO 日期 */
function resolveWeekday(scope: string, weekdayRaw: string, base: dayjs.Dayjs): string | undefined {
  const wd = weekdayRaw === '日' || weekdayRaw === '天' ? 7 : CN_NUM[weekdayRaw] ?? Number(weekdayRaw)
  if (!wd || wd < 1 || wd > 7) return undefined
  // dayjs: 0=周日。转成 ISO 周（1=周一 … 7=周日）
  const currentIso = base.day() === 0 ? 7 : base.day()
  let diff = wd - currentIso
  if (scope === '下') diff += 7
  else if (scope === '上') diff -= 7
  else if (diff < 0) diff += 7 // 「周三」指本周或最近的将来
  return iso(base.add(diff, 'day'))
}

function clampDate(y: number, m: number, d: number): string | undefined {
  const parsed = dayjs(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, ISO_DATE, true)
  return parsed.isValid() ? iso(parsed) : undefined
}

/**
 * 抽取截止日期。命中优先级：显式完整日期 > due: 前缀 > 中文月日 >
 * 数字月/日 > 相对日（今天/明天/N天后）> 星期。
 */
function extractDue(text: string, slicer: Slicer, now: dayjs.Dayjs): string | undefined {
  type Matcher = { re: RegExp; build: (m: RegExpExecArray) => string | undefined }

  const matchers: Matcher[] = [
    // 2026-09-05 / 2026/9/5 / 2026.9.5
    {
      re: /(?:due[:：]\s*)?(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/i,
      build: (m) => clampDate(Number(m[1]), Number(m[2]), Number(m[3]))
    },
    // 2026年9月5日
    {
      re: /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/,
      build: (m) => clampDate(Number(m[1]), Number(m[2]), Number(m[3]))
    },
    // 9月5日 / 九月五日（补当前年，已过则顺延到明年）
    {
      re: /([0-9]{1,2}|[两一二三四五六七八九十]{1,3})\s*月\s*([0-9]{1,2}|[两一二三四五六七八九十]{1,3})\s*[日号]/,
      build: (m) => {
        const mm = CN_NUM[m[1]] ?? Number(m[1])
        const dd = CN_NUM[m[2]] ?? Number(m[2])
        if (!mm || !dd) return undefined
        const thisYear = clampDate(now.year(), mm, dd)
        if (!thisYear) return undefined
        return dayjs(thisYear).isBefore(now, 'day') ? clampDate(now.year() + 1, mm, dd) : thisYear
      }
    },
    // 9/5 或 due: 9-5（无年份）
    {
      re: /(?:due[:：]\s*)?(?:^|[\s(（【[])(\d{1,2})[-/](\d{1,2})(?![-/\d])/i,
      build: (m) => {
        const mm = Number(m[1])
        const dd = Number(m[2])
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined
        const thisYear = clampDate(now.year(), mm, dd)
        if (!thisYear) return undefined
        return dayjs(thisYear).isBefore(now, 'day') ? clampDate(now.year() + 1, mm, dd) : thisYear
      }
    },
    // 今天 / 明天 / 后天 / 大后天 / 昨天
    {
      re: /(今天|今日|明天|明日|后天|大后天|昨天)/,
      build: (m) => {
        const map: Record<string, number> = {
          今天: 0,
          今日: 0,
          明天: 1,
          明日: 1,
          后天: 2,
          大后天: 3,
          昨天: -1
        }
        return iso(now.add(map[m[1]], 'day'))
      }
    },
    { re: /\btoday\b/i, build: () => iso(now) },
    { re: /\btomorrow\b/i, build: () => iso(now.add(1, 'day')) },
    // 3天后 / 两周后 / 1个月后
    {
      re: /([0-9]{1,3}|[两一二三四五六七八九十]{1,3})\s*(天|日|周|星期|个?月)\s*(?:之)?后/,
      build: (m) => {
        const n = CN_NUM[m[1]] ?? Number(m[1])
        if (!n) return undefined
        const unit = m[2]
        if (unit === '天' || unit === '日') return iso(now.add(n, 'day'))
        if (unit === '周' || unit === '星期') return iso(now.add(n * 7, 'day'))
        return iso(now.add(n, 'month'))
      }
    },
    // 本周五 / 下周一 / 周三 / 下星期二
    {
      re: /(本|这|下|上)?\s*(?:周|星期|礼拜)\s*([0-9一二三四五六日天])/,
      build: (m) => resolveWeekday(m[1] ?? '', m[2], now)
    },
    // 本月底 / 月底
    { re: /(?:本)?月底/, build: () => iso(now.endOf('month')) },
    // 本周内 / 这周内
    { re: /(?:本|这)周内?(?![0-9一二三四五六日天])/, build: () => resolveWeekday('', '5', now) }
  ]

  for (const matcher of matchers) {
    const m = matcher.re.exec(text)
    if (!m) continue
    const value = matcher.build(m)
    if (!value) continue
    // 剥离时跳过前导分隔符，只删日期本体
    const lead = /^[\s(（【[]/.test(m[0]) ? 1 : 0
    slicer.mark(m.index + lead, m.index + m[0].length)
    return value
  }
  return undefined
}

/* ---------------- 入口 ---------------- */

/**
 * @param raw  单条待办的原始标题文本
 * @param now  基准日期（注入以便测试；默认取当天）
 */
export function enrich(raw: string, now: Date = new Date()): Enrichment {
  const base = dayjs(now).startOf('day')
  const slicer = new Slicer()

  // 先剥离 "due:" 前缀词本身留下的冗余，交由各 matcher 处理
  const priority = extractPriority(raw, slicer)
  const due = extractDue(raw, slicer, base)
  const tags = extractTags(raw, slicer)
  const assignee = extractAssignee(raw, slicer)

  let title = slicer.apply(raw)
  // 清掉残留的 due 前缀与空括号
  title = title
    .replace(/\bdue\s*[:：]\s*/gi, '')
    .replace(/[(（【[]\s*[)）】\]]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // 全部被剥离时回退到原文，避免产生空标题
  if (title.length === 0) title = raw.trim()

  return { title, due, priority, tags, assignee }
}
