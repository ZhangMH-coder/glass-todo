/**
 * 整窗口文件拖放。
 * Tauri 2 用窗口级 onDragDropEvent 拿磁盘路径（Web 层拿不到真实路径）。
 */
import { useEffect, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'

export function useFileDrop(onFiles: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return
        if (event.payload.type === 'over' || event.payload.type === 'enter') {
          setDragging(true)
        } else if (event.payload.type === 'drop') {
          setDragging(false)
          if (event.payload.paths.length > 0) onFiles(event.payload.paths)
        } else {
          setDragging(false)
        }
      })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [onFiles])

  return dragging
}
