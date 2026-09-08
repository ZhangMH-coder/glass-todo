/** 轻量 toast：仅用于操作反馈，自动消失 */
import { useCallback, useRef, useState } from 'react'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const DURATION_MS = 3600

export function useToasts(): {
  toasts: Toast[]
  push: (message: string, kind?: ToastKind) => void
} {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    seq.current += 1
    const id = seq.current
    setToasts((prev) => [...prev, { id, kind, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), DURATION_MS)
  }, [])

  return { toasts, push }
}
