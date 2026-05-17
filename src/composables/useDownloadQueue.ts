import { reactive, computed } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { dsm } from '../api/dsm'

export interface DownloadTask {
  id: string
  path: string
  name: string
  size: number
  loaded: number
  status: 'queued' | 'downloading' | 'done' | 'error' | 'cancelled'
  error?: string
}

const state = reactive({
  tasks: [] as DownloadTask[],
})

export const downloadQueue = computed(() => state.tasks)

export function enqueue(path: string, name: string, size: number = 0) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const task: DownloadTask = { id, path, name, size, loaded: 0, status: 'queued' }
  state.tasks.unshift(task)
  startDownload(task)
  return id
}

export function cancelTask(id: string) {
  const task = state.tasks.find(t => t.id === id)
  if (!task) return
  task.status = 'cancelled'
}

export function removeTask(id: string) {
  const idx = state.tasks.findIndex(t => t.id === id)
  if (idx >= 0) state.tasks.splice(idx, 1)
}

export function clearCompleted() {
  state.tasks.splice(0, state.tasks.length, ...state.tasks.filter(t => t.status === 'downloading' || t.status === 'queued'))
}

async function startDownload(task: DownloadTask) {
  task.status = 'downloading'
  try {
    const url = dsm.downloadUrl(task.path, 'download')
    await openUrl(url)
    task.status = 'done'
    task.loaded = task.size
  } catch (e: any) {
    task.status = 'error'
    task.error = e?.message ?? String(e)
  }
}
