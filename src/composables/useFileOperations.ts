import { reactive, watch } from 'vue'
import { dsm, DsmClient } from '../api/dsm'

interface Operation {
  id: string
  sourceUrl: string
  account: string
  kind: 'upload' | 'copy' | 'move'
  name: string
  status: 'running' | 'waiting' | 'done' | 'error'
  taskid?: string
  progress: number
  error?: string
}

function restore(): Operation[] {
  try {
    const value = JSON.parse(localStorage.getItem('synolink.operations') || '[]')
    return Array.isArray(value) ? value.map(t => ({ ...t, status: t.status === 'running' ? 'waiting' : t.status })) : []
  } catch { return [] }
}
export const fileOperations = reactive<Operation[]>(restore())
watch(fileOperations, tasks => {
  try { localStorage.setItem('synolink.operations', JSON.stringify(tasks)) } catch { /* optional persistence */ }
}, { deep: true })

function newOperation(kind: Operation['kind'], name: string) {
  const task: Operation = { id: crypto.randomUUID(), sourceUrl: dsm.baseUrl, account: dsm.account, kind, name, status: 'running', progress: 0 }
  fileOperations.unshift(task)
  return fileOperations[0]!
}

// A dedicated client prevents an upload already in flight from following a server switch.
function snapshotClient() {
  const client = new DsmClient(dsm.baseUrl)
  client.sid = dsm.sid
  client.synoToken = dsm.synoToken
  client.apiInfo = { ...dsm.apiInfo }
  client.allowInsecure = dsm.allowInsecure
  return client
}

export async function trackedUpload(folder: string, file: File, overwrite: boolean) {
  const task = newOperation('upload', file.name)
  const client = snapshotClient()
  try {
    const result = await client.upload(folder, file, overwrite)
    if (!result.success) throw new Error(`上传失败（${result.error?.code}），请重新选择该文件重试`)
    task.status = 'done'
    task.progress = 100
    return result
  } catch (e: any) {
    task.status = 'error'
    task.error = e.message ?? String(e)
    return { success: false, error: { code: task.error } }
  }
}

export async function startCopyMove(paths: string[], destination: string, move: boolean) {
  const task = newOperation(move ? 'move' : 'copy', `${paths.length} 个项目 → ${destination}`)
  try {
    const result = await dsm.copyMove(paths, destination, false, move)
    if (!result.success || !result.data?.taskid) throw new Error(`无法启动任务（${result.error?.code}）`)
    task.taskid = result.data.taskid
    void monitor(task)
  } catch (e: any) {
    task.status = 'error'
    task.error = e.message ?? String(e)
    throw e
  }
}

const monitoring = new Set<string>()
async function monitor(task: Operation) {
  if (monitoring.has(task.id)) return
  monitoring.add(task.id)
  try {
    while (task.taskid && task.status === 'running') {
      if (dsm.baseUrl !== task.sourceUrl || dsm.account !== task.account || !dsm.sid) {
        task.status = 'waiting'
        task.error = 'NAS 任务可能仍在运行；登录来源服务器后可继续查询'
        return
      }
      const result = await dsm.copyMoveStatus(task.taskid)
      if (!result.success) throw new Error(`暂时无法查询任务（${result.error?.code}）`)
      const data = result.data as any
      if (data?.error || data?.errors?.length) {
        task.status = 'error'
        task.error = 'NAS 报告部分项目操作失败，请检查权限、同名文件及剩余空间'
        return
      }
      task.progress = Math.max(0, Math.min(100, Number(data?.progress ?? 0) * 100))
      if (data?.finished) { task.status = 'done'; task.progress = 100; return }
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
  } catch (e: any) {
    task.status = 'waiting'
    task.error = `${e.message ?? e}；NAS 任务可能仍在运行，可重新查询`
  } finally { monitoring.delete(task.id) }
}

export function refreshOperation(task: Operation) {
  if (task.kind === 'upload') return
  task.status = 'running'
  task.error = undefined
  void monitor(task)
}

export function removeOperation(task: Operation) {
  if (task.status === 'running') return
  const index = fileOperations.indexOf(task)
  if (index >= 0) fileOperations.splice(index, 1)
}
