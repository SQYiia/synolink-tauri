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

export interface VmmHost {
  hostId: string
  hostName: string
  status: string
  totalCpu: number
  freeCpu: number
  totalRam: number
  freeRam: number
}

export interface VmmStorage {
  storageId: string
  storageName: string
  hostName: string
  status: string
  size: number
  used: number
  volumePath: string
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

function mapHost(raw: any): VmmHost {
  return {
    hostId: raw.host_id ?? '',
    hostName: raw.host_name ?? '',
    status: raw.status ?? 'unknown',
    totalCpu: raw.total_cpu_core ?? 0,
    freeCpu: raw.free_cpu_core ?? 0,
    totalRam: raw.total_ram_size ?? 0,
    freeRam: raw.free_ram_size ?? 0,
  }
}

function mapStorage(raw: any): VmmStorage {
  return {
    storageId: raw.storage_id ?? '',
    storageName: raw.storage_name ?? '',
    hostName: raw.host_name ?? '',
    status: raw.status ?? 'unknown',
    size: raw.size ?? 0,
    used: raw.used ?? 0,
    volumePath: raw.volume_path ?? '',
  }
}

const state = reactive({
  guests: [] as VmmGuest[],
  hosts: [] as VmmHost[],
  storages: [] as VmmStorage[],
  loading: false,
  available: true,
})

export const vmmGuests = computed(() => state.guests)
export const vmmHosts = computed(() => state.hosts)
export const vmmStorages = computed(() => state.storages)
export const vmmLoading = computed(() => state.loading)
export const vmmAvailable = computed(() => state.available)

let pollTimer: ReturnType<typeof setInterval> | null = null

export async function vmmRefresh() {
  state.loading = true
  try {
    const [guestRes, hostRes, storageRes] = await Promise.all([
      dsm.vmmGuestList(),
      dsm.vmmHostList(),
      dsm.vmmStorageList(),
    ])
    if (guestRes.success && guestRes.data) {
      state.guests = ((guestRes.data as any).guests ?? []).map(mapGuest)
      state.available = true
    } else {
      const code = guestRes.error?.code
      if (code === 102 || code === 103) {
        state.available = false
        return
      }
    }
    if (hostRes.success && hostRes.data) {
      state.hosts = ((hostRes.data as any).hosts ?? []).map(mapHost)
    }
    if (storageRes.success && storageRes.data) {
      state.storages = ((storageRes.data as any).storages ?? []).map(mapStorage)
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
    hosts: vmmHosts,
    storages: vmmStorages,
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
