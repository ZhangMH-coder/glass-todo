/**
 * 渲染层状态：zustand。
 * 所有变更都走 persist() → Tauri save_store 命令（SQLite 原子写），渲染层不直接碰文件。
 */
import { create } from 'zustand'
import {
  createEmptyStore,
  INBOX_LIST_ID,
  type Priority,
  type Settings,
  type Status,
  type Store,
  type Task,
  type TodoList
} from '@shared/types'
import { api } from '../lib/api'

/** 侧栏视图 */
export type ViewKey = 'inbox' | 'today' | 'upcoming' | 'done' | `list:${string}`

interface AppState {
  ready: boolean
  lists: TodoList[]
  tasks: Task[]
  settings: Settings
  view: ViewKey
  query: string

  init: () => Promise<void>
  setView: (view: ViewKey) => void
  setQuery: (query: string) => void

  addTask: (title: string, listId: string) => void
  updateTask: (id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>) => void
  toggleTask: (id: string) => void
  removeTask: (id: string) => void
  cyclePriority: (id: string) => void

  addList: (name: string) => void
  renameList: (id: string, name: string) => void
  removeList: (id: string) => void

  updateSettings: (patch: Partial<Settings>) => void
  /** 导入提交后整体替换 store（内存态与 SQLite 一致） */
  replaceStore: (store: Store) => void
}

const PRIORITY_CYCLE: Priority[] = ['normal', 'high', 'urgent', 'low']
const LIST_COLORS = ['#7aa2ff', '#5ee6c0', '#ffb86b', '#ff8fa3', '#b18cff', '#8fd3ff']

function nowIso(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

export const useAppStore = create<AppState>((set, get) => {
  /** 把当前内存状态写回 SQLite */
  const persist = (): void => {
    const { lists, tasks, settings } = get()
    const payload: Store = { schemaVersion: 1, lists, tasks, settings }
    void api.saveStore(payload).catch(() => undefined)
  }

  const commit = (patch: Partial<AppState>): void => {
    set(patch)
    persist()
  }

  return {
    ready: false,
    lists: createEmptyStore().lists,
    tasks: [],
    settings: createEmptyStore().settings,
    view: 'inbox',
    query: '',

    init: async () => {
      try {
        const store = await api.loadStore()
        // 脏数据清洗：外部写入或旧版本可能缺 updatedAt（排序会崩），这里兜底补齐
        const now = nowIso()
        const tasks = store.tasks.map((t) => ({
          ...t,
          updatedAt: t.updatedAt ?? t.createdAt ?? now,
          completedAt: t.completedAt ?? undefined,
          notes: t.notes ?? undefined,
          due: t.due ?? undefined,
          assignee: t.assignee ?? undefined,
          parentId: t.parentId ?? undefined
        }))
        set({
          ready: true,
          lists: store.lists,
          tasks,
          // 兜底合并：旧库/旧版本缺新字段时用默认值补齐
          settings: { ...createEmptyStore().settings, ...store.settings }
        })
      } catch (err) {
        console.error('loadStore failed', err)
        // 首启异常时用空库继续，不让应用白屏
        set({ ready: true })
      }
    },

    setView: (view) => set({ view }),
    setQuery: (query) => set({ query }),

    addTask: (title, listId) => {
      const clean = title.trim()
      if (clean.length === 0) return
      const ts = nowIso()
      const maxOrder = get().tasks.reduce((m, t) => (t.order > m ? t.order : m), -1)
      const task: Task = {
        id: newId('task'),
        title: clean.slice(0, 200),
        status: 'todo',
        priority: 'normal',
        tags: [],
        listId,
        order: maxOrder + 1,
        createdAt: ts,
        updatedAt: ts
      }
      commit({ tasks: [...get().tasks, task] })
    },

    updateTask: (id, patch) => {
      commit({
        tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: nowIso() } : t))
      })
    },

    toggleTask: (id) => {
      const ts = nowIso()
      commit({
        tasks: get().tasks.map((t) => {
          if (t.id !== id) return t
          const status: Status = t.status === 'done' ? 'todo' : 'done'
          return {
            ...t,
            status,
            completedAt: status === 'done' ? ts : undefined,
            updatedAt: ts
          }
        })
      })
    },

    removeTask: (id) => {
      // 连带解除子任务的父引用，避免留下孤儿指针
      commit({
        tasks: get()
          .tasks.filter((t) => t.id !== id)
          .map((t) => (t.parentId === id ? { ...t, parentId: undefined } : t))
      })
    },

    cyclePriority: (id) => {
      const task = get().tasks.find((t) => t.id === id)
      if (!task) return
      const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(task.priority) + 1) % PRIORITY_CYCLE.length]
      get().updateTask(id, { priority: next })
    },

    addList: (name) => {
      const clean = name.trim().slice(0, 40)
      if (clean.length === 0) return
      const lists = get().lists
      const list: TodoList = {
        id: newId('list'),
        name: clean,
        color: LIST_COLORS[lists.length % LIST_COLORS.length],
        order: lists.length
      }
      commit({ lists: [...lists, list] })
    },

    renameList: (id, name) => {
      const clean = name.trim().slice(0, 40)
      if (clean.length === 0 || id === INBOX_LIST_ID) return
      commit({ lists: get().lists.map((l) => (l.id === id ? { ...l, name: clean } : l)) })
    },

    removeList: (id) => {
      // 收件箱是默认归属，不允许删除
      if (id === INBOX_LIST_ID) return
      const { lists, tasks, view } = get()
      commit({
        lists: lists.filter((l) => l.id !== id),
        // 清单内的任务移回收件箱，而不是连带删除
        tasks: tasks.map((t) => (t.listId === id ? { ...t, listId: INBOX_LIST_ID } : t))
      })
      if (view === `list:${id}`) set({ view: 'inbox' })
    },

    updateSettings: (patch) => {
      commit({ settings: { ...get().settings, ...patch } })
    },

    replaceStore: (store) => {
      set({ lists: store.lists, tasks: store.tasks, settings: store.settings })
    }
  }
})
