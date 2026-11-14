import { onActivated, onDeactivated } from 'vue'
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
  disks: Array<{ vdisk_id: string; vdisk_size: number; controller: number }>
  nics: Array<{ vnic_id: string; network_name: string; mac: string }>
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
    disks: raw.vdisks ?? [],
    nics: raw.vnics ?? [],
  }
}

function resourceNumber(value:any):number { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value)>=0 ? Number(value) : NaN }

function mapHost(raw: any): VmmHost {
  return {
    hostId: raw.host_id ?? '',
    hostName: raw.host_name ?? '',
    status: raw.status ?? 'unknown',
    totalCpu: resourceNumber(raw.total_cpu_core),
    freeCpu: resourceNumber(raw.free_cpu_core),
    totalRam: resourceNumber(raw.total_ram_size),
    freeRam: resourceNumber(raw.free_ram_size),
  }
}

function mapStorage(raw: any): VmmStorage {
  return {
    storageId: raw.storage_id ?? '',
    storageName: raw.storage_name ?? '',
    hostName: raw.host_name ?? '',
    status: raw.status ?? 'unknown',
    size: resourceNumber(raw.size),
    used: resourceNumber(raw.used),
    volumePath: raw.volume_path ?? '',
  }
}

const state = reactive({
  guests: [] as VmmGuest[],
  hosts: [] as VmmHost[],
  storages: [] as VmmStorage[],
  loading: false,
  available: true,
  reason: '',
})

export const vmmGuests = computed(() => state.guests)
export const vmmHosts = computed(() => state.hosts)
export const vmmStorages = computed(() => state.storages)
export const vmmLoading = computed(() => state.loading)
export const vmmAvailable = computed(() => state.available)

let epoch = 0
let stateContext = ''
function resetContext() {
  const context = JSON.stringify([dsm.baseUrl, dsm.account])
  if (context !== stateContext) {
    epoch++
    stateContext = context
    state.reason = ''
    state.guests = []
    state.hosts = []
    state.storages = []
    state.available = true
    state.loading = false
  }
}
let pollTimer: ReturnType<typeof setInterval> | null = null

export async function vmmRefresh() {
  resetContext()
  if (state.loading || document.hidden) return
  const context = stateContext, token = ++epoch, sid = dsm.sid
  state.loading = true
  try {
    const results = await Promise.allSettled([
      dsm.vmmGuestList(),
      dsm.vmmHostList(),
      dsm.vmmStorageList(),
    ])
    if (token !== epoch || sid !== dsm.sid || context !== JSON.stringify([dsm.baseUrl, dsm.account])) return
    const [guestRes, hostRes, storageRes] = results.map(r => r.status === 'fulfilled' ? r.value : {success:false})
    state.reason = ''
    if (guestRes.success && Array.isArray(guestRes.data?.guests)) {
      state.guests = ((guestRes.data as any).guests ?? []).map(mapGuest)
      state.available = true
    } else {
      const code = guestRes.error?.code
      state.reason = vmmError(code)
      if (code === 102 || code === 103) {
        state.available = false
        return
      }
    }
    if (!hostRes.success || !Array.isArray(hostRes.data?.hosts)) { state.hosts = []; state.reason += ' 主机信息暂不可用。' }
    if (hostRes.success && Array.isArray(hostRes.data?.hosts)) {
      state.hosts = ((hostRes.data as any).hosts ?? []).map(mapHost)
    }
    if (!storageRes.success || !Array.isArray(storageRes.data?.storages)) { state.storages = []; state.reason += ' 存储信息暂不可用。' }
    if (storageRes.success && Array.isArray(storageRes.data?.storages)) {
      state.storages = ((storageRes.data as any).storages ?? []).map(mapStorage)
    }
  } catch {
    if (context === JSON.stringify([dsm.baseUrl, dsm.account])) state.reason = '无法刷新虚拟机状态，请检查 NAS 连接；当前数据可能已过期'
  } finally {
    if (token === epoch) state.loading = false
  }
}

export function vmmStartPolling(intervalMs = 5000) {
  vmmStopPolling()
  vmmRefresh()
  pollTimer = setInterval(vmmRefresh, intervalMs)
}

export function vmmStopPolling() {
  epoch++; state.loading = false
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function vmmError(code?: number) {
  const messages: Record<number, string> = { 102: 'VMM 接口不可用，请检查套件', 103: 'VMM 不支持此操作', 105: '当前账号没有操作权限', 106: '登录已过期', 401: '配置参数无效', 402: '操作失败，请检查虚拟机状态', 403: '虚拟机名称已存在', 600: '集群未就绪', 601: '主机离线', 902: 'CPU 资源不足', 903: '内存不足', 1600: '配置已修改，但 HA 资源预留失败，请在 VMM 检查' }
  return messages[code ?? -1] || 'VMM 操作失败（code=' + code + '）'
}
const busy = reactive<Record<string, boolean>>({})
async function action(guestId: string, label: string, request: () => Promise<any>) {
  if (busy[guestId]) return false
  const context = JSON.stringify([dsm.baseUrl,dsm.account,dsm.sid])
  busy[guestId] = true
  try {
    const res = await request()
    if(context !== JSON.stringify([dsm.baseUrl,dsm.account,dsm.sid]))return false
    if (!res.success) throw new Error(vmmError(res.error?.code))
    ElMessage.success(label + '指令已发送')
    await vmmRefresh()
    return true
  } catch (error: any) { if(context === JSON.stringify([dsm.baseUrl,dsm.account,dsm.sid]))ElMessage.error(error?.message || label + '失败'); return false }
  finally { delete busy[guestId] }
}
export const vmmPowerOn = (id: string) => action(id, '开机', () => dsm.vmmGuestPowerOn(id))
export const vmmShutdown = (id: string) => action(id, '关机', () => dsm.vmmGuestShutdown(id))
export const vmmPowerOff = (id: string) => action(id, '强制关机', () => dsm.vmmGuestPowerOff(id))
export const vmmSave = (id: string, settings: Parameters<typeof dsm.vmmGuestSet>[1]) => action(id, '保存配置', () => dsm.vmmGuestSet(id, settings))

export function useVmm() {
  resetContext()
  onActivated(() => vmmStartPolling())
  onDeactivated(vmmStopPolling)
  onScopeDispose(() => {
    vmmStopPolling()
  })

  return {
    busy,
    save: vmmSave,
    reason: computed(() => state.reason),
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
