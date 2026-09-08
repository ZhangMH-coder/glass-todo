/**
 * 壁纸渲染层：平铺 / 缩放（cover·contain）/ 九宫格位置 + Ken Burns 动画 + 多图轮播。
 *
 * 结构：.wallpaper 固定于视口底层（z-index 0，UI 在其上）；
 * .wallpaper__inner 承载 background-image，尺寸放大到 110% 以容纳 Ken Burns 的
 * 平移缩放（transform 走合成层，比动画 background-size 性能好）。
 * 轮播通过切换 key 重挂载 inner，触发淡入。
 */
import { useEffect, useMemo, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { WALLPAPER_POSITION_CSS, type Settings } from '@shared/types'

interface Props {
  settings: Settings
}

export default function WallpaperLayer({ settings }: Props): React.JSX.Element | null {
  const images = useMemo(() => {
    if (settings.bgMode !== 'wallpaper') return []
    const list = settings.wallpaperList.filter((p) => p.length > 0)
    if (list.length > 0) return list
    return settings.wallpaperPath ? [settings.wallpaperPath] : []
  }, [settings.bgMode, settings.wallpaperList, settings.wallpaperPath])

  const [idx, setIdx] = useState(0)

  // 多图轮播：仅当 ≥2 张且间隔 >0
  const intervalSec = settings.wallpaperInterval
  const rotating = images.length >= 2 && intervalSec > 0
  useEffect(() => {
    if (!rotating) return
    const t = window.setInterval(() => {
      setIdx((i) => (i + 1) % images.length)
    }, intervalSec * 1000)
    return () => window.clearInterval(t)
  }, [rotating, intervalSec, images.length])

  // 图数量变化时避免越界
  useEffect(() => {
    setIdx((i) => (images.length === 0 ? 0 : i % images.length))
  }, [images.length])

  if (images.length === 0) return <div className="wallpaper" aria-hidden="true" />

  const current = Math.min(idx, images.length - 1)
  const src = convertFileSrc(images[current])
  const fit = settings.wallpaperFit
  const kenburns = settings.wallpaperAnim === 'kenburns' && !settings.reduceMotion
  const posCss = WALLPAPER_POSITION_CSS[settings.wallpaperPosition]

  const style: React.CSSProperties = {
    backgroundImage: `url("${src}")`,
    backgroundRepeat: fit === 'tile' ? 'repeat' : 'no-repeat',
    backgroundSize: fit === 'tile' ? 'auto' : fit,
    backgroundPosition: fit === 'tile' ? '0 0' : posCss,
    opacity: Math.min(100, Math.max(30, settings.wallpaperOpacity ?? 100)) / 100
  }

  return (
    <div className="wallpaper" aria-hidden="true">
      <div
        key={`${current}-${src}`}
        className={`wallpaper__inner${kenburns ? ' wallpaper__inner--kb' : ''}`}
        style={style}
      />
    </div>
  )
}
