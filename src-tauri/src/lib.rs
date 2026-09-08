// GlassTodo 2.0（Tauri 2）S0 打样入口
// 窗口：无边框 + 透明 + 云母/亚克力/模糊降级链（对应参考图"云母效果/兼容模式"）
// 命令：load_store / save_store（SQLite）/ read_text_file / parse_docx（导入）

mod store;

use store::{init_db, load_store, parse_docx, save_store};
use tauri::Manager;

/// 读取本地文本文件（导入 txt/csv 等）。路径来自用户对话框/拖拽，仅按需读取。
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 解析 docx（zip 解压 + document.xml 纯文本提取），返回可导入的段落文本。
#[tauri::command]
fn read_docx(path: String) -> Result<String, String> {
  parse_docx(&path)
}

/// 选择壁纸后复制到应用数据目录（原文件移动/删除不影响），返回新文件完整路径。
#[tauri::command]
fn copy_wallpaper(app: tauri::AppHandle, path: String) -> Result<String, String> {
  const EXTS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];
  let ext = path
    .rsplit('.')
    .next()
    .unwrap_or("")
    .to_lowercase();
  if !EXTS.contains(&ext.as_str()) {
    return Err("仅支持 jpg / png / webp 图片作为壁纸".into());
  }
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?
    .join("wallpapers");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let millis = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0);
  let name = format!("wp_{millis}.{ext}");
  std::fs::copy(&path, dir.join(&name)).map_err(|e| e.to_string())?;
  Ok(dir.join(&name).to_string_lossy().to_string())
}

/// 窗口玻璃效果：Win11 22H2+ Mica（云母效果）→ Acrylic → Blur（兼容模式）
fn apply_vibrancy(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  #[cfg(target_os = "windows")]
  {
    if let Some(win) = app.get_webview_window("main") {
      use window_vibrancy::{apply_acrylic, apply_blur, apply_mica};
      // 云母效果（参考图模式）：Win11 22H2+ Mica；失败降级 Acrylic；再降级 Blur（兼容模式）
      if apply_mica(&win, Some(true)).is_err() {
        if apply_acrylic(&win, Some((18, 18, 18, 125))).is_err() {
          let _ = apply_blur(&win, Some((18, 18, 18, 125)));
        }
      }
    }
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      let db = init_db(app.handle()).map_err(|e| e.to_string())?;
      app.manage(db);
      apply_vibrancy(app)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      load_store,
      save_store,
      read_text_file,
      read_docx,
      copy_wallpaper
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
