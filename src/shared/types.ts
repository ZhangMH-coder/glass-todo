/** 主进程与渲染进程共享的类型定义 */

export type Priority = 'urgent' | 'high' | 'normal' | 'low'
export type Status = 'todo' | 'doing' | 'done'

export const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: '紧急',
  high: '高',
  normal: '普通',
  low: '低'
}

export interface TaskSource {
  fileName: string
  line?: number
  importedAt: string
}

export interface Task {
  id: string
  title: string
  notes?: string
  status: Status
  priority: Priority
  /** ISO yyyy-MM-dd */
  due?: string
  tags: string[]
  assignee?: string
  parentId?: string
  listId: string
  order: number
  source?: TaskSource
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface TodoList {
  id: string
  name: string
  color: string
  order: number
}

/** 壁纸显示方式：平铺 / 缩放铺满 / 缩放完整 */
export type WallpaperFit = 'tile' | 'cover' | 'contain'
/** 九宫格位置 */
export type WallpaperPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
/** 动画壁纸：无 / Ken Burns 缓慢推拉 */
export type WallpaperAnim = 'none' | 'kenburns'

export interface Settings {
  theme: 'dark' | 'light' | 'warm' | 'cool'
  glass: boolean
  reduceMotion: boolean
  /** 背景模式：流体 / 壁纸（参考图） */
  bgMode: 'fluid' | 'wallpaper'
  /** 色调 0–360° */
  bgHue: number
  /** 颜色深浅 0–100% */
  bgSaturation: number
  /** 颜色亮度 0–100% */
  bgLightness: number
  /** 背景亮度 0–100%（浅色模式 50 原样，100 提亮至纯白） */
  bgBrightness: number
  /** 玻璃模糊度 px */
  glassBlur: number
  /** 磨砂度 % */
  glassFrost: number
  /** 壁纸文件名（应用数据目录内），未选为 undefined；多图时为首图 */
  wallpaperPath?: string
  /** 显示方式：平铺 / 缩放铺满 / 缩放完整 */
  wallpaperFit: WallpaperFit
  /** 九宫格位置（tile 平铺时忽略） */
  wallpaperPosition: WallpaperPosition
  /** 动画壁纸：无 / Ken Burns */
  wallpaperAnim: WallpaperAnim
  /** 轮播间隔秒：0 关闭 / 30 / 60 / 300 */
  wallpaperInterval: number
  /** 轮播图列表（完整路径，≥2 张且 interval>0 时轮播） */
  wallpaperList: string[]
  /** 壁纸透明度 30–100% */
  wallpaperOpacity: number
}

export interface Store {
  schemaVersion: 1
  lists: TodoList[]
  tasks: Task[]
  settings: Settings
}

export const INBOX_LIST_ID = 'inbox'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  glass: true,
  reduceMotion: false,
  bgMode: 'fluid',
  bgHue: 316,
  bgSaturation: 36,
  bgLightness: 58,
  bgBrightness: 50,
  glassBlur: 24,
  glassFrost: 55,
  wallpaperFit: 'cover',
  wallpaperPosition: 'center',
  wallpaperAnim: 'none',
  wallpaperInterval: 0,
  wallpaperList: [],
  wallpaperOpacity: 100
}

/** 九宫格 → CSS background-position */
export const WALLPAPER_POSITION_CSS: Record<WallpaperPosition, string> = {
  'top-left': 'top left',
  'top-center': 'top center',
  'top-right': 'top right',
  'center-left': 'center left',
  center: 'center center',
  'center-right': 'center right',
  'bottom-left': 'bottom left',
  'bottom-center': 'bottom center',
  'bottom-right': 'bottom right'
}

export const WALLPAPER_POSITION_LABEL: Record<WallpaperPosition, string> = {
  'top-left': '左上',
  'top-center': '顶部',
  'top-right': '右上',
  'center-left': '左侧',
  center: '居中',
  'center-right': '右侧',
  'bottom-left': '左下',
  'bottom-center': '底部',
  'bottom-right': '右下'
}

export function createEmptyStore(): Store {
  return {
    schemaVersion: 1,
    lists: [
      { id: INBOX_LIST_ID, name: '收件箱', color: '#7aa2ff', order: 0 },
      { id: 'work', name: '工作', color: '#5ee6c0', order: 1 },
      { id: 'personal', name: '个人', color: '#ffb86b', order: 2 }
    ],
    tasks: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}

/* ---------- 导入管线 ---------- */

/** 提取层输出：与具体文件格式解耦的中间表示 */
export interface RawDocument {
  fileName: string
  /** 全文（行已用 \n 连接） */
  text: string
  lines: string[]
  /** 表格类文件的行数据，首行为表头 */
  tableRows?: string[][]
  /** 提取阶段的告警，例如扫描版 PDF 无文本层 */
  warnings: string[]
}

/** 解析层输出的候选待办（尚未落库） */
export interface CandidateTask {
  /** 批次内临时 id */
  tempId: string
  title: string
  notes?: string
  status: Status
  priority: Priority
  due?: string
  tags: string[]
  assignee?: string
  /** 缩进层级，0 为顶层 */
  depth: number
  /** 父候选项的 tempId */
  parentTempId?: string
  line?: number
  /** 命中的规则名，用于界面展示 */
  rule: string
  /** 0–1 置信度 */
  confidence: number
  /** 去重判定结果 */
  dedupe: 'new' | 'duplicate'
  /** 与之重复的已有任务标题 */
  duplicateOf?: string
  /** 用户是否勾选导入 */
  selected: boolean
}

export interface ImportAnalysis {
  fileName: string
  candidates: CandidateTask[]
  warnings: string[]
  stats: {
    totalLines: number
    matched: number
    duplicates: number
  }
}

export interface CommitPayload {
  listId: string
  candidates: CandidateTask[]
  fileName: string
}

export const SUPPORTED_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'log',
  'csv',
  'tsv',
  'json',
  'docx',
  'xlsx',
  'xlsm',
  'pdf'
] as const

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

export function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  return idx === -1 ? '' : fileName.slice(idx + 1).toLowerCase()
}

export function isSupportedFile(fileName: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(fileName))
}
