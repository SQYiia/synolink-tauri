# SynoLink · 群晖 DSM 桌面客户端

基于 **Tauri 2 + Vue 3 + TypeScript** 构建的跨平台 Synology NAS 桌面客户端，以轻量、原生的体验替代官方 Web 端，专注于文件浏览、相册与视频媒体库的高效访问。

> 适配 DSM 6.x / 7.x，使用 FileStation API 与 Tauri HTTP 插件直连 NAS，通过原生 HTTP 访问 NAS，默认验证 HTTPS 证书。

---

## ✨ 核心功能

- **多服务器管理**：保存多台 NAS 登录信息，一键切换
- **文件管理**：共享文件夹浏览、目录导航、上传/下载/重命名/删除/新建目录；开发版新增分享链接管理、ZIP/7z 压缩、整包解压及 NAS 文件任务取消，参见 [P1 验收记录](doc/P1-FILE-FEATURES-VALIDATION.md)。
  - 下一批开发版支持批量重命名：文字替换、前后缀、序号、预览和冲突检查，Windows 多选与安卓长按多选同步适配，参见 [批量重命名验收](doc/P2-BATCH-RENAME-VALIDATION.md)。
  - 开发版回收站：按共享目录浏览 `#recycle`、恢复到指定目录、确认后永久删除选中项目，Windows 工具栏与安卓更多菜单同步接入，详见 [回收站验收](doc/P2-RECYCLE-BIN-VALIDATION.md)。
- **相册视图**：递归扫描图片目录，按日期分组展示，渐进式懒加载 + 大图浏览
  - 拍摄时间智能识别：文件名 → `crtime` → `mtime` 优先级回退
- **视频库**：递归扫描视频目录，网格式封面预览，内置播放器、NFO 影视信息与本地海报；支持连接 Jellyfin 海报墙
- **系统信息**：CPU / 内存 / 存储卷 / 磁盘占用实时查看
- **会话自动恢复**：session 失效自动重登，无感续期
- **安卓相册自动备份（开发版）**：选择手机相册和 NAS 目录，原生后台扫描新增照片、上传并校验内容，支持仅 Wi-Fi、暂停及可选视频。真机验收尚未完成，详见 [相册备份验收记录](doc/P1-PHOTO-BACKUP-VALIDATION.md)。

## 🛠 技术栈

| 层级 | 技术 |
| --- | --- |
| 壳 | Tauri 2（Rust） |
| 前端 | Vue 3 `<script setup>` + TypeScript + Vite 6 |
| UI | Element Plus + @element-plus/icons-vue |
| 状态 | Pinia |
| 路由 | Vue Router（hash 模式） |
| 网络 | `@tauri-apps/plugin-http`（原生 HTTP 请求） |
| 存储 | `@tauri-apps/plugin-store`（多服务器配置持久化） |
| 外部打开 | `@tauri-apps/plugin-opener` |

## 📁 目录结构

```
synolink-tauri/
├── src/                    # 前端源码
│   ├── api/dsm.ts          # DSM API 封装（FileStation / Auth / System）
│   ├── views/              # 路由视图（ServerList / Files / Album / Videos / Me 等）
│   ├── layouts/AppShell.vue# 主 Shell（底部 Tab 布局）
│   ├── components/         # 通用组件（FolderPicker / LazyThumb）
│   ├── stores/             # Pinia store
│   └── router/             # 路由表
└── src-tauri/              # Tauri/Rust 端
    ├── src/lib.rs          # 自定义 dsm:// 协议代理（流媒体、缩略图）
    ├── tauri.conf.json     # 应用配置
    └── capabilities/       # 权限清单
```

## 🚀 开发与构建

### 环境要求

- Node.js ≥ 18
- Rust ≥ 1.77（`rustup install stable`）
- Windows 需安装 MSVC 构建工具与 WebView2 Runtime

### 命令

```bash
# 安装依赖
npm install

# 开发模式（前端热更新 + Tauri 窗口）
npm run tauri dev

# 生产打包（产出 exe / msi / nsis）
npm run tauri build
```

构建产物位于 `src-tauri/target/release/`，安装包在 `src-tauri/target/release/bundle/`。

> NSIS 打包会从 GitHub 下载 `nsis-3.11.zip`，网络不通可在 `src-tauri/tauri.conf.json` 的 `bundle.targets` 中改为 `["msi"]` 单独出 MSI。

## 🔑 登录与会话

- 登录接口：`SYNO.API.Auth` (session=`FileStation`, format=`sid`)，下载站使用独立会话
- 登录成功后持有 `sid` 与 `synotoken`，请求统一通过 `entry.cgi` 发出
- 默认校验 HTTPS 证书。只有在服务器设置中显式开启“允许无效证书”时才放宽校验；该设置不等于证书指纹绑定。
- 媒体流（视频/原图）通过自定义 `dsm://` scheme 由 Rust 端代理转发，并遵循当前服务器的证书设置

## 🧩 推荐 IDE

- [VS Code](https://code.visualstudio.com/)
- [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 📄 License

本项目仅供学习交流，与 Synology Inc. 无任何关联。

## 可靠性与安全更新

- 文件目录和搜索结果读取完整分页，搜索可取消，失败不会作为完整结果展示。
- 上传默认禁止覆盖，同名文件需确认；上传、NAS 复制/移动记录可在传输中心查看。
- 本机下载绑定来源服务器和账号，记录可跨重启恢复；继续下载前必须登录来源账号。断点续传依赖服务器提供 ETag 或 Last-Modified 验证器，没有验证器时安全地从头下载。
- 下载采用读取空闲超时，避免将 30 秒当作整个大文件的传输期限。识别无附件头的 DSM JSON 错误响应，并校验续传偏移和文件长度。
- 密码可选存入系统凭据库（Windows Credential Store / Apple Keychain / Linux Secret Service），配置 JSON 不再保存密码。旧记录自动迁移；凭据库不可用时不回退到明文保存，下次启动需要重新输入密码。
- HTTPS 默认校验证书，既有自签名服务器需要在“编辑服务器”中显式配置例外。生产构建启用 CSP。
- 相册和视频使用按服务器、账号隔离的 IndexedDB 列表缓存；后台重新扫描更新缓存。此实现仍是全量扫描，不是服务端增量索引。
- 收藏和视频进度按服务器、账号隔离；旧的未隔离记录不会自动混入新账号。
- F5 刷新文件列表、Alt+↑ 返回上级、F2 重命名单选文件；支持直接输入目录路径。

### 验证

运行 `npm test`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml --lib`。
回归用例覆盖完整分页、搜索取消、默认不覆盖、权限拒绝、密码迁移与删除，以及包含逗号的文件路径。
真实 NAS 的 DSM 版本兼容性、OTP、系统凭据库权限、WebView 媒体播放和移动端后台行为仍需设备联调。上传记录恢复后需重新选择文件；暂不提供上传分块续传。NAS 文件任务的“重新查询”不会重新提交复制或移动，避免重复操作。

### 0.1.2 相册图片加载

缩略图及相册原图改用 Tauri HTTP 插件直接读取，通过 Blob URL 显示，避免 WebView 自定义协议请求失败时无法诊断。图片响应会校验类型、限制大小，识别 DSM 错误码；会话失效仅合并重登并重试一次。重试会重新请求 NAS，不复用失败响应。失败卡片显示具体错误原因，移动预览保留滑动与缩放。此变更通过模拟 HTTP 响应测试；真实 NAS 的图片权限、缩略图生成和网络状态仍需设备验证。

### 0.1.3 HEIC / HEIF 预览

File Station 缩略图 404 不代表原文件不存在。HEIC/HEIF 缩略图失败时读取原文件，通过按需加载的 `heic-to/csp` 在本机 Worker 中解码，输出 512px 缩略图或最长边 2560px 的预览；下载仍保留原文件。转换串行执行，取消的排队任务跳过，解码后释放位图。图片读取上限为 64 MiB。File Station Thumb 使用文档版本 2 和 JSON 字符串路径。

`npm run test:heic` 使用公开 HEIC 样本和隔离 Chrome 验证真实解码、缩略图尺寸、取消后恢复及生产 CSP。`CHROME_PATH` 可指定浏览器位置。依赖许可和来源见 `public/licenses/HEIC-NOTICES.txt`。真实用户 NAS 上的 HEIC 文件仍需升级后验证。

### 0.1.4 HEIC 缓存与照片查看器

HEIC/HEIF 的 JPEG 缩略图和大图预览保存在 IndexedDB，按服务器、账号、路径、修改时间、文件大小和预览尺寸隔离，跨登录/重启复用。文件缺少修改时间时不持久缓存。最多保留 128 MiB / 2000 张，按最近使用时间淘汰；存储不可用时仍可正常读取和转换。桌面预览使用深色全屏查看器，顶部文件名与关闭按钮、两侧切换、底部照片信息及下载/删除操作；保留方向键和 Esc 支持。

### 0.1.5 视频库与播放

视频封面优先读取本机持久缓存和群晖缩略图。群晖未生成缩略图时，通过已认证的分段视频流在本机截帧，最多并行两项、每项最多等待 15 秒；成功后按文件版本缓存。此兜底依赖 WebView 支持该视频编码，不包含服务端转码，不支持的编码显示暂无封面或明确播放错误。

视频库使用 16:9 封面卡片，扫描期间保留已发现内容并显示扫描错误。桌面与移动端采用统一深色全屏播放器，支持倍速、缓冲状态、错误重试和进度记忆。已移除视频的外部打开入口和相关引导。浏览器验证包含真实生成的视频截帧、播放、倍速、错误恢复、关闭和窄屏布局；用户 NAS 的流式读取仍需实机验证。

### 0.1.12 相册与视频自动加载

- 统一媒体页面生命周期：首次进入、KeepAlive 返回及登录就绪后自动扫描，首次 mounted/activated 不重复发请求。
- 服务器/账号切换时重新读取对应目录，修复非响应式 DSM 字段导致监听和缓存键失效。
- 离开页面取消旧扫描结果更新；保留已有内容供返回后继续浏览。缓存读取最多等待 1 秒，缓存写入不阻塞扫描完成。
- 45 项回归测试及真实页面浏览器测试通过，验证首次加载和返回后发现新增媒体，全程不点击刷新。

### 0.1.11 内存统计修复

- 性能页与首页统一使用 DSM real_usage 占用率，避免把缓存作为应用占用。
- 区分系统内存 total_real 与已安装内存 memory_size；容量按 KiB 换算。由占用率换算的已用量标注为估算。
- 缺失百分比时，仅在总量、空闲、缓存与缓冲字段齐全时估算；不完整、无效数据及请求失败显示未知，不产生伪造历史点。
- 41 项回归测试通过，覆盖缓存占用、0%、字符串字段及缺失/异常数据。

### 0.1.10 Drive 与备份中心

- Drive：个人文件、团队文件夹、目录导航、分页、当前页筛选及文件信息；登录时建立独立 Drive 会话。
- 备份中心：Hyper Backup / Active Backup for Business 只读任务列表、最近结果、执行时间，Hyper Backup 错误详情；不支持的接口与权限失败分别显示。
- 不把缺失或未知备份结果当作成功，不将仓库 ID 当作任务 ID，不返回备份凭据原始数据。
- 37 项回归测试。实际 NAS 提供 Drive 接口，但未提供两种备份任务接口；写入、分享、版本恢复与备份执行尚未接入。

### 0.1.9 应用中心与套件接入（首批）

- P0：应用中心展示套件、版本、状态，搜索和筛选已接入功能；兼容未接入套件与权限不足提示。
- P1：Container Manager / Docker 容器列表、资源占用、启停重启及分页日志；停止/重启需用户在界面确认。
- P1：Download Station 下载限速及默认目录设置，保留 0=不限速，只提交已修改字段。
- Photos 未安装/未启用，原生相册接入暂缓；仍可使用现有文件相册。Drive、备份和影音等后续优先级尚未完成。
- NAS 仅做匿名只读 API 能力探测；功能操作使用模拟 NAS 测试，尚待真实套件验证。

### 0.1.8 虚拟机配置

- 新增详情与配置：名称、描述、自动启动策略，以及关机后的 CPU、内存调整。
- 展示虚拟磁盘容量、网络组和 MAC 地址，桌面及移动端均可访问。
- 操作增加重复提交保护和具体错误提示；刷新失败及账号切换不再静默覆盖状态。
- 32 项测试和模拟 NAS 浏览器交互验证通过；未修改实际 NAS 虚拟机。

### 0.1.7 文件菜单与下载站状态

- 文件行操作收进右键菜单，保留更多按钮和移动端操作，支持多选、键盘导航。
- 下载站显示刷新错误、最后更新时间、任务详情和零速度状态提示；未返回速度不再当作零。
- 检查暂停、恢复、删除的单任务错误，修正多行链接提交和移除种子文件后的状态。
- 31 项回归测试及浏览器交互验证通过；实际 NAS 零速度原因仍需对照具体任务状态。

### 0.1.6 封面加载与界面统一

本机缓存命中不再等待网络加载队列。视频封面直接使用首个可解码画面，避免先跳转到中段触发额外远程读取；群晖封面请求等待 2.5 秒后转为本机截帧，单项截帧上限 8 秒。视频列表只提前加载视口外 80px 的封面，播放时也会顺手缓存画面。首次远程视频的实际耗时仍取决于带宽、文件封装和编码。

统一桌面侧栏、概览、文件表格、下载站、性能、设置、服务器列表及登录表单的背景、间距与圆角，适配深色主题和窄屏侧栏。移除远程字体依赖，采用系统字体。移除与多根节点页面冲突的桌面离场过渡，避免快速切换页面时空白。浏览器回归新增网络队列占满时的缓存显示及概览→文件→性能的连续导航检查。

## 0.1.13 · Jellyfin 与影视资料

视频页增加 NAS 文件 / Jellyfin 影视库切换。Jellyfin 支持账号登录、系统凭据库保存连接令牌、海报墙、搜索分页、电影与剧集详情、季集浏览；海报懒加载并按服务器、用户、图片版本缓存。支持反向代理子路径，默认校验 HTTPS 证书。

使用：打开「视频 → Jellyfin 影视库」，填写 Jellyfin 地址（通常为 http://NAS地址:8096）和 Jellyfin 账号。DSM 地址及账号不会自动用于 Jellyfin。此版本接入媒体浏览与资料，Jellyfin 转码播放和观看进度同步尚未接入；NAS 文件模式保留原有内置播放。

NAS 文件模式自动读取同目录的同名 .nfo（movie / tvshow / episodedetails XML），支持标题、年份、评分、简介、类型、演员。单视频目录可使用 movie.nfo。海报按「同名-poster.jpg/png → 同名.jpg/png → poster.jpg/png → folder.jpg」匹配。仅只读现有文件，不修改影视内容，不自动访问 NFO 内的网络地址。多视频目录优先为每个视频提供同名 NFO，以避免资料串片。刷新按钮重新检查附加资料，缺少海报时回退到现有视频缩略图。

验证：48 项 Node 回归测试、Vue 类型检查和前端构建；浏览器模拟 Jellyfin 登录、详情、剧集导航、移动布局、NFO XML 和已有媒体播放回归。实际 Jellyfin 服务由用户在安装后填写地址进行联机验证。

## 0.1.14 · 媒体列表自动恢复

相册和 NAS 视频首次扫描返回空结果或暂时失败时自动复查（最多两次），复查期间保留已有缓存。识别同账号 SID 更新并重新加载；恢复窗口可见时按间隔刷新。正确区分字符串 false 与 true 的扫描状态，扫描调度不再依赖动画帧，停止后台搜索不会阻塞页面结束加载。手动刷新、切换目录和离开页面会取消旧复查任务。

验证：54 项 Node 测试；浏览器模拟相册和视频首次返回空结果后自动恢复、返回页面自动更新及会话更新，无需点击刷新。真实 NAS 的首次空列表原因仍需联机确认。

## 0.1.15 · 套件管理

应用中心增加套件详情、启动/停止、卸载前检查。套件中心分别读取群晖和社区目录，提供更新检测、下载进度、存储卷选择、安装/更新确认及版本核实；支持逐项确认的更新队列。第三方来源可新增、修改和删除（移除来源不会卸载套件），支持上传不超过 512 MB 的 SPK。支持 NAS 自动更新策略：关闭、仅重要更新、所有套件最新版本；保留自定义策略，直到用户明确选择新策略。

接口参数核对来源：用户 NAS 的 /webman/modules/PkgManApp/PkgManApp.js（只读获取）与 N4S4/synology-api 的 core_package.py。安装保留签名与依赖检查，不强制安装；存在自定义安装/卸载向导、许可确认、重启或依赖替换时，明确提示在 DSM 完成。依赖不自动安装，不跳过风险确认。网络中断或超时不视为成功，NAS 可能继续执行，需刷新核实后再试。修改套件和套件源通常需要 NAS 管理员权限。Docker 镜像更新不属于 SPK 管理。

验证：58 项 Node 测试、类型检查及构建；浏览器模拟套件启停、下载、安装、更新、来源增删改与自动更新策略。未对真实 NAS 执行安装、更新、卸载等写操作，实际 DSM 版本兼容性待用户验证。

## 软件更新（Windows x64，0.1.16 起）

启动 5 秒后自动检查 GitHub Releases 最新稳定版，此后每 6 小时检查一次；在「我的」中可以关闭自动检查或手动检查。发现新版本时显示通知，下载和安装均由用户操作。下载失败可重试，已完成的安装包会复用并重新校验。有未完成的传输或文件操作时禁止退出安装。

更新源固定为 `SQYiia/synolink-tauri`，采用 HTTPS 和 GitHub 资产 SHA256 digest 校验；这属于完整性校验，并非发行者代码签名。安装前再次校验，随后打开 Windows 安装向导并退出应用，安装完成后重新启动。0.1.15 及更早版本需要先手动安装 0.1.16。

发布新版本需同步 package.json、package-lock.json、Cargo.toml、Cargo.lock、tauri.conf.json 的版本，以 `v版本号` 发布正式 Release，并上传 `SynoLink_版本号_x64-setup.exe`；GitHub API 必须返回该资产的 `sha256:` digest。草稿、预发布、相同或更低版本不会触发更新。当前不包含 macOS/iOS 自动安装。

验证：`npm test`、`npm run test:updater`、`cargo test --manifest-path src-tauri/Cargo.toml`。更新浏览器测试模拟 GitHub 返回及安装调用，不启动实际安装器。

## Android

支持构建 ARM64 安卓安装包，最低 Android 7.0。手机界面、媒体代理和应用内下载目录已适配。构建、签名、验证方式及当前限制见 [Android 说明](doc/ANDROID.md)。
