/**
 * 去重层：标题归一化后比对，再叠一层字符级相似度。
 * 同批次内与已有任务库中均做检测。纯函数。
 */
import type { CandidateTask } from '../types'

/** 相似度阈值，超过即判定重复 */
const SIMILARITY_THRESHOLD = 0.86

/** 归一化：去空白、去标点、大小写折叠、全角转半角 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!-/:-@[-`{-~，。、；：？！「」『』（）【】《》…—·]/g, '')
}

/** 二元组集合相似度（Dice 系数），对中文与英文都稳定 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2)
      map.set(g, (map.get(g) ?? 0) + 1)
    }
    return map
  }

  const ga = bigrams(a)
  const gb = bigrams(b)
  let overlap = 0
  for (const [g, countA] of ga) {
    const countB = gb.get(g)
    if (countB) overlap += Math.min(countA, countB)
  }
  const total = a.length - 1 + (b.length - 1)
  return (2 * overlap) / total
}

export interface ExistingTask {
  title: string
}

/**
 * 标注每个候选项是 new 还是 duplicate。
 * 不修改入参，返回新数组。重复项默认取消勾选。
 */
export function markDuplicates(
  candidates: CandidateTask[],
  existing: ExistingTask[]
): CandidateTask[] {
  const seen = new Map<string, string>()
  for (const task of existing) {
    seen.set(normalizeTitle(task.title), task.title)
  }
  const normalizedExisting = [...seen.keys()]

  return candidates.map((c) => {
    const key = normalizeTitle(c.title)
    if (key.length === 0) return { ...c }

    const exact = seen.get(key)
    if (exact !== undefined) {
      return { ...c, dedupe: 'duplicate' as const, duplicateOf: exact, selected: false }
    }

    let best: { title: string; score: number } | undefined
    for (const other of normalizedExisting) {
      const score = similarity(key, other)
      if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
        best = { title: seen.get(other) ?? other, score }
      }
    }

    if (best) {
      return { ...c, dedupe: 'duplicate' as const, duplicateOf: best.title, selected: false }
    }

    // 记入 seen，让同批次内的后续重复项也能被发现
    seen.set(key, c.title)
    normalizedExisting.push(key)
    return { ...c }
  })
}
