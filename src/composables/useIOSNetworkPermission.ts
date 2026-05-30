import { ref } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isIOS } from '../utils/platform'

const FAIL_THRESHOLD = 2
const FAIL_WINDOW_MS = 8000
const LS_OK_KEY = 'synolink.iosNetworkOk'

export const iosNetworkBlocked = ref(false)

const failTimes: number[] = []

export function markNetworkSuccess() {
  iosNetworkBlocked.value = false
  failTimes.length = 0
  try { localStorage.setItem(LS_OK_KEY, '1') } catch {}
}

export function markNetworkFailure() {
  if (!isIOS) return
  const now = Date.now()
  failTimes.push(now)
  while (failTimes.length && now - failTimes[0] > FAIL_WINDOW_MS) failTimes.shift()
  if (failTimes.length >= FAIL_THRESHOLD) {
    iosNetworkBlocked.value = true
  }
}

export function networkPreviouslyOk(): boolean {
  try { return localStorage.getItem(LS_OK_KEY) === '1' } catch { return false }
}

export async function openIOSSettings() {
  for (const scheme of ['app-settings:', 'App-prefs:']) {
    try {
      await openUrl(scheme)
      return
    } catch {/* try next */}
  }
}

/** 重置阻断状态并触发重新探测；返回的 Promise 在探测完成后 resolve */
let _retryFn: (() => Promise<boolean>) | null = null
export function setRetryProbe(fn: (() => Promise<boolean>) | null) { _retryFn = fn }

export async function retryNetworkProbe(): Promise<boolean> {
  iosNetworkBlocked.value = false
  failTimes.length = 0
  if (_retryFn) {
    const ok = await _retryFn()
    if (ok) markNetworkSuccess()
    return ok
  }
  return false
}

export function _resetNetworkProbe() {
  iosNetworkBlocked.value = false
  failTimes.length = 0
}
