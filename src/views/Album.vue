<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, markRaw, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { dsm } from '../api/dsm'
import FolderPicker from '../components/FolderPicker.vue'
import LazyThumb from '../components/LazyThumb.vue'

const router = useRouter()
const folder = ref('')
const loading = ref(false)
const photos = shallowRef<any[]>([])
const viewerOpen = ref(false)
const viewerIndex = ref(0)
const pickerOpen = ref(false)
let scanGen = 0

/** 渐进加载：初始展示数量，滴到底部哨兵时追加 */
const VISIBLE_INIT = 120
const VISIBLE_STEP = 120
const visibleCount = ref(VISIBLE_INIT)
const sentinel = ref<HTMLElement | null>(null)
let sentinelObserver: IntersectionObserver | null = null

const STORAGE_KEY = computed(() => `album:folder:${dsm.baseUrl}`)

onMounted(() => {
  if (!dsm.sid) {
    router.replace('/servers')
    return
  }
  // 读取持久化目录
  try {
    const saved = localStorage.getItem(STORAGE_KEY.value)
    if (saved) {
      folder.value = saved
      // 自动扫描一次
      scan()
    }
  } catch {}

  // 底部哨兵：进视口就追加一批到 DOM
  nextTick(() => {
    if (!sentinel.value) return
    sentinelObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && visibleCount.value < photos.value.length) {
          visibleCount.value = Math.min(photos.value.length, visibleCount.value + VISIBLE_STEP)
        }
      }
    }, { rootMargin: '800px', threshold: 0 })
    sentinelObserver.observe(sentinel.value)
  })
})

onBeforeUnmount(() => {
  sentinelObserver?.disconnect()
  sentinelObserver = null
})

const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'])

function isImage(f: any): boolean {
  if (f.isdir) return false
  const name = (f.name as string) || ''
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return IMG_EXT.has(ext)
}

async function scan() {
  if (!folder.value) return
  loading.value = true
  photos.value = []
  visibleCount.value = VISIBLE_INIT
  scanGen++
  const gen = scanGen
  let taskid = ''
  try {
    const start = await dsm.searchStart(folder.value, '', true, {
      extension: 'jpg,jpeg,png,gif,webp,bmp,heic',
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

    for (let iter = 0; iter < MAX_ITER; iter++) {
      if (gen !== scanGen) return
      const list: any = await dsm.searchList(taskid, { offset, limit: PAGE })
      if (!list.success) break
      const d = list.data ?? {}
      const batch: any[] = d.files ?? []
      finished = !!d.finished

      if (batch.length > 0) {
        // markRaw 避免 Vue 给每个对象建立深度响应，大数组渲染开销显著下降
        for (const f of batch) markRaw(f)
        collected.push(...batch)
        offset += batch.length
        photos.value = collected.filter(isImage)
        idleRounds = 0
        // 每拉完一页让出一帧，避免长时间独占主线程造成其他 Tab / 输入卡顿
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

    ElMessage.success(`扫描完成：${photos.value.length} 张图片`)
  } catch (e: any) {
    ElMessage.error('扫描出错: ' + (e?.message ?? e))
  } finally {
    if (taskid) await dsm.searchStop(taskid).catch(() => {})
    loading.value = false
  }
}

/** 全量按日期倒序的扫平列表（用于 viewer 翻页） */
const flatPhotos = computed(() => {
  const arr = [...photos.value]
  arr.sort((a, b) => {
    const ta = Number(a.additional?.time?.mtime ?? 0)
    const tb = Number(b.additional?.time?.mtime ?? 0)
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
    const t = p.additional?.time?.mtime
    let key = '未知日期'
    if (t) {
      const d = new Date(Number(t) * 1000)
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

function onPickFolder(p: string) {
  folder.value = p
  try { localStorage.setItem(STORAGE_KEY.value, p) } catch {}
  scan()
}

// baseUrl 变化时（切换服务器）重读持久化
watch(() => dsm.baseUrl, () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY.value)
    folder.value = saved ?? ''
    photos.value = []
    visibleCount.value = VISIBLE_INIT
    if (saved) scan()
  } catch {}
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
    </el-dialog>

    <FolderPicker v-model="pickerOpen" :initial="folder" title="选择相册目录" @confirm="onPickFolder" />
  </div>
</template>

<style scoped>
.page { padding: 12px 16px 24px; max-width: 1400px; margin: 0 auto; }
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 0 12px;
}
.title { margin: 0; font-size: 22px; color: var(--el-text-color-primary); }
.actions { display: flex; gap: 8px; }
.folder-bar {
  display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--el-text-color-secondary);
  background: var(--el-bg-color); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px;
}
.folder-path { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count { color: var(--el-color-primary); font-weight: 600; }
.body { min-height: 200px; }
.empty { text-align: center; padding: 80px 0; color: var(--el-text-color-secondary); }
.date-group { margin-bottom: 20px; }
.date-title {
  display: flex; align-items: center; gap: 6px;
  margin: 0 0 10px; padding: 6px 0;
  font-size: 15px; color: var(--el-text-color-primary);
  position: sticky; top: 0; background: var(--el-bg-color-page); z-index: 1;
}
.date-count {
  margin-left: 6px; font-size: 12px; color: var(--el-text-color-secondary); font-weight: 400;
}
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; }
.sentinel {
  text-align: center; padding: 16px 0; font-size: 12px; color: var(--el-text-color-secondary);
  min-height: 40px;
}
.cell {
  cursor: pointer; border-radius: 4px; overflow: hidden; background: var(--el-fill-color);
  aspect-ratio: 1 / 1; transition: transform 0.15s;
}
.cell:hover { transform: scale(1.03); }
.tile { width: 100%; height: 100%; object-fit: cover; display: block; background: var(--el-fill-color); }
.tile.placeholder { display: flex; align-items: center; justify-content: center; color: var(--el-text-color-placeholder); }
.viewer { position: relative; display: flex; justify-content: center; align-items: center; min-height: 70vh; background: #000; }
.viewer-img { max-width: 100%; max-height: 80vh; object-fit: contain; }
.viewer-img.placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 300px; height: 300px; background: #222; color: #ccc; }
.nav { position: absolute; top: 50%; transform: translateY(-50%); }
.nav.left { left: 10px; }
.nav.right { right: 10px; }
.viewer-counter { text-align: center; color: var(--el-text-color-secondary); margin-top: 8px; }
</style>
