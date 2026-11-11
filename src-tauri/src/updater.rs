use std::{path::PathBuf, time::Duration};
use futures_util::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const REPO: &str = "https://github.com/SQYiia/synolink-tauri/releases/download";
const MAX_SIZE: u64 = 256 * 1024 * 1024;
#[derive(Default)]
pub struct UpdateState(pub tokio::sync::Mutex<UpdateData>);
#[derive(Default)]
pub struct UpdateData { release: Option<UpdateInfo>, ready: Option<PathBuf> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo { version: String, notes: String, size: u64, url: String, sha256: String }
#[derive(Deserialize)]
struct Asset { name: String, browser_download_url: String, size: u64, digest: Option<String> }
#[derive(Deserialize)]
struct Release { tag_name: String, body: Option<String>, draft: bool, prerelease: bool, assets: Vec<Asset> }
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent("SynoLink-Updater").https_only(true)
        .connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(600))
        .build().map_err(|e| e.to_string())
}
fn valid_hash(hash: &str) -> bool { hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()) }
fn select_release(release: Release, current: &str) -> Result<Option<UpdateInfo>, String> {
    let version = Version::parse(release.tag_name.trim_start_matches('v')).map_err(|_| "版本格式无效")?;
    if release.draft || release.prerelease || !version.pre.is_empty() || version <= Version::parse(current).map_err(|e| e.to_string())? { return Ok(None); }
    let name = format!("SynoLink_{version}_x64-setup.exe");
    let asset = release.assets.into_iter().find(|a| a.name == name).ok_or("新版尚未提供 Windows x64 安装包")?;
    if asset.browser_download_url != format!("{REPO}/{}/{name}", release.tag_name) || asset.size == 0 || asset.size > MAX_SIZE { return Err("安装包地址或大小无效".into()); }
    let hash = asset.digest.unwrap_or_default().strip_prefix("sha256:").unwrap_or("").to_lowercase();
    if !valid_hash(&hash) { return Err("GitHub 未提供有效的 SHA256 校验值，请稍后重试".into()); }
    Ok(Some(UpdateInfo { version: version.to_string(), notes: release.body.unwrap_or_default(), size: asset.size, url: asset.browser_download_url, sha256: hash }))
}
#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle, state: tauri::State<'_, UpdateState>) -> Result<Option<UpdateInfo>, String> {
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) { return Err("当前仅支持 Windows x64 应用内更新".into()); }
    let mut data = state.0.try_lock().map_err(|_| "正在处理更新，请稍后重试")?;
    let response = client()?.get("https://api.github.com/repos/SQYiia/synolink-tauri/releases/latest")
        .header("Accept", "application/vnd.github+json").header("X-GitHub-Api-Version", "2022-11-28")
        .timeout(Duration::from_secs(30)).send().await.map_err(|e| format!("无法连接 GitHub：{e}"))?;
    if response.status().as_u16() == 404 { data.release = None; data.ready = None; return Ok(None); }
    let response = response.error_for_status().map_err(|e| format!("检查更新失败（GitHub 可能限流）：{e}"))?;
    let release: Release = serde_json::from_str(&response.text().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let update = select_release(release, &app.package_info().version.to_string())?;
    if data.release.as_ref().map(|r| &r.sha256) != update.as_ref().map(|r| &r.sha256) { data.ready = None; }
    data.release = update.clone();
    Ok(update)
}
async fn verify(path: &std::path::Path, info: &UpdateInfo) -> Result<(), String> {
    let mut file = tokio::fs::File::open(path).await.map_err(|e| e.to_string())?;
    if file.metadata().await.map_err(|e| e.to_string())?.len() != info.size { return Err("安装包大小校验失败，请重新下载".into()); }
    let mut hash = Sha256::new();
    let mut buf = vec![0; 64 * 1024];
    loop { let n = file.read(&mut buf).await.map_err(|e| e.to_string())?; if n == 0 { break; } hash.update(&buf[..n]); }
    if format!("{:x}", hash.finalize()) != info.sha256 { return Err("安装包 SHA256 校验失败，请重新下载".into()); }
    Ok(())
}
#[derive(Clone, Serialize)]
struct Progress { downloaded: u64, total: u64 }
#[tauri::command]
pub async fn download_app_update(app: tauri::AppHandle, state: tauri::State<'_, UpdateState>) -> Result<(), String> {
    let mut data = state.0.try_lock().map_err(|_| "正在处理更新，请稍后重试")?;
    let info = data.release.clone().ok_or("请先检查更新")?;
    data.ready = None;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let path = dir.join("SynoLink-update.exe");
    if verify(&path, &info).await.is_ok() { data.ready = Some(path); return Ok(()); }
    let part = dir.join("SynoLink-update.part");
    let result: Result<(), String> = async {
        let response = client()?.get(&info.url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut file = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
        let mut downloaded = 0;
        let mut last = std::time::Instant::now();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;
            if downloaded > info.size { return Err("下载内容超过预期大小".into()); }
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            if last.elapsed() > Duration::from_millis(150) || downloaded == info.size {
                let _ = app.emit("app-update-progress", Progress { downloaded, total: info.size }); last = std::time::Instant::now();
            }
        }
        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);
        verify(&part, &info).await?;
        if path.exists() { tokio::fs::remove_file(&path).await.map_err(|e| e.to_string())?; }
        tokio::fs::rename(&part, &path).await.map_err(|e| e.to_string())?;
        Ok(())
    }.await;
    if result.is_err() { let _ = tokio::fs::remove_file(&part).await; }
    result?;
    data.ready = Some(path);
    Ok(())
}
#[tauri::command]
pub async fn install_app_update(app: tauri::AppHandle, state: tauri::State<'_, UpdateState>) -> Result<(), String> {
    let data = state.0.try_lock().map_err(|_| "正在处理更新，请稍后重试")?;
    let path = data.ready.as_ref().ok_or("请先下载安装包")?;
    verify(path, data.release.as_ref().ok_or("请先检查更新")?).await?;
    if !cfg!(target_os = "windows") { return Err("当前平台不支持此安装包".into()); }
    std::process::Command::new(path).spawn().map_err(|e| format!("无法启动安装程序：{e}"))?;
    app.exit(0);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn release(version: &str) -> Release {
        serde_json::from_value(serde_json::json!({"tag_name":format!("v{version}"),"draft":false,"prerelease":false,"body":"notes","assets":[{"name":format!("SynoLink_{version}_x64-setup.exe"),"browser_download_url":format!("{REPO}/v{version}/SynoLink_{version}_x64-setup.exe"),"size":3,"digest":format!("sha256:{}", "a".repeat(64))}]})).unwrap()
    }
    #[test] fn version_order_and_channels() {
        assert!(select_release(release("0.1.16"), "0.1.15").unwrap().is_some());
        assert!(select_release(release("0.1.9"), "0.1.15").unwrap().is_none());
        assert!(select_release(release("0.1.15"), "0.1.15").unwrap().is_none());
        let mut r = release("0.1.16"); r.prerelease = true;
        assert!(select_release(r, "0.1.15").unwrap().is_none());
    }
    #[test] fn rejects_untrusted_asset_and_missing_hash() {
        let mut r = release("0.1.16"); r.assets[0].browser_download_url = "https://example.com/setup.exe".into();
        assert!(select_release(r, "0.1.15").is_err());
        let mut r = release("0.1.16"); r.assets[0].digest = None;
        assert!(select_release(r, "0.1.15").is_err());
    }
    #[test] fn detects_corrupt_installer() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let path = std::env::temp_dir().join(format!("synolink-update-test-{}", std::process::id()));
            tokio::fs::write(&path, b"abc").await.unwrap();
            let mut info = select_release(release("0.1.16"), "0.1.15").unwrap().unwrap();
            assert!(verify(&path, &info).await.is_err());
            info.sha256 = format!("{:x}", Sha256::digest(b"abc"));
            assert!(verify(&path, &info).await.is_ok());
            tokio::fs::write(&path, b"abcd").await.unwrap();
            assert!(verify(&path, &info).await.is_err());
            tokio::fs::remove_file(path).await.unwrap();
        });
    }
}
