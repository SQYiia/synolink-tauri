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
})

export const dsTasks = computed(() => state.tasks)
export const dsStatistic = computed(() => state.statistic)
export const dsLoading = computed(() => state.loading)
export const dsAvailable = computed(() => state.available)

let pollTimer: ReturnType<typeof setInterval> | null = null

let probed = false

async function probeAvailability(): Promise<boolean> {
  if (probed) return state.available
  probed = true
  try {
    const res = await dsm.dsInfo()
    if (res.success) {
      state.available = true
      return true
    }
    const code = res.error?.code
    if (code === 102 || code === 103) {
      state.available = false
      return false
    }
    state.available = true
    return true
  } catch {
    return true
  }
}

export async function dsRefresh() {
  state.loading = true
  try {
    if (!(await probeAvailability())) return
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

export function dsStartPolling(intervalMs = 3000) {
  dsStopPolling()
  dsRefresh()
  pollTimer = setInterval(dsRefresh, intervalMs)
}

export function dsStopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export async function dsCreateTask(uri: string, destination?: string): Promise<boolean> {
  const res = await dsm.dsTaskCreate({ uri, destination })
  if (res.success) {
    await dsRefresh()
    return true
  }
  return false
}

export async function dsCreateTaskFile(file: File, destination?: string): Promise<boolean> {
  const res = await dsm.dsTaskCreateFile(file, destination)
  if (res.success) {
    await dsRefresh()
    return true
  }
  return false
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
    startPolling: dsStartPolling,
    stopPolling: dsStopPolling,
    refresh: dsRefresh,
    createTask: dsCreateTask,
    createTaskFile: dsCreateTaskFile,
    pauseTasks: dsPauseTasks,
    resumeTasks: dsResumeTasks,
    deleteTasks: dsDeleteTasks,
  }
}
