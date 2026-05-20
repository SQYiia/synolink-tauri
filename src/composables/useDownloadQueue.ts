import { reactive, computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { ElMessage, ElNotification } from 'element-plus'
import { h } from 'vue'

export interface DownloadTask {
  id: string
  path: string
  name: string
  size: number
  loaded: number
  status: 'queued' | 'downloading' | 'done' | 'error' | 'cancelled'
  error?: string
  savePath?: string
}

const MAX_CONCURRENT = 2

const state = reactive({
  tasks: [] as DownloadTask[],
})

export const downloadQueue = computed(() => state.tasks)

/** 当前下载目录（默认=系统 Downloads）。启动时异步拉取。 */
export const downloadDir = ref<string>('')

async function ensureDownloadDir() {
  if (downloadDir.value) return downloadDir.value
  try {
    downloadDir.value = await invoke<string>('get_default_download_dir')
  } catch (e) {
    console.warn('[download] get_default_download_dir failed:', e)
  }
  return downloadDir.value
}

/** 打开文件所在目录并高亮选中。某些平台仅能打开目录不能高亮。 */
export async function revealSavedFile(savePath: string) {
  try {
    await revealItemInDir(savePath)
  } catch (e: any) {
    ElMessage.warning('无法打开文件所在位置：' + (e?.message ?? e))
  }
}

/** Rust 端事件载荷 */
interface ProgressPayload { taskId: string; loaded: number; total: number }
interface DonePayload { taskId: string; savePath: string }
interface ErrorPayload { taskId: string; error: string }

/** 全局事件监听只装一次 */
let listenersReady = false
const unlistens: UnlistenFn[] = []

async function ensureListeners() {
  if (listenersReady) return
  listenersReady = true
  unlistens.push(
    await listen<ProgressPayload>('download:progress', (e) => {
      const t = state.tasks.find(x => x.id === e.payload.taskId)
      if (!t) return
      t.loaded = e.payload.loaded
      if (e.payload.total > 0) t.size = e.payload.total
    }),
    await listen<DonePayload>('download:done', (e) => {
      const t = state.tasks.find(x => x.id === e.payload.taskId)
      if (!t) return
      t.status = 'done'
      t.savePath = e.payload.savePath
      if (t.size > 0) t.loaded = t.size
      // 完成提示：带“打开所在目录”按钮
      ElNotification({
        title: '下载完成',
        message: h('div', [
          h('div', { style: 'font-size:12px;word-break:break-all;color:var(--el-text-color-regular)' }, t.name),
          h('div', { style: 'font-size:11px;color:var(--el-text-color-secondary);word-break:break-all;margin-top:2px' }, t.savePath || ''),
          h('a', {
            style: 'display:inline-block;margin-top:6px;font-size:12px;color:var(--el-color-primary);cursor:pointer',
            onClick: () => t.savePath && revealSavedFile(t.savePath),
          }, '打开所在目录'),
        ]),
        type: 'success',
        duration: 5000,
      })
      processQueue()
    }),
    await listen<ErrorPayload>('download:error', (e) => {
      const t = state.tasks.find(x => x.id === e.payload.taskId)
      if (!t) return
      t.status = 'error'
      t.error = e.payload.error
      processQueue()
    }),
    await listen<ProgressPayload>('download:cancelled', (e) => {
      const t = state.tasks.find(x => x.id === e.payload.taskId)
      if (!t) return
      t.status = 'cancelled'
      processQueue()
    }),
  )
}

export function enqueue(path: string, name: string, size: number = 0) {
  ensureListeners()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const task: DownloadTask = { id, path, name, size, loaded: 0, status: 'queued' }
  state.tasks.unshift(task)
  // 启动提示保存位置
  ensureDownloadDir().then(dir => {
    ElMessage({
      type: 'info',
      message: dir ? `已加入下载队列，保存到：${dir}` : '已加入下载队列',
      duration: 2500,
    })
  })
  processQueue()
  return id
}

export function cancelTask(id: string) {
  const task = state.tasks.find(t => t.id === id)
  if (!task) return
  if (task.status === 'downloading') {
    invoke('cancel_download', { taskId: id }).catch(() => { /* ignore */ })
    // 状态变更交给 download:cancelled 事件统一处理
  } else if (task.status === 'queued') {
    task.status = 'cancelled'
    processQueue()
  }
}

export function removeTask(id: string) {
  const idx = state.tasks.findIndex(t => t.id === id)
  if (idx >= 0) state.tasks.splice(idx, 1)
}

export function clearCompleted() {
  state.tasks = state.tasks.filter(t => t.status === 'downloading' || t.status === 'queued')
}

function activeCount() {
  return state.tasks.filter(t => t.status === 'downloading').length
}

function processQueue() {
  while (activeCount() < MAX_CONCURRENT) {
    const next = state.tasks.find(t => t.status === 'queued')
    if (!next) break
    startDownload(next)
  }
}

async function startDownload(task: DownloadTask) {
  task.status = 'downloading'
  task.error = undefined
  // 全部委托给 Rust 端：流式 reqwest + tokio fs 写盘 + .synodownload 临时文件断点续传 + 进度事件
  // 这里不 await，避免阻塞队列调度；最终状态由 download:done/error/cancelled 事件改写
  invoke('download_to_file', {
    taskId: task.id,
    path: task.path,
    name: task.name,
  }).catch((e: any) => {
    // 命令本身被拒（比如 session 未设）才会走到这里；正常错误由 download:error 事件处理
    if (task.status === 'downloading') {
      task.status = 'error'
      task.error = typeof e === 'string' ? e : (e?.message ?? String(e))
      processQueue()
    }
  })
}
