import { recordError } from '../utils/errorHistory'
import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'

/** Windows / Android 下自定义 scheme 走 http://<scheme>.localhost，其他平台是 <scheme>://localhost */
const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows|Android/i.test(navigator.userAgent)
const DSM_SCHEME_BASE = IS_WINDOWS ? 'http://dsm.localhost' : 'dsm://localhost'

/** DSM 统一响应结构（doc 1.4） */
export interface DsmResponse<T = any> {
  success: boolean
  data?: T
  error?: { code: number; errors?: any }
}

export class MediaError extends Error {
  constructor(message: string, public code?: number) { super(message); this.name = 'MediaError' }
}

function imageContentType(bytes: Uint8Array): string | null {
  const text = new TextDecoder('ascii').decode(bytes.slice(0, 12))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && text.slice(1, 4) === 'PNG') return 'image/png'
  if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'image/gif'
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp'
  if (text.startsWith('BM')) return 'image/bmp'
  if (text.slice(4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(text.slice(8, 12))) return 'image/heic'
  return null
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

/** Download Station `destination` 必须是**相对于共享文件夹的**路径，如 `Downloads/sub`。
 *  常见 FolderPicker 会返回 `/Downloads/...` 或 `/volume1/Downloads/...`，这里统一去除前导 `/` 与 `volumeN/`。 */
function normalizeDsDestination(p?: string): string | undefined {
  if (!p) return undefined
  let s = String(p).trim().replace(/\\/g, '/')
  if (!s) return undefined
  s = s.replace(/^\/+/, '')
  s = s.replace(/^volume\d+\//i, '')
  s = s.replace(/\/+$/, '')
  return s || undefined
}

export class DsmClient {
  baseUrl: string
  account = ''
  allowInsecure = false
  mediaScope = crypto.randomUUID()
  apiInfo: Record<string, ApiInfo> = {}
  synoToken = ''
  sid = ''
  /** DownloadStation 专用 sid。群晖要求此类 API 必须用 session=DownloadStation 登录，
   *  与 FileStation session 的 sid 不互通。为两者同时可用，我们双登录并按 api 前缀路由。 */
  dsSid = ''
  driveSid = ''

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
    const started = Date.now()
    const requestIdentity = `${this.baseUrl}\n${this.account}`
    const method = opts.method ?? 'GET'
    // 根据调用的 api 选择会话 sid：SYNO.DownloadStation.* 优先用 dsSid，其余用主 sid
    const apiName = (opts.form?.api as string | undefined) ?? (opts.query?.api as string | undefined) ?? ''
    const authParams = opts.form ?? opts.query
    const useDsSid = !!this.dsSid && (apiName.startsWith('SYNO.DownloadStation.') ||
      (apiName === 'SYNO.API.Auth' && authParams?.method === 'logout' && authParams?.session === 'DownloadStation'))
    const useDriveSid = !!this.driveSid && (apiName.startsWith('SYNO.SynologyDrive.') || (apiName === 'SYNO.API.Auth' && authParams?.method === 'logout' && authParams?.session === 'SynologyDrive'))
    const effectiveSid = useDriveSid ? this.driveSid : useDsSid ? this.dsSid : this.sid
    // 注入 _sid（DSM session ID）
    const query = { ...(opts.query ?? {}) }
    const form = opts.form ? { ...opts.form } : undefined
    if (effectiveSid) {
      if (form) form._sid = effectiveSid
      else query._sid = effectiveSid
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

    try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      connectTimeout: 15000,
      signal: AbortSignal.timeout(30000),
      // Only an explicitly configured server may bypass certificate validation.
      danger: {
        acceptInvalidCerts: this.allowInsecure,
        acceptInvalidHostnames: this.allowInsecure,
      },
    } as any)
    if (!res.ok) throw Object.assign(new Error(`服务器响应异常（HTTP ${res.status}）`),{code:res.status})
    const text = await res.text()
    if (requestIdentity !== `${this.baseUrl}\n${this.account}`) throw new Error('连接已切换，已忽略旧请求的结果')
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('服务器未返回有效数据，请检查地址或反向代理配置')
    }
    // 会话失效（code=119 / 105 / 106 / 107）自动重登并重放一次
    const code = parsed?.error?.code
    const SESSION_LOST = code === 119 || code === 106 || code === 107
    if (this === dsm && !_retried && parsed?.success === false && SESSION_LOST && sessionRecoverer) {
      // 登出登入接口自身不走恢复，避免死循环
      const isAuthCall = (opts.form?.api === 'SYNO.API.Auth') || (opts.query?.api === 'SYNO.API.Auth') || path.endsWith('/auth.cgi')
      if (!isAuthCall) {
        if (!reloginInflight) reloginInflight = sessionRecoverer().finally(() => { reloginInflight = null })
        const ok = await reloginInflight
        if (ok) return this.request<T>(path, opts, true)
      }
    }
    if(parsed?.success===false) void recordError(requestIdentity,'api','request',parsed?.error?.code,Date.now()-started,_retried?'failed':'none')
    else if(_retried) void recordError(requestIdentity,'api','request',null,Date.now()-started,'recovered')
    return parsed as T
    } catch(error) { void recordError(requestIdentity,'api','request',(error as {code?:number})?.code,Date.now()-started,_retried?'failed':'none'); throw error }
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
    if (!res.success || !res.data) throw new Error('无法读取服务器 API 信息')
    return this.apiInfo
  }

  private versionOf(api: string) {
    return this.apiInfo[api]?.maxVersion ?? 1
  }

  /** 调用 webapi 统一入口（doc 1.1）。
   *  DSM 7 上 entry.cgi 只能路由到某些 API，Download Station 等第三方套件必须走专用 CGI。
   *  优先使用 SYNO.API.Info 返回的 path 字段动态拼接 URL，未加载时则回退 entry.cgi。 */
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
    const cgiPath = this.apiInfo[api]?.path ?? 'entry.cgi'
    const url = `/webapi/${cgiPath}`
    if (opts.post) {
      return this.request<DsmResponse<T>>(url, {
        method: 'POST',
        form: full,
      })
    }
    return this.request<DsmResponse<T>>(url, { query: full })
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
    this.dsSid = ''
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
      if (this.account !== params.account) this.mediaScope = crypto.randomUUID()
      this.account = params.account
      this.sid = res.data.sid ?? ''
      this.synoToken = res.data.synotoken ?? ''
      // 同步会话给 Rust 端（用于 dsm:// 代理流式播放）
      try {
        await invoke('set_session', {
          baseUrl: this.baseUrl,
          sid: this.sid,
          synoToken: this.synoToken,
          account: this.account,
          allowInsecure: this.allowInsecure,
          mediaScope: this.mediaScope,
        })
      } catch {
        this.sid = ''
        this.account = ''
        throw new Error('无法初始化本机媒体与传输会话，请重试登录')
      }
      // 追加 DownloadStation 会话登录（双 sid 策略），同步等待以保证 dsSid 就绪；失败不阻断主登录
      await this.dsLogin(params).catch(() => {})
      this.driveSid = ''
      if (this.apiInfo['SYNO.SynologyDrive.Files']) {
        const drive = await this.entry<AuthResult>('SYNO.API.Auth', 'login', { post: true, params: { ...params, session: 'SynologyDrive', format: 'sid' } }).catch(() => null)
        this.driveSid = drive?.success ? drive.data?.sid ?? '' : ''
      }
    }
    return res
  }

  /** DownloadStation 专用登录，拿到独立 sid 存于 dsSid。
   *  不调 set_session（Rust 端只需要主 sid 走媒体代理）。 */
  private async dsLogin(params: { account: string; passwd: string; otp_code?: string; device_id?: string }) {
    const res = await this.entry<AuthResult>('SYNO.API.Auth', 'login', {
      post: true,
      params: {
        session: 'DownloadStation',
        format: 'sid',
        account: params.account,
        passwd: params.passwd,
        otp_code: params.otp_code ?? '',
        ...(params.device_id ? { device_id: params.device_id } : {}),
      },
    })
    if (res.success && res.data?.sid) {
      this.dsSid = res.data.sid
    }
    return res
  }

  /** 登出（doc 3.2），session 必须与 login 时一致 */
  async logout() {
    try {
      if (this.driveSid) await this.entry('SYNO.API.Auth', 'logout', { params: { session: 'SynologyDrive' } }).catch(() => {})
      if (this.dsSid) await this.entry('SYNO.API.Auth', 'logout', { params: { session: 'DownloadStation' } }).catch(() => {})
      return await this.entry('SYNO.API.Auth', 'logout', { params: { session: 'FileStation' } })
    } finally {
      this.driveSid = ''
      this.dsSid = ''
      this.sid = ''
      this.synoToken = ''
      this.account = ''
      this.mediaScope = crypto.randomUUID()
      await invoke('clear_session')
    }
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
    return this.listAll(folderPath, undefined, 'dir')
  }

  /** Fetch every page; never silently present a truncated directory. */
  async listAll(folderPath = '', additional = '["size","time","type","perm"]', filetype: 'all' | 'dir' = 'all'): Promise<DsmResponse> {
    const key = folderPath ? 'files' : 'shares'
    const rows: any[] = []
    const seen = new Set<string>()
    const baseUrl = this.baseUrl
    const account = this.account
    for (let offset = 0;;) {
      if (this.baseUrl !== baseUrl || this.account !== account) throw new Error('服务器或账号已切换，请重新加载')
      const res = folderPath
        ? await this.listFiles(folderPath, { offset, limit: 500, additional, filetype })
        : await this.listShare({ offset, limit: 500, additional })
      if (this.baseUrl !== baseUrl || this.account !== account) throw new Error('服务器或账号已切换，请重新加载')
      if (!res.success) return res
      const batch: any[] = res.data?.[key] ?? []
      for (const row of batch) {
        if (!seen.has(row.path)) { seen.add(row.path); rows.push(row) }
      }
      offset += batch.length
      if (rows.length < offset) throw new Error('目录在加载期间发生变化，请刷新重试')
      const total = Number(res.data?.total)
      if (!batch.length || (Number.isFinite(total) && offset >= total)) break
      if (batch.length < 500 && !Number.isFinite(total)) break
    }
    return { success: true, data: { [key]: rows, total: rows.length } }
  }

  async searchAll(folder: string, pattern: string, signal?: AbortSignal) {
    const start = await this.searchStart(folder, pattern, true)
    if (!start.success || !start.data?.taskid) throw new Error('无法启动搜索')
    const taskid = start.data.taskid
    const baseUrl = this.baseUrl
    const account = this.account
    const deadline = Date.now() + 120000
    const check = () => {
      if (signal?.aborted || baseUrl !== this.baseUrl || account !== this.account) throw new Error('搜索已取消')
      if (Date.now() > deadline) throw new Error('搜索尚未完成，请缩小范围后重试')
    }
    try {
      for (;;) {
        check()
        const res = await this.searchList(taskid, { limit: 1 })
        if (!res.success) throw new Error(`搜索失败（${res.error?.code}）`)
        if (res.data?.finished) break
        await new Promise(r => setTimeout(r, 500))
      }
      const files: any[] = []
      for (let offset = 0;;) {
        check()
        const res = await this.searchList(taskid, { offset, limit: 500 })
        if (!res.success) throw new Error(`读取搜索结果失败（${res.error?.code}）`)
        const batch = res.data?.files ?? []
        files.push(...batch)
        offset += batch.length
        if (batch.length < 500) return files
      }
    } finally {
      if (baseUrl === this.baseUrl && account === this.account) await this.searchStop(taskid).catch(() => {})
    }
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
    const p = JSON.stringify(Array.isArray(path) ? path : [path])
    return this.entry('SYNO.FileStation.Delete', 'delete', {
      post: true,
      params: { path: p, recursive: recursive ? 'true' : 'false' },
    })
  }

  /** 复制或移动文件/文件夹（doc 4.9 start） */
  async copyMove(paths: string[], destFolder: string, overwrite = false, removeSource = false) {
    const p = JSON.stringify(paths)
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

  /** File features require discovered APIs; never guess unsupported endpoints. */
  async ensureFileFeature(api: string) {
    if (!Object.keys(this.apiInfo).length) await this.loadApiInfo()
    const info = this.apiInfo[api]
    const supported = ['SYNO.FileStation.Extract', 'SYNO.FileStation.Rename'].includes(api) ? 2 : 3
    if (!info || !Number.isInteger(info.minVersion) || !Number.isInteger(info.maxVersion) || info.minVersion > supported || info.maxVersion < supported) throw new Error('当前 NAS 不支持此文件操作接口')
    return supported
  }
  async fileFeature(api: string, method: string, params: Record<string, any> = {}, post = false) {
    const version = await this.ensureFileFeature(api)
    return this.entry(api, method, { post, params: { ...params, version } })
  }
  shareCreate(path: string, password: string, expiry: string) {
    return this.fileFeature('SYNO.FileStation.Sharing', 'create', { path: JSON.stringify(path), password: JSON.stringify(password), date_expired: JSON.stringify(expiry) }, true)
  }
  renameChecked(path: string, name: string) {
    return this.fileFeature('SYNO.FileStation.Rename', 'rename', { path: JSON.stringify([path]), name: JSON.stringify([name]) }, true)
  }
  shareList(offset = 0) { return this.fileFeature('SYNO.FileStation.Sharing', 'list', { offset, limit: 50, sort_by: JSON.stringify('name'), sort_direction: JSON.stringify('asc'), force_clean: false }) }
  shareDelete(id: string) { return this.fileFeature('SYNO.FileStation.Sharing', 'delete', { id: JSON.stringify(id) }, true) }
  compressStart(paths: string[], destination: string, format: 'zip' | '7z', password: string) {
    return this.fileFeature('SYNO.FileStation.Compress', 'start', { path: JSON.stringify(paths), dest_file_path: JSON.stringify(destination), format: JSON.stringify(format), level: JSON.stringify('moderate'), mode: JSON.stringify('add'), password: JSON.stringify(password) }, true)
  }
  extractStart(path: string, destination: string, password: string, overwrite: boolean, subfolder: boolean) {
    return this.fileFeature('SYNO.FileStation.Extract', 'start', { file_path: JSON.stringify(path), dest_folder_path: JSON.stringify(destination), password: JSON.stringify(password), overwrite, keep_dir: true, create_subfolder: subfolder }, true)
  }
  fileTaskRequest(kind: 'copy' | 'move' | 'compress' | 'extract', method: 'status' | 'stop', taskid: string) {
    const api = kind === 'compress' ? 'Compress' : kind === 'extract' ? 'Extract' : 'CopyMove'
    return this.fileFeature('SYNO.FileStation.' + api, method, { taskid: JSON.stringify(taskid) }, method === 'stop')
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
   *  默认使用 JSON 数组形式，兼容性更好。
   *  sort_by/sort_direction 由 DSM 服务端排序，避免前端拉回后重排。 */
  async searchList(
    taskid: string,
    opts: {
      offset?: number
      limit?: number
      additional?: string
      sortBy?: 'name' | 'size' | 'user' | 'group' | 'mtime' | 'atime' | 'ctime' | 'crtime' | 'type' | 'posix'
      sortDirection?: 'asc' | 'desc'
    } = {},
  ) {
    const params: Record<string, any> = {
      taskid,
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 100,
      additional: opts.additional ?? '["real_path","size","time","type","perm"]',
    }
    if (opts.sortBy) params.sort_by = opts.sortBy
    if (opts.sortDirection) params.sort_direction = opts.sortDirection
    return this.entry('SYNO.FileStation.Search', 'list', { params })
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
      version: '2',
      method: 'get',
      path: JSON.stringify(path),
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
    return (await this.imageBlob('thumb', path, size)).arrayBuffer()
  }

  /** Load authenticated image bytes through the same native HTTP transport as API requests. */
  async imageBlob(kind: 'thumb' | 'image', path: string, size: 'small' | 'medium' | 'large' | 'original' = 'small', signal?: AbortSignal, retried = false): Promise<Blob> {
    const identity = `${this.baseUrl}\n${this.account}`
    const started = Date.now()
    try {
    const requestSid = this.sid
    if (!requestSid) throw new MediaError('请先登录服务器')
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const url = kind === 'thumb' ? this.thumbUrl(path, size) : this.downloadUrl(path)
    let response: Response
    try {
      response = await fetch(url, {
        headers: { ...this.authHeaders(), 'Cache-Control': 'no-cache' },
        signal,
        connectTimeout: 15000,
        danger: { acceptInvalidCerts: this.allowInsecure, acceptInvalidHostnames: this.allowInsecure },
      } as any)
    } catch {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
      throw new MediaError('图片连接失败，请检查网络和服务器证书设置')
    }
    if (!response.ok) {
      await response.body?.cancel()
      const label = kind === 'thumb' ? '缩略图' : '原图'
      throw new MediaError(response.status === 404
        ? `${label}未找到（HTTP 404）${kind === 'thumb' ? '，NAS 可能未生成预览' : '，请检查文件是否已移动'}`
        : `${label}请求失败（HTTP ${response.status}）`, response.status)
    }
    const limit = (kind === 'thumb' ? 16 : 64) * 1024 * 1024
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel()
      throw new MediaError('图片过大，请下载后查看')
    }
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    if (!reader) throw new MediaError('服务器未返回图片内容')
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > limit) { await reader.cancel(); throw new MediaError('图片过大，请下载后查看') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    if (identity !== `${this.baseUrl}\n${this.account}`) throw new MediaError('连接已切换，请重新打开相册')
    const body = new Blob(chunks)
    const prefix = new Uint8Array(await body.slice(0, 65536).arrayBuffer())
    const mime = imageContentType(prefix)
    if (mime) return new Blob(chunks, { type: mime })
    let code: number | undefined
    try { const result = JSON.parse(new TextDecoder().decode(prefix)); if (result.success === false) code = result.error?.code } catch { /* not a DSM JSON envelope */ }
    if ([106, 107, 119].includes(code ?? 0) && !retried && this === dsm && sessionRecoverer) {
      if (this.sid === requestSid) {
        if (!reloginInflight) reloginInflight = sessionRecoverer().finally(() => { reloginInflight = null })
        if (!await reloginInflight) throw new MediaError('登录已过期，请重新登录后加载图片', code)
      }
      return this.imageBlob(kind, path, size, signal, true)
    }
    const messages: Record<number, string> = {
      105: '当前账号无权读取图片，请检查共享文件夹权限',
      106: '登录已过期，请重新登录', 107: '会话已中断，请重新登录', 119: '登录已失效，请重新登录',
      800: '图片文件不存在或已移动', 801: 'NAS 无法生成此文件的缩略图',
    }
    throw new MediaError(code ? `${messages[code] ?? 'NAS 拒绝图片请求'}（${code}）` : '服务器返回的内容不是可显示的图片', code)
    } catch(error) { if(!signal?.aborted) void recordError(identity,'image',kind==='thumb'?'thumbnail':'original',error instanceof MediaError?error.code:null,Date.now()-started,retried?'failed':'none'); throw error }
  }

  /** Resolve a local media descriptor; never fetch its custom-scheme URL in the WebView. */
  async cachedMediaImageBlob(source: string): Promise<Blob | null> {
    try {
      const descriptor = new URL(source)
      const path = descriptor.searchParams.get('path') || ''
      const revision = descriptor.searchParams.get('revision')
      const scope = this.mediaScope
      const identity = `${this.baseUrl}\n${this.account}`
      if (!this.sid || !revision || descriptor.searchParams.get('scope') !== scope) return null
      const video = /\.(mp4|webm|mov|mkv|avi|ts|m4v|mpg|mpeg|wmv|flv|3gp)$/i.test(path)
      if (!video && !/\.hei[cf]$/i.test(path)) return null
      const kind = descriptor.pathname.slice(1), size = descriptor.searchParams.get('size') || 'small'
      if (video && kind !== 'thumb') return null
      const dimension = video ? 640 : kind === 'thumb' && size !== 'large' && size !== 'original' ? 512 : 2560
      const cache = await import('../utils/imageCache')
      const blob = await cache.readImageCache(cache.imageCacheKey(this.baseUrl, this.account, path, revision, String(dimension)))
      return scope === this.mediaScope && identity === `${this.baseUrl}\n${this.account}` ? blob : null
    } catch { return null }
  }

  async mediaImageBlob(source: string, signal?: AbortSignal): Promise<Blob> {
    const identity = `${this.baseUrl}\n${this.account}\n${this.mediaScope}`
    const descriptor = new URL(source)
    const kind = descriptor.pathname.slice(1)
    const path = descriptor.searchParams.get('path')
    if (!path || !['thumb', 'image'].includes(kind) || descriptor.searchParams.get('scope') !== this.mediaScope) {
      throw new MediaError('图片链接已过期，请重新打开相册')
    }
    const size = descriptor.searchParams.get('size') || 'small'
    if (!['small', 'medium', 'large', 'original'].includes(size)) throw new MediaError('缩略图尺寸无效')
    const isVideoThumb = kind === 'thumb' && /\.(mp4|webm|mov|mkv|avi|ts|m4v|mpg|mpeg|wmv|flv|3gp)$/i.test(path)
    const dimension = isVideoThumb ? 640 : kind === 'thumb' && size !== 'large' && size !== 'original' ? 512 : 2560
    const revision = descriptor.searchParams.get('revision')
    const cache = (/\.hei[cf]$/i.test(path) || isVideoThumb) && revision ? await import('../utils/imageCache') : null
    const cacheKey = cache ? cache.imageCacheKey(this.baseUrl, this.account, path, revision!, String(dimension)) : ''
    if (cache) {
      const hit = await cache.readImageCache(cacheKey)
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
      if (identity !== `${this.baseUrl}\n${this.account}\n${this.mediaScope}`) throw new MediaError('连接已切换，请重新打开相册')
      if (hit) return hit
    }
    let blob: Blob
    const probe = isVideoThumb ? new AbortController() : null
    const abortProbe = () => probe?.abort()
    signal?.addEventListener('abort', abortProbe, { once: true })
    if (signal?.aborted) probe?.abort()
    const probeTimeout = probe ? setTimeout(() => probe.abort(), 2500) : undefined
    try {
      blob = await this.imageBlob(kind as 'thumb' | 'image', path, size as 'small' | 'medium' | 'large' | 'original', probe?.signal ?? signal)
    } catch (error) {
      // DSM can return HTTP 404 for HEIC even when the original exists.
      // Never turn permission/session failures into another download request.
      if (kind !== 'thumb' || (!/\.hei[cf]$/i.test(path) && !isVideoThumb) || signal?.aborted ||
          (error instanceof MediaError && [105, 106, 107, 119].includes(error.code ?? 0))) throw error
      if (isVideoThumb) {
        try {
          const { captureVideoFrame } = await import('../utils/videoFrame')
          blob = await captureVideoFrame(this.mediaUrl('stream', path), signal)
        } catch {
          if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
          throw new MediaError('暂无可用封面，可尝试播放视频')
        }
        if (identity !== `${this.baseUrl}\n${this.account}\n${this.mediaScope}`) throw new MediaError('连接已切换，请重新打开视频')
      } else blob = await this.imageBlob('image', path, 'small', signal)
    } finally { clearTimeout(probeTimeout); signal?.removeEventListener('abort', abortProbe) }
    if (blob.type === 'image/heic') {
      try {
        const { convertHeic } = await import('../utils/heic')
        const converted = await convertHeic(blob, dimension, signal)
        if (identity !== `${this.baseUrl}\n${this.account}\n${this.mediaScope}`) throw new MediaError('连接已切换，请重新打开相册')
        if (cache) await cache.writeImageCache(cacheKey, converted)
        return converted
      } catch (error) {
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
        if (error instanceof MediaError) throw error
        throw new MediaError('HEIC 本地转换失败，请下载原图查看')
      }
    }
    if (cache) await cache.writeImageCache(cacheKey, blob)
    return blob
  }

  /** 文件上传 multipart（doc 4.9 upload） */
  async upload(folderPath: string, file: File, overwrite = false) {
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
      danger: { acceptInvalidCerts: this.allowInsecure, acceptInvalidHostnames: this.allowInsecure },
    } as any)
    const text = await res.text()
    try {
      return JSON.parse(text) as DsmResponse
    } catch {
      return { success: false, error: { code: -1, errors: text } } as DsmResponse
    }
  }

  /** 获取文件字节（用于预览或本地保存） */
  async readSidecar(path: string, maxBytes: number): Promise<ArrayBuffer> {
    const res = await fetch(this.downloadUrl(path, 'open'), {
      headers: this.authHeaders(), signal: AbortSignal.timeout(15000),
      danger: { acceptInvalidCerts: this.allowInsecure, acceptInvalidHostnames: this.allowInsecure },
    } as any)
    if (!res.ok) throw new Error(`资料读取失败（HTTP ${res.status}）`)
    if (Number(res.headers.get('content-length')) > maxBytes) throw new Error('资料文件过大')
    const reader = res.body?.getReader()
    if (!reader) throw new Error('资料内容为空')
    const chunks: Uint8Array[] = []; let length = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.length
        if (length > maxBytes) throw new Error('资料文件过大')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes.buffer
  }

  async downloadBytes(path: string): Promise<ArrayBuffer> {
    const url = this.downloadUrl(path, 'open')
    const res = await fetch(url, {
      method: 'GET',
      headers: this.authHeaders(),
      danger: { acceptInvalidCerts: this.allowInsecure, acceptInvalidHostnames: this.allowInsecure },
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
  mediaUrl(kind: 'stream' | 'thumb' | 'image', path: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ path, scope: this.mediaScope, ...extra })
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
      params: { ...params, destination: normalizeDsDestination(params.destination) },
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
    const sid = this.dsSid || this.sid
    if (sid) form.append('_sid', sid)
    const dest = normalizeDsDestination(destination)
    if (dest) form.append('destination', dest)
    form.append('file', file, file.name)
    const url = `${this.baseUrl}/webapi/${cgi}`
    const headers: Record<string, string> = this.authHeaders()
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      danger: { acceptInvalidCerts: this.allowInsecure, acceptInvalidHostnames: this.allowInsecure },
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

  // ─── VMM (Virtual Machine Manager) ───────────────────────────────

  async driveFiles(path = '/mydrive', offset = 0) {
    return this.entry('SYNO.SynologyDrive.Files', 'list', { params: { version: 2, path, offset, limit: 100, filter: '{}', sort_by: 'name', sort_direction: 'asc' } })
  }
  async driveTeamFolders(offset = 0) {
    return this.entry('SYNO.SynologyDrive.TeamFolders', 'list', { params: { offset, limit: 100, filter: '{}', sort_by: 'name', sort_direction: 'asc' } })
  }
  async hyperBackupTasks() {
    return this.entry('SYNO.Backup.Task', 'list', { params: { version: 1, additional: JSON.stringify(['last_bkp_time', 'last_bkp_result']) } })
  }
  async hyperBackupStatus(taskId: string) {
    return this.entry('SYNO.Backup.Task', 'status', { params: { version: 1, task_id: taskId, blOnline: false, additional: JSON.stringify(['last_bkp_time', 'next_bkp_time', 'last_bkp_result', 'last_bkp_progress']) } })
  }
  async activeBackupTasks() {
    return this.entry('SYNO.ActiveBackup.Task', 'list', { params: { version: 1, load_status: true, load_result: true, load_devices: false, load_versions: false, filter: '{}' } })
  }

  async packageList() {
    return this.entry('SYNO.Core.Package', 'list', { params: { additional: JSON.stringify(['status', 'description', 'maintainer', 'distributor', 'dependent_packages', 'startable', 'available_operation', 'autoupdate', 'installing_progress', 'is_uninstall_pages']), ignore_hidden: false } })
  }

  async packageControl(id: string, action: 'start' | 'stop') {
    if (!id || !['start','stop'].includes(action)) throw new Error('无效的套件操作')
    return this.entry('SYNO.Core.Package.Control', action, {post:true,params:{version:1,id}})
  }
  async packageCatalog(community=false) { return this.entry('SYNO.Core.Package.Server','list',{params:{version:2,blforcereload:true,blloadothers:community}}) }
  async packageFeeds() { return this.entry('SYNO.Core.Package.Feed','list',{params:{version:1}}) }
  async packageFeedSave(name:string, feed:string, original?:string) {
    const url=new URL(feed)
    if(!name.trim()||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('请输入套件源名称和有效的 HTTP/HTTPS 地址')
    return this.entry('SYNO.Core.Package.Feed',original?'set':'add',{post:true,params:{version:1,list:JSON.stringify({name:name.trim(),feed,...(original?{orifeed:original}:{})})}})
  }
  async packageFeedDelete(feed:string) { return this.entry('SYNO.Core.Package.Feed','delete',{post:true,params:{version:1,list:JSON.stringify([feed])}}) }
  async packageFeasibility(id:string,type:'install'|'start'|'stop'|'uninstall') { return this.entry('SYNO.Core.Package','feasibility_check',{post:true,params:{version:1,type:type+'_check',packages:JSON.stringify([id])}}) }
  async packageSettings() { return this.entry('SYNO.Core.Package.Setting','get',{params:{version:1}}) }
  async packageAutoUpdate(mode:'disabled'|'important'|'all') {
    if(!['disabled','important','all'].includes(mode))throw new Error('无效的更新策略')
    return this.entry('SYNO.Core.Package.Setting','set',{post:true,params:{version:1,enable_autoupdate:mode!=='disabled',autoupdateall:mode==='all',autoupdateimportant:mode==='important'}})
  }
  async packageDownload(pkg: {id:string;link:string;md5:string;size:string|number}) {
    const url = new URL(pkg.link)
    if (!['https:','http:'].includes(url.protocol) || !pkg.id || !pkg.md5 || !Number.isFinite(Number(pkg.size)) || Number(pkg.size)<=0) throw new Error('套件下载信息不完整')
    return this.entry('SYNO.Core.Package.Installation','install',{post:true,params:{version:1,operation:'install',type:0,blqinst:false,url:pkg.link,name:pkg.id,checksum:pkg.md5,filesize:pkg.size}})
  }
  async packageDownloadStatus(task: string) { return this.entry('SYNO.Core.Package.Installation','status',{params:{version:1,task_id:task}}) }
  async packageDownloadedInfo(task: string) { return this.entry('SYNO.Core.Package.Installation.Download','check',{params:{version:1,taskid:task}}) }
  async packageCheck(info:any) { return this.entry('SYNO.Core.Package.Installation','check',{post:true,params:{version:1,id:info.id,install_type:info.install_type || info.additional?.install_type || '',install_on_cold_storage:false,blCheckDep:true,replacepkgs:'{}'}}) }
  async packageInstall(info:any, volume:string, task:string, upgrade:boolean) {
    if (!info.id || !task || (!upgrade && !volume)) throw new Error('安装信息不完整，请重新准备套件')
    return this.entry('SYNO.Core.Package.Installation',upgrade?'upgrade':'install',{post:true,params:{version:1,type:0,check_codesign:true,force:false,installrunpackage:true,extra_values:'{}',...(info.filename?{path:info.filename}:{task_id:task}),...(!upgrade?{volume_path:volume}:{})}})
  }
  async packageUninstall(id:string) {
    if (!id) throw new Error('套件标识为空')
    return this.entry('SYNO.Core.Package.Uninstallation','uninstall',{post:true,params:{version:1,id,dsm_apps:''}})
  }
  async packageUpload(file:File) {
    if (!/\.spk$/i.test(file.name) || !file.size || file.size>512*1024*1024) throw new Error('请选择不超过 512 MB 的 SPK 文件')
    const info=this.apiInfo['SYNO.Core.Package.Installation'];if(!info)throw new Error('当前 NAS 不支持安装接口')
    const identity=this.baseUrl+'\n'+this.account
    const url=this.buildUrl('/webapi/'+info.path,{api:'SYNO.Core.Package.Installation',version:1,method:'upload',_sid:this.sid})
    const body=new FormData();body.append('additional',JSON.stringify(['description','maintainer','status','install_type','install_reboot','break_pkgs','replace_pkgs']));body.append('file',file)
    const response=await fetch(url,{method:'POST',headers:this.authHeaders(),body,signal:AbortSignal.timeout(180000),danger:{acceptInvalidCerts:this.allowInsecure,acceptInvalidHostnames:this.allowInsecure}} as any)
    if(identity!==this.baseUrl+'\n'+this.account)throw new Error('账号已切换')
    if(!response.ok)throw new Error('上传失败（HTTP '+response.status+'）')
    return response.json() as Promise<DsmResponse>
  }
  async containerList() {
    return this.entry('SYNO.Docker.Container', 'list', { params: { type: 'all', offset: 0, limit: -1 } })
  }
  async containerResources() { return this.entry('SYNO.Docker.Container.Resource', 'get') }
  async containerAction(name: string, action: 'start' | 'stop' | 'restart') {
    if (!['start', 'stop', 'restart'].includes(action) || !name) throw new Error('无效的容器操作')
    return this.entry('SYNO.Docker.Container', action, { post: true, params: { name } })
  }
  async containerLogs(name: string, offset = 0) {
    return this.entry('SYNO.Docker.Container.Log', 'get', { post: true, params: { name, offset, limit: 200, sort_dir: 'DESC' } })
  }
  async dsConfig() { return this.entry('SYNO.DownloadStation.Info', 'getconfig') }
  async dsSetConfig(params: Record<string, string | number>) {
    const allowed = ['bt_max_download', 'bt_max_upload', 'http_max_download', 'ftp_max_download', 'default_destination']
    if (Object.keys(params).some(key => !allowed.includes(key))) throw new Error('不支持的下载设置')
    return this.entry('SYNO.DownloadStation.Info', 'setserverconfig', { post: true, params })
  }

  /** 列出主机 */
  async vmmHostList() {
    return this.entry('SYNO.Virtualization.API.Host', 'list')
  }

  /** 列出虚拟机 */
  async vmmGuestList(additional = true) {
    return this.entry('SYNO.Virtualization.API.Guest', 'list', {
      params: { additional },
    })
  }

  /** 获取指定虚拟机信息 */
  async vmmGuestGet(opts: { guest_id?: string; guest_name?: string }) {
    return this.entry('SYNO.Virtualization.API.Guest', 'get', {
      params: { ...opts, additional: true },
    })
  }

  async vmmGuestSet(guestId: string, settings: { new_guest_name?: string; description?: string; autorun?: number; vcpu_num?: number; vram_size?: number }) {
    return this.entry('SYNO.Virtualization.API.Guest', 'set', { params: { guest_id: guestId, ...settings } })
  }

  /** 虚拟机开机 */
  async vmmGuestPowerOn(guestId: string) {
    return this.entry('SYNO.Virtualization.API.Guest.Action', 'poweron', {
      params: { guest_id: guestId },
    })
  }

  /** 虚拟机正常关机 */
  async vmmGuestShutdown(guestId: string) {
    return this.entry('SYNO.Virtualization.API.Guest.Action', 'shutdown', {
      params: { guest_id: guestId },
    })
  }

  /** 虚拟机强制关机 */
  async vmmGuestPowerOff(guestId: string) {
    return this.entry('SYNO.Virtualization.API.Guest.Action', 'poweroff', {
      params: { guest_id: guestId },
    })
  }

  /** VMM 存储列表 */
  async vmmStorageList() {
    return this.entry('SYNO.Virtualization.API.Storage', 'list')
  }

  /** VMM 网络列表 */
  async vmmNetworkList() {
    return this.entry('SYNO.Virtualization.API.Network', 'list')
  }
}

/** 单例 */
export const dsm = new DsmClient()
