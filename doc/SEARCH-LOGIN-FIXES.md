# 搜索、保存密码连接与套件图标（2026-11-14）

## 改动

- 全局搜索先枚举当前账号可访问的共享文件夹，再进行最多两项并发的递归搜索。DSM 不支持将 `/` 当作共享文件夹搜索。
- Search v2 及以上使用 JSON 数组编码目录，兼容包含逗号、引号的路径；v1 保留字符串。参考 [Synology File Station API](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf)。
- 关闭搜索、取消、切换身份时停止继续调度并丢弃旧结果；已创建 NAS 搜索任务沿用 finally 清理。部分目录失败保留其余结果并显示提示。
- 从服务器列表点击连接时，最近使用的账号若已保存且成功读取密码，完成接口发现后自动登录一次。密码错误返回表单，OTP 仍需用户输入；会话失效跳转登录不触发此自动登录流程。登录请求期间阻止页面跳转，以免旧登录污染新服务器会话。
- 已安装套件及在线目录共用图标组件，读取 NAS／套件源提供的图标字段。通过原生 HTTP 获取栅格图片，限制大小、不附加认证信息、不跟随重定向，仅在用户已允许时对当前 NAS 放宽证书验证。地址不可用时显示名称首字母。没有提供图标的 NAS 不保证显示官方图标。

## 验证

- `npm test`：100 项通过，包含共享目录枚举、并发、部分失败、取消、身份变化、参数编码和图标 URL 校验。
- `npm run test:desktop`：搜索结果、权限失败提示、取消及 1440/1100/900/760 宽度回归通过。
- `node scripts/check-login-browser.mjs`：保存密码自动登录、未保存／无法读取密码、会话失效、密码错误、OTP 取消通过。
- `npm run test:heic`：现有媒体、套件、存储、导航等浏览器回归通过。
- Windows 原生构建包含 Vue 类型检查与生产构建。安装包和直接运行 EXE 放在忽略目录 `.npm-cache/deliverables`，不提交二进制。

## 待验证

- 真实 NAS 搜索、实际套件图标返回字段与可访问性、系统凭据读取后的登录。
- Windows 安装运行与安卓真机仍待验证。浏览器测试不能替代设备测试。
- 继续保留 0.1.19 预览版本，不发布尚未完成真机验收的 0.1.20。

## 官方图标回退补充

2026-11-14：增加 57 张从 Synology Design 官方目录取得的未修改 PNG 缩略图，约 346 KiB，随 Windows／安卓共用前端打包。NAS 图标缺失、下载失败或解码失败时，按确切套件 ID 使用本地官方图标，无需联网；明确标为第三方来源的套件不套用官方映射。未知套件使用中性套件图形，不再显示首字母。映射范围以 `src/utils/officialPackageIcons.ts` 为准，来源与校验值见 `public/package-icons/sources.json`。

验证：102 项 Node 测试通过；`check-package-icons-browser.mjs` 验证离线官方图标、NAS 地址失败、本地图标失败及未知套件回退；类型检查与生产构建通过。真实设备仍待验证。
