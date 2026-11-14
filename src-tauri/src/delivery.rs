use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;
#[derive(Default)]
pub struct Completed(pub Mutex<HashMap<String, String>>);
fn receipts(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("completed-downloads.json"))
}
pub fn register(app: &tauri::AppHandle, id: String, path: String) {
    if let Ok(mut m) = app.state::<Completed>().0.lock() {
        if m.is_empty() {
            if let Some(p) = receipts(app) {
                if let Ok(bytes) = std::fs::read(p) {
                    *m = serde_json::from_slice(&bytes).unwrap_or_default()
                }
            }
        }
        m.insert(id, path);
        if let Some(p) = receipts(app) {
            if let Ok(bytes) = serde_json::to_vec(&*m) {
                let _ = std::fs::write(p, bytes);
            }
        }
    }
}
fn completed_path(app: &tauri::AppHandle, id: &str) -> Result<String, String> {
    let state = app.state::<Completed>();
    let mut m = state.0.lock().map_err(|_| "任务状态不可用")?;
    if m.is_empty() {
        if let Some(p) = receipts(app) {
            if let Ok(bytes) = std::fs::read(p) {
                *m = serde_json::from_slice(&bytes).unwrap_or_default()
            }
        }
    }
    m.get(id)
        .cloned()
        .ok_or("该任务没有已验证的完成文件".into())
}
#[cfg(target_os = "android")]
pub struct Bridge(pub tauri::plugin::PluginHandle<tauri::Wry>);
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("delivery")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                app.manage(Bridge(api.register_android_plugin(
                    "com.zhoujianxiang.synolink",
                    "DeliveryPlugin",
                )?));
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
#[tauri::command]
pub async fn deliver_download(
    app: tauri::AppHandle,
    task_id: String,
    share: bool,
) -> Result<bool, String> {
    let path = completed_path(&app, &task_id)?;
    let root = std::path::PathBuf::from(crate::get_default_download_dir(app.clone())?)
        .canonicalize()
        .map_err(|_| "下载目录不可用")?;
    let file = std::path::PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "下载文件不存在")?;
    if !file.starts_with(root) || !file.is_file() {
        return Err("只能导出应用下载目录中的已完成文件".into());
    }
    #[cfg(target_os = "android")]
    {
        let result: serde_json::Value = app
            .state::<Bridge>()
            .0
            .run_mobile_plugin(
                "deliver",
                serde_json::json!({"path":file.to_string_lossy(),"share":share}),
            )
            .map_err(|_| "文件交付失败")?;
        return Ok(result["saved"].as_bool().unwrap_or(false));
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = share;
        Err("此操作仅适用于安卓".into())
    }
}
#[tauri::command]
pub async fn export_android_report(app: tauri::AppHandle, report: String, kind: Option<String>) -> Result<bool, String> {
    if report.len() > 262144 || serde_json::from_str::<serde_json::Value>(&report).is_err() {
        return Err("无效报告".into());
    }
    #[cfg(target_os = "android")]
    {
        let path = app
            .path()
            .app_data_dir()
            .map_err(|_| "应用目录不可用")?
            .join(if kind.as_deref() == Some("container-log") { "SynoLink-container-log.json" } else { "SynoLink-diagnostics.json" });
        std::fs::write(&path, report).map_err(|_| "报告写入失败")?;
        let result: serde_json::Value = app
            .state::<Bridge>()
            .0
            .run_mobile_plugin(
                "deliver",
                serde_json::json!({"path":path.to_string_lossy(),"share":false}),
            )
            .map_err(|_| "报告导出失败")?;
        return Ok(result["saved"].as_bool().unwrap_or(false));
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("此操作仅适用于安卓".into())
    }
}
