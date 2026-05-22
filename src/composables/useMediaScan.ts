import { computed, ref, shallowRef, markRaw, nextTick } from 'vue'
import { useRouter } from 'vue-router'
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

  const router = useRouter()
  const folder = ref('')
  const loading = ref(false)
  const items = shallowRef<any[]>([])
  const visibleCount = ref(visibleInit)
  const sentinel = ref<HTMLElement | null>(null)
  let sentinelObserver: IntersectionObserver | null = null
  let scanGen = 0

  const STORAGE_KEY = computed(() => `${storageKeyPrefix}:${dsm.baseUrl}`)

  function initFromStorage() {
    if (!dsm.sid) {
      router.replace('/servers')
      return false
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY.value)
      if (saved) {
        folder.value = saved
        return true
      }
    } catch {}
    return false
  }

  function setupSentinel() {
    nextTick(() => {
      if (!sentinel.value) return
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
    sentinelObserver?.disconnect()
    sentinelObserver = null
  }

  async function scan() {
    if (!folder.value) return
    loading.value = true
    items.value = []
    visibleCount.value = visibleInit
    scanGen++
    const gen = scanGen
    let taskid = ''
    try {
      const start = await dsm.searchStart(folder.value, '', true, {
        extension: extensions,
        filetype: 'file',
      })
      if (!start.success || !start.data?.taskid) {
        ElMessage.error('启动扫描失败 (code=' + (start.error?.code ?? '?') + ')')
        return
      }
      taskid = start.data.taskid

      const collected: any[] = []
      let offset = 0
      const PAGE = 500
      const MAX_ITER = 400
      let finished = false
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
        if (gen !== scanGen) return
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
        if (!list.success) break
        const d = list.data ?? {}
        const batch: any[] = d.files ?? []
        finished = !!d.finished

        if (batch.length > 0) {
          for (const f of batch) markRaw(f)
          const filtered = batch.filter(filterFn)
          collected.push(...filtered)
          offset += batch.length
          idleRounds = 0
          if (Date.now() - lastFlushAt >= FLUSH_INTERVAL) {
            flush()
            await new Promise<void>((r) => requestAnimationFrame(() => r()))
          }
        } else {
          idleRounds++
        }

        if (finished && batch.length === 0) break
        if (batch.length === 0) {
          if (idleRounds > 20) break
          await new Promise((r) => setTimeout(r, 500))
        }
      }

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
      
      // 兑底：确保最后一批数据可见（排序后重新 flush）
      items.value = collected.slice()

      ElMessage.success(`扫描完成：${items.value.length} 个文件`)
    } catch (e: any) {
      ElMessage.error('扫描出错: ' + (e?.message ?? e))
    } finally {
      if (taskid) await dsm.searchStop(taskid).catch(() => {})
      loading.value = false
    }
  }

  function onPickFolder(p: string) {
    folder.value = p
    try { localStorage.setItem(STORAGE_KEY.value, p) } catch {}
    scan()
  }

  function onBaseUrlChange() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY.value)
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
