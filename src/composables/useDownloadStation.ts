import { reactive, computed, onScopeDispose } from 'vue'
import { dsm } from '../api/dsm'

export interface DSTask {
  id: string
  type: string
  title: string
  size: number
  status: string
  sizeDownloaded: number
  sizeUploaded: number
  speedDownload: number
  speedUpload: number
  destination: string
  uri: string
  createTime: number
}

export interface DSStatistic {
  speedDownload: number
  speedUpload: number
}

const STATUS_LABELS: Record<string, { label: string; type: string }> = {
  waiting: { label: '等待中', type: 'info' },
  downloading: { label: '下载中', type: '' },
  paused: { label: '已暂停', type: 'warning' },
  finishing: { label: '完成中', type: 'success' },
  finished: { label: '已完成', type: 'success' },
  hash_checking: { label: '校验中', type: 'info' },
  seeding: { label: '做种中', type: 'success' },
  filehosting_waiting: { label: '等待中', type: 'info' },
  extracting: { label: '解压中', type: 'info' },
  error: { label: '错误', type: 'danger' },
}

export function getStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? { label: status, type: 'info' }
}

function mapTask(raw: any): DSTask {
  const transfer = raw.additional?.transfer ?? {}
  const detail = raw.additional?.detail ?? {}
  return {
    id: raw.id,
    type: raw.type ?? 'http',
    title: raw.title ?? '',
    size: raw.size ?? 0,
    status: raw.status ?? 'waiting',
    sizeDownloaded: transfer.size_downloaded ?? 0,
    sizeUploaded: transfer.size_uploaded ?? 0,
    speedDownload: transfer.speed_download ?? 0,
    speedUpload: transfer.speed_upload ?? 0,
    destination: detail.destination ?? '',
    uri: detail.uri ?? '',
    createTime: Number(detail.create_time ?? 0),
  }
}

const state = reactive({
  tasks: [] as DSTask[],
  statistic: { speedDownload: 0, speedUpload: 0 } as DSStatistic,
  loading: false,
  available: true,
  /** 不可用原因，直接在 UI 展示（避免需要 F12） */
  reason: '' as string,
})

export const dsTasks = computed(() => state.tasks)
export const dsStatistic = computed(() => state.statistic)
export const dsLoading = computed(() => state.loading)
export const dsAvailable = computed(() => state.available)
export const dsReason = computed(() => state.reason)

let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * 探测 Download Station 是否可用。
 *  - 直接调 dsInfo()（此时已双 sid 登录，路由用 dsSid），让 DSM 自己回答：
 *      · success=true        → 可用
 *      · code=102/103/104    → 未安装套件
 *      · code=105            → 账号无访问 DS 权限（也视为不可用，提示更具体）
 *      · 其他（网络/119/-1） 保持当前状态，上层重试
 */
async function probeAvailability(force = false): Promise<boolean> {
  try {
    if (force || !Object.keys(dsm.apiInfo).length) {
      await dsm.loadApiInfo().catch(() => {})
    }
    // 诊断一下 dsSid 是否拿到了（双 sid 登录是否成功）
    const hasDsSid = !!(dsm as any).dsSid
    const res = await dsm.dsInfo()
    if (res.success) {
      state.available = true
      state.reason = ''
      return true
    }
    const code = res.error?.code
    const errMsg = JSON.stringify(res.error ?? res)
    if (code === 102 || code === 103 || code === 104 || code === 105) {
      let hint = ''
      if (code === 102) hint = 'API 不存在（未安装 Download Station 套件）'
      else if (code === 103) hint = '方法不存在'
      else if (code === 104) hint = 'API 版本不支持'
      else if (code === 105) hint = '账号无访问权限（请在群晖控制面板将当前账号加入 Download Station 授权列表）'
      state.reason = `code=${code} ${hint}\n${errMsg}` + (hasDsSid ? '' : '\n\u26a0 dsSid 未获取、session=DownloadStation 登录可能失败')
      state.available = false
      return false
    }
    state.reason = `临时失败 code=${code}\n${errMsg}`
    return state.available
  } catch (e: any) {
    state.reason = '探测异常: ' + (e?.message ?? String(e))
    return state.available
  }
}

export async function dsRefresh(force = false) {
  state.loading = true
  try {
    if (!(await probeAvailability(force))) return
    const [taskRes, statRes] = await Promise.all([
      dsm.dsTaskList(),
      dsm.dsStatistic(),
    ])
    if (taskRes.success && taskRes.data) {
      state.tasks = (taskRes.data as any).tasks?.map(mapTask) ?? []
    }
    if (statRes.success && statRes.data) {
      state.statistic.speedDownload = (statRes.data as any).speed_download ?? 0
      state.statistic.speedUpload = (statRes.data as any).speed_upload ?? 0
    }
  } catch {
    // network error, keep last state
  } finally {
    state.loading = false
  }
}

/** 重试按钮专用：强制重新加载 apiInfo + 重新 probe */
export async function dsRetry() {
  state.available = true // 给一次机会，让 probe 重新判定
  await dsRefresh(true)
}

export function dsStartPolling(intervalMs = 3000) {
  dsStopPolling()
  dsRefresh()
  pollTimer = setInterval(() => {
    // 仅在套件可用时才继续轮询；不可用时停止避免无意义请求
    if (state.available) dsRefresh()
    else dsStopPolling()
  }, intervalMs)
}

export function dsStopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export async function dsCreateTask(uri: string, destination?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await dsm.dsTaskCreate({ uri, destination })
  if (res.success) {
    await dsRefresh()
    return { ok: true }
  }
  return { ok: false, error: dsTaskErrorMsg(res.error?.code) + ` (raw: ${JSON.stringify(res.error ?? res)})` }
}

export async function dsCreateTaskFile(file: File, destination?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await dsm.dsTaskCreateFile(file, destination)
  if (res.success) {
    await dsRefresh()
    return { ok: true }
  }
  return { ok: false, error: dsTaskErrorMsg(res.error?.code) + ` (raw: ${JSON.stringify(res.error ?? res)})` }
}

/** Download Station Task 业务错误码（doc 第 9 节） */
function dsTaskErrorMsg(code?: number): string {
  switch (code) {
    case 100: return '未知错误'
    case 101: return '参数无效'
    case 102: return 'API 不存在（套件未装/CGI 路径错）'
    case 103: return '方法不存在'
    case 104: return 'API 版本不支持'
    case 105: return '账号无权限（请在控制面板给当前账号赋予 Download Station 权限）'
    case 106: return '连接超时'
    case 107: return '多点登录冲突'
    case 119: return 'SID 会话失效'
    case 400: return '文件上传失败'
    case 401: return '超过最大任务数'
    case 402: return '目标路径被拒绝（仔细检查共享文件夹权限）'
    case 403: return '目标路径不存在'
    case 404: return '任务 ID 无效'
    case 405: return '任务动作无效'
    case 406: return '未设置默认下载目录（请在 Download Station 设置中指定 default destination）'
    case 407: return '设置目录失败'
    case 408: return '文件不存在'
    default:  return `未知 code=${code}`
  }
}

export async function dsPauseTasks(ids: string[]) {
  await dsm.dsTaskPause(ids)
  await dsRefresh()
}

export async function dsResumeTasks(ids: string[]) {
  await dsm.dsTaskResume(ids)
  await dsRefresh()
}

export async function dsDeleteTasks(ids: string[], forceComplete = false) {
  await dsm.dsTaskDelete(ids, forceComplete)
  await dsRefresh()
}

export function useDownloadStation() {
  onScopeDispose(() => {
    dsStopPolling()
  })

  return {
    tasks: dsTasks,
    statistic: dsStatistic,
    loading: dsLoading,
    available: dsAvailable,
    reason: dsReason,
    startPolling: dsStartPolling,
    stopPolling: dsStopPolling,
    refresh: dsRefresh,
    retry: dsRetry,
    createTask: dsCreateTask,
    createTaskFile: dsCreateTaskFile,
    pauseTasks: dsPauseTasks,
    resumeTasks: dsResumeTasks,
    deleteTasks: dsDeleteTasks,
  }
}
