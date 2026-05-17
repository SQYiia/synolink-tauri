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
}

export function useMediaScan(opts: UseMediaScanOptions) {
  const {
    extensions,
    filterFn,
    visibleInit = 120,
    visibleStep = 120,
    storageKeyPrefix,
  } = opts

  const router = useRouter()
  const folder = ref('')
  const loading = ref(false)
  const items = shallowRef<any[]>([])
  const visibleCount = ref(visibleInit)
  const sentinel = ref<HTMLElement | null>(null)
  let sentinelObserver: IntersectionObserver | null = null
  let scanGen = 0

  function storageKey() { return `${storageKeyPrefix}:${dsm.baseUrl}` }

  function initFromStorage() {
    if (!dsm.sid) {
      router.replace('/servers')
      return false
    }
    try {
      const saved = localStorage.getItem(storageKey())
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
      const MAX_FILES = 3000
      const MAX_ITER = 400
      let finished = false
      let idleRounds = 0

      for (let iter = 0; iter < MAX_ITER; iter++) {
        if (gen !== scanGen) return
        const list: any = await dsm.searchList(taskid, {
          offset,
          limit: PAGE,
          additional: '["real_path","size","time","type","perm"]',
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
          items.value = collected.slice()
          if (collected.length >= MAX_FILES) { finished = true; break }
          idleRounds = 0
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
        } else {
          idleRounds++
        }

        if (finished && batch.length === 0) break
        if (batch.length === 0) {
          if (idleRounds > 20) break
          await new Promise((r) => setTimeout(r, 500))
        }
      }

      const truncated = collected.length >= MAX_FILES
      ElMessage.success(truncated ? `已加载前 ${items.value.length} 个文件（目录文件过多）` : `扫描完成：${items.value.length} 个文件`)
    } catch (e: any) {
      ElMessage.error('扫描出错: ' + (e?.message ?? e))
    } finally {
      if (taskid) await dsm.searchStop(taskid).catch(() => {})
      loading.value = false
    }
  }

  function onPickFolder(p: string) {
    folder.value = p
    try { localStorage.setItem(storageKey(), p) } catch {}
    scan()
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
    initFromStorage,
    setupSentinel,
    cleanup,
  }
}
