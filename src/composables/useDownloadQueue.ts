import { reactive, computed } from 'vue'
import { dsm } from '../api/dsm'

export interface DownloadTask {
  id: string
  path: string
  name: string
  size: number
  loaded: number
  status: 'queued' | 'downloading' | 'done' | 'error' | 'cancelled'
  error?: string
  abortCtrl?: AbortController
}

const MAX_CONCURRENT = 2

const state = reactive({
  tasks: [] as DownloadTask[],
})

export const downloadQueue = computed(() => state.tasks)

export function enqueue(path: string, name: string, size: number = 0) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const task: DownloadTask = { id, path, name, size, loaded: 0, status: 'queued' }
  state.tasks.unshift(task)
  processQueue()
  return id
}

export function cancelTask(id: string) {
  const task = state.tasks.find(t => t.id === id)
  if (!task) return
  if (task.status === 'downloading' && task.abortCtrl) {
    task.abortCtrl.abort()
  }
  task.status = 'cancelled'
  processQueue()
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
  task.abortCtrl = new AbortController()
  const url = dsm.downloadUrl(task.path, 'download')
  const headers: Record<string, string> = {}
  if (dsm.synoToken) headers['X-SYNO-TOKEN'] = dsm.synoToken

  try {
    const res = await fetch(url, {
      headers,
      signal: task.abortCtrl.signal,
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    } as any)

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const contentLength = Number(res.headers.get('content-length') || task.size || 0)
    if (contentLength) task.size = contentLength

    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')

    const chunks: Uint8Array[] = []
    let received = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      task.loaded = received
    }

    // Create blob and trigger download
    const blob = new Blob(chunks)
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = task.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)

    task.status = 'done'
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      task.status = 'cancelled'
    } else {
      task.status = 'error'
      task.error = e?.message ?? String(e)
    }
  } finally {
    task.abortCtrl = undefined
    processQueue()
  }
}
