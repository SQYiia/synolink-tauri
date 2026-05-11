# SynoLink · 群晖 DSM 桌面客户端

基于 **Tauri 2 + Vue 3 + TypeScript** 构建的跨平台 Synology NAS 桌面客户端，以轻量、原生的体验替代官方 Web 端，专注于文件浏览、相册与视频媒体库的高效访问。

> 适配 DSM 6.x / 7.x，使用 FileStation API 与 Tauri HTTP 插件直连 NAS，绕过浏览器 CORS 和自签名证书限制。

---

## ✨ 核心功能

- **多服务器管理**：保存多台 NAS 登录信息，一键切换
- **文件管理**：共享文件夹浏览、目录导航、上传/下载/重命名/删除/新建目录
- **相册视图**：递归扫描图片目录，按日期分组展示，渐进式懒加载 + 大图浏览
  - 拍摄时间智能识别：文件名 → `crtime` → `mtime` 优先级回退
- **视频库**：递归扫描视频目录，网格式封面预览，内置播放器 + 系统播放器一键外部打开（VLC/PotPlayer 等）
- **系统信息**：CPU / 内存 / 存储卷 / 磁盘占用实时查看
- **会话自动恢复**：session 失效自动重登，无感续期

## 🛠 技术栈

| 层级 | 技术 |
| --- | --- |
| 壳 | Tauri 2（Rust） |
| 前端 | Vue 3 `<script setup>` + TypeScript + Vite 6 |
| UI | Element Plus + @element-plus/icons-vue |
| 状态 | Pinia |
| 路由 | Vue Router（hash 模式） |
| 网络 | `@tauri-apps/plugin-http`（绕过 CORS & 自签证书） |
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

- 登录接口：`SYNO.API.Auth` (session=`webui`, format=`sid`)
- 登录成功后持有 `sid` 与 `synotoken`，请求统一通过 `entry.cgi` 发出
- 自签名证书通过 Tauri HTTP 插件的 `danger.acceptInvalidCerts` 绕过
- 媒体流（视频/原图）通过自定义 `dsm://` scheme 由 Rust 端代理转发，规避 WebView 对自签证书的拦截

## 🧩 推荐 IDE

- [VS Code](https://code.visualstudio.com/)
- [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 📄 License

本项目仅供学习交流，与 Synology Inc. 无任何关联。
