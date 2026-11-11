<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dsm } from '../api/dsm'
import { formatBytes } from '../utils/format'
import { useMediaScan } from '../composables/useMediaScan'
import { enqueue as enqueueDownload } from '../composables/useDownloadQueue'
import FolderPicker from '../components/FolderPicker.vue'
import LazyThumb from '../components/LazyThumb.vue'
import PhotoViewer from '../components/PhotoViewer.vue'
import { useIsMobile } from '../composables/useIsMobile'
import { useBackHandler } from '../composables/useInteractiveSwipeBack'
import { confirm, toast } from '../utils/feedback'

const isMobile = useIsMobile()

const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'])

function isImage(f: any): boolean {
  if (f.isdir) return false
  const name = (f.name as string) || ''
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return IMG_EXT.has(ext)
}

const {
  folder, loading, scanError, items: photos,
  scan, onPickFolder,
} = useMediaScan({
  extensions: 'jpg,jpeg,png,gif,webp,bmp,heic,heif',
  filterFn: isImage,
  visibleInit: 120,
  visibleStep: 120,
  storageKeyPrefix: 'album:folder',
  firstPagePreview: 48,
})

const viewerOpen = ref(false)
const viewerIndex = ref(0)
const previewPhotos = shallowRef<any[]>([])
const pickerOpen = ref(false)

const scrollEl = ref<HTMLElement | null>(null)
const containerWidth = ref(0)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const floatingDateVisible = ref(false)
let floatingDateTimer: ReturnType<typeof setTimeout> | null = null
let rafId: number | null = null
let resizeObserver: ResizeObserver | null = null

const GAP = 4
const HEADER_HEIGHT = 40
const BUFFER = computed(() => isMobile.value ? cellSize.value * 2 : 800)

// 移动端用更小的格子
const MIN_COL_WIDTH = computed(() => isMobile.value ? 110 : 140)

const colCount = computed(() => {
  if (containerWidth.value <= 0) return 1
  return Math.max(isMobile.value ? 3 : 1, Math.floor((containerWidth.value + GAP) / (MIN_COL_WIDTH.value + GAP)))
})

const cellSize = computed(() => {
  if (containerWidth.value <= 0) return MIN_COL_WIDTH.value
  return (containerWidth.value - (colCount.value - 1) * GAP) / colCount.value
})

const timeCache = new WeakMap<object, number>()
const dateCache = new WeakMap<object, string>()
const thumbCache = new WeakMap<object, string>()

function parseNameTime(name: string): number {
  if (!name) return 0
  const m = name.match(/(19|20)(\d{2})[-_]?(\d{2})[-_]?(\d{2})(?:[\s_\-T]?(\d{2})[\.\-:]?(\d{2})(?:[\.\-:]?(\d{2}))?)?/)
  if (!m) return 0
  const y = Number(m[1] + m[2])
  const mo = Number(m[3])
  const d = Number(m[4])
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return 0
  const hh = Number(m[5] ?? '0')
  const mi = Number(m[6] ?? '0')
  const ss = Number(m[7] ?? '0')
  const t = new Date(y, mo - 1, d, hh, mi, ss).getTime()
  if (isNaN(t)) return 0
  return Math.floor(t / 1000)
}

function photoTime(p: any): number {
  const cached = timeCache.get(p)
  if (cached !== undefined) return cached
  let t = Number(p?.additional?.time?.crtime ?? 0)
  if (!t) t = Number(p?.additional?.time?.mtime ?? 0)
  if (!t) t = parseNameTime(p?.name || '')
  timeCache.set(p, t)
  return t
}

function dateLabel(p: any): string {
  const cached = dateCache.get(p)
  if (cached !== undefined) return cached
  const t = photoTime(p)
  const label = !t
    ? '未知日期'
    : (() => {
        const d = new Date(t * 1000)
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
      })()
  dateCache.set(p, label)
  return label
}

const flatPhotos = computed(() => [...photos.value].sort((a, b) => photoTime(b) - photoTime(a) || String(a.path).localeCompare(String(b.path))))

type Segment =
  | { type: 'header'; key: string; date: string; count: number; offset: number; height: number }
  | { type: 'row'; key: string; photos: any[]; offset: number; height: number }

const segments = computed<Segment[]>(() => {

  const cols = colCount.value
  const cell = cellSize.value
  const all = flatPhotos.value
  if (!all.length || cell <= 0) return []

  const groups: { date: string; photos: any[] }[] = []
  let curDate = ''
  for (const p of all) {
    const d = dateLabel(p)
    if (d !== curDate) {
      curDate = d
      groups.push({ date: d, photos: [] })
    }
    groups[groups.length - 1].photos.push(p)
  }

  const segs: Segment[] = []
  let offset = 0
  for (const g of groups) {
    segs.push({
      type: 'header',
      key: `h-${g.date}`,
      date: g.date,
      count: g.photos.length,
      offset,
      height: HEADER_HEIGHT,
    })
    offset += HEADER_HEIGHT

    for (let i = 0; i < g.photos.length; i += cols) {
      const row = g.photos.slice(i, i + cols)
      segs.push({
        type: 'row',
        key: `r-${row[0].path}`,
        photos: row,
        offset,
        height: cell,
      })
      offset += cell + GAP
    }
  }
  return segs
})

const totalHeight = computed(() => {
  const s = segments.value
  if (!s.length) return 0
  const last = s[s.length - 1]
  return last.offset + last.height
})

const visibleSegments = computed(() => {
  const top = scrollTop.value - BUFFER.value
  const bottom = scrollTop.value + viewportHeight.value + BUFFER.value
  const rows = segments.value
  let lo = 0, hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (rows[mid].offset + rows[mid].height <= top) lo = mid + 1
    else hi = mid
  }
  let end = lo
  while (end < rows.length && rows[end].offset < bottom) end++
  return rows.slice(lo, end)
})

const headerSegs = computed(() =>
  segments.value.filter((s): s is Extract<Segment, { type: 'header' }> => s.type === 'header'),
)

const floatingDate = computed(() => {
  const target = scrollTop.value + 60
  const hs = headerSegs.value
  if (!hs.length) return ''
  let lo = 0, hi = hs.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (hs[mid].offset <= target) {
      idx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return idx >= 0 ? hs[idx].date : ''
})

function onScroll() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    if (!scrollEl.value) return
    scrollTop.value = scrollEl.value.scrollTop

    floatingDateVisible.value = true
    if (floatingDateTimer) clearTimeout(floatingDateTimer)
    floatingDateTimer = setTimeout(() => {
      floatingDateVisible.value = false
    }, 1500)
  })
}

function measure() {
  if (!scrollEl.value) return
  containerWidth.value = scrollEl.value.clientWidth
  viewportHeight.value = scrollEl.value.clientHeight
  scrollTop.value = scrollEl.value.scrollTop
}
watch(scrollEl, element => {
  resizeObserver?.disconnect()
  if (!element) return
  resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(element)
  measure()
}, { flush: 'post' })
onActivated(measure)
watch(folder, () => {
  if (scrollEl.value) scrollEl.value.scrollTop = 0
  scrollTop.value = 0
  viewerOpen.value = false
  mPreviewOpen.value = false
})
watch(totalHeight, () => {
  if (!scrollEl.value) return
  const top = Math.max(0, Math.min(scrollTop.value, totalHeight.value - viewportHeight.value))
  scrollEl.value.scrollTop = top
  scrollTop.value = top
}, { flush: 'post' })

function thumbOf(p: any) {
  const cached = thumbCache.get(p)
  if (cached) return cached
  const u = dsm.mediaUrl('thumb', p.path, { size: 'small', ...imageRevision(p) })
  thumbCache.set(p, u)
  return u
}
function imageRevision(p: any): Record<string, string> {
  const time = p.additional?.time
  // Without metadata, do not persist an unversioned copy of a mutable file.
  return time?.mtime ? { revision: JSON.stringify([time.mtime, time.ctime ?? 0, p.additional?.size ?? p.size ?? 0]) } : {}
}
function fullOf(p: any) {
  return dsm.mediaUrl('image', p.path, imageRevision(p))
}
function fallbackOf(p: any) {
  const size = Number(p.additional?.size ?? 0)
  return size <= 64 * 1024 * 1024 && !/\.hei[cf]$/i.test(p.name) ? dsm.mediaUrl('image', p.path) : ''
}

// 移动端图片预览状态（组件式，比 showImagePreview 命令式更可控）
const mPreviewOpen = ref(false)
const mPreviewIndex = ref(0)
const mPreviewStart = ref(0)
const previewUrls = ref<Record<string, string>>({})
const mPreviewImages = computed(() => previewPhotos.value.map(p => previewUrls.value[p.path] || ''))
const mPreviewError = ref('')
const mPreviewLoading = ref(false)
const mPreviewRetry = ref(0)
let mobileRequest: AbortController | null = null
let mobileGeneration = 0
function releaseMobilePreview() {
  mobileRequest?.abort()
  for (const url of Object.values(previewUrls.value)) URL.revokeObjectURL(url)
  previewUrls.value = {}
}
onBeforeUnmount(releaseMobilePreview)
watch([mPreviewOpen, mPreviewIndex, previewPhotos, mPreviewRetry], async () => {
  const generation = ++mobileGeneration
  mobileRequest?.abort()
  mPreviewError.value = ''
  mPreviewLoading.value = false
  if (!mPreviewOpen.value) { releaseMobilePreview(); return }
  const index = mPreviewIndex.value
  const photo = previewPhotos.value[index]
  if (!photo) return
  const keep = new Set(previewPhotos.value.slice(Math.max(0, index - 1), index + 2).map(p => p.path))
  for (const [path, url] of Object.entries(previewUrls.value)) {
    if (!keep.has(path)) { URL.revokeObjectURL(url); delete previewUrls.value[path] }
  }
  if (previewUrls.value[photo.path]) return
  const controller = new AbortController()
  mobileRequest = controller
  const timeout = setTimeout(() => controller.abort(), 45000)
  mPreviewLoading.value = true
  try {
    const blob = await dsm.mediaImageBlob(fullOf(photo), controller.signal)
    if (generation === mobileGeneration && mPreviewOpen.value) previewUrls.value[photo.path] = URL.createObjectURL(blob)
  } catch (error: any) {
    if (generation === mobileGeneration) mPreviewError.value = error?.name === 'MediaError' ? error.message : '图片读取失败或超时，请重试'
  } finally {
    clearTimeout(timeout)
    if (generation === mobileGeneration) mPreviewLoading.value = false
  }
})

function openPhoto(p: any) {
  const idx = flatPhotos.value.findIndex((x) => x.path === p.path)
  if (idx < 0) return
  previewPhotos.value = flatPhotos.value
  if (isMobile.value) {

    mPreviewStart.value = idx
    mPreviewIndex.value = idx
    mPreviewOpen.value = true
  } else {
    viewerIndex.value = idx
    viewerOpen.value = true
  }
}
function prev() { if (viewerIndex.value > 0) viewerIndex.value-- }
function next() { if (viewerIndex.value < previewPhotos.value.length - 1) viewerIndex.value++ }

function onViewerKey(e: KeyboardEvent) {
  if (document.querySelector('.el-message-box')) return
  if (['ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault()
  if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
  else if (e.key === 'Escape') viewerOpen.value = false
}

async function viewerDownload() {
  const p = previewPhotos.value[viewerIndex.value]
  if (!p) return
  try {
    const size = Number((p as any).additional?.size || (p as any).size || 0)
    await enqueueDownload(p.path, p.name, size)
  } catch (e: any) {
    ElMessage.error('下载失败：' + (e?.message ?? e))
  }
}

async function viewerDelete() {
  const p = previewPhotos.value[viewerIndex.value]
  if (!p) return
  try {
    await ElMessageBox.confirm(`确定删除「${p.name}」？`, '删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    const res = await dsm.deletePath(p.path)
    if (res.success) {
      ElMessage.success('已删除')
      photos.value = photos.value.filter((x: any) => x.path !== p.path)
      previewPhotos.value = previewPhotos.value.filter((x: any) => x.path !== p.path)
      if (viewerIndex.value >= previewPhotos.value.length) {
        viewerIndex.value = Math.max(0, previewPhotos.value.length - 1)
      }
      if (!previewPhotos.value.length) viewerOpen.value = false
    } else {
      ElMessage.error(`删除失败 code=${res.error?.code}`)
    }
  } catch {}
}

watch(viewerOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', onViewerKey)
  } else {
    window.removeEventListener('keydown', onViewerKey)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onViewerKey)
  resizeObserver?.disconnect()
  if (rafId !== null) cancelAnimationFrame(rafId)
  if (floatingDateTimer) clearTimeout(floatingDateTimer)
})

// 移动端：选择目录后自动开扫
async function onMobilePickFolder(p: string) {
  onPickFolder(p)
}

// 移动端图片预览的删除/下载（操作当前预览中的图）
async function mDeleteCurrent() {
  const p = previewPhotos.value[mPreviewIndex.value]
  if (!p) return
  const ok = await confirm(`确定删除「${p.name}」？`, '删除', { danger: true, confirmText: '删除' })
  if (!ok) return
  const res = await dsm.deletePath(p.path)
  if (res.success) {
    toast('已删除', 'success')
    photos.value = photos.value.filter((x: any) => x.path !== p.path)
      previewPhotos.value = previewPhotos.value.filter((x: any) => x.path !== p.path)

    if (mPreviewIndex.value >= previewPhotos.value.length) {
      mPreviewIndex.value = Math.max(0, previewPhotos.value.length - 1)
    }
    if (!previewPhotos.value.length) mPreviewOpen.value = false
  } else {
    toast(`删除失败 code=${res.error?.code}`, 'error')
  }
}

async function mDownloadCurrent() {
  const p = previewPhotos.value[mPreviewIndex.value]
  if (!p) return
  const size = Number((p as any).additional?.size || (p as any).size || 0)
  await enqueueDownload(p.path, p.name, size)
}

// 侧滑返回：预览打开时优先关预览
useBackHandler(() => {
  if (!isMobile.value) return false
  if (mPreviewOpen.value) { mPreviewOpen.value = false; return true }
  if (pickerOpen.value) { pickerOpen.value = false; return true }
  return false
})
</script>

<template>
  <!-- 桌面端 -->
  <div v-if="!isMobile" class="page">
    <header class="topbar">
      <h2 class="title">相册</h2>
      <div class="actions">
        <el-button @click="pickerOpen = true">
          <el-icon style="margin-right:4px"><Folder /></el-icon>
          {{ folder ? '切换目录' : '选择目录' }}
        </el-button>
        <el-button type="primary" :loading="loading" :disabled="!folder" @click="scan">扫描</el-button>
      </div>
    </header>
    <div class="folder-bar" v-if="folder">
      <el-icon><Document /></el-icon>
      <span class="folder-path">{{ folder }}</span>
      <span class="count">共 {{ photos.length }} 张</span>
    </div>

    <div v-if="loading" class="scan-status" role="status">正在更新相册，已发现 {{ photos.length }} 张，已有照片可继续浏览…</div>
    <div v-if="scanError" class="scan-status" role="alert">{{ scanError }} <button @click="scan">重试扫描</button></div>
    <main ref="scrollEl" class="body" @scroll="onScroll">
      <div v-if="!folder" class="empty">
        <el-icon :size="64" color="#c0c4cc"><Picture /></el-icon>
        <div style="margin-top:12px">请选择要浏览的图片目录</div>
        <el-button type="primary" style="margin-top:16px" @click="pickerOpen = true">选择目录</el-button>
      </div>
      <div v-else-if="!photos.length && !loading" class="empty">
        <el-icon :size="64" color="#c0c4cc"><Picture /></el-icon>
        <div style="margin-top:12px">此目录暂无图片</div>
      </div>

      <template v-else>


        <div
          v-if="floatingDate && floatingDateVisible && scrollTop > HEADER_HEIGHT"
          class="floating-date"
        ><span>{{ floatingDate }}</span></div>

        <div class="virtual-spacer" :style="{ height: totalHeight + 'px' }">
          <template v-for="seg in visibleSegments" :key="seg.key">
            <div
              v-if="seg.type === 'header'"
              class="date-title"
              :style="{ position: 'absolute', top: seg.offset + 'px', width: '100%' }"
            >
              <el-icon><Calendar /></el-icon>
              <span>{{ (seg as any).date }}</span>
              <span class="date-count">{{ (seg as any).count }}</span>
            </div>
            <div
              v-else
              class="virtual-row"
              :style="{ position: 'absolute', top: seg.offset + 'px', width: '100%', height: cellSize + 'px' }"
            >
              <div
                v-for="p in (seg as any).photos"
                :key="p.path"
                class="cell"
                :style="{ width: cellSize + 'px', height: cellSize + 'px' }"
                @click="openPhoto(p)"
                :title="p.name"
              >
                <LazyThumb :src="thumbOf(p)" :fallback-src="fallbackOf(p)" :alt="p.name" aspect-ratio="1/1">
                  <template #fallback>
                    <el-icon :size="32"><Picture /></el-icon>
                  </template>
                </LazyThumb>
              </div>
            </div>
          </template>
        </div>

        <div class="bottom-stat" v-if="flatPhotos.length > 0">
          共 {{ flatPhotos.length }} 张照片
        </div>
      </template>
    </main>

    <PhotoViewer v-model="viewerOpen"
      :src="previewPhotos[viewerIndex] ? fullOf(previewPhotos[viewerIndex]) : ''"
      :name="previewPhotos[viewerIndex]?.name || ''" :index="viewerIndex" :total="previewPhotos.length"
      :size="formatBytes(previewPhotos[viewerIndex]?.additional?.size || 0)"
      :date="previewPhotos[viewerIndex] && photoTime(previewPhotos[viewerIndex]) ? new Date(photoTime(previewPhotos[viewerIndex]) * 1000).toLocaleString() : ''"
      @prev="prev" @next="next" @download="viewerDownload" @delete="viewerDelete" />

    <FolderPicker v-model="pickerOpen" :initial="folder" title="选择相册目录" @confirm="onPickFolder" />
  </div>

  <!-- 移动端 -->
  <div v-else class="m-album">
    <header class="m-album-head">
      <div class="album-heading"><h2>照片</h2><span v-if="folder">{{ photos.length.toLocaleString() }} 张</span></div>
      <div class="album-tools">
        <button class="album-source" @click="pickerOpen = true" :title="folder"><van-icon name="folder-o" /><span>{{ folder || '选择目录' }}</span><van-icon name="arrow-down" /></button>
        <button v-if="folder" class="album-refresh" :disabled="loading" @click="scan" aria-label="刷新相册"><van-loading v-if="loading" size="16" /><van-icon v-else name="replay" /></button>
      </div>
    </header>
    <div v-if="loading && !photos.length" class="scan-status" role="status">正在读取照片…</div>
    <div v-if="scanError" class="scan-status" role="alert">{{ scanError }} <button @click="scan">重试扫描</button></div>
    <main ref="scrollEl" class="m-album-body" @scroll="onScroll">
      <van-empty v-if="!folder" image="search" description="请选择要浏览的图片目录">
        <van-button round type="primary" @click="pickerOpen = true">选择目录</van-button>
      </van-empty>
      <van-empty v-else-if="!photos.length && !loading" image="default" description="此目录暂无图片" />

      <template v-else>


        <div
          v-if="floatingDate && floatingDateVisible && scrollTop > HEADER_HEIGHT"
          class="floating-date"
        ><span>{{ floatingDate }}</span></div>

        <div class="virtual-spacer" :style="{ height: totalHeight + 'px' }">
          <template v-for="seg in visibleSegments" :key="seg.key">
            <div
              v-if="seg.type === 'header'"
              class="m-date-title"
              :style="{ position: 'absolute', top: seg.offset + 'px', width: '100%' }"
            >
              <span>{{ (seg as any).date }}</span>
              <span class="m-date-count">{{ (seg as any).count }} 张</span>
            </div>
            <div
              v-else
              class="virtual-row"
              :style="{ position: 'absolute', top: seg.offset + 'px', width: '100%', height: cellSize + 'px' }"
            >
              <div
                v-for="p in (seg as any).photos"
                :key="p.path"
                class="m-cell"
                :style="{ width: cellSize + 'px', height: cellSize + 'px' }"
                @click="openPhoto(p)"
              >
                <LazyThumb root-margin="100px" :src="thumbOf(p)" :fallback-src="fallbackOf(p)" :alt="p.name" aspect-ratio="1/1">
                  <template #placeholder><span class="photo-placeholder" role="img" :aria-label="p.name + ' 加载中'"></span></template>
                  <template #fallback>
                    <van-icon name="photo-o" size="28" color="#c0c4cc" />
                  </template>
                </LazyThumb>
              </div>
            </div>
          </template>
        </div>

        <div class="m-bottom-stat" v-if="flatPhotos.length > 0">
          共 {{ flatPhotos.length }} 张照片
        </div>
      </template>
    </main>

    <FolderPicker v-model="pickerOpen" :initial="folder" title="选择相册目录" @confirm="onMobilePickFolder" />

    <!-- 移动端图片预览 -->
    <van-image-preview v-model:show="mPreviewOpen" :images="mPreviewImages" :start-position="mPreviewStart"
      closeable show-index @change="mPreviewIndex = $event">
      <template #cover>
        <div class="m-preview-actions" :style="{ paddingBottom: 'calc(var(--sl-safe-bottom) + 16px)' }">
          <span v-if="mPreviewLoading" style="color: white">正在读取原图…</span>
          <span v-if="mPreviewError" style="color: white">{{ mPreviewError }}</span>
          <van-button v-if="mPreviewError" size="small" @click.stop="mPreviewRetry++">重新请求</van-button>
          <van-button size="small" round icon="down" @click.stop="mDownloadCurrent">下载</van-button>
          <van-button size="small" round icon="delete-o" type="danger" plain @click.stop="mDeleteCurrent">删除</van-button>
        </div>
      </template>
    </van-image-preview>


  </div>
</template>

<style scoped>

/* Desktop */
.scan-status { padding: 8px 12px; flex-shrink: 0; font-size: 12px; color: var(--el-text-color-secondary); }
.page {
  display: flex; flex-direction: column; height: 100%;
  padding: 20px 24px 0; max-width: 1400px; margin: 0 auto;
}
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 0 16px;
  border-bottom: var(--sl-border); margin-bottom: 16px; flex-shrink: 0;
}
.title { margin: 0; font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); }
.actions { display: flex; gap: 8px; }
.folder-bar {
  display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--el-text-color-secondary);
  background: var(--sl-bg-card); border-radius: var(--sl-radius-sm); padding: 8px 12px; margin-bottom: 12px;
  border: var(--sl-border); flex-shrink: 0;
}
.folder-path { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count { color: var(--sl-primary); font-weight: 600; }
.body { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; min-height: 0; }
.empty { text-align: center; padding: 48px 0; color: var(--el-text-color-secondary); font-size: 13px; }
.scan-progress { text-align: center; padding: 64px 0; color: var(--el-text-color-secondary); font-size: 14px; }
.scan-progress .hint { margin-top: 6px; font-size: 12px; color: var(--el-text-color-placeholder); }
.floating-date {
  position: sticky; top: 8px; z-index: 10;
  display: inline-block; background: rgba(0, 0, 0, 0.65); color: #fff;
  font-size: 12px; font-weight: 600; padding: 4px 14px; border-radius: 20px;
  pointer-events: none; margin-left: 50%; transform: translateX(-50%);
  backdrop-filter: blur(8px); transition: opacity 0.3s;
}
.virtual-spacer { position: relative; width: 100%; }
.date-title {
  display: flex; align-items: center; gap: 6px; padding: 6px 0;
  font-size: 11px; font-weight: 600; color: var(--el-text-color-secondary);
  text-transform: uppercase; letter-spacing: 0.05em; box-sizing: border-box;
}
.date-count { margin-left: 6px; font-size: 11px; color: var(--el-text-color-placeholder); font-weight: 400; }
.virtual-row { display: flex; gap: 4px; }
.cell {
  cursor: pointer; border-radius: var(--sl-radius-sm); overflow: hidden;
  background: var(--el-fill-color); flex-shrink: 0;
  transition: opacity var(--sl-transition-fast);
}
.cell:hover { opacity: 0.85; }
.cell:active { opacity: 0.7; }
.bottom-stat { text-align: center; padding: 16px 0; font-size: 12px; color: var(--el-text-color-secondary); }
/* Mobile */
.m-album {
  height: 100%;
  display: flex; flex-direction: column;
}
.m-album-head {
  display: flex; align-items: center;
  padding: 10px 16px;
  background: var(--sl-bg-card);
  border-bottom: var(--sl-border);
}
.m-album-folder {
  flex: 1; display: flex; align-items: center; gap: 6px;
  font-size: 14px; color: var(--el-text-color-primary);
  min-width: 0;
}
.m-album-folder-text {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 220px;
}
.m-album-count { font-size: 12px; color: var(--el-text-color-secondary); }
.m-album-body {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  position: relative; min-height: 0;
  -webkit-overflow-scrolling: touch;
}
.m-scan-progress {
  text-align: center; padding: 40px 0;
  color: var(--el-text-color-secondary); font-size: 13px;
}
.m-date-title {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary);
  box-sizing: border-box;
  background: var(--sl-bg-page);
}
.m-date-count { font-size: 11px; color: var(--el-text-color-placeholder); font-weight: 400; }
.m-cell {
  border-radius: 4px; overflow: hidden;
  background: var(--el-fill-color); flex-shrink: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.m-cell:active { opacity: 0.7; }
.m-preview-actions {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  display: flex; justify-content: center; gap: 12px;
  padding: 16px;
  z-index: 2;
}
.m-bottom-stat {
  text-align: center; padding: 16px 0 80px;
  font-size: 12px; color: var(--el-text-color-secondary);
}

.m-album { padding: 0 12px; background: var(--el-bg-color); }
.m-album-head { padding: 10px 2px; gap: 12px; border-bottom: 1px solid var(--el-border-color-lighter); background: transparent; flex-wrap: wrap; justify-content: space-between; }
.album-heading,.album-tools { display:flex; align-items:center; gap:8px; min-width:0; }
.album-heading h2 { font-size:24px; margin:0; letter-spacing:-.04em; }
.album-heading span,.m-date-count { color:var(--el-text-color-secondary); font-size:12px; }
.album-tools { max-width:100%; }
.album-tools button { border:0; background:var(--el-fill-color-light); color:var(--el-text-color-regular); border-radius:12px; height:40px; padding:0 12px; display:flex; align-items:center; justify-content:center; gap:7px; }
.album-source span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width:32vw; }
.m-date-title { padding:0 2px; height:40px; background:transparent; font-size:14px; color:var(--el-text-color-primary); }
.m-date-count { margin-left:auto; }
.m-cell { border-radius:9px; }
.m-album .floating-date { position:sticky; display:block; width:max-content; height:0; padding:0; background:none; backdrop-filter:none; }
.m-album .floating-date span { background:#232832e0; border-radius:18px; padding:5px 12px; }
.photo-placeholder { width:100%; height:100%; background:linear-gradient(145deg,var(--el-fill-color-light),var(--el-fill-color)); }
</style>
