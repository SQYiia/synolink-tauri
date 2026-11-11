import { onActivated, onDeactivated } from 'vue'
import { onMounted, onUnmounted, ref } from 'vue'
import { dsm } from '../api/dsm'
import { normalizeVolume } from '../utils/storage'
import { parseMemory } from '../utils/memory'

const HISTORY_MAX = 60

export function useSystemMonitor(opts: { autoStart?: boolean; pollMs?: number } = {}) {
  const cpuPct = ref(0)
  const memPct = ref<number | null>(null)
  const memInstalled = ref<number | null>(null)
  const memAvailable = ref(false)
  const memTotal = ref(0)
  const memUsed = ref(0)
  const netSend = ref(0)
  const netRecv = ref(0)
  const diskRead = ref(0)
  const diskWrite = ref(0)
  const volumes = ref<any[]>([])
  const disks = ref<any[]>([])
  const sharesCount = ref(0)
  const lastUpdate = ref('')
  const loading = ref(false)

  const cpuHistory = ref<number[]>([])
  const memHistory = ref<number[]>([])
  const netSendHistory = ref<number[]>([])
  const netRecvHistory = ref<number[]>([])

  function pushHistory(arr: number[], val: number) {
    arr.push(val)
    if (arr.length > HISTORY_MAX) arr.shift()
  }

  async function refreshUtil() {
    try {
      const res = await dsm.systemUtilization()
      if (!res.success || !res.data) throw new Error('性能数据读取失败')
      if (res.success && res.data) {
        const d: any = res.data
        const cpu = d.cpu ?? {}
        cpuPct.value = Math.min(100, Number(cpu.user_load ?? 0) + Number(cpu.system_load ?? 0))
        const mem = parseMemory(d.memory)
        memTotal.value = mem.totalBytes ?? 0
        memUsed.value = mem.usedBytes ?? 0
        memPct.value = mem.percentage
        memInstalled.value = mem.installedBytes
        memAvailable.value = mem.usedBytes != null && mem.totalBytes != null
        const nets: any[] = d.network ?? []
        const total = nets.find((n: any) => n.device === 'total') ?? nets[0] ?? {}
        netSend.value = Number(total.tx ?? 0)
        netRecv.value = Number(total.rx ?? 0)
        const disk = d.disk ?? {}
        const total2 = (disk.total ?? {}) as any
        diskRead.value = Number(total2.read_byte ?? 0)
        diskWrite.value = Number(total2.write_byte ?? 0)
        lastUpdate.value = new Date().toLocaleTimeString()

        pushHistory(cpuHistory.value, cpuPct.value)
        if (memPct.value != null) pushHistory(memHistory.value, memPct.value)
        else memHistory.value = []
        pushHistory(netSendHistory.value, netSend.value)
        pushHistory(netRecvHistory.value, netRecv.value)
      }
    } catch (e) { memPct.value = null; memAvailable.value = false; memInstalled.value = null; memHistory.value = []; console.warn('[monitor] refreshUtil failed:', e) }
  }

  function normalizeDisk(d: any) {
    const sizeObj = (d?.size && typeof d.size === 'object') ? d.size : null
    const size = Number(
      d?.size_total ?? sizeObj?.total ?? d?.capacity ??
      (typeof d?.size === 'number' || typeof d?.size === 'string' ? d.size : 0)
    ) || 0
    const temp = Number(d?.temp ?? d?.temperature ?? 0) || 0
    return {
      ...d,
      _name: d?.name ?? d?.disk_id ?? d?.id ?? d?.disk_path ?? '-',
      _model: [d?.vendor, d?.model].filter(Boolean).join(' ').trim() || d?.model || '',
      _temp: temp,
      _size: size,
      _status: d?.status ?? d?.smart_status ?? d?.smart_test_status ?? '',
    }
  }

  async function refreshStorage() {
    try {
      const res = await dsm.storageInfo()
      if (res.success && res.data) {
        volumes.value = (((res.data as any).volumes ?? []) as any[]).map(normalizeVolume)
      }
    } catch (e) { console.warn('[monitor] refreshStorage failed:', e) }
  }

  async function refreshDisks() {
    try {
      const res = await dsm.diskInfo()
      if (res.success && res.data) {
        const raw = ((res.data as any).disks ?? (res.data as any)) as any[]
        disks.value = (Array.isArray(raw) ? raw : []).map(normalizeDisk)
      }
    } catch (e) { console.warn('[monitor] refreshDisks failed:', e) }
  }

  async function refreshShares() {
    try {
      const res = await dsm.listShare({ limit: 100 })
      if (res.success) {
        const shares: any[] = (res.data as any)?.shares ?? []
        sharesCount.value = shares.length
      }
    } catch (e) { console.warn('[monitor] refreshShares failed:', e) }
  }

  async function refreshAll() {
    loading.value = true
    try {
      await Promise.all([refreshUtil(), refreshStorage(), refreshDisks(), refreshShares()])
    } finally {
      loading.value = false
    }
  }

  let timer: any = null
  function startPolling() {
    if (timer) return
    timer = setInterval(refreshUtil, opts.pollMs ?? 5000)
  }
  function stopPolling() {
    if (timer) { clearInterval(timer); timer = null }
  }

  if (opts.autoStart !== false) {
    onMounted(async () => {
      if (!dsm.sid) return
      await refreshAll()
      startPolling()
    })
    onUnmounted(stopPolling)
    onActivated(startPolling)
    onDeactivated(stopPolling)
  }

  return {
    cpuPct, memPct, memTotal, memUsed, memAvailable, memInstalled,
    netSend, netRecv, diskRead, diskWrite,
    volumes, disks, sharesCount, lastUpdate, loading,
    cpuHistory, memHistory, netSendHistory, netRecvHistory,
    refreshAll, refreshUtil, refreshStorage, refreshDisks, refreshShares,
    startPolling, stopPolling,
  }
}
