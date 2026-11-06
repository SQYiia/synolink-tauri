import { readMediaCache, writeMediaCache } from '../utils/mediaCache'
import { computed, ref, shallowRef, markRaw, nextTick, onScopeDispose, onMounted, onActivated, onDeactivated, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dsm } from '../api/dsm'

export interface UseMediaScanOptions {
  extensions: string
  filterFn: (f: any) => boolean
  visibleInit?: number
  visibleStep?: number
  storageKeyPrefix: string
  /** DSM 服务端排序字段，优先使用后可在前端跳过排序 */
  sortBy?: 'name' | 'size' | 'user' | 'group' | 'mtime' | 'atime' | 'ctime' | 'crtime' | 'type' | 'posix'
  sortDirection?: 'asc' | 'desc'
}

export function useMediaScan(opts: UseMediaScanOptions) {
  const {
    extensions,
    filterFn,
    visibleInit = 120,
    visibleStep = 120,
    storageKeyPrefix,
    sortBy,
    sortDirection,
  } = opts

  const folder = ref('')
  const loading = ref(false)
  const scanError = ref('')
  const items = shallowRef<any[]>([])
  const visibleCount = ref(visibleInit)
  const sentinel = ref<HTMLElement | null>(null)
  let sentinelObserver: IntersectionObserver | null = null
  let scanGen = 0

  // DsmClient is not reactive: compute this from the current session on every access.
  const storageKey = () => `${storageKeyPrefix}:${dsm.baseUrl}:${dsm.account}`
  let active = false
  let context = ''
  let session = ''
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let lastStartedAt = 0
  let sessionTimer: ReturnType<typeof setInterval> | undefined
  const identity = () => JSON.stringify([dsm.baseUrl, dsm.account])

  function initFromStorage() {
    if (!dsm.sid) {
      return false
    }
    try {
      const saved = localStorage.getItem(storageKey())
      if (folder.value !== (saved ?? '')) items.value = []
      folder.value = saved ?? ''
      return !!saved
    } catch {}
    return false
  }

  function setupSentinel() {
    nextTick(() => {
      sentinelObserver?.disconnect()
      if (!active || !sentinel.value) return
      sentinelObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting && visibleCount.value < items.value.length) {
            visibleCount.value = Math.min(items.value.length, visibleCount.value + visibleStep)
          }
        }
      }, { rootMargin: '800px', threshold: 0 })
      sentinelObserver.observe(sentinel.value)
    })
  }

  function cleanup() {
    clearTimeout(retryTimer)
    scanGen++
    loading.value = false
    sentinelObserver?.disconnect()
    sentinelObserver = null
  }
  function checkSession(force = false) {
    if (!active) return
    if (!dsm.sid) {
      if (context) { cleanup(); context = ''; session = ''; folder.value = ''; items.value = [] }
      return
    }
    const next = identity()
    if (force || next !== context || session !== dsm.sid) {
      if (next !== context) { cleanup(); folder.value = ''; items.value = []; scanError.value = ''; context = next }
      session = dsm.sid
      if (initFromStorage()) void runScan(true, 0)
      setupSentinel()
    }
  }
  function resume() {
    if (active && !loading.value && Date.now() - lastStartedAt > 15000 && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) checkSession(true)
  }
  function activate() {
    if (active) return // mounted + activated fire together on the first KeepAlive entry
    active = true
    checkSession(true)
    sessionTimer = setInterval(() => checkSession(), 500)
    if (typeof window !== 'undefined') window.addEventListener('focus', resume)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', resume)
  }
  function deactivate() {
    active = false; clearInterval(sessionTimer); cleanup()
    if (typeof window !== 'undefined') window.removeEventListener('focus', resume)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resume)
  }
  onMounted(activate)
  onActivated(activate)
  onDeactivated(deactivate)
  onScopeDispose(deactivate)
  watch(sentinel, setupSentinel, { flush: 'post' })

  function scan() { return runScan(false, 0) }

  async function runScan(automatic: boolean, attempt: number) {
    if (!folder.value || !dsm.sid) return
    clearTimeout(retryTimer)
    lastStartedAt = Date.now()
    loading.value = true
    scanError.value = ''
    visibleCount.value = visibleInit
    scanGen++
    const gen = scanGen
    let taskid = ''
    let retry = false
    const sourceUrl = dsm.baseUrl
    const sourceAccount = dsm.account
    const sourceFolder = folder.value
    const cacheKey = `${storageKey()}:${sourceFolder}`
    try {
      if (!items.value.length) {
        // A locked/unavailable local database must not block the NAS scan.
        let timeout: ReturnType<typeof setTimeout> | undefined
        const cached = await Promise.race([readMediaCache(cacheKey), new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 1000) })]).finally(() => clearTimeout(timeout))
        if (gen !== scanGen || sourceUrl !== dsm.baseUrl || sourceAccount !== dsm.account) return
        if (cached) items.value = cached
      }
      const start = await dsm.searchStart(sourceFolder, '', true, {
        extension: extensions,
        filetype: 'file',
      })
      if (!start.success || !start.data?.taskid) {
        throw new Error('无法扫描目录，请检查 File Station 权限（' + (start.error?.code ?? '?') + '）')
      }
      taskid = start.data.taskid

      const collected: any[] = []
      let offset = 0
      const PAGE = 500
      const MAX_ITER = 400
      let finished = false
      let drained = false
      let idleRounds = 0

      // 限频刷新：扫描期间频繁 items.value = collected.slice() 会触发
      // 下游 computed (排序/分组/segments) 全量重算，大文件量时主线程持续卡顿。
      // 这里改为最多每 FLUSH_INTERVAL ms 刷新一次，扫描完成在 finally 兜底刷新。
      const FLUSH_INTERVAL = 400
      let lastFlushAt = 0
      const flush = () => {
        items.value = collected.slice()
        lastFlushAt = Date.now()
      }

      for (let iter = 0; iter < MAX_ITER; iter++) {
        if (gen !== scanGen || sourceUrl !== dsm.baseUrl || sourceAccount !== dsm.account) return
        const list: any = await dsm.searchList(taskid, {
          offset,
          limit: PAGE,
          additional: '["real_path","size","time","type","perm"]',
          // 注意：DSM Search.list 在后台扫描未完成时带 sort_by/sort_direction 会产生
          // “窗口漂移”：后扫到的新文件会插到排序阶段阶段前端，而本端 offset 持续递增，
          // 导致“被挤出窗口”的最新文件永远读不到（例如 25/26 年的照片丢失）。
          // 因此扫描阶段不传 sort，使用默认扫描顺序保证 offset 稳定、数据不漏；
          // 顺序由 finally 阶段在前端一次性排序。
        })
        if (gen !== scanGen || sourceUrl !== dsm.baseUrl || sourceAccount !== dsm.account) return
        if (!list.success) throw new Error(`读取媒体列表失败（${list.error?.code}）`)
        const d = list.data ?? {}
        const batch: any[] = d.files ?? []
        finished = d.finished === true || d.finished === 'true' || d.finished === 1

        if (batch.length > 0) {
          for (const f of batch) markRaw(f)
          const filtered = batch.filter(filterFn)
          collected.push(...filtered)
          offset += batch.length
          idleRounds = 0
          if (Date.now() - lastFlushAt >= FLUSH_INTERVAL) {
            flush()
            await new Promise<void>((r) => setTimeout(r, 0))
          }
        } else {
          idleRounds++
        }

        if (finished && batch.length === 0) { drained = true; break }
        if (batch.length === 0) {
          if (idleRounds > 240) throw new Error('扫描等待超时，当前结果可能不完整，请重试')
          await new Promise((r) => setTimeout(r, 500))
        }
      }

      if (gen !== scanGen) return
      if (!drained) throw new Error('扫描尚未完成，当前仅显示部分结果，请重试')

      // 托底：在前端按 sortBy 字段排序一次，保证 25/26 年照片位于最前。
      if (sortBy === 'crtime' || sortBy === 'mtime' || sortBy === 'atime' || sortBy === 'ctime') {
        const key = sortBy
        const dir = sortDirection === 'asc' ? 1 : -1
        collected.sort((a, b) => {
          const va = Number(a?.additional?.time?.[key] ?? 0)
          const vb = Number(b?.additional?.time?.[key] ?? 0)
          return (va - vb) * dir
        })
      } else if (sortBy === 'name') {
        const dir = sortDirection === 'asc' ? 1 : -1
        collected.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')) * dir)
      } else if (sortBy === 'size') {
        const dir = sortDirection === 'asc' ? 1 : -1
        collected.sort((a, b) => (Number(a?.additional?.size ?? 0) - Number(b?.additional?.size ?? 0)) * dir)
      }
      
      // A first empty task can race DSM indexing/session recovery. Confirm automatically
      // before replacing a cached library with an empty result. Keep retries bounded.
      if (automatic && collected.length === 0 && attempt < 2) { retry = true; return }
      // 兑底：确保最后一批数据可见（排序后重新 flush）
      items.value = collected.slice()

      void writeMediaCache(cacheKey, collected)
      if (!automatic) ElMessage.success(`扫描完成：${items.value.length} 个文件`)
    } catch (e: any) {
      if (gen === scanGen) {
        scanError.value = '扫描未完成：' + (e?.message ?? e)
        retry = automatic && attempt < 2
        if (!retry) ElMessage.error(scanError.value)
      }
    } finally {
      if (taskid && sourceUrl === dsm.baseUrl && sourceAccount === dsm.account) void dsm.searchStop(taskid).catch(() => {})
      if (gen === scanGen) {
        if (retry && active) {
          scanError.value = ''
          retryTimer = setTimeout(() => {
            if (active && gen === scanGen && sourceUrl === dsm.baseUrl && sourceAccount === dsm.account && sourceFolder === folder.value) void runScan(true, attempt + 1)
          }, attempt === 0 ? 1200 : 3000)
        } else loading.value = false
      }
    }
  }

  function onPickFolder(p: string) {
    if (folder.value !== p) items.value = []
    folder.value = p
    try { localStorage.setItem(storageKey(), p) } catch {}
    scan()
  }

  function onBaseUrlChange() {
    try {
      const saved = localStorage.getItem(storageKey())
      folder.value = saved ?? ''
      items.value = []
      visibleCount.value = visibleInit
      if (saved) scan()
    } catch {}
  }

  const visibleItems = computed(() => items.value.slice(0, visibleCount.value))

  return {
    folder,
    loading,
    scanError,
    items,
    visibleCount,
    visibleItems,
    sentinel,
    scan,
    onPickFolder,
    onBaseUrlChange,
    initFromStorage,
    setupSentinel,
    cleanup,
  }
}
