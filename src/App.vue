<script setup lang="ts">
import AppUpdateDialog from './components/AppUpdateDialog.vue'
import { onMounted, onUnmounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { downloadQueue } from './composables/useDownloadQueue'
import { fileOperations } from './composables/useFileOperations'
import { confirm } from './utils/feedback'
import { useAppStore } from './stores/app'
import { initTheme } from './composables/useTheme'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { isIOS, isMobileUA } from './utils/platform'
import {
  iosNetworkBlocked,
  openIOSSettings,
  networkPreviouslyOk,
  markNetworkSuccess,
  setRetryProbe,
  retryNetworkProbe,
} from './composables/useIOSNetworkPermission'

const app = useAppStore()
const retrying = ref(false)
let unlistenClose: (() => void) | undefined
let confirmingClose = false
onMounted(async () => {
  if (!isTauri() || isMobileUA) return
  unlistenClose = await getCurrentWindow().onCloseRequested(async event => {
    const pending = downloadQueue.value.some(t => t.status === 'downloading' || t.status === 'queued') ||
      fileOperations.some(t => ['running','cancelling'].includes(t.status))
    if (!pending) return
    event.preventDefault()
    if (confirmingClose) return
    confirmingClose = true
    try {
      if (await confirm('仍有未完成任务。关闭会中断本机传输；NAS 上的文件任务可能继续运行。确定关闭？', '未完成任务')) {
        await getCurrentWindow().destroy()
      }
    } finally { confirmingClose = false }
  })
})
onUnmounted(() => unlistenClose?.())

/** iOS 本地网络权限触发：
 *  向本地 IP 发请求触发 iOS 评估 NSLocalNetworkUsageDescription 权限。
 *  优先使用用户已配置的 NAS 地址（更可靠），无服务器时回退 link-local。 */
async function primeIOSLocalNetworkPermission(probeUrl?: string): Promise<boolean> {
  if (!isIOS) return true
  const target = probeUrl || 'http://169.254.42.42:65535/'
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    await tauriFetch(target, {
      signal: ctrl.signal,
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    } as any)
    clearTimeout(t)
    markNetworkSuccess()
    return true
  } catch {
    return false
  }
}

/** 从 store 拿第一个服务器的 URL 作为探测目标 */
function getProbeUrl(): string | undefined {
  const s = app.servers[0]
  if (!s) return undefined
  return `${s.protocol}://${s.host}:${s.port}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query`
}

// 首次启动教学弹窗：仅在 iOS 且历史从未成功过本地网络访问时显示
const ONBOARDING_KEY = 'synolink.iosNetworkOnboarded'
const onboardingOpen = ref(false)

function dismissOnboarding() {
  try { localStorage.setItem(ONBOARDING_KEY, '1') } catch {}
  onboardingOpen.value = false
  void primeIOSLocalNetworkPermission(getProbeUrl())
}

onMounted(() => {
  app.load().then(() => {
    initTheme()
    if (isIOS) {
      setRetryProbe(async () => primeIOSLocalNetworkPermission(getProbeUrl()))
      const onboarded = (() => { try { return localStorage.getItem(ONBOARDING_KEY) === '1' } catch { return false } })()
      if (!onboarded && !networkPreviouslyOk()) {
        onboardingOpen.value = true
      } else {
        void primeIOSLocalNetworkPermission(getProbeUrl())
      }
    }
  })
})
</script>

<template>
  <router-view />
  <AppUpdateDialog />

  <!-- 首次启动：解释为什么要本地网络权限，确认后触发系统弹窗 -->
  <van-dialog
    v-model:show="onboardingOpen"
    title="允许访问本地网络"
    confirm-button-text="允许"
    :show-cancel-button="false"
    :close-on-click-overlay="false"
    teleport="body"
  >
    <div class="net-onboard">
      <div class="net-onboard-icon">
        <van-icon name="wifi" size="40" color="hsl(217 91% 60%)" />
      </div>
      <p>
        SynoLink 需要访问<b>本地网络</b>才能连接你局域网内的群晖 NAS。<br />
        点「允许」后，iOS 会再弹一次系统级权限请求，请同样选择允许。
      </p>
      <p class="net-onboard-sub">
        权限可以随时在「设置 → SynoLink → 本地网络」中开启或关闭。
      </p>
    </div>
    <template #footer>
      <van-button block type="primary" @click="dismissOnboarding">允许</van-button>
    </template>
  </van-dialog>

  <!-- 检测到被拒绝：阻断式遮罩 + 重试 / 跳设置 -->
  <van-dialog
    v-model:show="iosNetworkBlocked"
    title="本地网络权限未开启"
    :show-cancel-button="false"
    :close-on-click-overlay="false"
    teleport="body"
  >
    <div class="net-blocked">
      <div class="net-blocked-icon">
        <van-icon name="warning-o" size="40" color="hsl(0 84% 60%)" />
      </div>
      <p>
        无法连接到你的群晖 NAS。<br />
        看起来 SynoLink 没有<b>本地网络</b>权限，请前往系统设置开启。
      </p>
      <p class="net-blocked-path">
        路径：设置 → SynoLink → 本地网络
      </p>
    </div>
    <template #footer>
      <div class="net-blocked-actions">
        <van-button block plain @click="retrying = true; retryNetworkProbe().finally(() => retrying = false)">
          <van-loading v-if="retrying" size="14" style="margin-right: 6px" />
          重新检测
        </van-button>
        <van-button block type="primary" @click="openIOSSettings">去设置</van-button>
      </div>
    </template>
  </van-dialog>
</template>

<style src="./styles/base.css"></style>
<style src="./styles/polish.css"></style>
<style src="./styles/desktop.css"></style>
<style src="./styles/workspace-pages.css"></style>
