<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dsm } from '../api/dsm'
import { formatBytes } from '../utils/format'
import { enqueue } from '../composables/useDownloadQueue'
import FolderPicker from '../components/FolderPicker.vue'

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const path = ref<string>('')
const items = ref<any[]>([])
const crumbs = ref<string[]>([])
const uploadInput = ref<HTMLInputElement | null>(null)

// 缩略图：path -> blob URL
const thumbs = ref<Record<string, string>>({})
let thumbGen = 0 // 防止旧请求覆盖新目录

// 搜索
const searchPattern = ref('')
const searchTaskId = ref('')
const inSearchMode = ref(false)

// 预览
const previewOpen = ref(false)
const previewTitle = ref('')
const previewType = ref<'image' | 'video' | 'audio' | 'text' | 'other'>('other')
const previewSrc = ref('')
const previewText = ref('')
const previewLoading = ref(false)

const canUpload = computed(() => !!path.value && !inSearchMode.value)

// 批量选择
const selection = ref<any[]>([])
function onSelectionChange(rows: any[]) { selection.value = rows }

// 拖拽上传
const dragging = ref(false)

// 收藏夹
const FAVORITES_KEY = 'files:favorites'
const favorites = ref<string[]>(loadFavorites())

function loadFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]') } catch { return [] }
}
function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.value))
}
function toggleFavorite(p: string) {
  const idx = favorites.value.indexOf(p)
  if (idx >= 0) favorites.value.splice(idx, 1)
  else favorites.value.push(p)
  saveFavorites()
}
function isFavorite(p: string) { return favorites.value.includes(p) }

// 复制/移动
const copyMovePickerOpen = ref(false)
const copyMoveMode = ref<'copy' | 'move'>('copy')
const copyMovePaths = ref<string[]>([])

function startCopyMove(mode: 'copy' | 'move', paths: string[]) {
  copyMoveMode.value = mode
  copyMovePaths.value = paths
  copyMovePickerOpen.value = true
}

async function onCopyMoveConfirm(dest: string) {
  copyMovePickerOpen.value = false
  if (!dest || !copyMovePaths.value.length) return
  loading.value = true
  try {
    const res = await dsm.copyMove(copyMovePaths.value, dest, false, copyMoveMode.value === 'move')
    if (res.success) {
      ElMessage.success(copyMoveMode.value === 'move' ? '移动成功' : '复制成功')
      await loadCurrent()
    } else {
      ElMessage.error(`操作失败 code=${res.error?.code}`)
    }
  } finally {
    loading.value = false
  }
}

// 批量操作
async function batchDelete() {
  if (!selection.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selection.value.length} 个项目？该操作不可撤销。`, '批量删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    loading.value = true
    const paths = selection.value.map((r) => r.path)
    const res = await dsm.deletePath(paths)
    if (res.success) {
      ElMessage.success(`已删除 ${paths.length} 个项目`)
      await loadCurrent()
    } else {
      ElMessage.error(`删除失败 code=${res.error?.code}`)
    }
  } catch {
  } finally {
    loading.value = false
  }
}

function batchDownload() {
  if (!selection.value.length) return
  let count = 0
  for (const row of selection.value) {
    if (!isRowDir(row)) {
      enqueue(row.path, row.name, Number(row.additional?.size || 0))
      count++
    }
  }
  if (count) ElMessage.success(`已添加 ${count} 个文件到下载队列`)
}

function batchCopy() {
  if (!selection.value.length) return
  startCopyMove('copy', selection.value.map((r) => r.path))
}

function batchMove() {
  if (!selection.value.length) return
  startCopyMove('move', selection.value.map((r) => r.path))
}

// 拖拽上传处理
function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (canUpload.value) dragging.value = true
}
function onDragLeave() { dragging.value = false }
async function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  if (!canUpload.value) return
  const files = e.dataTransfer?.files
  if (!files || !files.length) return
  loading.value = true
  try {
    for (const f of Array.from(files)) {
      const res = await dsm.upload(path.value, f)
      if (res.success) ElMessage.success(`${f.name} 上传完成`)
      else ElMessage.error(`${f.name} 上传失败 code=${res.error?.code}`)
    }
    await loadCurrent()
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!dsm.sid) {
    router.replace('/servers')
    return
  }
  const openPath = route.query.open as string | undefined
  if (openPath) {
    await openFolder({ path: openPath, isdir: true })
  } else {
    await loadShares()
  }
})

async function loadShares() {
  loading.value = true
  path.value = ''
  crumbs.value = []
  inSearchMode.value = false
  try {
    const res = await dsm.listShare({ limit: 100, additional: 'real_path,owner,time,perm,mount_point_type,volume_status' })
    if (res.success) items.value = (res.data as any)?.shares ?? []
    else ElMessage.error(`code=${res.error?.code}`)
  } finally {
    loading.value = false
  }
}

async function loadCurrent() {
  if (!path.value) return loadShares()
  loading.value = true
  try {
    const res = await dsm.listFiles(path.value, { limit: 500, additional: 'size,time,type,perm' })
    if (res.success) items.value = (res.data as any)?.files ?? []
    else ElMessage.error(`code=${res.error?.code}`)
  } finally {
    loading.value = false
  }
}

async function openFolder(row: any) {
  const isDir = row.isdir ?? (row.path?.endsWith('/') || !row.additional?.size)
  if (!isDir) {
    await preview(row)
    return
  }
  loading.value = true
  try {
    const target = row.path as string
    const res = await dsm.listFiles(target, { limit: 500, additional: 'size,time,type,perm' })
    if (res.success) {
      items.value = (res.data as any)?.files ?? []
      path.value = target
      crumbs.value = target.split('/').filter(Boolean)
      inSearchMode.value = false
    } else {
      ElMessage.error(`code=${res.error?.code}`)
    }
  } finally {
    loading.value = false
  }
}

async function crumbJump(idx: number) {
  const parts = crumbs.value.slice(0, idx + 1)
  await openFolder({ path: '/' + parts.join('/'), isdir: true })
}

async function doCreateFolder() {
  if (!path.value) return ElMessage.warning('请先进入共享文件夹')
  try {
    const { value } = await ElMessageBox.prompt('新建文件夹名', '新建', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPattern: /^[^/\\:*?"<>|]{1,200}$/,
      inputErrorMessage: '名称不合法',
    })
    const res = await dsm.createFolder(path.value, value!)
    if (res.success) {
      ElMessage.success('已创建')
      await loadCurrent()
    } else {
      ElMessage.error(`创建失败 code=${res.error?.code}`)
    }
  } catch {}
}

async function doRename(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('重命名', row.name, {
      inputValue: row.name,
      inputPattern: /^[^/\\:*?"<>|]{1,200}$/,
      inputErrorMessage: '名称不合法',
    })
    const res = await dsm.rename(row.path, value!)
    if (res.success) {
      ElMessage.success('已重命名')
      await loadCurrent()
    } else {
      ElMessage.error(`重命名失败 code=${res.error?.code}`)
    }
  } catch {}
}

async function doDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」？该操作不可撤销。`, '删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    loading.value = true
    const res = await dsm.deletePath(row.path)
    if (res.success) {
      ElMessage.success('已删除')
      await loadCurrent()
    } else {
      ElMessage.error(`删除失败 code=${res.error?.code}`)
    }
  } catch {
  } finally {
    loading.value = false
  }
}

function doDownload(row: any) {
  enqueue(row.path, row.name, Number(row.additional?.size || 0))
  ElMessage.success(`已添加「${row.name}」到下载队列`)
}

function triggerUpload() {
  if (!canUpload.value) return
  uploadInput.value?.click()
}

async function onUploadPicked(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = input.files
  if (!files || !files.length) return
  loading.value = true
  try {
    for (const f of Array.from(files)) {
      const res = await dsm.upload(path.value, f)
      if (res.success) ElMessage.success(`${f.name} 上传完成`)
      else ElMessage.error(`${f.name} 上传失败 code=${res.error?.code}`)
    }
    await loadCurrent()
  } finally {
    loading.value = false
    if (input) input.value = ''
  }
}

async function doSearch() {
  if (!searchPattern.value) return
  const folder = path.value || '/'
  loading.value = true
  try {
    const start = await dsm.searchStart(folder, searchPattern.value, true)
    if (!start.success || !start.data?.taskid) {
      ElMessage.error('启动搜索失败')
      return
    }
    searchTaskId.value = start.data.taskid
    inSearchMode.value = true
    let results: any[] = []
    const MAX_WAIT = 10000
    const POLL_INTERVAL = 500
    const startTime = Date.now()
    while (Date.now() - startTime < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL))
      const list = await dsm.searchList(searchTaskId.value, { limit: 500 })
      if (list.success) {
        const data = list.data as any
        results = data?.files ?? []
        if (data?.finished) break
      }
    }
    items.value = results
    await dsm.searchStop(searchTaskId.value).catch(() => {})
    ElMessage.success(`找到 ${results.length} 个结果`)
  } finally {
    loading.value = false
  }
}

async function exitSearch() {
  inSearchMode.value = false
  searchPattern.value = ''
  await loadCurrent()
}

function typeOf(name: string): 'image' | 'video' | 'audio' | 'text' | 'other' {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) return 'audio'
  if (['txt', 'md', 'log', 'json', 'xml', 'ini', 'conf', 'yml', 'yaml', 'js', 'ts', 'html', 'css', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sh'].includes(ext))
    return 'text'
  return 'other'
}

async function preview(row: any) {
  previewTitle.value = row.name
  previewType.value = typeOf(row.name)
  previewSrc.value = ''
  previewText.value = ''
  if (previewType.value === 'other') {
    ElMessage.info('该类型暂不支持预览，可改为下载')
    return
  }
  // 视频/音频优先用 dsm:// 流式播放，避免整文件载入内存
  if (previewType.value === 'video' || previewType.value === 'audio') {
    previewSrc.value = dsm.mediaUrl('stream', row.path)
    previewOpen.value = true
    return
  }
  // 大文件保护：文本 > 5MB、图片 > 20MB 时提示
  const fileSize = Number(row.additional?.size ?? 0)
  const TEXT_LIMIT = 5 * 1024 * 1024
  const IMAGE_LIMIT = 20 * 1024 * 1024
  const limit = previewType.value === 'text' ? TEXT_LIMIT : IMAGE_LIMIT
  if (fileSize > limit) {
    ElMessage.warning(`文件过大（${formatBytes(fileSize)}），请直接下载查看`)
    return
  }
  previewOpen.value = true
  previewLoading.value = true
  try {
    const buf = await dsm.downloadBytes(row.path)
    if (previewType.value === 'text') {
      const decoder = new TextDecoder('utf-8', { fatal: false })
      previewText.value = decoder.decode(buf)
    } else {
      // image
      const blob = new Blob([buf], { type: 'image/*' })
      previewSrc.value = URL.createObjectURL(blob)
    }
  } catch (e: any) {
    ElMessage.error('预览失败：' + (e?.message ?? e))
    previewOpen.value = false
  } finally {
    previewLoading.value = false
  }
}

watch(previewOpen, (v) => {
  if (!v && previewSrc.value && previewSrc.value.startsWith('blob:')) {
    URL.revokeObjectURL(previewSrc.value)
  }
  if (!v) previewSrc.value = ''
})

function isRowDir(row: any) {
  return row.isdir ?? !row.additional?.size
}

function isThumbable(row: any): boolean {
  if (isRowDir(row)) return false
  const t = typeOf(row.name ?? '')
  return t === 'image' || t === 'video'
}

function revokeThumbs() {
  for (const url of Object.values(thumbs.value)) {
    try { URL.revokeObjectURL(url) } catch {}
  }
  thumbs.value = {}
}

async function loadThumbs(rows: any[], gen: number) {
  const targets = rows
    .filter(isThumbable)
    .map((r) => r.path as string)
    .filter((p) => p && !thumbs.value[p])
  const concurrency = 4
  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (idx < targets.length) {
      const p = targets[idx++]
      if (gen !== thumbGen) return
      try {
        const buf = await dsm.thumbBytes(p, 'small')
        if (gen !== thumbGen) return
        // 大小太小通常是 DSM 返回的 JSON 错误，跳过
        if (!buf || buf.byteLength < 64) continue
        const blob = new Blob([buf], { type: 'image/jpeg' })
        thumbs.value[p] = URL.createObjectURL(blob)
      } catch {}
    }
  })
  await Promise.all(workers)
}

watch(items, (rows) => {
  revokeThumbs()
  thumbGen++
  if (rows && rows.length) void loadThumbs(rows, thumbGen)
})

onUnmounted(() => {
  revokeThumbs()
})

function sortByName(a: any, b: any) {
  const aDir = isRowDir(a) ? 0 : 1
  const bDir = isRowDir(b) ? 0 : 1
  if (aDir !== bDir) return aDir - bDir
  return (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN')
}

function sortBySize(a: any, b: any) {
  const aDir = isRowDir(a) ? 0 : 1
  const bDir = isRowDir(b) ? 0 : 1
  if (aDir !== bDir) return aDir - bDir
  return (Number(a.additional?.size) || 0) - (Number(b.additional?.size) || 0)
}

function sortByTime(a: any, b: any) {
  const aDir = isRowDir(a) ? 0 : 1
  const bDir = isRowDir(b) ? 0 : 1
  if (aDir !== bDir) return aDir - bDir
  return (Number(a.additional?.time?.mtime) || 0) - (Number(b.additional?.time?.mtime) || 0)
}
</script>

<template>
  <el-container class="page">
    <el-header>
      <div class="header">
        <h2 class="page-title">文件</h2>
        <el-breadcrumb separator="/" style="flex: 1; margin: 0 12px;">
          <el-breadcrumb-item><a @click="loadShares">共享文件夹</a></el-breadcrumb-item>
          <el-breadcrumb-item v-for="(c, i) in crumbs" :key="c"><a @click="crumbJump(i)">{{ c }}</a></el-breadcrumb-item>
        </el-breadcrumb>
        <el-button v-if="path" :type="isFavorite(path) ? 'warning' : undefined" circle size="small" @click="toggleFavorite(path)" title="收藏当前目录">
          <el-icon><Star /></el-icon>
        </el-button>
        <el-input
          v-model="searchPattern"
          placeholder="搜索（当前目录递归）"
          style="width: 220px; margin-right: 8px;"
          clearable
          @keyup.enter="doSearch"
        />
        <el-button v-if="inSearchMode" @click="exitSearch">退出搜索</el-button>
        <el-button type="primary" :disabled="!searchPattern" @click="doSearch">搜索</el-button>
        <el-button :disabled="!path || inSearchMode" @click="doCreateFolder">新建文件夹</el-button>
        <el-button :disabled="!canUpload" type="success" @click="triggerUpload">上传</el-button>
        <input ref="uploadInput" type="file" multiple style="display:none" @change="onUploadPicked" />
      </div>
    </el-header>

    <!-- 收藏栏 -->
    <div class="favorites-bar" v-if="favorites.length">
      <el-icon :size="14"><Star /></el-icon>
      <el-tag
        v-for="f in favorites"
        :key="f"
        size="small"
        closable
        @click="openFolder({ path: f, isdir: true })"
        @close="toggleFavorite(f)"
        class="fav-tag"
      >{{ f.split('/').pop() || f }}</el-tag>
    </div>

    <el-main
      v-loading="loading"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      :class="{ 'drag-over': dragging }"
    >
      <!-- 拖拽上传提示 -->
      <div v-if="dragging" class="drop-overlay">
        <el-icon :size="48"><Upload /></el-icon>
        <span>松开以上传文件</span>
      </div>

      <!-- 批量操作栏 -->
      <div v-if="selection.length" class="batch-bar">
        <span>已选 {{ selection.length }} 项</span>
        <el-button size="small" @click="batchDownload">批量下载</el-button>
        <el-button size="small" @click="batchCopy">复制到…</el-button>
        <el-button size="small" @click="batchMove">移动到…</el-button>
        <el-button size="small" type="danger" @click="batchDelete">批量删除</el-button>
      </div>

      <el-table :data="items" stripe @row-dblclick="openFolder" @selection-change="onSelectionChange" style="width: 100%" :default-sort="{ prop: 'name', order: 'ascending' }">
        <el-table-column type="selection" width="42" />
        <el-table-column width="56">
          <template #default="{ row }">
            <el-icon v-if="isRowDir(row)" :size="28"><Folder /></el-icon>
            <img
              v-else-if="isThumbable(row) && thumbs[row.path]"
              :src="thumbs[row.path]"
              class="thumb"
              @click="preview(row)"
            />
            <el-icon v-else-if="isThumbable(row)" :size="28" class="thumb-ph"><Picture /></el-icon>
            <el-icon v-else :size="28"><Document /></el-icon>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" sortable :sort-method="sortByName" />
        <el-table-column label="大小" width="110" sortable :sort-method="sortBySize">
          <template #default="{ row }">{{ isRowDir(row) ? '—' : formatBytes(row.additional?.size) }}</template>
        </el-table-column>
        <el-table-column label="修改时间" width="170" sortable :sort-method="sortByTime">
          <template #default="{ row }">
            <span v-if="row.additional?.time?.mtime">{{ new Date(row.additional.time.mtime * 1000).toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="360" fixed="right">
          <template #default="{ row }">
            <el-button v-if="!isRowDir(row)" size="small" @click="preview(row)">预览</el-button>
            <el-button v-if="!isRowDir(row)" size="small" @click="doDownload(row)">下载</el-button>
            <el-button size="small" @click="startCopyMove('copy', [row.path])">复制</el-button>
            <el-button size="small" @click="startCopyMove('move', [row.path])">移动</el-button>
            <el-button size="small" @click="doRename(row)">重命名</el-button>
            <el-button size="small" type="danger" @click="doDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-main>

    <el-dialog
      v-model="previewOpen"
      :title="previewTitle"
      width="80%"
      top="5vh"
      destroy-on-close
    >
      <div v-loading="previewLoading" class="preview-body">
        <img v-if="previewType === 'image' && previewSrc" :src="previewSrc" class="preview-media" />
        <video v-else-if="previewType === 'video' && previewSrc" :src="previewSrc" class="preview-media" controls autoplay />
        <audio v-else-if="previewType === 'audio' && previewSrc" :src="previewSrc" controls style="width:100%" />
        <pre v-else-if="previewType === 'text'" class="preview-text">{{ previewText }}</pre>
      </div>
    </el-dialog>

    <FolderPicker
      v-model="copyMovePickerOpen"
      :initial="path"
      :title="copyMoveMode === 'copy' ? '复制到…' : '移动到…'"
      @confirm="onCopyMoveConfirm"
    />
  </el-container>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.header {
  display: flex; align-items: center; padding: 10px 16px; gap: 8px;
  position: sticky; top: 0; z-index: 10;
  background: var(--sl-surface);
  backdrop-filter: blur(var(--sl-surface-blur));
  -webkit-backdrop-filter: blur(var(--sl-surface-blur));
  box-shadow: var(--sl-shadow-sm);
}
.page-title { margin: 0 8px 0 4px; font-size: 22px; font-weight: 700; color: var(--el-text-color-primary); white-space: nowrap; }
a { cursor: pointer; color: var(--sl-primary); }
.preview-body { display: flex; justify-content: center; align-items: center; min-height: 50vh; border-radius: var(--sl-radius-md); overflow: hidden; }
.preview-media { max-width: 100%; max-height: 70vh; }
.preview-text {
  width: 100%; max-height: 70vh; overflow: auto;
  background: var(--el-fill-color); padding: 16px; border-radius: var(--sl-radius-sm);
  white-space: pre-wrap; word-break: break-all; font-family: Consolas, Monaco, monospace; font-size: 13px;
}
.thumb {
  width: 44px; height: 44px; object-fit: cover; border-radius: 6px; cursor: pointer; display: block;
  background: var(--el-fill-color); transition: transform var(--sl-transition-fast);
}
.thumb:hover { transform: scale(1.1); }
.thumb-ph { color: #c0c4cc; }

/* Table overrides */
:deep(.el-table) {
  border-radius: var(--sl-radius-md);
  overflow: hidden;
  --el-table-border-color: transparent;
}
:deep(.el-table th.el-table__cell) {
  background: var(--el-fill-color);
  font-weight: 600;
  font-size: 13px;
}
:deep(.el-table tr) {
  transition: background var(--sl-transition-fast);
}
:deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(0, 0, 0, 0.015);
}
:deep(.el-main) {
  padding: 12px 16px;
  position: relative;
}
.drag-over {
  outline: 2px dashed var(--sl-primary);
  outline-offset: -4px;
  background: rgba(var(--el-color-primary-rgb, 64, 158, 255), 0.04);
}
.drop-overlay {
  position: absolute; inset: 0; z-index: 100;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgba(255,255,255,0.85); backdrop-filter: blur(4px);
  color: var(--sl-primary); font-size: 16px; font-weight: 600;
  pointer-events: none;
}
.batch-bar {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 10px;
  background: var(--el-color-primary-light-9); border-radius: var(--sl-radius-md);
  font-size: 13px; color: var(--el-text-color-primary);
}
.favorites-bar {
  display: flex; align-items: center; gap: 6px; padding: 6px 16px;
  overflow-x: auto; flex-shrink: 0;
  font-size: 12px; color: var(--el-text-color-secondary);
}
.fav-tag { cursor: pointer; }
</style>
