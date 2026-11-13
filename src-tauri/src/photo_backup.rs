#[cfg(any(target_os = "android", test))]
use serde_json::json;
use serde_json::Value;
pub static SESSION_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[cfg(any(target_os = "android", test))]
fn safe_config(config: &Value) -> Result<Value, String> {
    let path = config["destination"].as_str().ok_or("请选择 NAS 目录")?;
    if !path.starts_with('/')
        || path == "/"
        || path.split('/').any(|p| p == ".." || p == ".")
        || path.chars().any(|c| c.is_control() || c == '\\')
    {
        return Err("NAS 目录无效".into());
    }
    let albums = config["albums"].as_array().ok_or("请选择相册")?;
    if albums.is_empty()
        || albums.len() > 100
        || albums.iter().any(|v| {
            v.as_str()
                .map(|s| s.is_empty() || s.len() > 256)
                .unwrap_or(true)
        })
    {
        return Err("请选择有效相册".into());
    }
    Ok(
        json!({"destination":path.trim_end_matches('/'),"albums":albums,"wifiOnly":config["wifiOnly"].as_bool().unwrap_or(true),"includeVideos":config["includeVideos"].as_bool().unwrap_or(false)}),
    )
}
#[cfg(target_os = "android")]
use tauri::Manager;
#[cfg(target_os = "android")]
pub struct Bridge(pub tauri::plugin::PluginHandle<tauri::Wry>);
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("photo-backup")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            app.manage(Bridge(api.register_android_plugin(
                "com.zhoujianxiang.synolink",
                "PhotoBackupPlugin",
            )?));
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
pub async fn invalidate(app: &tauri::AppHandle) {
    #[cfg(target_os = "android")]
    {
        let app = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _: Result<Value, _> = app
                .state::<Bridge>()
                .0
                .run_mobile_plugin("execute", json!({"action":"invalidate","payload":"{}"}));
        })
        .await;
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
}
#[tauri::command]
pub async fn photo_backup_action(
    app: tauri::AppHandle,
    action: String,
    config: Option<Value>,
    source_url: String,
    source_account: String,
) -> Result<Value, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, action, config, source_url, source_account);
        Err("自动相册备份仅支持 Android 手机".into())
    }
    #[cfg(target_os = "android")]
    {
        let _gate = if ["start", "resume", "pause", "recheck"].contains(&action.as_str()) {
            Some(SESSION_GATE.lock().await)
        } else {
            None
        };
        use sha2::{Digest, Sha256};
        let session = crate::read_session(&app.state::<crate::AppState>());
        if session.sid.is_empty()
            || session.base_url != source_url
            || session.account != source_account
        {
            return Err("请登录备份来源账号".into());
        }
        if ![
            "requestLibrary",
            "albums",
            "snapshot",
            "start",
            "pause",
            "resume",
            "recheck",
        ]
        .contains(&action.as_str())
        {
            return Err("未知备份操作".into());
        }
        let identity = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(source_url, source_account)).unwrap())
        );
        let mut payload = json!({"identity":identity});
        if action == "start" || action == "resume" {
            payload["baseUrl"] = json!(session.base_url);
            payload["sid"] = json!(session.sid);
            payload["synoToken"] = json!(session.syno_token);
            payload["allowInsecure"] = json!(session.allow_insecure);
            if action == "start" {
                let config = safe_config(&config.ok_or("缺少备份配置")?)?;
                for (key, value) in config.as_object().unwrap() {
                    payload[key] = value.clone();
                }
            }
        }
        let handle = app.clone();
        let callback = tauri::ipc::Channel::<Value>::new(move |_| {
            use tauri::Emitter;
            let _ = handle.emit("photo-backup:open", ());
            Ok(())
        });
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Bridge>().0.run_mobile_plugin(
                "execute",
                json!({"action":action,"payload":payload.to_string(),"callback":callback}),
            )
        })
        .await
        .map_err(|_| "备份桥接不可用".to_string())?
        .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_configuration_never_accepts_credentials_or_unsafe_destination() {
        let config=safe_config(&json!({"destination":"/photos/","albums":["external:42"],"sid":"secret","baseUrl":"https://other","password":"secret"})).unwrap();
        assert_eq!(config["destination"], "/photos");
        assert_eq!(config["wifiOnly"], true);
        assert_eq!(config["includeVideos"], false);
        assert!(!config.to_string().contains("secret"));
        assert!(config.get("baseUrl").is_none());
        for path in [
            "/",
            "relative",
            "/photos/../x",
            "/photos\\x",
            "/photos\r\nx",
        ] {
            assert!(safe_config(&json!({"destination":path,"albums":["a"]})).is_err());
        }
    }
    #[test]
    fn backup_requires_explicit_album_selection() {
        for albums in [json!([]), json!([null]), json!([""]), json!(vec!["a"; 101])] {
            assert!(safe_config(&json!({"destination":"/photos","albums":albums})).is_err());
        }
        assert_eq!(safe_config(&json!({"destination":"/photos","albums":["a"],"wifiOnly":false,"includeVideos":true})).unwrap()["includeVideos"],true);
    }
}
