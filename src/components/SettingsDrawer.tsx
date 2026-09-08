import { useEffect, useRef } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  WALLPAPER_POSITION_LABEL,
  type Settings,
  type WallpaperFit,
  type WallpaperPosition
} from '@shared/types'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { api } from '../lib/api'

interface Props {
  settings: Settings
  taskCount: number
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  onRevealStore: () => void
}

const THEMES: { id: Settings['theme']; label: string }[] = [
  { id: 'dark', label: '深色' },
  { id: 'light', label: '浅色' },
  { id: 'warm', label: '暖色' },
  { id: 'cool', label: '冷色' }
]

const FITS: { id: WallpaperFit; label: string; hint: string }[] = [
  { id: 'tile', label: '平铺', hint: '原尺寸重复排列' },
  { id: 'cover', label: '铺满', hint: '裁剪边缘填满窗口' },
  { id: 'contain', label: '完整', hint: '完整显示，留边' }
]

const POSITION_GRID: WallpaperPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
]

const INTERVALS: { id: number; label: string }[] = [
  { id: 0, label: '关闭' },
  { id: 30, label: '30秒' },
  { id: 60, label: '1分钟' },
  { id: 300, label: '5分钟' }
]

function Slider({
  label,
  min,
  max,
  unit,
  value,
  hint,
  onChange
}: {
  label: string
  min: number
  max: number
  unit: string
  value: number
  hint?: string
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <div className="settings__row settings__row--col">
      <div className="slider-row">
        <span className="slider-row__label">{label}</span>
        <span className="slider-row__value">
          {Math.round(value)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        style={{ ['--range-pct' as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <span className="slider-row__hint">{hint}</span> : null}
    </div>
  )
}

export default function SettingsDrawer({
  settings,
  taskCount,
  onChange,
  onClose,
  onRevealStore
}: Props): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 焦点陷阱：Tab 在面板内循环，卸载时焦点还给触发按钮
  useFocusTrap(panelRef, true)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pickWallpapers = async (): Promise<void> => {
    const paths = await api.openFiles([
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }
    ])
    if (paths.length === 0) return
    try {
      const stored: string[] = []
      for (const p of paths) {
        stored.push(await api.copyWallpaper(p))
      }
      const prev = settings.wallpaperList ?? []
      onChange({
        wallpaperList: [...prev, ...stored],
        wallpaperPath: settings.wallpaperPath ?? stored[0],
        bgMode: 'wallpaper'
      })
    } catch (err) {
      console.error('copyWallpaper failed', err)
    }
  }

  /** 展示用列表：新多图优先，兼容旧版单图 wallpaperPath */
  const shownWallpapers =
    settings.wallpaperList.length > 0
      ? settings.wallpaperList
      : settings.wallpaperPath
        ? [settings.wallpaperPath]
        : []

  const removeWallpaper = (path: string): void => {
    const rest = (settings.wallpaperList ?? []).filter((p) => p !== path)
    onChange({
      wallpaperList: rest,
      wallpaperPath:
        settings.wallpaperPath === path ? (rest[0] ?? undefined) : settings.wallpaperPath
    })
  }

  return (
    <div
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="drawer__panel" ref={panelRef} tabIndex={-1} style={{ width: 'min(560px, 100%)' }}>
        <div className="drawer__head">
          <div>
            <h2 className="drawer__title" id="settings-title">
              设置
            </h2>
            <p className="drawer__sub">共 {taskCount} 条待办，全部保存在本机</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
            aria-label="关闭设置"
          >
            ✕
          </button>
        </div>

        <div className="drawer__body">
          <section className="settings__group">
            <h3 className="settings__group-title">外观</h3>

            <div className="settings__row">
              <span className="settings__label">
                <strong>主题</strong>
                <span>四套预设配色，设置保存在本机</span>
              </span>
              <div className="seg" role="group" aria-label="主题">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`seg__btn${settings.theme === t.id ? ' seg__btn--on' : ''}`}
                    onClick={() => onChange({ theme: t.id })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings__row">
              <span className="settings__label">
                <strong>玻璃效果</strong>
                <span>关闭后改用实色卡片，可提升低性能设备的流畅度与文字清晰度</span>
              </span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.glass}
                  onChange={(e) => onChange({ glass: e.target.checked })}
                  aria-label="玻璃效果"
                />
                <span className="switch__track" />
              </label>
            </div>

            <div className="settings__row">
              <span className="settings__label">
                <strong>减少动效</strong>
                <span>关闭背景漂移与过渡动画</span>
              </span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.reduceMotion}
                  onChange={(e) => onChange({ reduceMotion: e.target.checked })}
                  aria-label="减少动效"
                />
                <span className="switch__track" />
              </label>
            </div>
          </section>

          <section className="settings__group">
            <h3 className="settings__group-title">背景</h3>

            <div className="settings__row">
              <span className="settings__label">
                <strong>背景模式</strong>
                <span>流体为动态渐变，壁纸使用本地图片（复制进应用目录）</span>
              </span>
              <div className="seg" role="group" aria-label="背景模式">
                <button
                  type="button"
                  className={`seg__btn${settings.bgMode === 'fluid' ? ' seg__btn--on' : ''}`}
                  onClick={() => onChange({ bgMode: 'fluid' })}
                >
                  流体
                </button>
                <button
                  type="button"
                  className={`seg__btn${settings.bgMode === 'wallpaper' ? ' seg__btn--on' : ''}`}
                  onClick={() => onChange({ bgMode: 'wallpaper' })}
                >
                  壁纸
                </button>
              </div>
            </div>

            {settings.bgMode === 'wallpaper' ? (
              <>
                <div className="settings__row">
                  <span className="settings__label">
                    <strong>壁纸图片</strong>
                    <span>可多选，原文件移动 / 删除不影响应用内壁纸</span>
                  </span>
                  <span className="settings__inline-actions">
                    <button type="button" className="btn btn--sm" onClick={() => void pickWallpapers()}>
                      添加图片…
                    </button>
                  </span>
                </div>

                {shownWallpapers.length > 0 ? (
                  <div className="wallpaper-list">
                    {shownWallpapers.map((p, i) => {
                      const name = p.split(/[\\/]/).pop() ?? `图片 ${i + 1}`
                      return (
                        <div className="wallpaper-list__item" key={p}>
                          <img
                            className="wallpaper-list__thumb"
                            src={convertFileSrc(p)}
                            alt=""
                            loading="lazy"
                          />
                          <span className="wallpaper-list__name" title={p}>
                            {name}
                          </span>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`移除 ${name}`}
                            onClick={() => removeWallpaper(p)}
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="settings__row">
                    <span className="settings__hint">还没有壁纸，点「添加图片…」选择本地图片</span>
                  </div>
                )}

                <div className="settings__row">
                  <span className="settings__label">
                    <strong>显示方式</strong>
                    <span>平铺按原尺寸重复，铺满裁剪填满，完整缩放显示</span>
                  </span>
                  <div className="seg" role="group" aria-label="壁纸显示方式">
                    {FITS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`seg__btn${settings.wallpaperFit === f.id ? ' seg__btn--on' : ''}`}
                        onClick={() => onChange({ wallpaperFit: f.id })}
                        title={f.hint}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings__row">
                  <span className="settings__label">
                    <strong>位置</strong>
                    <span>平铺时忽略，铺满 / 完整时决定图片对齐</span>
                  </span>
                </div>
                <div className="settings__row">
                  <div
                    className={`pos-grid${settings.wallpaperFit === 'tile' ? ' pos-grid--disabled' : ''}`}
                    role="group"
                    aria-label="壁纸位置"
                  >
                    {POSITION_GRID.map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        className={`pos-grid__cell${settings.wallpaperPosition === pos ? ' pos-grid__cell--on' : ''}`}
                        disabled={settings.wallpaperFit === 'tile'}
                        aria-label={WALLPAPER_POSITION_LABEL[pos]}
                        title={WALLPAPER_POSITION_LABEL[pos]}
                        onClick={() => onChange({ wallpaperPosition: pos })}
                      />
                    ))}
                  </div>
                </div>

                <div className="settings__row">
                  <span className="settings__label">
                    <strong>动画壁纸</strong>
                    <span>Ken Burns 缓慢推拉效果，减少动效开启时自动关闭</span>
                  </span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={settings.wallpaperAnim === 'kenburns'}
                      onChange={(e) =>
                        onChange({ wallpaperAnim: e.target.checked ? 'kenburns' : 'none' })
                      }
                      aria-label="动画壁纸"
                    />
                    <span className="switch__track" />
                  </label>
                </div>

                <div className="settings__row">
                  <span className="settings__label">
                    <strong>多图轮播</strong>
                    <span>
                      {shownWallpapers.length >= 2
                        ? '按间隔自动切换，当前有 ' + shownWallpapers.length + ' 张'
                        : '需至少 2 张壁纸才生效'}
                    </span>
                  </span>
                  <div className="seg" role="group" aria-label="轮播间隔">
                    {INTERVALS.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        className={`seg__btn${settings.wallpaperInterval === it.id ? ' seg__btn--on' : ''}`}
                        disabled={shownWallpapers.length < 2 && it.id !== 0}
                        onClick={() => onChange({ wallpaperInterval: it.id })}
                      >
                        {it.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Slider
                  label="壁纸透明度"
                  min={30}
                  max={100}
                  unit="%"
                  value={settings.wallpaperOpacity ?? 100}
                  hint="调低让壁纸若隐若现，露出深色底"
                  onChange={(v) => onChange({ wallpaperOpacity: v })}
                />
              </>
            ) : null}

            <Slider
              label="色调"
              min={0}
              max={360}
              unit="°"
              value={settings.bgHue}
              onChange={(v) => onChange({ bgHue: v })}
            />
            <Slider
              label="颜色深浅"
              min={0}
              max={100}
              unit="%"
              value={settings.bgSaturation}
              onChange={(v) => onChange({ bgSaturation: v })}
            />
            <Slider
              label="背景亮度"
              min={0}
              max={100}
              unit="%"
              value={settings.bgBrightness}
              hint="50 原样 · 100 提亮至纯白（浅色模式）"
              onChange={(v) => onChange({ bgBrightness: v })}
            />
            <Slider
              label="玻璃模糊度"
              min={4}
              max={60}
              unit="px"
              value={settings.glassBlur}
              onChange={(v) => onChange({ glassBlur: v })}
            />
            <Slider
              label="磨砂度"
              min={0}
              max={100}
              unit="%"
              value={settings.glassFrost}
              hint="玻璃面板的雾面磨砂，壁纸模式下同样生效"
              onChange={(v) => onChange({ glassFrost: v })}
            />
          </section>

          <section className="settings__group">
            <h3 className="settings__group-title">数据</h3>

            <div className="settings__row">
              <span className="settings__label">
                <strong>数据文件</strong>
                <span>SQLite 数据库，本地保存。全程离线，不联网</span>
              </span>
              <button type="button" className="btn btn--sm" onClick={onRevealStore}>
                在文件夹中显示
              </button>
            </div>

            <div className="settings__row">
              <span className="settings__label">
                <strong>支持的导入格式</strong>
                <span>txt / md / log / csv / tsv / json / docx（xlsx / pdf 暂不支持）</span>
              </span>
            </div>

            <div className="settings__row">
              <span className="settings__label">
                <strong>快捷键</strong>
                <span>
                  Ctrl+O 导入文件　·　Ctrl+Shift+V 粘贴导入　·　Ctrl+F 搜索　·　Ctrl+N 新建待办　·　Esc 关闭弹层
                </span>
              </span>
            </div>
          </section>
        </div>

        <div className="drawer__foot">
          <span className="drawer__foot-info">GlassTodo 2.0 · S0 打样</span>
          <button type="button" className="btn" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
