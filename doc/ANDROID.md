# Android 构建与安装

## 2026-11-14 移动端视觉统一

与 Windows 共用工作区颜色：页面背景、内容卡片、透明标题区及危险操作层级统一。触屏按钮／输入框保持至少 44px，工具栏与弹窗底部操作自动换行；底部导航和横屏触屏布局保留。覆盖管理页、文件／相册顶部、设置和概览卡片，播放器保留独立画布。

验证：Android UA 的文件、4000 张相册虚拟列表、视频、套件交互及横屏导航通过；十个管理页的浅色／深色手机布局和横向溢出检查通过；安卓相关 3 项自动测试通过。浏览器截图不是设备验收，安装、系统文件选择器、后台传输和启动器显示仍需真机验证。

安装包继续使用 `.android-signing` 中既有密钥，ARM64 Release 经 zipalign 和 apksigner 签名验证。版本保留 0.1.19 预览，不发布尚待真机验收的 0.1.20。

目标：Android 7.0（API 24）及以上的 ARM64 手机。安卓工程在 `src-tauri/gen/android`，与 Windows 共用界面及 Rust 后端。

## 构建

需 JDK 17、Android SDK 36 / Build Tools 36、NDK 27.2.12479018 及 Rust `aarch64-linux-android` 目标。首次构建需要联网获取依赖。

```powershell
# 使用系统环境变量，或此项目在 D 盘的本地工具缓存
. ./scripts/android-env.ps1
npm run android:build
```

输出在 `src-tauri/gen/android/app/build/outputs/apk/`。Release APK 需要签名才可安装。不能用 Windows EXE 更新安卓应用。

## 当前适配

- 手机和平板使用触屏布局，横屏不切换到依赖鼠标右键的桌面布局。
- Android 媒体流使用 `http://dsm.localhost` 本地代理。
- 下载保存至应用私有 Downloads 目录，目录选择器只能浏览该应用目录；暂未实现导出到系统公共下载目录。
- NAS 密码和 Jellyfin 令牌暂仅在本次运行中保留，重启需要重新登录；不向磁盘写入明文密码。
- Android 系统备份关闭，避免媒体缓存和账户配置被自动备份。
- 允许用户配置 HTTP NAS 及本地媒体代理；HTTPS 证书校验策略与桌面一致。
- 首版不提供 Android 自动安装更新，也不保证应用退到后台后继续传输。

## 验证

```powershell
node --test scripts/android.test.mjs
node scripts/check-android-browser.mjs
```

浏览器测试使用 Android UA 和手机尺寸，覆盖文件、相册、视频和横屏触控导航；它不能替代 Android 真机对 NAS 登录、下载、HEIC 转换和视频播放的验证。

## APK 签名

```powershell
./scripts/sign-android.ps1 -Apk 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk'
```

脚本首次运行会在已被 Git 忽略的 `.android-signing/` 创建签名密钥及随机密码文件，后续复用同一密钥。请将整个目录安全备份；丢失密钥后无法覆盖升级已安装的 APK。不要上传该目录到 GitHub。签名后的 APK 位于 `src-tauri/target/release/bundle/android/`。

原生库通过 `src-tauri/build.rs` 配置 16 KB ELF 页对齐，签名脚本同时进行 APK 的 16 KB ZIP 对齐。Android Activity 为系统栏、刘海和键盘保留空间，系统返回手势优先回退页面。
