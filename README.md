# GlassTodo

玻璃拟态待办事项桌面应用 —— 用 **Tauri 2** 重写的轻量版。

原 Electron 版（4 进程 480~575MB 内存 / 128MB 安装包）重写为单进程 ~31MB / 2.5MB 安装包，功能与视觉对齐原版，并新增完整壁纸体系。

## 性能对比

| 指标 | Electron 旧版 | Tauri 2 新版 |
|---|---|---|
| 安装包 | 128MB | **2.5MB** |
| 运行内存 | 4 进程 480~575MB | **单进程 ~31MB** |
| exe | — | 6.3MB |

## 功能

- ✅ 待办管理：清单 / 优先级 / 截止日期 / 标签 / 子任务 / 搜索
- ✅ 重启不丢数据：SQLite WAL 四表持久化（lists / tasks / settings / meta）
- ✅ 壁纸体系：平铺/缩放/九宫格位置、Ken Burns 动画壁纸、多图轮播（30s/1min/5min）、壁纸透明度
- ✅ 玻璃拟态背景：流体/壁纸双模式、模糊度/磨砂度/色调/深浅/亮度全部可调（Win11 Mica → Win10 Acrylic → 模糊降级链）
- ✅ 无边框窗口：拖拽、最小化/最大化/关闭
- ✅ 导入：拖拽 / 文件选择 / 剪贴板粘贴，支持 txt / md / log / csv / tsv / json / **docx**（Rust 原生解析）
- ✅ 主题：cool（更多主题规划中）

## 技术栈

- **桌面壳**：Tauri 2（Rust）
- **前端**：React 18 + TypeScript + Vite（压缩后 JS 265KB / gzip 84KB）
- **存储**：SQLite（rusqlite bundled，零系统依赖）
- **玻璃效果**：window-vibrancy（Mica / Acrylic / Blur 降级链）

## 快速开始

```bash
# 依赖：Rust stable-msvc、VS Build Tools、Node 18+
npm install
npm run tauri dev        # 开发模式
npm run tauri build      # 打包 NSIS 安装包（产物在 src-tauri/target/release/bundle/）
```

> 注意：release 构建必须用 `npx tauri build`（裸 `cargo build --release` 会回连 devUrl 导致弹浏览器）。

## 目录结构

```
src/              React 前端（components / lib / shared / store / styles）
src-tauri/        Rust 后端（lib.rs 命令注册、store.rs 存储与 docx 解析）
  capabilities/   Tauri 2 权限声明
  icons/          应用图标（由原版图标生成全套尺寸）
```

## 测试

```bash
cd src-tauri && cargo test   # 7 个单测：存储往返 / 旧库兼容 / 空库默认 / docx 解析
```

## 已知边界

- xlsx / pdf 导入暂不支持
- 数据与 Electron 旧版不自动迁移
