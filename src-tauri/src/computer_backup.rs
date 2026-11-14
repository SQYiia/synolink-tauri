use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tokio::io::AsyncReadExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    id: String,
    name: String,
    source: String,
    destination: String,
    source_url: String,
    account: String,
    status: String,
    message: String,
    output: String,
    total: usize,
    completed: usize,
    bytes: u64,
    current: String,
}
#[derive(Default)]
pub struct Backups {
    tasks: Mutex<Vec<Task>>,
    running: AtomicBool,
    cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法访问任务存储目录")?;
    std::fs::create_dir_all(&dir).map_err(|_| "无法创建任务存储目录")?;
    Ok(dir.join("computer-backups.json"))
}
fn persist(app: &tauri::AppHandle, tasks: &[Task]) -> Result<(), String> {
    let path = store_path(app)?;
    let temp = path.with_extension("tmp");
    std::fs::write(
        &temp,
        serde_json::to_vec(tasks).map_err(|_| "无法编码备份任务")?,
    )
    .map_err(|_| "无法保存备份任务")?;
    std::fs::rename(temp, path).map_err(|_| "无法保存备份任务".into())
}
pub fn setup(app: &tauri::AppHandle) {
    if let Ok(path) = store_path(app) {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(mut tasks) = serde_json::from_slice::<Vec<Task>>(&bytes) {
                for t in &mut tasks {
                    if matches!(
                        t.status.as_str(),
                        "scanning" | "uploading" | "verifying" | "cancelling"
                    ) {
                        t.status = "interrupted".into();
                        t.message =
                            "上次备份已中断，已上传文件保留；再次执行将创建新的备份目录".into();
                    }
                }
                *app.state::<Backups>().tasks.lock().unwrap() = tasks;
            }
        }
    }
}
fn update(app: &tauri::AppHandle, id: &str, change: impl FnOnce(&mut Task)) {
    if let Some(t) = app
        .state::<Backups>()
        .tasks
        .lock()
        .unwrap()
        .iter_mut()
        .find(|t| t.id == id)
    {
        change(t)
    }
}
fn scope(app: &tauri::AppHandle, url: &str, account: &str) -> Result<crate::Session, String> {
    let s = crate::read_session(&app.state::<crate::AppState>());
    if s.sid.is_empty() || s.base_url != url || s.account != account {
        return Err("请登录任务来源服务器和账号".into());
    }
    Ok(s)
}
fn valid_destination(path: &str) -> bool {
    path.starts_with('/')
        && path != "/"
        && !path.contains('\\')
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .skip(1)
            .all(|s| !s.is_empty() && s != "." && s != "..")
}
fn new_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    )
}
#[tauri::command]
pub fn computer_backup_snapshot(
    app: tauri::AppHandle,
    source_url: String,
    account: String,
) -> Result<Vec<Task>, String> {
    scope(&app, &source_url, &account)?;
    Ok(app
        .state::<Backups>()
        .tasks
        .lock()
        .unwrap()
        .iter()
        .filter(|t| t.source_url == source_url && t.account == account)
        .cloned()
        .collect())
}
#[tauri::command]
pub async fn computer_backup_create(
    app: tauri::AppHandle,
    name: String,
    source: String,
    destination: String,
    source_url: String,
    account: String,
) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("电脑文件夹备份仅支持 Windows".into());
    }
    scope(&app, &source_url, &account)?;
    if name.trim().is_empty() || name.chars().count() > 80 || !valid_destination(&destination) {
        return Err("请填写任务名称并选择 NAS 目标目录".into());
    }
    let path = PathBuf::from(&source);
    if !path.is_absolute() || !path.is_dir() {
        return Err("请选择可访问的本地文件夹".into());
    }
    let source = std::fs::canonicalize(path)
        .map_err(|_| "无法读取本地目录")?
        .to_string_lossy()
        .into_owned();
    let state = app.state::<Backups>();
    let mut tasks = state.tasks.lock().unwrap();
    if tasks.len() >= 100 {
        return Err("备份任务数量已达上限，请移除不用的任务".into());
    }
    let task = Task {
        id: new_id(),
        name: name.trim().into(),
        source,
        destination,
        source_url,
        account,
        status: "idle".into(),
        message: String::new(),
        output: String::new(),
        total: 0,
        completed: 0,
        bytes: 0,
        current: String::new(),
    };
    let mut next = tasks.clone();
    next.push(task);
    persist(&app, &next)?;
    *tasks = next;
    Ok(())
}
#[tauri::command]
pub fn computer_backup_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<Backups>();
    let mut tasks = state.tasks.lock().unwrap();
    let t = tasks.iter().find(|t| t.id == id).ok_or("任务不存在")?;
    scope(&app, &t.source_url, &t.account)?;
    if state.cancel.lock().unwrap().contains_key(&id) {
        return Err("请先取消正在执行的任务".into());
    }
    let next: Vec<_> = tasks.iter().filter(|t| t.id != id).cloned().collect();
    persist(&app, &next)?;
    *tasks = next;
    Ok(())
}
#[tauri::command]
pub fn computer_backup_cancel(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<Backups>();
    let tasks = state.tasks.lock().unwrap();
    let task = tasks.iter().find(|t| t.id == id).ok_or("任务不存在")?;
    scope(&app, &task.source_url, &task.account)?;
    if let Some(flag) = state.cancel.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
#[derive(Clone)]
struct Entry {
    local: PathBuf,
    relative: String,
    size: u64,
    modified: Option<SystemTime>,
    directory: bool,
}
fn scan(root: &Path, cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
    let mut out = Vec::new();
    let mut dirs = vec![root.to_path_buf()];
    while let Some(dir) = dirs.pop() {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        for item in std::fs::read_dir(dir).map_err(|_| "部分本地目录无法读取，请检查权限")?
        {
            if cancel.load(Ordering::Relaxed) {
                return Err("已取消".into());
            }
            let path = item.map_err(|_| "无法读取本地文件")?.path();
            let meta = std::fs::symlink_metadata(&path).map_err(|_| "无法读取本地文件属性")?;
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(
                        "所选文件夹包含链接或云端占位文件，请先下载到本地或选择普通文件夹".into(),
                    );
                }
            }
            if meta.file_type().is_symlink() || (!meta.is_dir() && !meta.is_file()) {
                return Err("所选文件夹包含不支持的链接或特殊文件".into());
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "本地文件超出所选目录")?
                .to_str()
                .ok_or("文件名编码不受支持")?
                .replace('\\', "/");
            if relative.chars().any(char::is_control) {
                return Err("文件名包含控制字符，无法备份".into());
            }
            out.push(Entry {
                local: path.clone(),
                relative,
                size: meta.len(),
                modified: meta.modified().ok(),
                directory: meta.is_dir(),
            });
            if out.len() > 200_000 {
                return Err("单次备份超过 20 万个项目，请拆分文件夹".into());
            }
            if meta.is_dir() {
                dirs.push(path)
            }
        }
    }
    out.sort_by(|a, b| a.relative.cmp(&b.relative));
    Ok(out)
}
fn check_source(root: &Path, e: &Entry) -> Result<(), String> {
    let actual = std::fs::canonicalize(&e.local).map_err(|_| "源文件已移动或无法访问")?;
    if !actual.starts_with(root) {
        return Err("源文件已移出所选目录".into());
    }
    let m = std::fs::metadata(&actual).map_err(|_| "无法读取源文件")?;
    if !m.is_file() || m.len() != e.size || m.modified().ok() != e.modified {
        return Err("源文件在备份期间发生变化，请结束编辑后重新执行".into());
    }
    Ok(())
}
struct Nas {
    client: reqwest::Client,
    session: crate::Session,
    info: Value,
}
impl Nas {
    fn url(&self, api: &str) -> Result<String, String> {
        let path = self.info[api]["path"]
            .as_str()
            .ok_or("NAS 缺少文件备份所需接口")?;
        if path.starts_with('/')
            || path.contains(':')
            || path.contains('\\')
            || path.split('/').any(|p| p == "..")
        {
            return Err("NAS 返回的接口地址无效".into());
        }
        Ok(format!("{}/webapi/{}", self.session.base_url, path))
    }
    fn version(&self, api: &str) -> Result<u64, String> {
        self.info[api]["maxVersion"]
            .as_u64()
            .filter(|v| *v > 0)
            .ok_or("NAS 返回的接口版本无效".into())
    }
    async fn json(
        &self,
        api: &str,
        method: &str,
        params: Vec<(&str, String)>,
    ) -> Result<Value, String> {
        let mut fields = vec![
            ("api", api.into()),
            ("method", method.into()),
            ("version", self.version(api)?.to_string()),
            ("_sid", self.session.sid.clone()),
        ];
        fields.extend(params);
        let r = self
            .client
            .post(self.url(api)?)
            .header("X-SYNO-TOKEN", &self.session.syno_token)
            .form(&fields)
            .send()
            .await
            .map_err(|_| "无法连接 NAS，请检查网络、证书和登录状态")?;
        response_json(r).await
    }
    async fn mkdir(&self, parent: &str, name: &str) -> Result<(), String> {
        self.json(
            "SYNO.FileStation.CreateFolder",
            "create",
            vec![
                ("folder_path", json!([parent]).to_string()),
                ("name", json!([name]).to_string()),
                ("force_parent", "false".into()),
            ],
        )
        .await?;
        Ok(())
    }
}
async fn response_json(mut response: reqwest::Response) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(format!(
            "NAS 请求失败（HTTP {}）",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "NAS 响应中断")? {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err("NAS 响应过大".into());
        }
        bytes.extend_from_slice(&chunk)
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "无法识别 NAS 响应")?;
    if value["success"] != true {
        return Err(format!(
            "NAS 拒绝备份请求（code={}），请检查会话、目录权限及可用空间",
            value["error"]["code"]
        ));
    }
    Ok(value["data"].clone())
}
fn multipart_field(boundary: &str, key: &str, value: &str) -> String {
    format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n")
}
fn quote_filename(name: &str) -> String {
    name.replace('%', "%25")
        .replace('"', "%22")
        .replace('\r', "%0D")
        .replace('\n', "%0A")
}
async fn digest_file(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "无法打开源文件")?;
    let mut hash = Sha256::new();
    let mut buf = vec![0; 64 * 1024];
    loop {
        let n = file.read(&mut buf).await.map_err(|_| "读取源文件失败")?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(hash.finalize().to_vec())
}
async fn upload(nas: &Nas, e: &Entry, parent: &str) -> Result<(), String> {
    let api = "SYNO.FileStation.Upload";
    let boundary = format!("synolink-{}", new_id());
    let mut head = String::new();
    for (k, v) in [
        ("api", api.to_string()),
        ("method", "upload".into()),
        ("version", nas.version(api)?.to_string()),
        ("_sid", nas.session.sid.clone()),
        ("path", parent.into()),
        ("create_parents", "false".into()),
        ("overwrite", "false".into()),
    ] {
        head.push_str(&multipart_field(&boundary, k, &v));
    }
    let name = e
        .local
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("文件名无效")?;
    head.push_str(&format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: application/octet-stream\r\n\r\n",quote_filename(name)));
    let tail = format!("\r\n--{boundary}--\r\n").into_bytes();
    let length = head.len() as u64 + e.size + tail.len() as u64;
    let file = tokio::fs::File::open(&e.local)
        .await
        .map_err(|_| "无法读取源文件")?
        .take(e.size);
    let chunks = stream::try_unfold(file, |mut file| async move {
        let mut bytes = vec![0; 64 * 1024];
        let n = file.read(&mut bytes).await?;
        if n == 0 {
            Ok::<_, std::io::Error>(None)
        } else {
            bytes.truncate(n);
            Ok(Some((bytes, file)))
        }
    });
    let body = stream::once(async move { Ok::<_, std::io::Error>(head.into_bytes()) })
        .chain(chunks)
        .chain(stream::once(async move { Ok::<_, std::io::Error>(tail) }));
    let response = nas
        .client
        .post(nas.url(api)?)
        .header("X-SYNO-TOKEN", &nas.session.syno_token)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .header("Content-Length", length)
        .body(reqwest::Body::wrap_stream(body))
        .send()
        .await
        .map_err(|_| "上传中断，请检查网络、证书和 NAS 剩余空间")?;
    response_json(response).await?;
    Ok(())
}
async fn verify(nas: &Nas, path: &str, expected: &[u8], size: u64) -> Result<(), String> {
    let api = "SYNO.FileStation.Download";
    let mut response = nas
        .client
        .get(nas.url(api)?)
        .header("X-SYNO-TOKEN", &nas.session.syno_token)
        .query(&[
            ("api", api.to_string()),
            ("method", "download".into()),
            ("version", nas.version(api)?.to_string()),
            ("_sid", nas.session.sid.clone()),
            ("path", json!([path]).to_string()),
            ("mode", "download".into()),
        ])
        .send()
        .await
        .map_err(|_| "无法读取 NAS 文件进行内容校验")?;
    if !response.status().is_success() {
        return Err("NAS 文件内容校验请求失败".into());
    }
    let mut hash = Sha256::new();
    let mut received = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|_| "NAS 内容校验中断")? {
        received += chunk.len() as u64;
        if received > size {
            return Err("NAS 文件大小校验失败".into());
        }
        hash.update(&chunk);
    }
    if received != size || hash.finalize().as_slice() != expected {
        return Err("NAS 文件内容校验失败，备份未完成".into());
    }
    Ok(())
}
async fn execute(
    app: &tauri::AppHandle,
    t: &Task,
    session: crate::Session,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .danger_accept_invalid_certs(session.allow_insecure)
        .danger_accept_invalid_hostnames(session.allow_insecure)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| "无法创建备份连接")?;
    let response = client
        .get(format!("{}/webapi/query.cgi", session.base_url))
        .query(&[
            ("api", "SYNO.API.Info"),
            ("method", "query"),
            ("version", "1"),
            (
                "query",
                "SYNO.FileStation.CreateFolder,SYNO.FileStation.Upload,SYNO.FileStation.Download",
            ),
            ("_sid", &session.sid),
        ])
        .header("X-SYNO-TOKEN", &session.syno_token)
        .send()
        .await
        .map_err(|_| "无法发现 NAS 文件接口")?;
    let nas = Nas {
        client,
        session,
        info: response_json(response).await?,
    };
    for api in [
        "SYNO.FileStation.CreateFolder",
        "SYNO.FileStation.Upload",
        "SYNO.FileStation.Download",
    ] {
        nas.url(api)?;
        nas.version(api)?;
    }
    let root = std::fs::canonicalize(&t.source).map_err(|_| "本地文件夹已移动或无法访问")?;
    let scan_root = root.clone();
    let entries = tauri::async_runtime::spawn_blocking(move || scan(&scan_root, &cancel))
        .await
        .map_err(|_| "扫描失败")??;
    update(app, &t.id, |t| {
        t.total = entries.iter().filter(|e| !e.directory).count();
    });
    let output_name = format!("SynoLink-{}", new_id());
    let output = format!("{}/{}", t.destination, output_name);
    nas.mkdir(&t.destination, &output_name).await?;
    update(app, &t.id, |t| t.output = output.clone());
    persist(app, &app.state::<Backups>().tasks.lock().unwrap())?;
    for entry in entries {
        let remote = format!("{}/{}", output, entry.relative);
        let (parent, name) = remote.rsplit_once('/').ok_or("目标路径无效")?;
        if entry.directory {
            nas.mkdir(parent, name).await?;
            continue;
        }
        update(app, &t.id, |t| {
            t.status = "uploading".into();
            t.current = entry.relative.clone()
        });
        check_source(&root, &entry)?;
        let hash = digest_file(&entry.local).await?;
        check_source(&root, &entry)?;
        upload(&nas, &entry, parent).await?;
        check_source(&root, &entry)?;
        update(app, &t.id, |t| t.status = "verifying".into());
        verify(&nas, &remote, &hash, entry.size).await?;
        update(app, &t.id, |t| {
            t.completed += 1;
            t.bytes += entry.size
        });
    }
    Ok(())
}
#[tauri::command]
pub fn computer_backup_start(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("电脑备份仅支持 Windows".into());
    }
    let state = app.state::<Backups>();
    let t = state
        .tasks
        .lock()
        .unwrap()
        .iter()
        .find(|t| t.id == id)
        .cloned()
        .ok_or("任务不存在")?;
    let session = scope(&app, &t.source_url, &t.account)?;
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("已有电脑备份正在执行，请等待完成或取消".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    state
        .cancel
        .lock()
        .unwrap()
        .insert(id.clone(), flag.clone());
    update(&app, &id, |t| {
        t.status = "scanning".into();
        t.message = String::new();
        t.total = 0;
        t.completed = 0;
        t.bytes = 0;
        t.current = String::new();
        t.output = String::new()
    });
    let saved = persist(&app, &state.tasks.lock().unwrap());
    if let Err(error) = saved {
        state.running.store(false, Ordering::SeqCst);
        state.cancel.lock().unwrap().remove(&id);
        update(&app, &id, |t| {
            t.status = "error".into();
            t.message = error.clone()
        });
        return Err(error);
    }
    tauri::async_runtime::spawn(async move {
        let stopped = async {
            loop {
                tokio::time::sleep(Duration::from_millis(250)).await;
                if flag.load(Ordering::Relaxed) {
                    return "已取消；已上传的文件保留在本次备份目录";
                }
                let current = crate::read_session(&app.state::<crate::AppState>());
                if current.sid != session.sid
                    || current.base_url != session.base_url
                    || current.account != session.account
                {
                    flag.store(true, Ordering::Relaxed);
                    return "登录连接已变化，备份已停止；请登录来源账号后重新执行";
                }
            }
        };
        let result = tokio::select! {r=execute(&app,&t,session.clone(),flag.clone())=>r, reason=stopped=>Err(reason.into())};
        update(&app, &id, |t| {
            t.current = String::new();
            match result {
                Ok(()) => {
                    t.status = "done".into();
                    t.message = "全部文件已上传并通过 SHA-256 内容校验".into()
                }
                Err(e) => {
                    t.status = if flag.load(Ordering::Relaxed) {
                        "interrupted"
                    } else {
                        "error"
                    }
                    .into();
                    t.message = e
                }
            }
        });
        let state = app.state::<Backups>();
        let mut tasks = state.tasks.lock().unwrap();
        if persist(&app, &tasks).is_err() {
            if let Some(t) = tasks.iter_mut().find(|t| t.id == id) {
                t.status = "error".into();
                t.message = "执行结果无法保存，请检查本地磁盘空间并核对 NAS 目录".into()
            }
        }
        state.cancel.lock().unwrap().remove(&id);
        state.running.store(false, Ordering::SeqCst);
    });
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_destinations() {
        for bad in ["/", "photo", "/photo/../secret", "/photo//x", "/photo\\x"] {
            assert!(!valid_destination(bad))
        }
        assert!(valid_destination("/photo/电脑备份"));
    }
    #[test]
    fn filename_does_not_inject_multipart_headers() {
        assert!(!quote_filename("a\"\r\nb").contains(['\r', '\n', '"']));
    }
    #[test]
    fn scans_empty_directories_and_detects_source_changes() {
        let root = std::env::temp_dir().join(format!("synolink-backup-test-{}", new_id()));
        std::fs::create_dir_all(root.join("empty")).unwrap();
        std::fs::write(root.join("中文.txt"), b"hello").unwrap();
        let canonical = std::fs::canonicalize(&root).unwrap();
        let rows = scan(&canonical, &AtomicBool::new(false)).unwrap();
        assert_eq!(rows.len(), 2);
        let file = rows.iter().find(|e| !e.directory).unwrap();
        check_source(&canonical, file).unwrap();
        std::fs::write(&file.local, b"changed").unwrap();
        assert!(check_source(&canonical, file).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cancellation_stops_scan() {
        assert!(scan(Path::new("."), &AtomicBool::new(true)).is_err());
    }
    #[test]
    fn upload_stream_and_content_verification() {
        use std::io::{Read, Write};
        let root = std::env::temp_dir().join(format!("synolink-backup-http-{}", new_id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("照片.txt");
        let data = vec![b'x'; 200_000];
        std::fs::write(&path, &data).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let expected = data.clone();
        let server = std::thread::spawn(move || {
            for index in 0..3 {
                let (mut conn, _) = listener.accept().unwrap();
                conn.set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut received = Vec::new();
                let header_end = loop {
                    let mut buf = [0u8; 8192];
                    let n = conn.read(&mut buf).unwrap();
                    assert!(n > 0);
                    received.extend_from_slice(&buf[..n]);
                    if let Some(i) = received.windows(4).position(|w| w == b"\r\n\r\n") {
                        break i + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&received[..header_end]).to_string();
                let len = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|s| s.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                while received.len() < header_end + len {
                    let mut buf = [0u8; 8192];
                    let n = conn.read(&mut buf).unwrap();
                    assert!(n > 0);
                    received.extend_from_slice(&buf[..n]);
                }
                let body = if index == 0 {
                    let text = String::from_utf8_lossy(&received[header_end..]);
                    assert!(text.contains("name=\"overwrite\"\r\n\r\nfalse"));
                    assert!(text.contains("照片.txt"));
                    assert!(received.windows(expected.len()).any(|w| w == expected));
                    b"{\"success\":true,\"data\":{}}".to_vec()
                } else if index == 1 {
                    expected.clone()
                } else {
                    b"corrupt".to_vec()
                };
                write!(
                    conn,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .unwrap();
                conn.write_all(&body).unwrap();
            }
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let api = json!({"path":"entry.cgi","minVersion":1,"maxVersion":2});
            let nas = Nas {
                client: reqwest::Client::new(),
                session: crate::Session {
                    base_url: format!("http://{address}"),
                    sid: "test".into(),
                    ..Default::default()
                },
                info: json!({"SYNO.FileStation.Upload":api,"SYNO.FileStation.Download":api}),
            };
            let e = Entry {
                local: path.clone(),
                relative: "照片.txt".into(),
                size: data.len() as u64,
                modified: None,
                directory: false,
            };
            upload(&nas, &e, "/backup/run").await.unwrap();
            let hash = digest_file(&path).await.unwrap();
            verify(&nas, "/backup/run/照片.txt", &hash, e.size)
                .await
                .unwrap();
            assert!(verify(&nas, "/backup/run/照片.txt", &hash, e.size)
                .await
                .is_err());
        });
        server.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
