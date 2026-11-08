//! BiliMusic 的 Tauri 外壳。
//!
//! 这里只负责三件事：创建窗口、注册 IPC 命令、管理应用生命周期。
//! 业务逻辑按计划拆到 crates/ 下的独立 crate 里，外壳保持薄。

use serde::Serialize;

#[derive(Serialize)]
pub struct Health {
    ok: bool,
    version: &'static str,
    engine: &'static str,
    platform: &'static str,
}

/// 用于确认 IPC 通路与外壳版本，UI 启动时会调用一次。
#[tauri::command]
fn health() -> Health {
    Health {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
        engine: "tauri",
        platform: std::env::consts::OS,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![health])
        .run(tauri::generate_context!())
        .expect("BiliMusic 启动失败");
}
