import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  INBOX_LIST_ID,
  PRIORITY_ORDER,
  type CandidateTask,
  type ImportAnalysis,
  type Store,
  type Task
} from '@shared/types'
import DropOverlay from './components/DropOverlay'
import ImportDrawer from './components/ImportDrawer'
import SettingsDrawer from './components/SettingsDrawer'
import Sidebar from './components/Sidebar'
import TaskList from './components/TaskList'
import TitleBar from './components/TitleBar'
import Toasts from './components/Toasts'
import WallpaperLayer from './components/WallpaperLayer'
import { useFileDrop } from './hooks/useFileDrop'
import { useToasts } from './hooks/useToasts'
import { api } from './lib/api'
import { analyzeText as analyzeImportedText, candidatesToTasks } from './lib/import'
import { useAppStore, type ViewKey } from './store/useAppStore'
import { isOverdue, todayIso } from './utils'

const WEEKDAY_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** 视图标题与空状态文案 */
function viewMeta(
  view: ViewKey,
  listName: string | undefined
): { title: string; subtitle: string; emptyTitle: string } {
  const today = todayIso()
  const weekday = WEEKDAY_FULL[new Date(`${today}T00:00:00`).getDay()]
  switch (view) {
    case 'today':
      return {
        title: '今天',
        subtitle: `${today} ${weekday} · 含逾期项`,
        emptyTitle: '今天没有待办'
      }
    case 'upcoming':
      return { title: '即将到来', subtitle: '按截止日期排序', emptyTitle: '暂无排期中的待办' }
    case 'done':
      return { title: '已完成', subtitle: '最近完成的在前', emptyTitle: '还没有完成的待办' }
    case 'inbox':
      return { title: '全部待办', subtitle: '所有未完成事项', emptyTitle: '待办清空了' }
    default:
      return {
        title: listName ?? '清单',
        subtitle: '该清单中的未完成事项',
        emptyTitle: '这个清单还是空的'
      }
  }
}

export default function App(): React.JSX.Element {
  const {
    ready,
    lists,
    tasks,
    settings,
    view,
    query,
    init,
    setView,
    setQuery,
    addTask,
    updateTask,
    toggleTask,
    removeTask,
    cyclePriority,
    addList,
    removeList,
    updateSettings,
    replaceStore
  } = useAppStore()

  const { toasts, push } = useToasts()
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null)
  const [committing, setCommitting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void init()
  }, [init])

  // 主题 / 玻璃 / 动效偏好通过根节点 data-* 驱动 CSS，避免逐组件传参
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.dataset.glass = settings.glass ? 'on' : 'off'
    root.dataset.motion = settings.reduceMotion ? 'reduced' : 'normal'

    // 背景参数（参考图）：色调 / 颜色深浅 / 背景亮度 / 玻璃模糊度 / 磨砂度
    // 壁纸渲染交给 <WallpaperLayer />（平铺/缩放/位置/动画/轮播），这里只驱动流体层
    const st = root.style
    st.setProperty('--gt-bg-hue', `${settings.bgHue}deg`)
    st.setProperty('--gt-bg-saturation', `${settings.bgSaturation}%`)
    st.setProperty('--gt-bg-lightness', `${settings.bgLightness}%`)
    // 50 原样 → 100 提亮至纯白（线性映射到 brightness 1~2）
    st.setProperty('--gt-bg-brightness', (0.5 + settings.bgBrightness / 100).toString())
    st.setProperty('--gt-glass-blur', `${settings.glassBlur}px`)
    // 磨砂度 → 玻璃饱和度：0 磨砂 = 鲜艳 160%，100 磨砂 = 灰雾 70%
    st.setProperty(
      '--gt-glass-saturate',
      `${Math.max(70, Math.round(160 - settings.glassFrost * 0.9))}%`
    )
  }, [settings])

  /* ---------------- 导入 ---------------- */

  const analyzeFiles = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      if (paths.length > 1) {
        push(`一次只解析一个文件，已选择 ${paths[0].split(/[\/]/).pop()}`, 'info')
      }
      try {
        // docx 走专用解析（zip+xml），其余走纯文本
        const lower = paths[0].toLowerCase()
        const text = lower.endsWith('.docx')
          ? await api.readDocx(paths[0])
          : await api.readTextFile(paths[0])
        const fileName = paths[0].split(/[\\/]/).pop() ?? '未命名'
        const result = analyzeImportedText(text, fileName, useAppStore.getState().tasks)
        setAnalysis(result)
        if (result.candidates.length === 0) push('没有从该文件识别到待办事项', 'info')
      } catch (err) {
        push(err instanceof Error ? err.message : '文件解析失败', 'error')
      }
    },
    [push]
  )

  const dragging = useFileDrop((paths) => void analyzeFiles(paths))

  const openImport = useCallback(async () => {
    const paths = await api.openFiles()
    await analyzeFiles(paths)
  }, [analyzeFiles])

  /** 剪贴板粘贴纯文本：读系统剪贴板 → analyzeText → 预览抽屉 */
  const analyzePastedText = useCallback(async () => {
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      push('无法读取剪贴板（权限被拒），请复制文本后重试', 'error')
      return
    }
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      push('剪贴板里没有文本，先复制一些待办内容', 'info')
      return
    }
    try {
      const result = analyzeImportedText(trimmed, '粘贴文本', useAppStore.getState().tasks)
      setAnalysis(result)
      if (result.candidates.length === 0) push('没有从粘贴文本识别到待办事项', 'info')
    } catch (err) {
      push(err instanceof Error ? err.message : '粘贴文本解析失败', 'error')
    }
  }, [push])

  const commitImport = useCallback(
    async (listId: string, candidates: CandidateTask[]) => {
      if (!analysis) return
      setCommitting(true)
      try {
        const { lists, tasks, settings } = useAppStore.getState()
        const newTasks = candidatesToTasks(candidates, listId, tasks)
        const store: Store = { schemaVersion: 1, lists, tasks: [...tasks, ...newTasks], settings }
        replaceStore(store)
        await api.saveStore(store)
        setAnalysis(null)
        push(`已导入 ${newTasks.length} 条待办`, 'success')
        setView(listId === INBOX_LIST_ID ? 'inbox' : `list:${listId}`)
      } catch (err) {
        push(err instanceof Error ? err.message : '导入失败', 'error')
      } finally {
        setCommitting(false)
      }
    },
    [analysis, push, replaceStore, setView]
  )

  const revealStore = useCallback(() => {
    // S0 占位：S1 打开数据目录（reveal）
  }, [])

  /* ---------------- 快捷键 ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'o') {
        e.preventDefault()
        void openImport()
      } else if (key === 'v' && e.shiftKey) {
        e.preventDefault()
        void analyzePastedText()
      } else if (key === 'f') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.search input')?.focus()
      } else if (key === 'n') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.quick-add input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openImport, analyzePastedText])

  /* ---------------- 视图过滤 ---------------- */

  const activeListId = view.startsWith('list:') ? view.slice(5) : INBOX_LIST_ID
  const listName = lists.find((l) => l.id === activeListId)?.name

  const visible = useMemo(() => {
    const today = todayIso()
    const q = query.trim().toLowerCase()

    const byView = tasks.filter((t) => {
      switch (view) {
        case 'inbox':
          return t.status !== 'done'
        case 'today':
          return t.status !== 'done' && (t.due === today || isOverdue(t))
        case 'upcoming':
          return t.status !== 'done' && t.due !== undefined && t.due > today
        case 'done':
          return t.status === 'done'
        default:
          return t.status !== 'done' && t.listId === activeListId
      }
    })

    const byQuery =
      q.length === 0
        ? byView
        : byView.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              (t.notes ?? '').toLowerCase().includes(q) ||
              t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
              (t.assignee ?? '').toLowerCase().includes(q)
          )

    return sortTasks(byQuery, view)
  }, [tasks, view, query, activeListId])

  const meta = viewMeta(view, listName)

  /** 壁纸模式且已有壁纸图 → 不渲染流体层；否则回退流体背景（避免透明黑底） */
  const hasWallpaper =
    settings.bgMode === 'wallpaper' &&
    (settings.wallpaperList.length > 0 || settings.wallpaperPath !== undefined)

  const submitDraft = (): void => {
    const title = draft.trim()
    if (title.length === 0) return
    addTask(title, view.startsWith('list:') ? activeListId : INBOX_LIST_ID)
    setDraft('')
  }

  return (
    <>
      <WallpaperLayer settings={settings} />
      {/* 壁纸模式且已有壁纸时不叠加流体层，让壁纸完整呈现；无壁纸时回退流体 */}
      {!hasWallpaper ? (
        <div className="backdrop" aria-hidden="true">
          <span className="blob blob-1" />
          <span className="blob blob-2" />
          <span className="blob blob-3" />
        </div>
      ) : null}

      <div className="app">
        <TitleBar
          query={query}
          onQueryChange={setQuery}
          onImport={() => void openImport()}
          onPasteImport={() => void analyzePastedText()}
          onOpenSettings={() => setShowSettings(true)}
        />

        <div className="body">
          <Sidebar
            lists={lists}
            tasks={tasks}
            view={view}
            onViewChange={setView}
            onAddList={addList}
            onRemoveList={removeList}
            onRevealStore={revealStore}
          />

          <main className="main">
            <div className="main__head">
              <div>
                <h1 className="main__title">{meta.title}</h1>
                <p className="main__subtitle">
                  {meta.subtitle}
                  {query.trim().length > 0 ? ` · 搜索「${query.trim()}」` : ''}
                </p>
              </div>
              <span className="chip" style={{ marginLeft: 'auto' }}>
                {visible.length} 条
              </span>
            </div>

            <div className="main__list">
              {ready ? (
                <TaskList
                  tasks={visible}
                  onToggle={toggleTask}
                  onRename={(id, title) => updateTask(id, { title })}
                  onCyclePriority={cyclePriority}
                  onRemove={removeTask}
                  emptyTitle={meta.emptyTitle}
                  emptyHint={
                    <>
                      把 txt / md / log / csv / tsv / docx 文件拖进窗口，
                      <br />
                      或按 Ctrl+O 选择文件、Ctrl+Shift+V 粘贴文本，自动整理成待办事项。
                    </>
                  }
                />
              ) : (
                <div className="empty">
                  <div className="empty__title">正在载入…</div>
                </div>
              )}
            </div>

            {view !== 'done' ? (
              <div className="quick-add">
                <input
                  className="field"
                  value={draft}
                  maxLength={200}
                  placeholder="添加待办…支持「明天 / 下周一 / P0 / #标签 / @负责人」"
                  aria-label="新待办内容"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitDraft()
                  }}
                />
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={submitDraft}
                  disabled={draft.trim().length === 0}
                >
                  添加
                </button>
              </div>
            ) : null}
          </main>
        </div>
      </div>

      {dragging ? <DropOverlay /> : null}

      {analysis ? (
        <ImportDrawer
          analysis={analysis}
          lists={lists}
          defaultListId={view.startsWith('list:') ? activeListId : INBOX_LIST_ID}
          committing={committing}
          onCancel={() => setAnalysis(null)}
          onCommit={(listId, candidates) => void commitImport(listId, candidates)}
        />
      ) : null}

      {showSettings ? (
        <SettingsDrawer
          settings={settings}
          taskCount={tasks.length}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
          onRevealStore={revealStore}
        />
      ) : null}

      <Toasts toasts={toasts} />
    </>
  )
}

/** 排序：已完成按完成时间倒序；其余按 截止日期 → 优先级 → 录入顺序 */
function sortTasks(list: Task[], view: ViewKey): Task[] {
  const sorted = [...list]
  if (view === 'done') {
    sorted.sort((a, b) =>
      (b.completedAt ?? b.updatedAt ?? '').localeCompare(a.completedAt ?? a.updatedAt ?? '')
    )
    return sorted
  }
  sorted.sort((a, b) => {
    const ad = a.due ?? ''
    const bd = b.due ?? ''
    if (ad !== bd) {
      if (ad === '') return 1
      if (bd === '') return -1
      return ad.localeCompare(bd)
    }
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (p !== 0) return p
    return a.order - b.order
  })
  return sorted
}
