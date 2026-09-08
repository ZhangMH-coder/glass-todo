//! SQLite 存储层：lists/tasks/settings/meta 四表。
//! 核心逻辑在 `*_impl` 纯函数（可单测），Tauri 命令只做 State 解包。
//! 每次写即时 commit（WAL），重启不丢失。

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
  pub theme: String,
  pub glass: bool,
  pub reduce_motion: bool,
  // 背景（参考图参数：模式/色调/颜色深浅/背景亮度/玻璃模糊度/磨砂度/壁纸）
  pub bg_mode: String,
  pub bg_hue: f64,
  pub bg_saturation: f64,
  pub bg_lightness: f64,
  pub bg_brightness: f64,
  pub glass_blur: f64,
  pub glass_frost: f64,
  pub wallpaper_path: Option<String>,
  // 壁纸三项增强（S0 后补：平铺/缩放/位置 + 动画 + 多图轮播）
  // 全部 #[serde(default)]：旧库 JSON 缺字段时回退默认，不破坏重启读取
  #[serde(default = "default_wallpaper_fit")]
  pub wallpaper_fit: String,
  #[serde(default = "default_wallpaper_position")]
  pub wallpaper_position: String,
  #[serde(default = "default_wallpaper_anim")]
  pub wallpaper_anim: String,
  #[serde(default)]
  pub wallpaper_interval: i64,
  #[serde(default)]
  pub wallpaper_list: Vec<String>,
  #[serde(default = "default_wallpaper_opacity")]
  pub wallpaper_opacity: i64,
}

fn default_wallpaper_fit() -> String { "cover".into() }
fn default_wallpaper_position() -> String { "center".into() }
fn default_wallpaper_anim() -> String { "none".into() }
fn default_wallpaper_opacity() -> i64 { 100 }

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TodoList {
  pub id: String,
  pub name: String,
  pub color: String,
  pub order: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskSource {
  pub file_name: Option<String>,
  pub line: Option<i64>,
  pub imported_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Task {
  pub id: String,
  pub title: String,
  pub notes: Option<String>,
  pub status: String,
  pub priority: String,
  pub due: Option<String>,
  pub tags: Vec<String>,
  pub assignee: Option<String>,
  pub parent_id: Option<String>,
  pub list_id: String,
  pub order: i64,
  pub source: Option<TaskSource>,
  pub created_at: String,
  pub updated_at: String,
  pub completed_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Store {
  pub schema_version: i64,
  pub lists: Vec<TodoList>,
  pub tasks: Vec<Task>,
  pub settings: Settings,
}

pub struct Db(pub Mutex<Connection>);

const INBOX_LIST_ID: &str = "inbox";

fn ensure_schema(conn: &Connection) -> Result<(), String> {
  conn
    .execute_batch(
      "CREATE TABLE IF NOT EXISTS lists(
       id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, ord INTEGER NOT NULL);
     CREATE TABLE IF NOT EXISTS tasks(
       id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, status TEXT NOT NULL,
       priority TEXT NOT NULL, due TEXT, tags TEXT NOT NULL DEFAULT '[]', assignee TEXT,
       parent_id TEXT, list_id TEXT NOT NULL, ord INTEGER NOT NULL,
       source_file TEXT, source_line INTEGER, imported_at TEXT,
       created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
       FOREIGN KEY(list_id) REFERENCES lists(id));
     CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id, ord);
     CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())
}

pub fn default_store() -> Store {
  Store {
    schema_version: 1,
    lists: vec![
      TodoList { id: INBOX_LIST_ID.into(), name: "收件箱".into(), color: "#7aa2ff".into(), order: 0 },
      TodoList { id: "work".into(), name: "工作".into(), color: "#5ee6c0".into(), order: 1 },
      TodoList { id: "personal".into(), name: "个人".into(), color: "#ffb86b".into(), order: 2 },
    ],
    tasks: vec![],
    settings: Settings {
      theme: "dark".into(),
      glass: true,
      reduce_motion: false,
      bg_mode: "fluid".into(),
      bg_hue: 316.0,
      bg_saturation: 36.0,
      bg_lightness: 58.0,
      bg_brightness: 50.0,
      glass_blur: 24.0,
      glass_frost: 55.0,
      wallpaper_path: None,
      wallpaper_fit: "cover".into(),
      wallpaper_position: "center".into(),
      wallpaper_anim: "none".into(),
      wallpaper_interval: 0,
      wallpaper_list: vec![],
      wallpaper_opacity: 100,
    },
  }
}

pub fn init_db(app: &AppHandle) -> Result<Db, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let path = dir.join("glass-todo.db");
  let conn = Connection::open(&path).map_err(|e| e.to_string())?;
  // WAL：崩溃恢复 + 读写不互斥
  let _ = conn.pragma_update(None, "journal_mode", "WAL");
  let _ = conn.pragma_update(None, "foreign_keys", "ON");

  ensure_schema(&conn)?;

  Ok(Db(Mutex::new(conn)))
}

fn tags_to_json(tags: &[String]) -> String {
  serde_json::to_string(tags).unwrap_or_else(|_| "[]".into())
}

fn tags_from_json(s: &str) -> Vec<String> {
  serde_json::from_str(s).unwrap_or_default()
}

/* ---------------- 核心逻辑（纯函数，可单测） ---------------- */

pub fn load_store_impl(conn: &Connection) -> Result<Store, String> {
  let mut store = default_store();

  let mut list_stmt = conn
    .prepare("SELECT id, name, color, ord FROM lists ORDER BY ord")
    .map_err(|e| e.to_string())?;
  let lists = list_stmt
    .query_map([], |r| {
      Ok(TodoList { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, order: r.get(3)? })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
  if !lists.is_empty() {
    store.lists = lists;
  }

  let mut task_stmt = conn
    .prepare(
      "SELECT id, title, notes, status, priority, due, tags, assignee, parent_id, list_id, ord,
              source_file, source_line, imported_at, created_at, updated_at, completed_at
       FROM tasks ORDER BY ord",
    )
    .map_err(|e| e.to_string())?;
  let tasks = task_stmt
    .query_map([], |r| {
      let notes: Option<String> = r.get(2)?;
      let source_file: Option<String> = r.get(11)?;
      let source_line: Option<i64> = r.get(12)?;
      let imported_at: Option<String> = r.get(13)?;
      let source = match (source_file, source_line, imported_at) {
        (Some(file_name), line, Some(imported_at)) => {
          Some(TaskSource { file_name: Some(file_name), line, imported_at })
        }
        _ => None,
      };
      Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        notes,
        status: r.get(3)?,
        priority: r.get(4)?,
        due: r.get(5)?,
        tags: tags_from_json(&r.get::<_, String>(6)?),
        assignee: r.get(7)?,
        parent_id: r.get(8)?,
        list_id: r.get(9)?,
        order: r.get(10)?,
        source,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
        completed_at: r.get(16)?,
      })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
  store.tasks = tasks;

  // settings 整体存 JSON 单行（旧库逐 key 三字段自动回退默认，无需迁移）
  if let Ok(json) = conn.query_row("SELECT value FROM settings WHERE key = 'settings_json'", [], |r| r.get::<_, String>(0)) {
    if let Ok(s) = serde_json::from_str::<Settings>(&json) {
      store.settings = s;
    }
  }

  Ok(store)
}

pub fn save_store_impl(conn: &mut Connection, store: &Store) -> Result<(), String> {
  let tx = conn.transaction().map_err(|e| e.to_string())?;
  tx.execute("DELETE FROM tasks", []).map_err(|e| e.to_string())?;
  tx.execute("DELETE FROM lists", []).map_err(|e| e.to_string())?;

  for l in &store.lists {
    tx.execute(
      "INSERT INTO lists(id, name, color, ord) VALUES (?1, ?2, ?3, ?4)",
      params![l.id, l.name, l.color, l.order],
    )
    .map_err(|e| e.to_string())?;
  }
  // 保证 inbox 存在（列表可能被前端删掉，inbox 是兜底）
  let has_inbox = store.lists.iter().any(|l| l.id == INBOX_LIST_ID);
  if !has_inbox {
    tx.execute(
      "INSERT OR IGNORE INTO lists(id, name, color, ord) VALUES (?1, '收件箱', '#7aa2ff', 0)",
      params![INBOX_LIST_ID],
    )
    .map_err(|e| e.to_string())?;
  }

  for t in &store.tasks {
    tx.execute(
      "INSERT INTO tasks(id, title, notes, status, priority, due, tags, assignee, parent_id, list_id, ord,
        source_file, source_line, imported_at, created_at, updated_at, completed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
      params![
        t.id, t.title, t.notes, t.status, t.priority, t.due, tags_to_json(&t.tags), t.assignee,
        t.parent_id, t.list_id, t.order,
        t.source.as_ref().and_then(|s| s.file_name.clone()),
        t.source.as_ref().and_then(|s| s.line),
        t.source.as_ref().map(|s| s.imported_at.clone()),
        t.created_at, t.updated_at, t.completed_at
      ],
    )
    .map_err(|e| e.to_string())?;
  }

  tx.execute("DELETE FROM settings", []).map_err(|e| e.to_string())?;
  let settings_json = serde_json::to_string(&store.settings).map_err(|e| e.to_string())?;
  tx.execute(
    "INSERT INTO settings(key, value) VALUES ('settings_json', ?1)",
    params![settings_json],
  )
  .map_err(|e| e.to_string())?;

  tx.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?1)",
    params![store.schema_version.to_string()])
    .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())
}

/* ---------------- Tauri 命令（State 解包） ---------------- */

/// 读全量 → Store
#[tauri::command]
pub fn load_store(db: State<'_, Db>) -> Result<Store, String> {
  let conn = db.0.lock().map_err(|e| e.to_string())?;
  load_store_impl(&conn)
}

/// 全量写回（事务）
#[tauri::command]
pub fn save_store(db: State<'_, Db>, store: Store) -> Result<(), String> {
  let mut conn = db.0.lock().map_err(|e| e.to_string())?;
  save_store_impl(&mut conn, &store)
}

/// 解析 docx：解压 zip → 提取 word/document.xml 的 <w:t> 纯文本（段落换行、反转义）
pub fn parse_docx(path: &str) -> Result<String, String> {
  let file = std::fs::File::open(path).map_err(|e| format!("无法打开文件: {e}"))?;
  let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("不是有效的 docx 文件: {e}"))?;
  let mut entry = archive
    .by_name("word/document.xml")
    .map_err(|_| "docx 缺少 word/document.xml（可能不是 Word 文档）".to_string())?;
  let mut buf = Vec::new();
  std::io::Read::read_to_end(&mut entry, &mut buf)
    .map_err(|e| format!("读取文档内容失败: {e}"))?;
  let xml = String::from_utf8_lossy(&buf);
  Ok(docx_xml_to_text(&xml))
}

/// document.xml → 纯文本：段落成行、段内 <w:tab/>→制表符、<w:br/>→换行、反转义
pub fn docx_xml_to_text(xml: &str) -> String {
  let re_p = regex::Regex::new(r"(?s)<w:p[ >].*?</w:p>").expect("valid regex");
  let re_t = regex::Regex::new(r"(?s)<w:t[^>]*>(.*?)</w:t>").expect("valid regex");
  let re_tab = regex::Regex::new(r"<w:tab\s*/>").expect("valid regex");
  let re_br = regex::Regex::new(r"<w:br\s*/>").expect("valid regex");

  let mut out: Vec<String> = Vec::new();
  for p in re_p.find_iter(xml) {
    let seg = re_tab.replace_all(p.as_str(), "\t");
    let seg = re_br.replace_all(&seg, "\n");
    let mut line = String::new();
    for cap in re_t.captures_iter(&seg) {
      line.push_str(&cap[1]);
    }
    let line = line
      .replace("&amp;", "&")
      .replace("&lt;", "<")
      .replace("&gt;", ">")
      .replace("&quot;", "\"")
      .replace("&apos;", "'")
      .replace("&#39;", "'");
    if !line.trim().is_empty() {
      out.push(line.trim_end().to_string());
    }
  }
  out.join("\n")
}

#[cfg(test)]
mod tests {
  use super::*;

  fn test_store() -> Store {
    Store {
      schema_version: 1,
      lists: vec![
        TodoList { id: "inbox".into(), name: "收件箱".into(), color: "#7aa2ff".into(), order: 0 },
        TodoList { id: "work".into(), name: "工作".into(), color: "#5ee6c0".into(), order: 1 },
      ],
      tasks: vec![
        Task {
          id: "task_1".into(),
          title: "买牛奶".into(),
          notes: Some("全脂 500ml".into()),
          status: "todo".into(),
          priority: "high".into(),
          due: Some("2026-09-10".into()),
          tags: vec!["生活".into(), "超市".into()],
          assignee: Some("我".into()),
          parent_id: None,
          list_id: "inbox".into(),
          order: 0,
          source: Some(TaskSource {
            file_name: Some("todo.txt".into()),
            line: Some(3),
            imported_at: "2026-09-07T00:00:00Z".into(),
          }),
          created_at: "2026-09-07T00:00:00Z".into(),
          updated_at: "2026-09-07T00:00:00Z".into(),
          completed_at: None,
        },
        Task {
          id: "task_2".into(),
          title: "子任务".into(),
          notes: None,
          status: "done".into(),
          priority: "normal".into(),
          due: None,
          tags: vec![],
          assignee: None,
          parent_id: Some("task_1".into()),
          list_id: "inbox".into(),
          order: 1,
          source: None,
          created_at: "2026-09-07T00:00:00Z".into(),
          updated_at: "2026-09-07T00:00:00Z".into(),
          completed_at: Some("2026-09-07T01:00:00Z".into()),
        },
      ],
      settings: Settings {
        theme: "cool".into(),
        glass: true,
        reduce_motion: false,
        bg_mode: "wallpaper".into(),
        bg_hue: 200.0,
        bg_saturation: 40.0,
        bg_lightness: 55.0,
        bg_brightness: 70.0,
        glass_blur: 18.0,
        glass_frost: 40.0,
        wallpaper_path: Some(
          "C:\\Users\\x\\AppData\\Roaming\\com.glasstodo.app\\wallpapers\\wp_1.png".into(),
        ),
        wallpaper_fit: "tile".into(),
        wallpaper_position: "top-left".into(),
        wallpaper_anim: "kenburns".into(),
        wallpaper_interval: 60,
        wallpaper_list: vec![
          "C:\\Users\\x\\AppData\\Roaming\\com.glasstodo.app\\wallpapers\\wp_1.png".into(),
          "C:\\Users\\x\\AppData\\Roaming\\com.glasstodo.app\\wallpapers\\wp_2.png".into(),
        ],
        wallpaper_opacity: 85,
      },
    }
  }

  /// 核心验收：save → load 往返不丢任何字段（数据重启不丢失的存储层保证）
  #[test]
  fn save_load_roundtrip_preserves_all_fields() {
    let mut conn = Connection::open_in_memory().unwrap();
    ensure_schema(&conn).unwrap();
    let expected = test_store();

    save_store_impl(&mut conn, &expected).unwrap();
    let loaded = load_store_impl(&conn).unwrap();

    assert_eq!(loaded.lists.len(), 2);
    assert_eq!(loaded.lists[0].id, "inbox");
    assert_eq!(loaded.lists[1].name, "工作");

    assert_eq!(loaded.tasks.len(), 2);
    let t1 = &loaded.tasks[0];
    assert_eq!(t1.title, "买牛奶");
    assert_eq!(t1.notes.as_deref(), Some("全脂 500ml"));
    assert_eq!(t1.status, "todo");
    assert_eq!(t1.priority, "high");
    assert_eq!(t1.due.as_deref(), Some("2026-09-10"));
    assert_eq!(t1.tags, vec!["生活", "超市"]);
    assert_eq!(t1.assignee.as_deref(), Some("我"));
    assert_eq!(t1.list_id, "inbox");
    assert_eq!(t1.source.as_ref().unwrap().file_name.as_deref(), Some("todo.txt"));
    assert_eq!(t1.source.as_ref().unwrap().line, Some(3));
    let t2 = &loaded.tasks[1];
    assert_eq!(t2.status, "done");
    assert_eq!(t2.parent_id.as_deref(), Some("task_1"));
    assert_eq!(t2.completed_at.as_deref(), Some("2026-09-07T01:00:00Z"));

    assert_eq!(loaded.settings.theme, "cool");
    assert_eq!(loaded.settings.bg_mode, "wallpaper");
    assert_eq!(loaded.settings.bg_hue, 200.0);
    assert_eq!(loaded.settings.bg_saturation, 40.0);
    assert_eq!(loaded.settings.bg_brightness, 70.0);
    assert_eq!(loaded.settings.glass_blur, 18.0);
    assert_eq!(loaded.settings.glass_frost, 40.0);
    assert_eq!(
      loaded.settings.wallpaper_path.as_deref(),
      Some("C:\\Users\\x\\AppData\\Roaming\\com.glasstodo.app\\wallpapers\\wp_1.png")
    );
    // 壁纸三项增强往返
    assert_eq!(loaded.settings.wallpaper_fit, "tile");
    assert_eq!(loaded.settings.wallpaper_position, "top-left");
    assert_eq!(loaded.settings.wallpaper_anim, "kenburns");
    assert_eq!(loaded.settings.wallpaper_interval, 60);
    assert_eq!(loaded.settings.wallpaper_opacity, 85);
    assert_eq!(loaded.settings.wallpaper_list.len(), 2);
    assert_eq!(
      loaded.settings.wallpaper_list[1],
      "C:\\Users\\x\\AppData\\Roaming\\com.glasstodo.app\\wallpapers\\wp_2.png"
    );
  }

  /// 旧库 settings JSON 缺壁纸三项字段时，加载不失败并回退默认（向前兼容）
  #[test]
  fn legacy_settings_json_missing_wallpaper_fields_falls_back() {
    let mut conn = Connection::open_in_memory().unwrap();
    ensure_schema(&conn).unwrap();
    // 模拟旧版本写入的 settings 单行 JSON（无 wallpaperFit 等新字段）
    let legacy = r#"{"theme":"warm","glass":true,"reduceMotion":false,"bgMode":"fluid","bgHue":210.0,"bgSaturation":40.0,"bgLightness":55.0,"bgBrightness":60.0,"glassBlur":18.0,"glassFrost":40.0}"#;
    conn.execute(
      "INSERT INTO settings(key, value) VALUES ('settings_json', ?1)",
      params![legacy],
    )
    .unwrap();

    let store = load_store_impl(&conn).unwrap();
    assert_eq!(store.settings.theme, "warm");
    assert_eq!(store.settings.bg_hue, 210.0);
    // 新字段回退默认值
    assert_eq!(store.settings.wallpaper_fit, "cover");
    assert_eq!(store.settings.wallpaper_position, "center");
    assert_eq!(store.settings.wallpaper_anim, "none");
    assert_eq!(store.settings.wallpaper_interval, 0);
    assert!(store.settings.wallpaper_list.is_empty());
    assert_eq!(store.settings.wallpaper_opacity, 100);
    // 老字段照常读回
    assert_eq!(store.settings.glass_blur, 18.0);
  }

  /// 空库首读返回默认三清单与默认设置
  #[test]
  fn empty_db_returns_defaults() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_schema(&conn).unwrap();
    let store = load_store_impl(&conn).unwrap();
    assert_eq!(store.lists.len(), 3);
    assert_eq!(store.tasks.len(), 0);
    assert_eq!(store.settings.theme, "dark");
    assert_eq!(store.settings.bg_hue, 316.0);
  }

  /// 无 inbox 的 store 保存后仍兜底 inbox
  #[test]
  fn save_without_inbox_keeps_inbox_fallback() {
    let mut conn = Connection::open_in_memory().unwrap();
    ensure_schema(&conn).unwrap();
    let mut store = test_store();
    store.lists.retain(|l| l.id != "inbox");
    save_store_impl(&mut conn, &store).unwrap();
    let loaded = load_store_impl(&conn).unwrap();
    assert!(loaded.lists.iter().any(|l| l.id == "inbox"));
  }

  /// docx XML → 纯文本：段落分行、run 拼接、实体反转义
  #[test]
  fn docx_xml_to_text_extracts_paragraphs() {
    let xml = r#"<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>9月10号生日</w:t></w:r></w:p>
<w:p><w:r><w:t>买 &amp; 取快递</w:t></w:r><w:r><w:t xml:space="preserve">（二楼）</w:t></w:r></w:p>
<w:p><w:r><w:t>   </w:t></w:r></w:p>
<w:p><w:r><w:t>查 <w:tab/> 余量</w:t></w:r></w:p>
</w:body></w:document>"#;
    let text = docx_xml_to_text(xml);
    assert!(text.contains("9月10号生日"));
    assert!(text.contains("买 & 取快递（二楼）"));
    assert!(text.contains("查 \t 余量"));
    // 空段落被跳过：共 3 个非空行
    assert_eq!(text.lines().count(), 3);
  }

  /// 非 docx 文件解析报错信息可读
  #[test]
  fn parse_docx_rejects_invalid_file() {
    let err = parse_docx("C:\\windows\\system32\\notepad.exe").unwrap_err();
    assert!(err.contains("docx") || err.contains("zip") || err.contains("打开"));
  }

  /// 真实 docx 文件（zip 打包 document.xml）端到端解析
  #[test]
  fn parse_docx_real_file_roundtrip() {
    use std::io::Write;
    let path = std::env::temp_dir().join("gt_docx_roundtrip.docx");
    let file = std::fs::File::create(&path).unwrap();
    let mut w = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();
    w.start_file("word/document.xml", opts).unwrap();
    w.write_all(
      r#"<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>端到端 docx 测试任务</w:t></w:r></w:p>
<w:p><w:r><w:t>第二行 &amp; 转义</w:t></w:r></w:p></w:body></w:document>"#
        .as_bytes(),
    )
    .unwrap();
    w.finish().unwrap();

    let text = parse_docx(path.to_str().unwrap()).unwrap();
    assert!(text.contains("端到端 docx 测试任务"));
    assert!(text.contains("第二行 & 转义"));
    assert_eq!(text.lines().count(), 2);
    std::fs::remove_file(&path).ok();
  }
}
