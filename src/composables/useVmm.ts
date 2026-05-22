import { reactive, computed, onScopeDispose } from 'vue'
import { dsm } from '../api/dsm'
import { ElMessage } from 'element-plus'

export interface VmmGuest {
  guestId: string
  guestName: string
  status: string
  vcpuNum: number
  vramSize: number
  autorun: number
  description: string
  storageName: string
}

const STATUS_LABELS: Record<string, { label: string; type: string }> = {
  running: { label: '运行中', type: 'success' },
  shutdown: { label: '已关机', type: 'info' },
  booting: { label: '启动中', type: 'warning' },
  shutting_down: { label: '关机中', type: 'warning' },
  inaccessible: { label: '不可访问', type: 'danger' },
  crashed: { label: '已崩溃', type: 'danger' },
  moving: { label: '迁移中', type: 'warning' },
  stor_migrating: { label: '存储迁移中', type: 'warning' },
  creating: { label: '创建中', type: 'info' },
  importing: { label: '导入中', type: 'info' },
  preparing: { label: '准备中', type: 'info' },
  ha_standby: { label: 'HA 待机', type: 'info' },
  unknown: { label: '未知', type: 'info' },
}

export function getVmmStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? { label: status, type: 'info' }
}

function mapGuest(raw: any): VmmGuest {
  return {
    guestId: raw.guest_id ?? '',
    guestName: raw.guest_name ?? '',
    status: raw.status ?? 'unknown',
    vcpuNum: raw.vcpu_num ?? 0,
    vramSize: raw.vram_size ?? 0,
    autorun: raw.autorun ?? 0,
    description: raw.description ?? '',
    storageName: raw.storage_name ?? '',
  }
}

const state = reactive({
  guests: [] as VmmGuest[],
  loading: false,
  available: true,
})

export const vmmGuests = computed(() => state.guests)
export const vmmLoading = computed(() => state.loading)
export const vmmAvailable = computed(() => state.available)

let pollTimer: ReturnType<typeof setInterval> | null = null

export async function vmmRefresh() {
  state.loading = true
  try {
    const res = await dsm.vmmGuestList()
    if (res.success && res.data) {
      state.guests = ((res.data as any).guests ?? []).map(mapGuest)
      state.available = true
    } else {
      const code = res.error?.code
      if (code === 102 || code === 103) {
        state.available = false
      }
    }
  } catch {
    // network error
  } finally {
    state.loading = false
  }
}

export function vmmStartPolling(intervalMs = 5000) {
  vmmStopPolling()
  vmmRefresh()
  pollTimer = setInterval(vmmRefresh, intervalMs)
}

export function vmmStopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export async function vmmPowerOn(guestId: string) {
  const res = await dsm.vmmGuestPowerOn(guestId)
  if (res.success) {
    ElMessage.success('开机指令已发送')
  } else {
    ElMessage.error('开机失败')
  }
  await vmmRefresh()
}

export async function vmmShutdown(guestId: string) {
  const res = await dsm.vmmGuestShutdown(guestId)
  if (res.success) {
    ElMessage.success('关机指令已发送')
  } else {
    ElMessage.error('关机失败')
  }
  await vmmRefresh()
}

export async function vmmPowerOff(guestId: string) {
  const res = await dsm.vmmGuestPowerOff(guestId)
  if (res.success) {
    ElMessage.warning('已强制关机')
  } else {
    ElMessage.error('强制关机失败')
  }
  await vmmRefresh()
}

export function useVmm() {
  onScopeDispose(() => {
    vmmStopPolling()
  })

  return {
    guests: vmmGuests,
    loading: vmmLoading,
    available: vmmAvailable,
    startPolling: vmmStartPolling,
    stopPolling: vmmStopPolling,
    refresh: vmmRefresh,
    powerOn: vmmPowerOn,
    shutdown: vmmShutdown,
    powerOff: vmmPowerOff,
  }
}
