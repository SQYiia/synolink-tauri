use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime};
use futures_util::StreamExt;
use serde::Serialize;
use tauri::http::Response;
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;

#[derive(Default, Clone)]
struct Session {
    base_url: String,
    sid: String,
    syno_token: String,
}

struct AppState {
    session: RwLock<Session>,
    http: reqwest::Client,
    cancels: RwLock<HashMap<String, Arc<AtomicBool>>>,
    thumb_cache_dir: RwLock<Option<PathBuf>>,
    thumb_write_counter: AtomicUsize,
}

impl Default for AppState {
    fn default() -> Self {
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("failed to build reqwest client");
        Self {
            session: RwLock::new(Session::default()),
            http,
            cancels: RwLock::new(HashMap::new()),
            thumb_cache_dir: RwLock::new(None),
            thumb_write_counter: AtomicUsize::new(0),
        }
    }
}

fn read_session(state: &AppState) -> Session {
    state.session.read().unwrap_or_else(|e| e.into_inner()).clone()
}

fn write_session(state: &AppState) -> std::sync::RwLockWriteGuard<'_, Session> {
    state.session.write().unwrap_or_else(|e| e.into_inner())
}

fn read_cancels(state: &AppState) -> std::sync::RwLockReadGuard<'_, HashMap<String, Arc<AtomicBool>>> {
    state.cancels.read().unwrap_or_else(|e| e.into_inner())
}

fn write_cancels(state: &AppState) -> std::sync::RwLockWriteGuard<'_, HashMap<String, Arc<AtomicBool>>> {
    state.cancels.write().unwrap_or_else(|e| e.into_inner())
}

#[tauri::command]
fn set_session(
    state: tauri::State<'_, AppState>,
    base_url: String,
    sid: String,
    syno_token: String,
) {
    let mut s = write_session(&state);
    s.base_url = base_url.trim_end_matches('/').to_string();
    s.sid = sid;
    s.syno_token = syno_token;
}

#[tauri::command]
fn clear_session(state: tauri::State<'_, AppState>) {
    let mut s = write_session(&state);
    *s = Session::default();
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    task_id: String,
    loaded: u64,
    total: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DonePayload {
    task_id: String,
    save_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    task_id: String,
    error: String,
}

fn safe_filename(name: &str) -> String {
    let bad = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut s: String = name
        .chars()
        .map(|c| if bad.contains(&c) || (c as u32) < 32 { '_' } else { c })
        .collect();
    if s.is_empty() {
        s = "download".to_string();
    }
    s
}

fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let target = dir.join(name);
    if !target.exists() {
        return target;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for i in 1..1000 {
        let candidate = dir.join(format!("{} ({}){}", stem, i, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{}-{}{}", stem, std::process::id(), ext))
}

/// 用 task_id 前 8 字符生成唯一的临时文件名，避免同名文件并发下载冲突
fn part_filename(task_id: &str, name: &str) -> String {
    let short_id = if task_id.len() >= 8 { &task_id[..8] } else { task_id };
    format!("{}.{}.synodownload", name, short_id)
}

#[tauri::command]
async fn download_to_file(
    app: tauri::AppHandle,
    task_id: String,
    path: String,
    name: String,
    save_dir: Option<String>,
) -> Result<(), String> {
    let (session, cancel_flag) = {
        let state = app.state::<AppState>();
        let session = read_session(&state);
        let flag = Arc::new(AtomicBool::new(false));
        write_cancels(&state).insert(task_id.clone(), flag.clone());
        (session, flag)
    };

    if session.base_url.is_empty() {
        return Err("session not set".into());
    }

    // 优先使用前端传入的保存目录，为空则回退系统默认 Downloads（iOS 无 Downloads，回退到 Documents）
    let dl_dir = match save_dir.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(s) => std::path::PathBuf::from(s),
        None => app
            .path()
            .download_dir()
            .or_else(|_| app.path().document_dir())
            .map_err(|e| format!("download/document_dir: {}", e))?,
    };
    if !dl_dir.exists() {
        std::fs::create_dir_all(&dl_dir).map_err(|e| format!("create dir: {}", e))?;
    }
    let final_name = safe_filename(&name);
    let part_path = dl_dir.join(part_filename(&task_id, &final_name));

    let resume_from: u64 = match std::fs::metadata(&part_path) {
        Ok(m) => m.len(),
        Err(_) => 0,
    };

    let url = format!(
        "{}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&mode=open&path={}&_sid={}",
        session.base_url,
        encode_path(&path),
        session.sid,
    );

    let http = {
        let state = app.state::<AppState>();
        state.http.clone()
    };

    let mut req = http.get(&url);
    if !session.syno_token.is_empty() {
        req = req.header("X-SYNO-TOKEN", &session.syno_token);
    }
    if resume_from > 0 {
        req = req.header("Range", format!("bytes={}-", resume_from));
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let supports_resume = status.as_u16() == 206;
    if !status.is_success() {
        let _ = app.emit(
            "download:error",
            ErrorPayload {
                task_id: task_id.clone(),
                error: format!("HTTP {}", status),
            },
        );
        cleanup_cancel(&app, &task_id);
        return Err(format!("HTTP {}", status));
    }

    let total: u64 = if supports_resume {
        resp.headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split('/').nth(1))
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
    } else {
        resp.content_length().unwrap_or(0)
    };

    let mut file = if supports_resume && resume_from > 0 {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&part_path)
            .await
            .map_err(|e| format!("open part(append): {}", e))?
    } else {
        tokio::fs::File::create(&part_path)
            .await
            .map_err(|e| format!("create part: {}", e))?
    };
    let mut loaded: u64 = if supports_resume { resume_from } else { 0 };

    let mut last_emit = Instant::now();
    let mut last_loaded = loaded;
    const EMIT_BYTES: u64 = 256 * 1024;
    const EMIT_MS: u128 = 200;

    let _ = app.emit(
        "download:progress",
        ProgressPayload {
            task_id: task_id.clone(),
            loaded,
            total,
        },
    );

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = file.flush().await;
            let _ = app.emit(
                "download:cancelled",
                ProgressPayload {
                    task_id: task_id.clone(),
                    loaded,
                    total,
                },
            );
            cleanup_cancel(&app, &task_id);
            return Ok(());
        }
        let bytes = chunk.map_err(|e| {
            let msg = e.to_string();
            let _ = app.emit(
                "download:error",
                ErrorPayload {
                    task_id: task_id.clone(),
                    error: msg.clone(),
                },
            );
            msg
        })?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("write: {}", e))?;
        loaded += bytes.len() as u64;

        let now = Instant::now();
        if loaded - last_loaded >= EMIT_BYTES || now.duration_since(last_emit).as_millis() >= EMIT_MS
        {
            let _ = app.emit(
                "download:progress",
                ProgressPayload {
                    task_id: task_id.clone(),
                    loaded,
                    total,
                },
            );
            last_emit = now;
            last_loaded = loaded;
        }
    }

    file.flush().await.map_err(|e| format!("flush: {}", e))?;
    drop(file);

    // 完整性校验：如果服务器报告了 total 且实际写入不匹配，视为失败
    if total > 0 && loaded != total {
        let msg = format!("incomplete download: got {} of {} bytes", loaded, total);
        let _ = app.emit(
            "download:error",
            ErrorPayload {
                task_id: task_id.clone(),
                error: msg.clone(),
            },
        );
        cleanup_cancel(&app, &task_id);
        return Err(msg);
    }

    let final_path = unique_path(&dl_dir, &final_name);
    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("rename: {}", e))?;

    let _ = app.emit(
        "download:progress",
        ProgressPayload {
            task_id: task_id.clone(),
            loaded,
            total: if total > 0 { total } else { loaded },
        },
    );
    let _ = app.emit(
        "download:done",
        DonePayload {
            task_id: task_id.clone(),
            save_path: final_path.to_string_lossy().to_string(),
        },
    );
    cleanup_cancel(&app, &task_id);
    Ok(())
}

#[tauri::command]
fn cancel_download(state: tauri::State<'_, AppState>, task_id: String) {
    if let Some(flag) = read_cancels(&state).get(&task_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn get_default_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| format!("download/document_dir: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

/// 用户可访问的本地根目录（iOS 沙盒 = Documents，桌面 = 系统 Downloads / Documents）。
/// 用作 in-app 文件夹选择器的起点 / 根。
#[tauri::command]
fn get_local_root_dir(app: tauri::AppHandle) -> Result<String, String> {
    // iOS / Android：用 Documents（沙盒可读写、文件 App 可见）
    // macOS / Win / Linux：优先 Documents（Tauri 的 download_dir 在某些环境不可靠）
    let dir = app
        .path()
        .document_dir()
        .or_else(|_| app.path().download_dir())
        .map_err(|e| format!("local root dir: {}", e))?;
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }
    Ok(dir.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 列出 parent 下的直接子目录（文件不列）。
/// 校验 parent 在 root_dir 之内（防越权 / 不让用户跳出沙盒访问其他 App 的容器）。
#[tauri::command]
fn list_local_subdirs(app: tauri::AppHandle, parent: String) -> Result<Vec<LocalEntry>, String> {
    let root = std::path::PathBuf::from(get_local_root_dir(app.clone())?);
    let target = std::path::PathBuf::from(&parent).canonicalize()
        .or_else(|_| Ok::<_, String>(std::path::PathBuf::from(&parent)))?;
    let root_canon = root.canonicalize().unwrap_or(root.clone());
    if !target.starts_with(&root_canon) && target != root_canon {
        return Err(format!("路径越界：{} 不在 {} 之内", target.display(), root_canon.display()));
    }
    let read = std::fs::read_dir(&target).map_err(|e| format!("read_dir: {}", e))?;
    let mut out: Vec<LocalEntry> = Vec::new();
    for entry in read.flatten() {
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // 跳过隐藏目录
        }
        out.push(LocalEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: true,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 在 parent 下新建子目录，返回完整路径。
/// 同样校验 parent 在 root_dir 之内，且 name 不含路径分隔符。
#[tauri::command]
fn create_local_subdir(app: tauri::AppHandle, parent: String, name: String) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.starts_with('.') {
        return Err("名称非法（不能含 / \\，不能以 . 开头）".into());
    }
    let root = std::path::PathBuf::from(get_local_root_dir(app.clone())?);
    let parent_path = std::path::PathBuf::from(&parent);
    let root_canon = root.canonicalize().unwrap_or(root.clone());
    let parent_canon = parent_path.canonicalize().unwrap_or(parent_path.clone());
    if !parent_canon.starts_with(&root_canon) && parent_canon != root_canon {
        return Err("路径越界".into());
    }
    let target = parent_path.join(trimmed);
    if target.exists() {
        return Err("目录已存在".into());
    }
    std::fs::create_dir_all(&target).map_err(|e| format!("mkdir: {}", e))?;
    Ok(target.to_string_lossy().to_string())
}

fn cleanup_cancel(app: &tauri::AppHandle, task_id: &str) {
    let state = app.state::<AppState>();
    write_cancels(&state).remove(task_id);
}

fn encode_path(p: &str) -> String {
    const SET: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
        .add(b' ')
        .add(b'"')
        .add(b'#')
        .add(b'<')
        .add(b'>')
        .add(b'?')
        .add(b'&')
        .add(b'=')
        .add(b'+')
        .add(b'%');
    percent_encoding::utf8_percent_encode(p, SET).to_string()
}

const MAX_CHUNK: u64 = 4 * 1024 * 1024;

fn clamp_range(range: Option<&str>) -> String {
    let raw = range.unwrap_or("bytes=0-");
    let rest = raw.strip_prefix("bytes=").unwrap_or("0-");
    let mut parts = rest.splitn(2, '-');
    let start: u64 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
    let end_s = parts.next().unwrap_or("").trim();
    let hard_end = start.saturating_add(MAX_CHUNK - 1);
    let end: u64 = if end_s.is_empty() {
        hard_end
    } else {
        end_s.parse::<u64>().unwrap_or(hard_end).min(hard_end)
    };
    format!("bytes={}-{}", start, end)
}

fn guess_mime(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "ts" => "video/mp2t",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

// ===== 缩略图本地磁盘缓存 =====
// 缓存目录：app_cache_dir/thumbs/
// 键：size 前缀 + 16 位 16 进制 hash(base_url + path + size)
// 容量上限：THUMB_CACHE_MAX_BYTES，超出后按 mtime 升序（FIFO）删除
// 调度：每写入 THUMB_CACHE_CHECK_EVERY 次后异步检查一次容量
const THUMB_CACHE_MAX_BYTES: u64 = 200 * 1024 * 1024;
const THUMB_CACHE_CHECK_EVERY: usize = 50;

fn thumb_cache_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let state = app.state::<AppState>();
    if let Ok(g) = state.thumb_cache_dir.read() {
        if let Some(p) = g.as_ref() {
            return Some(p.clone());
        }
    }
    let base = app.path().app_cache_dir().ok()?;
    let dir = base.join("thumbs");
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }
    if let Ok(mut g) = state.thumb_cache_dir.write() {
        *g = Some(dir.clone());
    }
    Some(dir)
}

fn thumb_cache_key(base_url: &str, path: &str, size: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    base_url.hash(&mut h);
    path.hash(&mut h);
    size.hash(&mut h);
    format!("{}_{:016x}.bin", size, h.finish())
}

fn thumb_cache_read(dir: &Path, key: &str) -> Option<Vec<u8>> {
    let p = dir.join(key);
    let bytes = std::fs::read(&p).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(bytes)
}

fn thumb_cache_write(dir: &Path, key: &str, bytes: &[u8]) {
    let p = dir.join(key);
    let tmp = dir.join(format!("{}.tmp", key));
    if std::fs::write(&tmp, bytes).is_ok() {
        let _ = std::fs::rename(&tmp, &p);
    }
}

fn enforce_thumb_cache_limit(dir: PathBuf, max_bytes: u64) {
    let mut entries: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let rd = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut total: u64 = 0;
    for ent in rd.flatten() {
        let p = ent.path();
        if !p.is_file() {
            continue;
        }
        if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".tmp") {
                let _ = std::fs::remove_file(&p);
                continue;
            }
        }
        if let Ok(meta) = ent.metadata() {
            let sz = meta.len();
            let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            total = total.saturating_add(sz);
            entries.push((p, sz, mtime));
        }
    }
    if total <= max_bytes {
        return;
    }
    entries.sort_by_key(|e| e.2);
    for (p, sz, _) in entries {
        if total <= max_bytes {
            break;
        }
        if std::fs::remove_file(&p).is_ok() {
            total = total.saturating_sub(sz);
        }
    }
}

fn maybe_enforce_cache(app: &tauri::AppHandle, dir: PathBuf) {
    let state = app.state::<AppState>();
    let n = state.thumb_write_counter.fetch_add(1, Ordering::Relaxed) + 1;
    if n % THUMB_CACHE_CHECK_EVERY != 0 {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        enforce_thumb_cache_limit(dir, THUMB_CACHE_MAX_BYTES);
    });
}

#[tauri::command]
fn clear_thumb_cache(app: tauri::AppHandle) -> Result<u64, String> {
    let dir = match thumb_cache_dir(&app) {
        Some(d) => d,
        None => return Ok(0),
    };
    let mut removed: u64 = 0;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for ent in rd.flatten() {
            let p = ent.path();
            if p.is_file() {
                let sz = ent.metadata().map(|m| m.len()).unwrap_or(0);
                if std::fs::remove_file(&p).is_ok() {
                    removed = removed.saturating_add(sz);
                }
            }
        }
    }
    Ok(removed)
}

#[tauri::command]
fn get_thumb_cache_stats(app: tauri::AppHandle) -> Result<(u64, u64), String> {
    let dir = match thumb_cache_dir(&app) {
        Some(d) => d,
        None => return Ok((0, 0)),
    };
    let mut total: u64 = 0;
    let mut count: u64 = 0;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for ent in rd.flatten() {
            if ent.path().is_file() {
                if let Ok(meta) = ent.metadata() {
                    total = total.saturating_add(meta.len());
                    count += 1;
                }
            }
        }
    }
    Ok((total, count))
}

async fn proxy(
    client: &reqwest::Client,
    session: Session,
    uri: String,
    range: Option<String>,
    app: Option<tauri::AppHandle>,
) -> Result<Response<Vec<u8>>, String> {
    if session.base_url.is_empty() {
        return Err("session not set".into());
    }
    let parsed = url::Url::parse(&uri).map_err(|e| format!("bad uri: {}", e))?;
    let kind = parsed.path();
    let params: HashMap<_, _> = parsed.query_pairs().into_owned().collect();
    let path = params.get("path").cloned().unwrap_or_default();
    if path.is_empty() {
        return Err("missing path".into());
    }

    let (target, is_stream, is_thumb, thumb_size) = match kind {
        "/stream" => (
            format!(
                "{}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&mode=open&path={}&_sid={}",
                session.base_url,
                encode_path(&path),
                session.sid,
            ),
            true,
            false,
            String::new(),
        ),
        "/thumb" => {
            let size = params.get("size").cloned().unwrap_or_else(|| "small".into());
            (
                format!(
                    "{}/webapi/entry.cgi?api=SYNO.FileStation.Thumb&version=2&method=get&size={}&path={}&_sid={}",
                    session.base_url,
                    size,
                    encode_path(&path),
                    session.sid,
                ),
                false,
                true,
                size,
            )
        }
        other => return Err(format!("unknown kind: {}", other)),
    };

    // 缩略图本地缓存：命中直接返回 JPEG、不请求 NAS
    let cache_meta = if is_thumb {
        if let Some(app) = app.as_ref() {
            if let Some(dir) = thumb_cache_dir(app) {
                let key = thumb_cache_key(&session.base_url, &path, &thumb_size);
                if let Some(bytes) = thumb_cache_read(&dir, &key) {
                    return Response::builder()
                        .status(200)
                        .header("Content-Type", "image/jpeg")
                        .header("Content-Length", bytes.len().to_string())
                        .header("Cache-Control", "public, max-age=31536000, immutable")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes)
                        .map_err(|e| e.to_string());
                }
                Some((dir, key))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let mut req = client.get(&target);
    if !session.syno_token.is_empty() {
        req = req.header("X-SYNO-TOKEN", &session.syno_token);
    }
    let effective_range = if is_stream {
        Some(clamp_range(range.as_deref()))
    } else {
        range.clone()
    };
    if let Some(r) = &effective_range {
        req = req.header("Range", r);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let headers = resp.headers().clone();

    // 如果是 stream 且服务端返回 200（不支持 Range），截断到 MAX_CHUNK 防止内存爆炸
    let bytes = if is_stream && status.as_u16() == 200 {
        let mut buf = Vec::with_capacity(MAX_CHUNK as usize);
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            let remaining = MAX_CHUNK as usize - buf.len();
            if remaining == 0 {
                break;
            }
            if chunk.len() <= remaining {
                buf.extend_from_slice(&chunk);
            } else {
                buf.extend_from_slice(&chunk[..remaining]);
                break;
            }
        }
        buf.into()
    } else {
        resp.bytes().await.map_err(|e| e.to_string())?
    };

    let mut builder = Response::builder().status(status.as_u16());
    let mut has_ct = false;
    for (k, v) in headers.iter() {
        let name = k.as_str().to_ascii_lowercase();
        if is_stream && name == "content-type" {
            continue;
        }
        if matches!(
            name.as_str(),
            "content-type"
                | "content-length"
                | "content-range"
                | "accept-ranges"
                | "last-modified"
                | "etag"
                | "cache-control"
        ) {
            if let Ok(val) = v.to_str() {
                builder = builder.header(k.as_str(), val);
                if name == "content-type" {
                    has_ct = true;
                }
            }
        }
    }
    if is_stream {
        if let Some(mime) = guess_mime(&path) {
            builder = builder.header("Content-Type", mime);
            has_ct = true;
        }
        builder = builder.header("Accept-Ranges", "bytes");
    }
    if !has_ct {
        builder = builder.header("Content-Type", "application/octet-stream");
    }
    builder = builder.header("Access-Control-Allow-Origin", "*");

    // 缩略图请求成功后写入本地缓存
    if let Some((dir, key)) = cache_meta {
        if status.is_success() && !bytes.is_empty() {
            let dir_for_write = dir.clone();
            let bytes_for_write = bytes.to_vec();
            tauri::async_runtime::spawn_blocking(move || {
                thumb_cache_write(&dir_for_write, &key, &bytes_for_write);
            });
            if let Some(app) = app.as_ref() {
                maybe_enforce_cache(app, dir);
            }
        }
    }

    builder.body(bytes.to_vec()).map_err(|e| e.to_string())
}

fn dsm_protocol(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let uri = request.uri().to_string();
    let range = request
        .headers()
        .get("Range")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let session = read_session(&state);
        let resp = match proxy(&state.http, session, uri, range, Some(app.clone())).await {
            Ok(r) => r,
            Err(e) => Response::builder()
                .status(500)
                .header("Content-Type", "text/plain; charset=utf-8")
                .body(e.into_bytes())
                .unwrap(),
        };
        responder.respond(resp);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("dsm", dsm_protocol)
        .invoke_handler(tauri::generate_handler![
            set_session,
            clear_session,
            download_to_file,
            cancel_download,
            get_default_download_dir,
            get_local_root_dir,
            list_local_subdirs,
            create_local_subdir,
            clear_thumb_cache,
            get_thumb_cache_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
