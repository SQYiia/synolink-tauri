import { reactive } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { downloadQueue } from './useDownloadQueue'
import { fileOperations } from './useFileOperations'
import { confirm } from '../utils/feedback'
import { version } from '../../package.json'

interface Release { version: string; notes: string; size: number }
const KEY = 'synolink.autoUpdateCheck'
export const updates = reactive({
  currentVersion: version, open: false, available: null as Release | null,
  phase: 'idle' as 'idle' | 'checking' | 'downloading' | 'ready' | 'installing',
  error: '', checked: false, progress: 0,
  automatic: (() => { try { return localStorage.getItem(KEY) !== 'false' } catch { return true } })(),
})
export const updateSupported = isTauri() && /Windows/i.test(navigator.userAgent)
export function setAutomatic(value: boolean) {
  updates.automatic = value
  try { localStorage.setItem(KEY, String(value)) } catch {}
}
export async function checkForUpdates(manual = true) {
  if (manual) updates.open = true
  if (!updateSupported) { updates.error = '当前仅支持 Windows x64 应用内更新'; return }
  if (updates.phase !== 'idle') return
  updates.phase = 'checking'; updates.error = ''
  try {
    updates.available = await invoke<Release | null>('check_app_update')
    updates.checked = true
  } catch (e) { updates.error = String(e) }
  finally { updates.phase = 'idle' }
}
export async function downloadUpdate() {
  if (updates.phase !== 'idle' || !updates.available) return
  updates.phase = 'downloading'; updates.error = ''; updates.progress = 0
  let unlisten: (() => void) | undefined
  try {
    unlisten = await listen<{ downloaded: number; total: number }>('app-update-progress', ({ payload }) => {
      updates.progress = Math.min(100, Math.floor(payload.downloaded / payload.total * 100))
    })
    await invoke('download_app_update')
    updates.progress = 100; updates.phase = 'ready'
  } catch (e) { updates.error = String(e); updates.phase = 'idle' }
  finally { unlisten?.() }
}
export async function installUpdate() {
  if (updates.phase !== 'ready') return
  if (downloadQueue.value.some(t => t.status === 'downloading' || t.status === 'queued') || fileOperations.some(t => ['running','cancelling'].includes(t.status))) {
    updates.error = '仍有未完成的传输或文件任务，请完成后再安装更新。'; return
  }
  if (!await confirm('将退出 SynoLink 并打开安装向导。完成安装后重新打开软件即可。', '安装更新', { confirmText: '退出并安装' })) return
  // Confirmation can stay open while another task starts.
  if (downloadQueue.value.some(t => t.status === 'downloading' || t.status === 'queued') || fileOperations.some(t => ['running','cancelling'].includes(t.status))) {
    updates.error = '有新的任务正在运行，请完成后再安装。'; return
  }
  updates.phase = 'installing'; updates.error = ''
  try { await invoke('install_app_update') }
  catch (e) { updates.error = String(e); updates.phase = 'idle' }
}
export function startUpdateChecks() {
  const check = () => { if (updates.automatic && updateSupported) void checkForUpdates(false) }
  const startup = setTimeout(check, 5000)
  const periodic = setInterval(check, 6 * 60 * 60 * 1000)
  return () => { clearTimeout(startup); clearInterval(periodic) }
}
