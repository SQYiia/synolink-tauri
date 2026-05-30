<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dsm } from '../api/dsm'
import { formatBytes } from '../utils/format'
import { useMediaScan } from '../composables/useMediaScan'
import { enqueue as enqueueDownload } from '../composables/useDownloadQueue'
import FolderPicker from '../components/FolderPicker.vue'
import LazyThumb from '../components/LazyThumb.vue'
import { useIsMobile } from '../composables/useIsMobile'
import { useBackHandler } from '../composables/useInteractiveSwipeBack'
import { confirm, toast } from '../utils/feedback'

const isMobile = useIsMobile()

const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'])

function isImage(f: any): boolean {
  if (f.isdir) return false
  const name = (f.name as string) || ''
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return IMG_EXT.has(ext)
}

const {
  folder, loading, items: photos,
  scan, onPickFolder, onBaseUrlChange, initFromStorage,
} = useMediaScan({
  extensions: 'jpg,jpeg,png,gif,webp,bmp,heic',
  filterFn: isImage,
  visibleInit: 120,
  visibleStep: 120,
  storageKeyPrefix: 'album:folder',
  sortBy: 'crtime',
  sortDirection: 'desc',
})

const viewerOpen = ref(false)
const viewerIndex = ref(0)
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
const HEADER_HEIGHT = 32
const BUFFER = 1000

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

const flatPhotos = computed(() => photos.value)

type Segment =
  | { type: 'header'; key: string; date: string; count: number; offset: number; height: number }
  | { type: 'row'; key: string; photos: any[]; offset: number; height: number }

const segments = computed<Segment[]>(() => {
  if (loading.value) return []

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
  const top = scrollTop.value - BUFFER
  const bottom = scrollTop.value + viewportHeight.value + BUFFER
  return segments.value.filter(
    (s) => s.offset + s.height > top && s.offset < bottom,
  )
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

onMounted(() => {
  const hasFolder = initFromStorage()
  if (hasFolder) scan()

  if (scrollEl.value) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth.value = entry.contentRect.width
        viewportHeight.value = entry.contentRect.height
      }
    })
    resizeObserver.observe(scrollEl.value)
    containerWidth.value = scrollEl.value.clientWidth
    viewportHeight.value = scrollEl.value.clientHeight
  }
})

watch(() => dsm.baseUrl, () => { onBaseUrlChange() })

function thumbOf(p: any) {
  const cached = thumbCache.get(p)
  if (cached) return cached
  const u = dsm.mediaUrl('thumb', p.path, { size: 'small' })
  thumbCache.set(p, u)
  return u
}
function fullOf(p: any) {
  return dsm.mediaUrl('stream', p.path)
}
function onFullError(p: any) { p._fullFailed = true }

// 移动端图片预览状态（组件式，比 showImagePreview 命令式更可控）
const mPreviewOpen = ref(false)
const mPreviewImages = ref<string[]>([])
const mPreviewIndex = ref(0)

function openPhoto(p: any) {
  const idx = flatPhotos.value.findIndex((x) => x.path === p.path)
  if (idx < 0) return
  if (isMobile.value) {
    mPreviewImages.value = flatPhotos.value.map((x: any) => fullOf(x))
    mPreviewIndex.value = idx
    mPreviewOpen.value = true
  } else {
    viewerIndex.value = idx
    viewerOpen.value = true
  }
}
function prev() { if (viewerIndex.value > 0) viewerIndex.value-- }
function next() { if (viewerIndex.value < flatPhotos.value.length - 1) viewerIndex.value++ }

function onViewerKey(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
  else if (e.key === 'Escape') viewerOpen.value = false
}

async function viewerDownload() {
  const p = flatPhotos.value[viewerIndex.value]
  if (!p) return
  try {
    const size = Number((p as any).additional?.size || (p as any).size || 0)
    enqueueDownload(p.path, p.name, size)
    ElMessage.success('已加入下载队列')
  } catch (e: any) {
    ElMessage.error('下载失败：' + (e?.message ?? e))
  }
}

async function viewerDelete() {
  const p = flatPhotos.value[viewerIndex.value]
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
      if (viewerIndex.value >= flatPhotos.value.length) {
        viewerIndex.value = Math.max(0, flatPhotos.value.length - 1)
      }
      if (!flatPhotos.value.length) viewerOpen.value = false
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
  await scan()
}

// 移动端图片预览的删除/下载（操作当前预览中的图）
async function mDeleteCurrent() {
  const p = flatPhotos.value[mPreviewIndex.value]
  if (!p) return
  const ok = await confirm(`确定删除「${p.name}」？`, '删除', { danger: true, confirmText: '删除' })
  if (!ok) return
  const res = await dsm.deletePath(p.path)
  if (res.success) {
    toast('已删除', 'success')
    photos.value = photos.value.filter((x: any) => x.path !== p.path)
    mPreviewImages.value = flatPhotos.value.map((x: any) => fullOf(x))
    if (mPreviewIndex.value >= mPreviewImages.value.length) {
      mPreviewIndex.value = Math.max(0, mPreviewImages.value.length - 1)
    }
    if (!mPreviewImages.value.length) mPreviewOpen.value = false
  } else {
    toast(`删除失败 code=${res.error?.code}`, 'error')
  }
}

function mDownloadCurrent() {
  const p = flatPhotos.value[mPreviewIndex.value]
  if (!p) return
  const size = Number((p as any).additional?.size || (p as any).size || 0)
  enqueueDownload(p.path, p.name, size)
  toast('已加入下载队列', 'success')
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

    <main ref="scrollEl" class="body" @scroll="onScroll" v-loading="loading">
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
        <div v-if="loading" class="scan-progress">
          <el-icon class="is-loading" :size="32"><Loading /></el-icon>
          <div style="margin-top:12px">扫描中，已发现 {{ photos.length }} 张照片…</div>
          <div class="hint">扫描完成后会一次性渲染网格</div>
        </div>

        <div
          v-if="!loading && floatingDate && floatingDateVisible && flatPhotos.length > 0"
          class="floating-date"
        >{{ floatingDate }}</div>

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
                <LazyThumb :src="thumbOf(p)" :alt="p.name" aspect-ratio="1/1">
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

    <el-dialog
      v-model="viewerOpen"
      :title="flatPhotos[viewerIndex]?.name"
      width="92%"
      top="3vh"
      destroy-on-close
    >
      <div class="viewer">
        <el-button class="nav left" circle @click="prev" :disabled="viewerIndex <= 0">
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <template v-if="flatPhotos[viewerIndex]">
          <img
            v-if="!flatPhotos[viewerIndex]._fullFailed"
            :src="fullOf(flatPhotos[viewerIndex])"
            class="viewer-img"
            @error="onFullError(flatPhotos[viewerIndex])"
          />
          <div v-else class="viewer-img placeholder">
            <el-icon :size="64"><Picture /></el-icon>
            <div style="margin-top:8px;color:#909399">图片加载失败</div>
          </div>
        </template>
        <el-button
          class="nav right"
          circle
          @click="next"
          :disabled="viewerIndex >= flatPhotos.length - 1"
        >
          <el-icon><ArrowRight /></el-icon>
        </el-button>
      </div>
      <div class="viewer-counter">{{ viewerIndex + 1 }} / {{ flatPhotos.length }}</div>
      <div class="viewer-info" v-if="flatPhotos[viewerIndex]">
        <span v-if="flatPhotos[viewerIndex].additional?.size">
          {{ formatBytes(flatPhotos[viewerIndex].additional.size) }}
        </span>
        <span v-if="photoTime(flatPhotos[viewerIndex])">
          {{ new Date(photoTime(flatPhotos[viewerIndex]) * 1000).toLocaleString() }}
        </span>
      </div>
      <div class="viewer-actions">
        <el-button type="primary" @click="viewerDownload">
          <el-icon style="margin-right:4px"><Download /></el-icon>下载
        </el-button>
        <el-button type="danger" @click="viewerDelete">
          <el-icon style="margin-right:4px"><Delete /></el-icon>删除
        </el-button>
      </div>
    </el-dialog>

    <FolderPicker v-model="pickerOpen" :initial="folder" title="选择相册目录" @confirm="onPickFolder" />
  </div>

  <!-- 移动端 -->
  <div v-else class="m-album">
    <div class="m-album-head">
      <div class="m-album-folder" @click="pickerOpen = true">
        <van-icon name="folder-o" size="18" />
        <span class="m-album-folder-text">{{ folder || '选择相册目录' }}</span>
        <van-icon name="arrow-down" size="14" />
      </div>
      <span v-if="folder && photos.length" class="m-album-count">{{ photos.length }} 张</span>
    </div>

    <main ref="scrollEl" class="m-album-body" @scroll="onScroll">
      <van-empty v-if="!folder" image="search" description="请选择要浏览的图片目录">
        <van-button round type="primary" @click="pickerOpen = true">选择目录</van-button>
      </van-empty>
      <van-empty v-else-if="!photos.length && !loading" image="default" description="此目录暂无图片" />

      <template v-else>
        <div v-if="loading" class="m-scan-progress">
          <van-loading size="24" />
          <div style="margin-top:8px">已发现 {{ photos.length }} 张照片…</div>
        </div>

        <div
          v-if="!loading && floatingDate && floatingDateVisible && flatPhotos.length > 0"
          class="floating-date"
        >{{ floatingDate }}</div>

        <div class="virtual-spacer" :style="{ height: totalHeight + 'px' }">
          <template v-for="seg in visibleSegments" :key="seg.key">
            <div
              v-if="seg.type === 'header'"
              class="m-date-title"
              :style="{ position: 'absolute', top: seg.offset + 'px', width: '100%' }"
            >
              <span>{{ (seg as any).date }}</span>
              <span class="m-date-count">{{ (seg as any).count }}</span>
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
                <LazyThumb :src="thumbOf(p)" :alt="p.name" aspect-ratio="1/1">
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
    <van-image-preview
      v-model:show="mPreviewOpen"
      v-model:index="mPreviewIndex"
      :images="mPreviewImages"
      :closeable="true"
      :show-index="true"
    >
      <template #cover>
        <div class="m-preview-actions" :style="{ paddingBottom: `calc(var(--sl-safe-bottom) + 16px)` }">
          <van-button size="small" round icon="down" @click="mDownloadCurrent">下载</van-button>
          <van-button size="small" round icon="delete-o" type="danger" plain @click="mDeleteCurrent">删除</van-button>
        </div>
      </template>
    </van-image-preview>
  </div>
</template>

<style scoped>
/* Desktop */
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
.viewer { position: relative; display: flex; justify-content: center; align-items: center; min-height: 70vh; background: #000; border-radius: var(--sl-radius-sm); overflow: hidden; }
.viewer-img { max-width: 100%; max-height: 80vh; object-fit: contain; }
.viewer-img.placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 300px; height: 300px; background: #222; color: #ccc; }
.nav { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.15) !important; backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.3) !important; color: #fff !important; }
.nav:hover { background: rgba(255,255,255,0.25) !important; }
.nav.left { left: 12px; }
.nav.right { right: 12px; }
.viewer-counter { text-align: center; color: var(--el-text-color-secondary); margin-top: 8px; font-size: 12px; }
.viewer-info { text-align: center; color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; display: flex; justify-content: center; gap: 16px; }
.viewer-actions { display: flex; justify-content: center; gap: 12px; margin-top: 10px; }

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
</style>
