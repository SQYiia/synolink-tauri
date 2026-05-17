<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { openUrl } from '@tauri-apps/plugin-opener'
import { dsm } from '../api/dsm'
import { formatBytes } from '../utils/format'
import { useMediaScan } from '../composables/useMediaScan'
import FolderPicker from '../components/FolderPicker.vue'
import LazyThumb from '../components/LazyThumb.vue'

const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'])

function isImage(f: any): boolean {
  if (f.isdir) return false
  const name = (f.name as string) || ''
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return IMG_EXT.has(ext)
}

const {
  folder, loading, items: photos, visibleCount, sentinel,
  scan, onPickFolder, initFromStorage, setupSentinel, cleanup,
} = useMediaScan({
  extensions: 'jpg,jpeg,png,gif,webp,bmp,heic',
  filterFn: isImage,
  visibleInit: 120,
  visibleStep: 120,
  storageKeyPrefix: 'album:folder',
})

const viewerOpen = ref(false)
const viewerIndex = ref(0)
const pickerOpen = ref(false)

onMounted(() => {
  const hasFolder = initFromStorage()
  if (hasFolder) scan()
  setupSentinel()
})


/**
 * 从文件名中解析拍摄时间，返回秒级时间戳；解析失败返回 0。
 */
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

/** 获取照片时间（秒级）：文件名 > crtime > mtime */
function photoTime(p: any): number {
  const byName = parseNameTime(p?.name || '')
  if (byName) return byName
  const cr = Number(p?.additional?.time?.crtime ?? 0)
  if (cr) return cr
  return Number(p?.additional?.time?.mtime ?? 0)
}

/** 全量按日期倒序 */
const flatPhotos = computed(() => {
  const arr = [...photos.value]
  arr.sort((a, b) => {
    const ta = photoTime(a)
    const tb = photoTime(b)
    if (!ta && !tb) return 0
    if (!ta) return 1
    if (!tb) return -1
    return tb - ta
  })
  return arr
})

/** 实际渲染到 DOM 的部分 */
const visiblePhotos = computed(() => flatPhotos.value.slice(0, visibleCount.value))

/** 基于可见部分的分组 */
const groupedPhotos = computed(() => {
  const map = new Map<string, any[]>()
  for (const p of visiblePhotos.value) {
    const t = photoTime(p)
    let key = '未知日期'
    if (t) {
      const d = new Date(t * 1000)
      key = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
    }
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  return Array.from(map.entries())
})

function thumbOf(p: any) {
  return dsm.mediaUrl('thumb', p.path, { size: 'small' })
}
function fullOf(p: any) {
  return dsm.mediaUrl('stream', p.path)
}
function onFullError(p: any) { p._fullFailed = true }

function openPhoto(p: any) {
  const idx = flatPhotos.value.findIndex((x) => x.path === p.path)
  if (idx >= 0) {
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
    await openUrl(dsm.downloadUrl(p.path, 'download'))
    ElMessage.success('已交由系统浏览器下载')
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
  cleanup()
})
</script>

<template>
  <div class="page">
    <!-- 顶栏 -->
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

    <!-- 主体 -->
    <main class="body" v-loading="loading">
      <div v-if="!folder" class="empty">
        <el-icon :size="64" color="#c0c4cc"><Picture /></el-icon>
        <div style="margin-top:12px">请选择要浏览的图片目录</div>
        <el-button type="primary" style="margin-top:16px" @click="pickerOpen = true">选择目录</el-button>
      </div>
      <div v-else-if="!photos.length && !loading" class="empty">
        <el-icon :size="64" color="#c0c4cc"><Picture /></el-icon>
        <div style="margin-top:12px">此目录暂无图片</div>
      </div>

      <div v-for="[date, list] in groupedPhotos" :key="date" class="date-group">
        <h3 class="date-title">
          <el-icon><Calendar /></el-icon>
          <span>{{ date }}</span>
          <span class="date-count">{{ list.length }}</span>
        </h3>
        <div class="grid">
          <div
            v-for="p in list"
            :key="p.path"
            class="cell"
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
      </div>

      <!-- 底部哨兵：滴入视口时追加下一批 -->
      <div ref="sentinel" class="sentinel">
        <span v-if="visibleCount < flatPhotos.length">
          已展示 {{ visibleCount }} / {{ flatPhotos.length }}，继续下滑加载…
        </span>
        <span v-else-if="flatPhotos.length > 0">共 {{ flatPhotos.length }} 张照片</span>
      </div>
    </main>

    <!-- 查看器 -->
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
</template>

<style scoped>
.page { padding: 20px 24px 24px; max-width: 1400px; margin: 0 auto; }
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 0 16px;
  border-bottom: var(--sl-border);
  margin-bottom: 16px;
}
.title { margin: 0; font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); }
.actions { display: flex; gap: 8px; }
.folder-bar {
  display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--el-text-color-secondary);
  background: var(--sl-bg-card); border-radius: var(--sl-radius-sm); padding: 8px 12px; margin-bottom: 12px;
  border: var(--sl-border);
}
.folder-path { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count { color: var(--sl-primary); font-weight: 600; }
.body { min-height: 200px; }
.empty { text-align: center; padding: 48px 0; color: var(--el-text-color-secondary); font-size: 13px; }
.date-group { margin-bottom: 16px; }
.date-title {
  display: flex; align-items: center; gap: 6px;
  margin: 0 0 8px; padding: 6px 0;
  font-size: 11px; font-weight: 600; color: var(--el-text-color-secondary);
  text-transform: uppercase; letter-spacing: 0.05em;
  position: sticky; top: 0;
  background: var(--el-bg-color-page);
  z-index: 1;
}
.date-count {
  margin-left: 6px; font-size: 11px; color: var(--el-text-color-placeholder); font-weight: 400;
}
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 4px; }
.sentinel {
  text-align: center; padding: 16px 0; font-size: 12px; color: var(--el-text-color-secondary);
  min-height: 40px;
}
.cell {
  cursor: pointer; border-radius: var(--sl-radius-sm); overflow: hidden; background: var(--el-fill-color);
  aspect-ratio: 1 / 1;
  transition: opacity var(--sl-transition-fast);
}
.cell:hover { opacity: 0.85; }
.cell:active { opacity: 0.7; }
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
</style>
