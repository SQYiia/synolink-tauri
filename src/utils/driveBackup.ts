export function rowsOf(data: any, key: string): any[] {
  if (!Array.isArray(data?.[key])) throw new Error('套件返回格式不兼容，请刷新或检查套件版本')
  return data[key]
}
export function driveItem(raw: any) {
  const id = raw.file_id ?? raw.id
  if (typeof id === 'number' && !Number.isSafeInteger(id)) throw new Error('文件 ID 超出安全精度，已停止打开以避免访问错误文件')
  return { id: id == null ? '' : String(id), name: String(raw.name ?? ''), directory: raw.is_dir === true || raw.isdir === true || ['dir', 'folder', 'directory'].includes(raw.type), size: typeof raw.size === 'number' ? raw.size : null, modified: raw.modified_time ?? raw.mtime ?? null, type: String(raw.type ?? '') }
}
export function displayTime(value: unknown): string {
  if (value == null || value === '') return '未返回'
  if (typeof value === 'string' && !/^\d+$/.test(value)) return value
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return '未返回'
  const date = new Date(number < 1e12 ? number * 1000 : number)
  return Number.isNaN(date.getTime()) ? '未返回' : date.toLocaleString()
}
export function backupResult(value: unknown) {
  if (value == null || value === '') return { label: '结果未返回', tone: 'info' as const }
  const raw = String(value)
  if (['done', 'success'].includes(raw)) return { label: '成功', tone: 'success' as const }
  if (['fail', 'failed', 'error'].includes(raw)) return { label: '失败', tone: 'danger' as const }
  if (['interrupt', 'cancelled', 'warning'].includes(raw)) return { label: raw === 'warning' ? '有警告' : '已中断', tone: 'warning' as const }
  return { label: `状态 ${raw}`, tone: 'info' as const }
}
export function backupTask(raw: any) {
  return { id: raw.task_id == null ? '' : String(raw.task_id), name: String(raw.name ?? raw.task_name ?? '未命名任务'), result: raw.last_bkp_result ?? raw.last_result?.status ?? null, time: raw.last_bkp_time ?? raw.last_result?.time_end ?? null, status: typeof raw.status === 'string' || typeof raw.status === 'number' ? String(raw.status) : '未返回', next: raw.next_bkp_time ?? raw.next_trigger_time ?? null }
}
