/**
 * Tauri invoke 封装：前端唯一 API 入口（替代 Electron 的 window.glassTodo）
 */
import { invoke } from '@tauri-apps/api/core'
import { open, type DialogFilter } from '@tauri-apps/plugin-dialog'
import type { Store } from '../shared/types'

export const api = {
  async loadStore(): Promise<Store> {
    return invoke<Store>('load_store')
  },
  async saveStore(store: Store): Promise<void> {
    return invoke('save_store', { store })
  },
  /** 读取本地文本文件（导入用；路径来自用户选择） */
  async readTextFile(path: string): Promise<string> {
    return invoke<string>('read_text_file', { path })
  },
  /** 解析 docx（Rust 提取段落纯文本） */
  async readDocx(path: string): Promise<string> {
    return invoke<string>('read_docx', { path })
  },
  /** 文件选择对话框 */
  async openFiles(
    filters: DialogFilter[] = [
      {
        name: '文本 / 表格 / Word',
        extensions: ['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'docx']
      },
      { name: '所有文件', extensions: ['*'] }
    ]
  ): Promise<string[]> {
    const result = await open({ multiple: true, filters })
    if (result === null) return []
    return Array.isArray(result) ? result : [result]
  },
  /** 复制壁纸进应用数据目录，返回新文件完整路径 */
  async copyWallpaper(path: string): Promise<string> {
    return invoke<string>('copy_wallpaper', { path })
  }
}
