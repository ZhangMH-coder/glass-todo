import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

interface Props {
  query: string
  onQueryChange: (value: string) => void
  onImport: () => void
  onPasteImport: () => void
  onOpenSettings: () => void
}

export default function TitleBar({
  query,
  onQueryChange,
  onImport,
  onPasteImport,
  onOpenSettings
}: Props): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const win = getCurrentWindow()

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    void win
      .onResized(() => {
        void win.isMaximized().then((m) => {
          if (!cancelled) setMaximized(m)
        })
      })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
    void win.isMaximized().then((m) => {
      if (!cancelled) setMaximized(m)
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [win])

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <span className="titlebar__logo" aria-hidden="true">
          ◈
        </span>
        <span>Glass Todo</span>
      </div>

      <div className="titlebar__actions">
        <div className="search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            placeholder="搜索待办…"
            aria-label="搜索待办"
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>

        <button type="button" className="btn btn--primary" onClick={onImport}>
          <span aria-hidden="true">⤓</span> 导入文件
        </button>

        <button
          type="button"
          className="btn"
          onClick={onPasteImport}
          title="粘贴剪贴板文本（Ctrl+Shift+V）"
        >
          <span aria-hidden="true">⧉</span> 粘贴导入
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onOpenSettings}
          aria-label="打开设置"
          title="设置"
        >
          ⚙
        </button>
      </div>

      <div className="window-controls">
        <button type="button" onClick={() => void win.minimize()} aria-label="最小化">
          ―
        </button>
        <button
          type="button"
          onClick={() => void win.toggleMaximize()}
          aria-label={maximized ? '还原窗口' : '最大化'}
        >
          {maximized ? '❐' : '□'}
        </button>
        <button
          type="button"
          className="close"
          onClick={() => void win.close()}
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
