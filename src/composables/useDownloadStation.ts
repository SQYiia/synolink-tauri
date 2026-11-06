import { onActivated, onDeactivated } from 'vue'
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
  speedKnown: boolean
  speedUpload: number
  destination: string
  uri: string
  createTime: number
  errorDetail: string
  seeders: number | null
  peers: number | null
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

export function mapTask(raw: any): DSTask {
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
    speedKnown: transfer.speed_download != null,
    speedUpload: transfer.speed_upload ?? 0,
    destination: detail.destination ?? '',
    uri: detail.uri ?? '',
    createTime: Number(detail.create_time ?? 0),
    errorDetail: String(raw.status_extra?.error_detail ?? detail.error_detail ?? raw.error_detail ?? ''),
    seeders: detail.connected_seeders == null ? null : Number(detail.connected_seeders),
    peers: detail.connected_leechers == null ? null : Number(detail.connected_leechers),
  }
}

export function getTaskHint(task: DSTask): string {
  if (task.status === 'downloading' && !task.speedKnown) return 'NAS 未返回下载速度，请刷新任务状态'
  if (task.status === 'error') return task.errorDetail ? `NAS 报告错误：${task.errorDetail}` : 'NAS 下载任务出错，请检查下载源和保存目录'
  if (task.status === 'paused') return '任务已暂停，恢复后继续下载'
  if (task.status === 'waiting') return '等待 NAS 调度，请检查下载计划或同时下载数量限制'
  if (task.status === 'filehosting_waiting') return '正在等待下载站点，请检查站点账号或等待时间'
  if (task.status === 'hash_checking') return '正在校验文件，暂时不会下载数据'
  if (task.status === 'downloading' && Number(task.speedDownload) === 0) {
    if (task.type === 'bt' && Number(task.size) === 0) return '尚未获取种子元数据，正在等待可连接的下载源'
    if (task.type === 'bt' && task.seeders === 0 && task.peers === 0) return '当前未连接到种子或节点，请检查资源活跃度及 NAS 网络'
    return 'NAS 当前没有接收数据，请检查下载源、网络和限速设置'
  }
  return ''
}

const state = reactive({
  tasks: [] as DSTask[],
  statistic: { speedDownload: 0, speedUpload: 0 } as DSStatistic,
  loading: false,
  available: true,
  /** 不可用原因，直接在 UI 展示（避免需要 F12） */
  reason: '' as string,
  lastUpdate: '',
})

export const dsTasks = computed(() => state.tasks)
export const dsStatistic = computed(() => state.statistic)
export const dsLoading = computed(() => state.loading)
export const dsAvailable = computed(() => state.available)
export const dsReason = computed(() => state.reason)
export const dsLastUpdate = computed(() => state.lastUpdate)

let stateContext = ''
function resetContext() {
  const context = JSON.stringify([dsm.baseUrl, dsm.account])
  if (context !== stateContext) {
    stateContext = context
    state.tasks = []
    state.statistic = { speedDownload: 0, speedUpload: 0 }
    state.available = true
    state.loading = false
    state.reason = ''
    state.lastUpdate = ''
  }
}
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
  const context = JSON.stringify([dsm.baseUrl, dsm.account])
  try {
    if (force || !Object.keys(dsm.apiInfo).length) {
      await dsm.loadApiInfo().catch(() => {})
    }
    // 诊断一下 dsSid 是否拿到了（双 sid 登录是否成功）

    const res = await dsm.dsInfo()
    if (context !== JSON.stringify([dsm.baseUrl, dsm.account])) return false
    if (res.success) {
      state.available = true
      state.reason = ''
      return true
    }
    const code = res.error?.code

    if (code === 102 || code === 103 || code === 104 || code === 105) {
      let hint = ''
      if (code === 102) hint = 'API 不存在（未安装 Download Station 套件）'
      else if (code === 103) hint = '方法不存在'
      else if (code === 104) hint = 'API 版本不支持'
      else if (code === 105) hint = '账号无访问权限（请在群晖控制面板将当前账号加入 Download Station 授权列表）'
      state.reason = hint
      state.available = false
      return false
    }
    state.reason = `暂时无法连接下载站（${code}），请检查网络或重新登录`
    return false
  } catch (e: any) {
    if (context !== JSON.stringify([dsm.baseUrl, dsm.account])) return false
    state.reason = '探测异常: ' + (e?.message ?? String(e))
    return false
  }
}

export async function dsRefresh(force = false) {
  resetContext()
  const context = stateContext
  if (state.loading) return
  state.loading = true
  try {
    if (!(await probeAvailability(force))) return
    const [taskResult, statResult] = await Promise.allSettled([
      dsm.dsTaskList(),
      dsm.dsStatistic(),
    ])
    if (context !== JSON.stringify([dsm.baseUrl, dsm.account])) return
    if (taskResult.status === 'rejected') throw new Error('任务列表读取失败，请检查 NAS 连接')
    const taskRes = taskResult.value
    const statRes = statResult.status === 'fulfilled' ? statResult.value : null
    if (!taskRes.success) throw new Error(`任务列表读取失败：${dsTaskErrorMsg(taskRes.error?.code)}`)
    if (taskRes.success && taskRes.data) {
      state.tasks = (taskRes.data as any).tasks?.map(mapTask) ?? []
    }
    state.lastUpdate = new Date().toLocaleTimeString()
    state.reason = statRes?.success ? '' : '任务已更新，但总速度统计暂时不可用'
    if (statRes?.success && statRes.data) {
      state.statistic.speedDownload = (statRes.data as any).speed_download ?? 0
      state.statistic.speedUpload = (statRes.data as any).speed_upload ?? 0
    }
  } catch (error: any) {
    if (context === JSON.stringify([dsm.baseUrl, dsm.account])) state.reason = error?.message || '下载站刷新失败，当前显示上次的数据'
  } finally {
    if (context === stateContext) state.loading = false
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
    if (!state.available) dsStopPolling()
    else if (!document.hidden) dsRefresh()
  }, intervalMs)
}

export function dsStopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export async function dsCreateTask(uri: string, destination?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await dsm.dsTaskCreate({ uri: uri.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(','), destination })
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
  assertTaskAction(await dsm.dsTaskPause(ids))
  await dsRefresh()
}

export async function dsResumeTasks(ids: string[]) {
  assertTaskAction(await dsm.dsTaskResume(ids))
  await dsRefresh()
}

export async function dsDeleteTasks(ids: string[], forceComplete = false) {
  assertTaskAction(await dsm.dsTaskDelete(ids, forceComplete))
  await dsRefresh()
}

export function assertTaskAction(result: any) {
  if (!result.success) throw new Error(dsTaskErrorMsg(result.error?.code))
  const failed = (Array.isArray(result.data) ? result.data : []).filter((item: any) => Number(item.error) !== 0)
  if (failed.length) throw new Error(`${failed.length} 个任务操作失败：${failed.map((item: any) => dsTaskErrorMsg(Number(item.error))).join('；')}`)
}

export function useDownloadStation() {
  resetContext()
  onActivated(() => dsStartPolling())
  onDeactivated(dsStopPolling)
  onScopeDispose(() => {
    dsStopPolling()
  })

  return {
    tasks: dsTasks,
    statistic: dsStatistic,
    loading: dsLoading,
    available: dsAvailable,
    reason: dsReason,
    lastUpdate: dsLastUpdate,
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
