use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Listener, Manager};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    #[serde(skip)]
    pub generation: u64,
    pub id: String,
    pub source_url: String,
    pub source_account: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    pub loaded: u64,
    pub status: String,
    pub save_path: Option<String>,
    pub save_dir: Option<String>,
    pub error: Option<String>,
}
pub struct Queue {
    running: Mutex<std::collections::HashSet<String>>,
    tasks: Mutex<Vec<Task>>,
    slots: Arc<tokio::sync::Semaphore>,
}
impl Default for Queue {
    fn default() -> Self {
        Self {
            running: Mutex::new(std::collections::HashSet::new()),
            tasks: Mutex::new(Vec::new()),
            slots: Arc::new(tokio::sync::Semaphore::new(2)),
        }
    }
}
fn persist(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        if let Ok(tasks) = app.state::<Queue>().tasks.lock() {
            if let Ok(bytes) = serde_json::to_vec(&*tasks) {
                let _ = std::fs::create_dir_all(&dir);
                let temp = dir.join("native-downloads.tmp");
                if std::fs::write(&temp, bytes).is_ok() {
                    let _ = std::fs::rename(temp, dir.join("native-downloads.json"));
                }
            }
        }
    }
}
fn update(app: &tauri::AppHandle, id: &str, status: &str, error: Option<String>) {
    if let Ok(mut tasks) = app.state::<Queue>().tasks.lock() {
        if let Some(t) = tasks.iter_mut().find(|t| t.id == id) {
            t.status = status.into();
            t.error = error;
        }
    }
    persist(app);
    let _ = app.emit("native-downloads:changed", ());
}
#[tauri::command]
pub fn native_download_snapshot(app: tauri::AppHandle) -> Vec<Task> {
    app.state::<Queue>()
        .tasks
        .lock()
        .map(|v| v.clone())
        .unwrap_or_default()
}
#[tauri::command]
pub fn native_download_cancel(app: tauri::AppHandle, task_id: String) {
    update(&app, &task_id, "cancelled", None);
    crate::cancel_download(app.state(), task_id);
    #[cfg(target_os = "android")]
    if !native_download_snapshot(app.clone())
        .iter()
        .any(|t| t.status == "queued" || t.status == "downloading")
    {
        tauri::async_runtime::spawn_blocking(move || {
            let _: Result<serde_json::Value, _> = app
                .state::<crate::delivery::Bridge>()
                .0
                .run_mobile_plugin("stopDownloads", serde_json::json!({}));
        });
    }
}
fn cancel_all(app: &tauri::AppHandle) {
    for task in native_download_snapshot(app.clone()) {
        if task.status == "queued" || task.status == "downloading" {
            native_download_cancel(app.clone(), task.id)
        }
    }
}
#[tauri::command]
pub async fn native_download_add(
    app: tauri::AppHandle,
    id: String,
    path: String,
    name: String,
    size: u64,
    source_url: String,
    source_account: String,
    save_dir: Option<String>,
) -> Result<(), String> {
    {
        let state = app.state::<crate::AppState>();
        let session = crate::read_session(&state);
        if session.sid.is_empty()
            || session.base_url != source_url
            || session.account != source_account
        {
            return Err("请登录任务来源账号".into());
        }
    }
    #[cfg(target_os = "android")]
    {
        let handle = app.clone();
        let callback = tauri::ipc::Channel::<serde_json::Value>::new(move |message| {
            if let tauri::ipc::InvokeResponseBody::Json(body)=message {
                if let Ok(data)=serde_json::from_str::<serde_json::Value>(&body){match data["reason"].as_str(){Some("open")=>{let _=handle.emit("native-downloads:open",());},Some("cancel")|Some("timeout")=>cancel_all(&handle),_=>{}}}
            }
            Ok(())
        });
        let _: serde_json::Value = app
            .state::<crate::delivery::Bridge>()
            .0
            .run_mobile_plugin("startDownloads", serde_json::json!({"callback":callback}))
            .map_err(|_| "无法启动后台下载服务，请返回前台重试")?;
    }
    static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    if app
        .state::<Queue>()
        .running
        .lock()
        .map_err(|_| "队列不可用")?
        .contains(&id)
    {
        return Err("任务仍在停止，请稍后重试".into());
    }
    if crate::read_cancels(&app.state::<crate::AppState>()).contains_key(&id) {
        return Err("任务仍在停止，请稍后重试".into());
    }
    if let Some(dir) = save_dir.as_ref() {
        let root = std::path::PathBuf::from(crate::get_default_download_dir(app.clone())?);
        std::fs::create_dir_all(&root).map_err(|_| "下载目录不可用")?;
        let target = std::path::PathBuf::from(dir)
            .canonicalize()
            .map_err(|_| "保存目录不存在")?;
        if !target.starts_with(root.canonicalize().map_err(|_| "下载目录不可用")?) {
            return Err("只能保存到应用下载目录".into());
        }
    }
    let task = Task {
        generation: GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        id: id.clone(),
        path,
        name,
        size,
        source_url,
        source_account,
        loaded: 0,
        status: "queued".into(),
        save_path: None,
        save_dir,
        error: None,
    };
    {
        let state = app.state::<Queue>();
        let mut tasks = state.tasks.lock().map_err(|_| "队列不可用")?;
        if let Some(old) = tasks.iter().find(|t| t.id == id) {
            if old.status == "queued" || old.status == "downloading" {
                return Err("任务正在执行".into());
            }
        }
        tasks.retain(|t| t.id != id);
        tasks.push(task.clone());
    }
    persist(&app);
    tauri::async_runtime::spawn(async move {
        let slots = app.state::<Queue>().slots.clone();
        let Ok(_permit) = slots.acquire_owned().await else {
            return;
        };
        if native_download_snapshot(app.clone())
            .iter()
            .find(|t| t.id == id && t.generation == task.generation)
            .map(|t| t.status.as_str())
            != Some("queued")
        {
            return;
        }
        if let Ok(mut running) = app.state::<Queue>().running.lock() {
            running.insert(id.clone());
        }
        update(&app, &id, "downloading", None);
        for attempt in 0..3 {
            let result = crate::download_to_file(
                app.clone(),
                id.clone(),
                task.path.clone(),
                task.name.clone(),
                task.save_dir.clone(),
                task.source_url.clone(),
                task.source_account.clone(),
            )
            .await;
            let current = native_download_snapshot(app.clone())
                .into_iter()
                .find(|t| t.id == id);
            if current.as_ref().map(|t| t.status.as_str()) == Some("cancelled") {
                break;
            }
            match result {
                Ok(()) => {
                    if current.as_ref().map(|t| t.status.as_str()) != Some("done") {
                        update(&app, &id, "cancelled", None)
                    }
                    break;
                }
                Err(error) => {
                    let transient = error.contains("timed out")
                        || error.contains("connection reset")
                        || error.contains("incomplete download");
                    if !transient || attempt == 2 {
                        update(
                            &app,
                            &id,
                            "error",
                            Some("下载失败，请检查连接、权限或登录状态后重试".into()),
                        );
                        break;
                    }
                }
            }
        }
        if let Ok(mut running) = app.state::<Queue>().running.lock() {
            running.remove(&id);
        }
        persist(&app);
        #[cfg(target_os = "android")]
        if !native_download_snapshot(app.clone())
            .iter()
            .any(|t| t.status == "queued" || t.status == "downloading")
        {
            let _: Result<serde_json::Value, _> = app
                .state::<crate::delivery::Bridge>()
                .0
                .run_mobile_plugin("stopDownloads", serde_json::json!({}));
        }
    });
    Ok(())
}
pub fn setup(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        if let Ok(bytes) = std::fs::read(dir.join("native-downloads.json")) {
            if let Ok(mut tasks) = serde_json::from_slice::<Vec<Task>>(&bytes) {
                for task in &mut tasks {
                    if task.status == "queued" || task.status == "downloading" {
                        task.status = "cancelled".into();
                        task.error = Some("等待恢复：请登录来源账号后继续".into())
                    }
                }
                if let Ok(mut target) = app.state::<Queue>().tasks.lock() {
                    *target = tasks
                }
            }
        }
    }
    for event in ["download:progress", "download:done"] {
        let handle = app.clone();
        app.listen(event, move |e| {
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                if let Some(id) = data["taskId"].as_str() {
                    if let Ok(mut tasks) = handle.state::<Queue>().tasks.lock() {
                        if let Some(task) = tasks.iter_mut().find(|t| t.id == id) {
                            if event == "download:done" {
                                task.status = "done".into();
                                task.save_path = data["savePath"].as_str().map(String::from)
                            } else {
                                task.loaded = data["loaded"].as_u64().unwrap_or(task.loaded);
                                if let Some(total) = data["total"].as_u64().filter(|n| *n > 0) {
                                    task.size = total
                                }
                            }
                        }
                    }
                    let _ = handle.emit("native-downloads:changed", ());
                    #[cfg(target_os = "android")]
                    {
                        static LAST: std::sync::atomic::AtomicU64 =
                            std::sync::atomic::AtomicU64::new(0);
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        let old = LAST.swap(now, std::sync::atomic::Ordering::Relaxed);
                        if now > old {
                            let tasks = native_download_snapshot(handle.clone());
                            let total: u64 = tasks
                                .iter()
                                .filter(|t| t.status == "queued" || t.status == "downloading")
                                .map(|t| t.size)
                                .sum();
                            let loaded: u64 = tasks
                                .iter()
                                .filter(|t| t.status == "queued" || t.status == "downloading")
                                .map(|t| t.loaded)
                                .sum();
                            let pct = if total > 0 {
                                ((loaded as f64 / total as f64) * 100.0).min(100.0) as u32
                            } else {
                                0
                            };
                            let _: Result<serde_json::Value, _> = handle
                                .state::<crate::delivery::Bridge>()
                                .0
                                .run_mobile_plugin(
                                    "updateDownloads",
                                    serde_json::json!({"percent":pct}),
                                );
                        }
                    }
                }
            }
        });
    }
}
#[tauri::command]
pub fn native_download_remove(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    {
        let state = app.state::<Queue>();
        let mut tasks = state.tasks.lock().map_err(|_| "队列不可用")?;
        if tasks
            .iter()
            .any(|t| t.id == task_id && (t.status == "queued" || t.status == "downloading"))
        {
            return Err("请先取消任务".into());
        }
        tasks.retain(|t| t.id != task_id);
    }
    persist(&app);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn task_metadata_never_contains_session_credentials() {
        let task = Task {
            generation: 0,
            id: "id".into(),
            source_url: "https://nas".into(),
            source_account: "user".into(),
            path: "/file".into(),
            name: "file".into(),
            size: 1,
            loaded: 0,
            status: "queued".into(),
            save_path: None,
            save_dir: None,
            error: None,
        };
        let json = serde_json::to_value(task).unwrap();
        assert!(json.get("sid").is_none());
        assert!(json.get("password").is_none());
        assert!(json.get("token").is_none());
    }
    #[tokio::test]
    async fn native_workers_are_limited_to_two() {
        let queue = Queue::default();
        let _first = queue.slots.acquire().await.unwrap();
        let _second = queue.slots.acquire().await.unwrap();
        assert!(queue.slots.try_acquire().is_err());
    }
}
