import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'

/** Windows 下自定义 scheme 走 http://<scheme>.localhost，其他平台是 <scheme>://localhost */
const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
const DSM_SCHEME_BASE = IS_WINDOWS ? 'http://dsm.localhost' : 'dsm://localhost'

/** DSM 统一响应结构（doc 1.4） */
export interface DsmResponse<T = any> {
  success: boolean
  data?: T
  error?: { code: number; errors?: any }
}

/** 会话失效（code=119）时由外部提供的自动恢复函数：返回 true 表示重登成功。 */
let sessionRecoverer: (() => Promise<boolean>) | null = null
export function setSessionRecoverer(fn: (() => Promise<boolean>) | null) {
  sessionRecoverer = fn
}
/** 防止并发重登；多个并发请求共享同一次重登 Promise。 */
let reloginInflight: Promise<boolean> | null = null

/** SYNO.API.Info 返回的单个 API 条目 */
export interface ApiInfo {
  path: string
  minVersion: number
  maxVersion: number
  requestFormat?: string
}

/** 登录返回 */
export interface AuthResult {
  sid?: string
  synotoken?: string
  did?: string
  account?: string
  device_id?: string
  is_portal_port?: boolean
}

/**
 * DSM API 客户端。参考 doc/Syno_DSM_API.md
 *
 * - 所有请求通过 Tauri HTTP 插件发送，绕过浏览器 CORS。
 * - 登录成功后自动保存 synotoken，后续请求注入 X-SYNO-TOKEN（doc 1.7）。
 * - Cookie 由 DSM 下发的 Set-Cookie 自动维护（Tauri 会持久 cookie）。
 */
export class DsmClient {
  baseUrl: string
  apiInfo: Record<string, ApiInfo> = {}
  synoToken = ''
  sid = ''

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  private buildUrl(path: string, params?: Record<string, any>) {
    const url = new URL(this.baseUrl + path)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  }

  private async request<T = any>(
    path: string,
    opts: {
      method?: 'GET' | 'POST'
      query?: Record<string, any>
      form?: Record<string, any>
      headers?: Record<string, string>
    } = {},
    _retried = false,
  ): Promise<T> {
    const method = opts.method ?? 'GET'
    // 注入 _sid（DSM session ID）
    const query = { ...(opts.query ?? {}) }
    const form = opts.form ? { ...opts.form } : undefined
    if (this.sid) {
      if (form) form._sid = this.sid
      else query._sid = this.sid
    }
    const url = this.buildUrl(path, query)
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    if (this.synoToken) headers['X-SYNO-TOKEN'] = this.synoToken
    // 注：不注入 Cookie: id=<sid>。
    // webapi 登录拿到的 sid 与 DSM Web GUI 登录的 cookie id 是两套独立会话，值不同；
    // 贸然把 webapi sid 当作 cookie id 注入，DSM 拿它去校验 GUI session 表会失败 → 119。

    let body: string | undefined
    if (form) {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(form)) {
        if (v !== undefined && v !== null) params.append(k, String(v))
      }
      body = params.toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    const res = await fetch(url, {
      method,
      headers,
      body,
      // 群晖 NAS 常为自签名证书，跳过 TLS 校验
      danger: {
        acceptInvalidCerts: true,
        acceptInvalidHostnames: true,
      },
    } as any)
    const text = await res.text()
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      return text as any
    }
    // 会话失效（code=119 / 105 / 106 / 107）自动重登并重放一次
    const code = parsed?.error?.code
    const SESSION_LOST = code === 119 || code === 105 || code === 106 || code === 107
    if (!_retried && parsed?.success === false && SESSION_LOST && sessionRecoverer) {
      // 登出登入接口自身不走恢复，避免死循环
      const isAuthCall = (opts.form?.api === 'SYNO.API.Auth') || (opts.query?.api === 'SYNO.API.Auth') || path.endsWith('/auth.cgi')
      if (!isAuthCall) {
        if (!reloginInflight) reloginInflight = sessionRecoverer().finally(() => { reloginInflight = null })
        const ok = await reloginInflight
        if (ok) return this.request<T>(path, opts, true)
      }
    }
    return parsed as T
  }

  /** SYNO.API.Info (doc 2.1) */
  async loadApiInfo() {
    const res = await this.request<DsmResponse<Record<string, ApiInfo>>>(
      '/webapi/query.cgi',
      {
        query: { api: 'SYNO.API.Info', version: 1, method: 'query', query: 'all' },
      },
    )
    if (res.success && res.data) {
      this.apiInfo = res.data
    }
    return this.apiInfo
  }

  private versionOf(api: string) {
    return this.apiInfo[api]?.maxVersion ?? 1
  }

  /** 调用 /webapi/entry.cgi 的统一入口（doc 1.1） */
  async entry<T = any>(
    api: string,
    method: string,
    opts: { post?: boolean; params?: Record<string, any> } = {},
  ): Promise<DsmResponse<T>> {
    const full = {
      api,
      version: this.versionOf(api),
      method,
      ...(opts.params ?? {}),
    }
    if (opts.post) {
      return this.request<DsmResponse<T>>('/webapi/entry.cgi', {
        method: 'POST',
        form: full,
      })
    }
    return this.request<DsmResponse<T>>('/webapi/entry.cgi', { query: full })
  }

  /** 明文登录（doc 3.1 method=login）
   *  注意：必须使用 session='FileStation' 登录！
   *  SYNO.FileStation.* 系列 API（尤其是 Download）对 session 类型校验严格，
   *  使用 'webui' 或其他 session 名会导致 Download 接口返回错误码 119（即使参数、cookie、URL 全部正确）。
   *  SYNO.Core.* 系列在 FileStation session 下同样可用（File Station 应用内部本就调这些）。 */
  async login(params: {
    account: string
    passwd: string
    otp_code?: string
    device_id?: string
    enable_device_token?: 'yes' | 'no'
  }): Promise<DsmResponse<AuthResult>> {
    const res = await this.entry<AuthResult>('SYNO.API.Auth', 'login', {
      post: true,
      params: {
        session: 'FileStation',
        format: 'sid',
        enable_syno_token: 'yes',
        enable_device_token: params.enable_device_token ?? 'no',
        account: params.account,
        passwd: params.passwd,
        otp_code: params.otp_code ?? '',
        ...(params.device_id ? { device_id: params.device_id } : {}),
      },
    })
    if (res.success && res.data) {
      this.sid = res.data.sid ?? ''
      this.synoToken = res.data.synotoken ?? ''
      // 同步会话给 Rust 端（用于 dsm:// 代理流式播放）
      try {
        await invoke('set_session', {
          baseUrl: this.baseUrl,
          sid: this.sid,
          synoToken: this.synoToken,
        })
      } catch (e) { console.warn('[dsm] set_session failed:', e) }
    }
    return res
  }

  /** 登出（doc 3.2），session 必须与 login 时一致 */
  async logout() {
    const res = await this.entry('SYNO.API.Auth', 'logout', { params: { session: 'FileStation' } })
    try { await invoke('clear_session') } catch (e) { console.warn('[dsm] clear_session failed:', e) }
    return res
  }

  /** 共享文件夹列表（doc 4.4 list_share） */
  async listShare(opts: { offset?: number; limit?: number; additional?: string } = {}) {
    return this.entry('SYNO.FileStation.List', 'list_share', {
      params: {
        offset: opts.offset ?? 0,
        limit: opts.limit ?? 0,
        additional: opts.additional ?? '',
      },
    })
  }

  /** 文件列表（doc 4.4 list） */
  async listFiles(folderPath: string, opts: { offset?: number; limit?: number; additional?: string; filetype?: 'all' | 'file' | 'dir' } = {}) {
    return this.entry('SYNO.FileStation.List', 'list', {
      params: {
        folder_path: folderPath,
        offset: opts.offset ?? 0,
        limit: opts.limit ?? 0,
        additional: opts.additional ?? '',
        filetype: opts.filetype ?? 'all',
      },
    })
  }

  /** 只列目录（给目录选择器用） */
  async listFolders(folderPath: string) {
    return this.listFiles(folderPath, { filetype: 'dir', limit: 0 })
  }

  /** 新建文件夹（doc 4.6 create） */
  async createFolder(folderPath: string, name: string, forceParent = false) {
    return this.entry('SYNO.FileStation.CreateFolder', 'create', {
      post: true,
      params: { folder_path: folderPath, name, force_parent: forceParent ? 'true' : 'false' },
    })
  }

  /** 重命名（doc 4.7 rename） */
  async rename(path: string, name: string) {
    return this.entry('SYNO.FileStation.Rename', 'rename', {
      post: true,
      params: { path, name },
    })
  }

  /** 删除（blocking 模式，doc 4.12 delete） */
  async deletePath(path: string | string[], recursive = true) {
    const p = Array.isArray(path) ? path.join(',') : path
    return this.entry('SYNO.FileStation.Delete', 'delete', {
      post: true,
      params: { path: p, recursive: recursive ? 'true' : 'false' },
    })
  }

  /** 复制或移动文件/文件夹（doc 4.9 start） */
  async copyMove(paths: string[], destFolder: string, overwrite = false, removeSource = false) {
    const p = paths.join(',')
    return this.entry<{ taskid: string }>('SYNO.FileStation.CopyMove', 'start', {
      post: true,
      params: {
        path: p,
        dest_folder_path: destFolder,
        overwrite: overwrite ? 'true' : 'false',
        remove_src: removeSource ? 'true' : 'false',
      },
    })
  }

  /** 轮询复制/移动任务状态 */
  async copyMoveStatus(taskid: string) {
    return this.entry<{ finished: boolean; progress?: number }>('SYNO.FileStation.CopyMove', 'status', {
      params: { taskid },
    })
  }

  /** 搜索：启动任务（doc 4.15 start）
   *  注意：pattern 留空表示搜索所有文件；传 `*` 会被 DSM 当作不合法正则立即返回空。 */
  async searchStart(
    folderPath: string,
    pattern = '',
    recursive = true,
    extra: { extension?: string; filetype?: 'file' | 'dir' | 'all' } = {},
  ) {
    const params: Record<string, any> = {
      folder_path: folderPath,
      pattern,
      recursive: recursive ? 'true' : 'false',
    }
    if (extra.extension) params.extension = extra.extension
    if (extra.filetype) params.filetype = extra.filetype
    return this.entry<{ taskid: string }>('SYNO.FileStation.Search', 'start', {
      post: true,
      params,
    })
  }

  /** 搜索：拉取结果
   *  注意：DSM 不同版本对 additional 的接受格式不一致（逗号分隔 vs JSON 数组）。
   *  默认使用 JSON 数组形式，兼容性更好。 */
  async searchList(
    taskid: string,
    opts: { offset?: number; limit?: number; additional?: string } = {},
  ) {
    return this.entry('SYNO.FileStation.Search', 'list', {
      params: {
        taskid,
        offset: opts.offset ?? 0,
        limit: opts.limit ?? 100,
        additional: opts.additional ?? '["real_path","size","time","type","perm"]',
      },
    })
  }

  /** 搜索：停止任务 */
  async searchStop(taskid: string) {
    return this.entry('SYNO.FileStation.Search', 'stop', { post: true, params: { taskid } })
  }

  /** 构造下载 URL（doc 4.10 download），带 _sid 走 GET
   *  注意：
   *  1. 强制使用 entry.cgi 而非 apiInfo 给出的独立 cgi（独立 cgi 对 _sid 校验更严格）。
   *  2. path 必须是 JSON 数组字符串 ["..."]，DSM 7+ 裸字符串会报 119。
   *  3. 默认 mode='open'：DSM 7 下 mode='download' 会严格校验 GUI session cookie，
   *     webapi 客户端拿不到 GUI session id，只能走 mode='open' 拿字节流。 */
  downloadUrl(path: string, mode: 'open' | 'download' = 'open') {
    const info = this.apiInfo['SYNO.FileStation.Download']
    const params = new URLSearchParams({
      api: 'SYNO.FileStation.Download',
      version: String(info?.maxVersion ?? 2),
      method: 'download',
      path: JSON.stringify([path]),
      mode,
      _sid: this.sid,
    })
    return `${this.baseUrl}/webapi/entry.cgi?${params.toString()}`
  }

  /** 构造缩略图 URL（doc 4.5 thumb） */
  thumbUrl(path: string, size: 'small' | 'medium' | 'large' | 'original' = 'medium') {
    const info = this.apiInfo['SYNO.FileStation.Thumb']
    const cgi = info?.path ?? 'entry.cgi'
    const params = new URLSearchParams({
      api: 'SYNO.FileStation.Thumb',
      version: String(info?.maxVersion ?? 2),
      method: 'get',
      path,
      size,
      _sid: this.sid,
    })
    return `${this.baseUrl}/webapi/${cgi}?${params.toString()}`
  }

  /** 统一拼装认证 header（仅 X-SYNO-TOKEN），给直接 fetch 调用复用 */
  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = {}
    if (this.synoToken) h['X-SYNO-TOKEN'] = this.synoToken
    return h
  }

  /** 拉取缩略图字节（绕过自签名证书） */
  async thumbBytes(path: string, size: 'small' | 'medium' | 'large' | 'original' = 'small'): Promise<ArrayBuffer> {
    const url = this.thumbUrl(path, size)
    const res = await fetch(url, {
      method: 'GET',
      headers: this.authHeaders(),
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    } as any)
    return await res.arrayBuffer()
  }

  /** 文件上传 multipart（doc 4.9 upload） */
  async upload(folderPath: string, file: File, overwrite = true) {
    const info = this.apiInfo['SYNO.FileStation.Upload']
    const cgi = info?.path ?? 'entry.cgi'
    const version = info?.maxVersion ?? 2
    const form = new FormData()
    form.append('api', 'SYNO.FileStation.Upload')
    form.append('version', String(version))
    form.append('method', 'upload')
    form.append('path', folderPath)
    form.append('create_parents', 'true')
    form.append('overwrite', overwrite ? 'true' : 'false')
    if (this.sid) form.append('_sid', this.sid)
    form.append('file', file, file.name)

    const url = `${this.baseUrl}/webapi/${cgi}`
    const headers: Record<string, string> = this.authHeaders()
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    } as any)
    const text = await res.text()
    try {
      return JSON.parse(text) as DsmResponse
    } catch {
      return { success: false, error: { code: -1, errors: text } } as DsmResponse
    }
  }

  /** 获取文件字节（用于预览或本地保存） */
  async downloadBytes(path: string): Promise<ArrayBuffer> {
    const url = this.downloadUrl(path, 'open')
    const res = await fetch(url, {
      method: 'GET',
      headers: this.authHeaders(),
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    } as any)
    return await res.arrayBuffer()
  }

  /** 系统基础信息（doc SYNO.Core.System info） */
  async systemInfo() {
    return this.entry('SYNO.Core.System', 'info', { params: { type: 'storage' } })
  }

  /** 资源占用（CPU/内存/网络/磁盘） */
  async systemUtilization() {
    return this.entry('SYNO.Core.System.Utilization', 'get', { params: { type: 'current' } })
  }

  /** 存储卷/磁盘 */
  async storageInfo() {
    return this.entry('SYNO.Core.Storage.Volume', 'list', {
      params: { limit: -1, offset: 0, location: 'internal', option: 'none' },
    })
  }

  async diskInfo() {
    return this.entry('SYNO.Core.Storage.Disk', 'list', {
      params: { limit: -1, offset: 0 },
    })
  }

  /** 构造 dsm:// 代理 URL（由 Rust 端转发并绕过自签名证书） */
  mediaUrl(kind: 'stream' | 'thumb', path: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ path, ...extra })
    return `${DSM_SCHEME_BASE}/${kind}?${params.toString()}`
  }

  // ─── Download Station ─────────────────────────────────────────────

  /** DS 版本信息 */
  async dsInfo() {
    return this.entry('SYNO.DownloadStation.Info', 'getinfo')
  }

  /** DS 配置 */
  async dsGetConfig() {
    return this.entry('SYNO.DownloadStation.Info', 'getconfig')
  }

  /** 列出下载任务 */
  async dsTaskList(opts: { offset?: number; limit?: number; additional?: string } = {}) {
    return this.entry('SYNO.DownloadStation.Task', 'list', {
      params: {
        offset: opts.offset ?? 0,
        limit: opts.limit ?? -1,
        additional: opts.additional ?? 'detail,transfer',
      },
    })
  }

  /** 获取指定任务详情 */
  async dsTaskGetInfo(ids: string[], additional = 'detail,transfer,file') {
    return this.entry('SYNO.DownloadStation.Task', 'getinfo', {
      params: { id: ids.join(','), additional },
    })
  }

  /** 创建下载任务（URL/磁力链接） */
  async dsTaskCreate(params: {
    uri: string
    destination?: string
    username?: string
    password?: string
    unzip_password?: string
  }) {
    return this.entry('SYNO.DownloadStation.Task', 'create', {
      post: true,
      params,
    })
  }

  /** 创建下载任务（torrent/nzb 文件上传） */
  async dsTaskCreateFile(file: File, destination?: string) {
    const info = this.apiInfo['SYNO.DownloadStation.Task']
    const cgi = info?.path ?? 'entry.cgi'
    const version = info?.maxVersion ?? 1
    const form = new FormData()
    form.append('api', 'SYNO.DownloadStation.Task')
    form.append('version', String(version))
    form.append('method', 'create')
    if (this.sid) form.append('_sid', this.sid)
    if (destination) form.append('destination', destination)
    form.append('file', file, file.name)
    const url = `${this.baseUrl}/webapi/${cgi}`
    const headers: Record<string, string> = this.authHeaders()
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    } as any)
    const text = await res.text()
    try {
      return JSON.parse(text) as DsmResponse
    } catch {
      return { success: false, error: { code: -1, errors: text } } as DsmResponse
    }
  }

  /** 删除任务 */
  async dsTaskDelete(ids: string[], forceComplete = false) {
    return this.entry('SYNO.DownloadStation.Task', 'delete', {
      params: { id: ids.join(','), force_complete: forceComplete ? 'true' : 'false' },
    })
  }

  /** 暂停任务 */
  async dsTaskPause(ids: string[]) {
    return this.entry('SYNO.DownloadStation.Task', 'pause', {
      params: { id: ids.join(',') },
    })
  }

  /** 恢复任务 */
  async dsTaskResume(ids: string[]) {
    return this.entry('SYNO.DownloadStation.Task', 'resume', {
      params: { id: ids.join(',') },
    })
  }

  /** 全局速度统计 */
  async dsStatistic() {
    return this.entry('SYNO.DownloadStation.Statistic', 'getinfo')
  }

  /** 启动 BT 搜索 */
  async dsBTSearchStart(keyword: string, module = 'all') {
    return this.entry<{ taskid: string }>('SYNO.DownloadStation.BTSearch', 'start', {
      params: { keyword, module },
    })
  }

  /** 获取 BT 搜索结果 */
  async dsBTSearchList(taskid: string, opts: {
    offset?: number; limit?: number;
    sort_by?: string; sort_direction?: string;
  } = {}) {
    return this.entry('SYNO.DownloadStation.BTSearch', 'list', {
      params: {
        taskid,
        offset: opts.offset ?? 0,
        limit: opts.limit ?? 50,
        sort_by: opts.sort_by ?? 'seeds',
        sort_direction: opts.sort_direction ?? 'desc',
      },
    })
  }

  /** 清除 BT 搜索任务 */
  async dsBTSearchClean(taskid: string) {
    return this.entry('SYNO.DownloadStation.BTSearch', 'clean', { params: { taskid } })
  }

  /** 获取 BT 搜索模块 */
  async dsBTSearchModules() {
    return this.entry('SYNO.DownloadStation.BTSearch', 'getModule')
  }
}

/** 单例 */
export const dsm = new DsmClient()
