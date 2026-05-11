use std::collections::HashMap;
use std::sync::Mutex;
use tauri::http::Response;
use tauri::Manager;

#[derive(Default, Clone)]
struct Session {
    base_url: String,
    sid: String,
    syno_token: String,
}

#[derive(Default)]
struct AppState {
    session: Mutex<Session>,
}

#[tauri::command]
fn set_session(
    state: tauri::State<'_, AppState>,
    base_url: String,
    sid: String,
    syno_token: String,
) {
    let mut s = state.session.lock().unwrap();
    s.base_url = base_url.trim_end_matches('/').to_string();
    s.sid = sid;
    s.syno_token = syno_token;
}

#[tauri::command]
fn clear_session(state: tauri::State<'_, AppState>) {
    let mut s = state.session.lock().unwrap();
    *s = Session::default();
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn encode_path(p: &str) -> String {
    // 保留 '/'，其余特殊字符百分号编码
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

/// 单次代理返回的最大字节数（WebView 只能一次性收取 body，分块才能避免大视频压垃内存）
const MAX_CHUNK: u64 = 4 * 1024 * 1024;

/// 把请求的 Range 截断到 MAX_CHUNK
/// 输入 "bytes=0-" / "bytes=1000-" / "bytes=100-999" / None
/// 输出 "bytes=start-end"，保证 end-start+1 <= MAX_CHUNK
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

/// 根据文件扩展名推测 Content-Type（主要为了视频/音频/图片）
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

async fn proxy(
    session: Session,
    uri: String,
    range: Option<String>,
) -> Result<Response<Vec<u8>>, String> {
    if session.base_url.is_empty() {
        return Err("session not set".into());
    }
    let parsed = url::Url::parse(&uri).map_err(|e| format!("bad uri: {}", e))?;
    let kind = parsed.path(); // 形如 "/stream" "/thumb"
    let params: HashMap<_, _> = parsed.query_pairs().into_owned().collect();
    let path = params.get("path").cloned().unwrap_or_default();
    if path.is_empty() {
        return Err("missing path".into());
    }

    let (target, is_stream) = match kind {
        "/stream" => (
            format!(
                "{}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&mode=open&path={}&_sid={}",
                session.base_url,
                encode_path(&path),
                session.sid,
            ),
            true,
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
            )
        }
        other => return Err(format!("unknown kind: {}", other)),
    };

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&target);
    if !session.syno_token.is_empty() {
        req = req.header("X-SYNO-TOKEN", &session.syno_token);
    }
    // 流式类强制截断 Range，一次最多拿 MAX_CHUNK。缩略图不需要。
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
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let mut builder = Response::builder().status(status.as_u16());
    let mut has_ct = false;
    for (k, v) in headers.iter() {
        let name = k.as_str().to_ascii_lowercase();
        // stream 模式下后面会根据扩展名提供 Content-Type，避免附加两次
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
    // 流式请求确保有正确的 Content-Type（DSM 常返回 application/octet-stream，会导致 WebView 不走 media pipeline）
    if is_stream {
        if let Some(mime) = guess_mime(&path) {
            builder = builder.header("Content-Type", mime);
            has_ct = true;
        }
        // 声明支持 Range，促使 <video> 走分块拉取
        builder = builder.header("Accept-Ranges", "bytes");
    }
    if !has_ct {
        builder = builder.header("Content-Type", "application/octet-stream");
    }
    // 允许 webview 跨 origin 加载
    builder = builder.header("Access-Control-Allow-Origin", "*");
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
        let session = {
            let state = app.state::<AppState>();
            let guard = state.session.lock().unwrap();
            guard.clone()
        };
        let resp = match proxy(session, uri, range).await {
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("dsm", dsm_protocol)
        .invoke_handler(tauri::generate_handler![greet, set_session, clear_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
