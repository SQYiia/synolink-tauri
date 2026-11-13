export interface RenameSource { path: string; name: string; isdir: boolean }
export interface RenameRule { mode: 'replace' | 'number'; find: string; replace: string; prefix: string; suffix: string; start: number; digits: number }
export interface RenameRow extends RenameSource { target: string; error: string; status: 'pending' | 'unchanged' | 'done' | 'error' | 'unknown' | 'stopped' }
const key = (name: string) => name.normalize('NFC').toLowerCase()
export const renameParent = (path: string) => path.slice(0, path.lastIndexOf('/'))
const hasErrors = (value:any) => value != null && (typeof value==='object' ? Object.keys(value).length>0 : !!value)
export function renamePreview(sources: RenameSource[], rule: RenameRule, existing: string[]): RenameRow[] {
  const occupied = new Set(existing.map(key))
  const rows = sources.map((source, index): RenameRow => {
    const dot = source.isdir ? -1 : source.name.lastIndexOf('.')
    const stem = dot > 0 ? source.name.slice(0, dot) : source.name
    const extension = dot > 0 ? source.name.slice(dot) : ''
    const width = Number.isInteger(rule.digits) ? Math.max(1, Math.min(9, rule.digits)) : 1
    const base = rule.mode === 'number' ? String(rule.start + index).padStart(width, '0') : rule.find ? stem.split(rule.find).join(rule.replace) : stem
    const target = rule.prefix + base + rule.suffix + extension
    let error = ''
    if (!target.trim() || /[\\/<>:"|?*\x00-\x1f\x7f]/.test(target) || /[. ]$/.test(target) || ['.', '..'].includes(target) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(target)) error = '名称包含不支持的字符或保留名称'
    else if (new TextEncoder().encode(target).length > 255) error = '名称超过 255 字节'
    else if (target !== source.name && occupied.has(key(target))) error = '目标名称已存在（含大小写近似名称）'
    if (rule.mode === 'number' && (!Number.isSafeInteger(rule.start) || rule.start < 0 || rule.start + sources.length > 999999999 || !Number.isInteger(rule.digits) || rule.digits < 1 || rule.digits > 9)) error = '序号范围无效'
    return { ...source, target, error, status: target === source.name ? 'unchanged' : 'pending' }
  })
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(key(row.target), (counts.get(key(row.target)) || 0) + 1)
  for (const row of rows) if ((counts.get(key(row.target)) || 0) > 1) row.error = '本批目标名称重复'
  return rows
}

/** Sequential writes: never retry an ambiguous rename or roll back completed changes. */
export async function runRenameBatch(rows: RenameRow[], rename: (row: RenameRow) => Promise<any>, active: () => boolean, changed: () => void) {
  if (rows.some(row => row.error)) throw new Error('请先解决预览中的名称冲突')
  for (const row of rows) {
    if (row.status !== 'pending') continue
    if (!active()) break
    try {
      const response = await rename(row)
      changed()
      const targetPath = renameParent(row.path) + '/' + row.target
      const files = response.data?.files
      if (response.success === false || hasErrors(response.error) || (Array.isArray(files) && files.some((file: any) => hasErrors(file.error) || hasErrors(file.errors))) || hasErrors(response.data?.errors)) {
        row.status = 'error'; row.error = 'NAS 报告重命名失败，请刷新目录检查'; break
      }
      if (response.success !== true || !Array.isArray(files) || files.length !== 1 || files[0].path !== targetPath) {
        row.status = 'unknown'; row.error = '结果未确认，请刷新检查，不要重复提交'; break
      }
      row.status = 'done'
    } catch {
      changed(); row.status = 'unknown'; row.error = '请求中断，结果未确认，请刷新检查'; break
    }
  }
  for (const row of rows) if (row.status === 'pending') row.status = 'stopped'
}
