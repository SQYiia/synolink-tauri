import { onMounted, onUnmounted, ref } from 'vue'
import { dsm } from '../api/dsm'

const HISTORY_MAX = 60

export function useSystemMonitor(opts: { autoStart?: boolean; pollMs?: number } = {}) {
  const cpuPct = ref(0)
  const memPct = ref(0)
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
      if (res.success && res.data) {
        const d: any = res.data
        const cpu = d.cpu ?? {}
        cpuPct.value = Math.min(100, Number(cpu.user_load ?? 0) + Number(cpu.system_load ?? 0))
        const mem = d.memory ?? {}
        memTotal.value = Number(mem.total_real ?? 0) * 1024
        const avail = Number(mem.avail_real ?? mem.avail ?? 0) * 1024
        memUsed.value = Math.max(0, memTotal.value - avail)
        memPct.value = memTotal.value ? Math.round((memUsed.value / memTotal.value) * 100) : 0
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
        pushHistory(memHistory.value, memPct.value)
        pushHistory(netSendHistory.value, netSend.value)
        pushHistory(netRecvHistory.value, netRecv.value)
      }
    } catch (e) { console.warn('[monitor] refreshUtil failed:', e) }
  }

  function normalizeVolume(v: any) {
    const sizeObj = (v?.size && typeof v.size === 'object') ? v.size : null
    const size = Number(
      v?.size_total ?? sizeObj?.total ?? v?.total ??
      (typeof v?.size === 'number' || typeof v?.size === 'string' ? v.size : 0)
    ) || 0
    const free = Number(
      v?.size_free_user ?? sizeObj?.free_user ?? sizeObj?.free ?? v?.free ?? 0
    ) || 0
    let used = Number(
      v?.size_used ?? v?.used_size ?? sizeObj?.used ?? v?.used ?? 0
    ) || 0
    if (!used && size > 0 && free > 0) used = Math.max(0, size - free)
    return {
      ...v,
      _name: v?.display_name ?? v?.volume_path ?? v?.id ?? '-',
      _size: size,
      _used: used,
      _status: v?.status ?? v?.volume_status,
    }
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
  }

  return {
    cpuPct, memPct, memTotal, memUsed,
    netSend, netRecv, diskRead, diskWrite,
    volumes, disks, sharesCount, lastUpdate, loading,
    cpuHistory, memHistory, netSendHistory, netRecvHistory,
    refreshAll, refreshUtil, refreshStorage, refreshDisks, refreshShares,
    startPolling, stopPolling,
  }
}
