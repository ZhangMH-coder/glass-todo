/**
 * 抽屉焦点陷阱：Tab / Shift+Tab 在面板内循环，焦点逃出面板时拉回，
 * 卸载时恢复打开前的焦点元素。配合 aria-modal="true" 保证键盘用户不会
 * 把焦点 Tab 进背景。
 */
import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean
): void {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    // 打开抽屉前的焦点元素（通常是触发按钮），关闭时还回去
    const restoreTarget = document.activeElement as HTMLElement | null

    const getFocusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      )

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) {
        e.preventDefault()
        container.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement
      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault()
          last.focus()
        }
      } else if (current === last || !container.contains(current)) {
        e.preventDefault()
        first.focus()
      }
    }

    const onFocusOut = (e: FocusEvent): void => {
      const next = e.relatedTarget as Node | null
      // 窗口级失焦（Alt+Tab 切走）不处理；焦点落到面板外则拉回
      if (next === null) return
      if (!container.contains(next)) {
        const focusable = getFocusable()
        ;(focusable[0] ?? container).focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    container.addEventListener('focusout', onFocusOut)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      container.removeEventListener('focusout', onFocusOut)
      restoreTarget?.focus()
    }
  }, [containerRef, active])
}