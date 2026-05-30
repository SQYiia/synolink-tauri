import { ref } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isIOS } from '../utils/platform'

/** iOS「本地网络」权限检测与引导。
 *  iOS 不允许 App 主动查询/请求该权限：唯一可见信号就是「请求私有 IP 段就静默失败」。
 *  策略：累计 N 秒内 ≥M 次连续连接失败 → 认为权限被拒，弹窗引导。 */

const FAIL_THRESHOLD = 2
const FAIL_WINDOW_MS = 8000
const LS_OK_KEY = 'synolink.iosNetworkOk'

/** 是否已弹出引导对话框（true 时 AppShell 渲染遮罩） */
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

/** 之前曾经成功过（说明权限是开的）—— 用于判断初次启动是否要主动展开教学弹窗 */
export function networkPreviouslyOk(): boolean {
  try { return localStorage.getItem(LS_OK_KEY) === '1' } catch { return false }
}

export async function openIOSSettings() {
  // app-settings: 直接跳本 App 的隐私页（iOS 系统映射 UIApplication.openSettingsURLString）
  // App-prefs: 通用的设置 URL scheme（部分版本可用）
  for (const scheme of ['app-settings:', 'App-prefs:']) {
    try {
      await openUrl(scheme)
      return
    } catch {/* try next */}
  }
}

/** 手动重置（开发用） */
export function _resetNetworkProbe() {
  iosNetworkBlocked.value = false
  failTimes.length = 0
}
