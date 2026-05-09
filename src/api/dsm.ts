import { fetch } from '@tauri-apps/plugin-http'

/** DSM 统一响应结构（doc 1.4） */
export interface DsmResponse<T = any> {
  success: boolean
  data?: T
  error?: { code: number; errors?: any }
}

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
    try {
      return JSON.parse(text) as T
    } catch {
      return text as any
    }
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

  /** 明文登录（doc 3.1 method=login） */
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
        session: 'webui',
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
    }
    return res
  }

  /** 登出（doc 3.2） */
  async logout() {
    return this.entry('SYNO.API.Auth', 'logout', { params: { session: 'webui' } })
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
  async listFiles(folderPath: string, opts: { offset?: number; limit?: number; additional?: string } = {}) {
    return this.entry('SYNO.FileStation.List', 'list', {
      params: {
        folder_path: folderPath,
        offset: opts.offset ?? 0,
        limit: opts.limit ?? 0,
        additional: opts.additional ?? '',
      },
    })
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

  /** 搜索：启动任务（doc 4.15 start） */
  async searchStart(folderPath: string, pattern: string, recursive = true) {
    return this.entry<{ taskid: string }>('SYNO.FileStation.Search', 'start', {
      post: true,
      params: { folder_path: folderPath, pattern, recursive: recursive ? 'true' : 'false' },
    })
  }

  /** 搜索：拉取结果 */
  async searchList(taskid: string, opts: { offset?: number; limit?: number } = {}) {
    return this.entry('SYNO.FileStation.Search', 'list', {
      params: {
        taskid,
        offset: opts.offset ?? 0,
        limit: opts.limit ?? 100,
        additional: 'size,time,type',
      },
    })
  }

  /** 搜索：停止任务 */
  async searchStop(taskid: string) {
    return this.entry('SYNO.FileStation.Search', 'stop', { post: true, params: { taskid } })
  }

  /** 构造下载 URL（doc 4.10 download），带 _sid 走 GET */
  downloadUrl(path: string, mode: 'open' | 'download' = 'download') {
    const info = this.apiInfo['SYNO.FileStation.Download']
    const cgi = info?.path ?? 'entry.cgi'
    const params = new URLSearchParams({
      api: 'SYNO.FileStation.Download',
      version: String(info?.maxVersion ?? 2),
      method: 'download',
      path,
      mode,
      _sid: this.sid,
    })
    return `${this.baseUrl}/webapi/${cgi}?${params.toString()}`
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
    const headers: Record<string, string> = {}
    if (this.synoToken) headers['X-SYNO-TOKEN'] = this.synoToken
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
    const headers: Record<string, string> = {}
    if (this.synoToken) headers['X-SYNO-TOKEN'] = this.synoToken
    const res = await fetch(url, {
      method: 'GET',
      headers,
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
}

/** 单例 */
export const dsm = new DsmClient()
