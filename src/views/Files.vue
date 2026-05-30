<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { showImagePreview } from 'vant'
import type { ActionSheetAction } from 'vant'
import { dsm } from '../api/dsm'
import { formatBytes } from '../utils/format'
import { enqueue } from '../composables/useDownloadQueue'
import FolderPicker from '../components/FolderPicker.vue'
import FileTypeIcon from '../components/FileTypeIcon.vue'
import { useIsMobile } from '../composables/useIsMobile'
import { useBackHandler } from '../composables/useInteractiveSwipeBack'
import { confirm, prompt, toast } from '../utils/feedback'

const router = useRouter()
const route = useRoute()
const isMobile = useIsMobile()

const loading = ref(false)
const refreshing = ref(false)
const path = ref<string>('')
const items = ref<any[]>([])
const sortKey = ref<'name' | 'size' | 'time'>('name')
const sortOrder = ref<'ascending' | 'descending'>('ascending')

const sortedItems = computed(() => {
  const dirs = items.value.filter(isRowDir)
  const files = items.value.filter(i => !isRowDir(i))
  const fns: Record<string, (a: any, b: any) => number> = { name: sortByName, size: sortBySize, time: sortByTime }
  const fn = fns[sortKey.value] ?? sortByName
  dirs.sort(fn)
  files.sort(fn)
  if (sortOrder.value === 'descending') { dirs.reverse(); files.reverse() }
  return [...dirs, ...files]
})

function onSortChange({ prop, order }: { prop: string; order: string | null }) {
  if (!order) {
    sortKey.value = 'name'
    sortOrder.value = 'ascending'
  } else {
    sortKey.value = (prop === 'size' ? 'size' : prop === 'time' ? 'time' : 'name') as any
    sortOrder.value = order as any
  }
}
const crumbs = ref<string[]>([])
const uploadInput = ref<HTMLInputElement | null>(null)

const thumbs = ref<Record<string, string>>({})
let thumbGen = 0

const searchPattern = ref('')
const searchTaskId = ref('')
const inSearchMode = ref(false)

const previewOpen = ref(false)
const previewTitle = ref('')
const previewType = ref<'image' | 'video' | 'audio' | 'text' | 'other'>('other')
const previewSrc = ref('')
const previewText = ref('')
const previewLoading = ref(false)

const canUpload = computed(() => !!path.value && !inSearchMode.value)

const selection = ref<any[]>([])
function onSelectionChange(rows: any[]) { selection.value = rows }

// 移动端选择模式
const selectMode = ref(false)
const selectedPaths = ref<Set<string>>(new Set())
function toggleSelect(row: any) {
  const p = row.path
  if (selectedPaths.value.has(p)) selectedPaths.value.delete(p)
  else selectedPaths.value.add(p)
  selectedPaths.value = new Set(selectedPaths.value)
}
function exitSelectMode() {
  selectMode.value = false
  selectedPaths.value = new Set()
}
const selectedRows = computed(() => sortedItems.value.filter(r => selectedPaths.value.has(r.path)))

const dragging = ref(false)

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
    if (!res.success || !res.data?.taskid) {
      toast(`操作失败 code=${res.error?.code}`, 'error')
      return
    }
    const taskid = res.data.taskid
    const MAX_WAIT = 60000
    const POLL = 1000
    const t0 = Date.now()
    let finished = false
    while (Date.now() - t0 < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, POLL))
      const st = await dsm.copyMoveStatus(taskid)
      if (!st.success) break
      const data = st.data as any
      if (data?.finished) { finished = true; break }
      if (data?.error) break
    }
    if (!finished) {
      toast('操作超时或失败，请手动确认', 'warning')
      await loadCurrent()
      return
    }
    toast(copyMoveMode.value === 'move' ? '移动成功' : '复制成功', 'success')
    await loadCurrent()
  } finally {
    loading.value = false
  }
}

async function batchDelete() {
  const rows = isMobile.value ? selectedRows.value : selection.value
  if (!rows.length) return
  const ok = await confirm(`确定删除选中的 ${rows.length} 个项目？该操作不可撤销。`, '批量删除', { danger: true, confirmText: '删除' })
  if (!ok) return
  loading.value = true
  try {
    const paths = rows.map((r) => r.path)
    const res = await dsm.deletePath(paths)
    if (res.success) {
      toast(`已删除 ${paths.length} 个项目`, 'success')
      await loadCurrent()
      if (isMobile.value) exitSelectMode()
    } else {
      toast(`删除失败 code=${res.error?.code}`, 'error')
    }
  } finally {
    loading.value = false
  }
}

function batchDownload() {
  const rows = isMobile.value ? selectedRows.value : selection.value
  if (!rows.length) return
  let count = 0
  for (const row of rows) {
    if (!isRowDir(row)) {
      enqueue(row.path, row.name, Number(row.additional?.size || 0))
      count++
    }
  }
  if (count) toast(`已添加 ${count} 个文件到下载队列`, 'success')
  if (isMobile.value) exitSelectMode()
}

function batchCopy() {
  const rows = isMobile.value ? selectedRows.value : selection.value
  if (!rows.length) return
  startCopyMove('copy', rows.map((r) => r.path))
}

function batchMove() {
  const rows = isMobile.value ? selectedRows.value : selection.value
  if (!rows.length) return
  startCopyMove('move', rows.map((r) => r.path))
}

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
    const res = await dsm.listShare({ limit: 100, additional: '["real_path","owner","time","perm","mount_point_type","volume_status"]' })
    if (res.success) items.value = (res.data as any)?.shares ?? []
    else toast(`code=${res.error?.code}`, 'error')
  } finally {
    loading.value = false
  }
}

async function loadCurrent() {
  if (!path.value) return loadShares()
  loading.value = true
  try {
    const res = await dsm.listFiles(path.value, { limit: 500, additional: '["size","time","type","perm"]' })
    if (res.success) items.value = (res.data as any)?.files ?? []
    else toast(`code=${res.error?.code}`, 'error')
  } finally {
    loading.value = false
  }
}

async function onPullRefresh() {
  refreshing.value = true
  try {
    await loadCurrent()
  } finally {
    refreshing.value = false
  }
}

async function openFolder(row: any) {
  if (selectMode.value) {
    toggleSelect(row)
    return
  }
  const isDir = isRowDir(row)
  if (!isDir) {
    await preview(row)
    return
  }
  loading.value = true
  try {
    const target = row.path as string
    const res = await dsm.listFiles(target, { limit: 500, additional: '["size","time","type","perm"]' })
    if (res.success) {
      items.value = (res.data as any)?.files ?? []
      path.value = target
      crumbs.value = target.split('/').filter(Boolean)
      inSearchMode.value = false
    } else {
      toast(`code=${res.error?.code}`, 'error')
    }
  } finally {
    loading.value = false
  }
}

async function crumbJump(idx: number) {
  const parts = crumbs.value.slice(0, idx + 1)
  await openFolder({ path: '/' + parts.join('/'), isdir: true })
}

/** 返回上一级目录：在子目录时返回到父目录；在共享根下不响应 */
async function goUp() {
  if (selectMode.value) { exitSelectMode(); return }
  if (inSearchMode.value) { await exitSearch(); return }
  if (!crumbs.value.length) return
  if (crumbs.value.length === 1) {
    await loadShares()
    return
  }
  const parts = crumbs.value.slice(0, -1)
  await openFolder({ path: '/' + parts.join('/'), isdir: true })
}

// 侧滑返回：消费"上级目录 / 退出选择 / 退出搜索"等场景，不让全局 fallback 跳出 tab
useBackHandler(() => {
  if (!isMobile.value) return false
  if (selectMode.value) { exitSelectMode(); return true }
  if (inSearchMode.value) { void exitSearch(); return true }
  if (crumbs.value.length) { void goUp(); return true }
  return false
})

async function doCreateFolder() {
  if (!path.value) {
    toast('请先进入共享文件夹', 'warning')
    return
  }
  const value = await prompt('新建文件夹名', '新建', {
    pattern: /^[^/\\:*?"<>|]{1,200}$/,
    patternError: '名称不合法',
  })
  if (!value) return
  const res = await dsm.createFolder(path.value, value)
  if (res.success) {
    toast('已创建', 'success')
    await loadCurrent()
  } else {
    toast(`创建失败 code=${res.error?.code}`, 'error')
  }
}

async function doRename(row: any) {
  const value = await prompt('重命名', row.name, {
    defaultValue: row.name,
    pattern: /^[^/\\:*?"<>|]{1,200}$/,
    patternError: '名称不合法',
  })
  if (!value) return
  const res = await dsm.rename(row.path, value)
  if (res.success) {
    toast('已重命名', 'success')
    await loadCurrent()
  } else {
    toast(`重命名失败 code=${res.error?.code}`, 'error')
  }
}

async function doDelete(row: any) {
  const ok = await confirm(`确定删除「${row.name}」？该操作不可撤销。`, '删除', { danger: true, confirmText: '删除' })
  if (!ok) return
  loading.value = true
  try {
    const res = await dsm.deletePath(row.path)
    if (res.success) {
      toast('已删除', 'success')
      await loadCurrent()
    } else {
      toast(`删除失败 code=${res.error?.code}`, 'error')
    }
  } finally {
    loading.value = false
  }
}

function doDownload(row: any) {
  enqueue(row.path, row.name, Number(row.additional?.size || 0))
  toast(`已添加「${row.name}」到下载队列`, 'success')
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
      if (res.success) toast(`${f.name} 上传完成`, 'success')
      else toast(`${f.name} 上传失败 code=${res.error?.code}`, 'error')
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
      toast('启动搜索失败', 'error')
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
    toast(`找到 ${results.length} 个结果`, 'success')
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
    toast('该类型暂不支持预览，可改为下载', 'info')
    return
  }
  if (previewType.value === 'video' || previewType.value === 'audio') {
    previewSrc.value = dsm.mediaUrl('stream', row.path)
    previewOpen.value = true
    return
  }
  const fileSize = Number(row.additional?.size ?? 0)
  const TEXT_LIMIT = 5 * 1024 * 1024
  const IMAGE_LIMIT = 20 * 1024 * 1024
  const limit = previewType.value === 'text' ? TEXT_LIMIT : IMAGE_LIMIT
  if (fileSize > limit) {
    toast(`文件过大（${formatBytes(fileSize)}），请直接下载查看`, 'warning')
    return
  }
  previewLoading.value = true
  try {
    const buf = await dsm.downloadBytes(row.path)
    if (previewType.value === 'text') {
      const decoder = new TextDecoder('utf-8', { fatal: false })
      previewText.value = decoder.decode(buf)
      previewOpen.value = true
    } else {
      const blob = new Blob([buf], { type: 'image/*' })
      previewSrc.value = URL.createObjectURL(blob)
      if (isMobile.value) {
        // 用 Vant ImagePreview 支持双指缩放、横滑
        showImagePreview({
          images: [previewSrc.value],
          showIndex: false,
          closeable: true,
          onClose: () => {
            if (previewSrc.value.startsWith('blob:')) URL.revokeObjectURL(previewSrc.value)
            previewSrc.value = ''
          },
        })
      } else {
        previewOpen.value = true
      }
    }
  } catch (e: any) {
    toast('预览失败：' + (e?.message ?? e), 'error')
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
  if (row.isdir !== undefined) return !!row.isdir
  if (row.additional?.type) return row.additional.type === 'dir'
  return row.additional?.size === undefined
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

function sortByName(a: any, b: any) { return (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN') }
function sortBySize(a: any, b: any) { return (Number(a.additional?.size) || 0) - (Number(b.additional?.size) || 0) }
function sortByTime(a: any, b: any) { return (Number(a.additional?.time?.mtime) || 0) - (Number(b.additional?.time?.mtime) || 0) }

// 移动端紧凑日期：今天 → HH:mm；本年 → MM/DD；其它 → YY/MM/DD
function shortDate(epoch: number): string {
  const d = new Date(epoch * 1000)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  const sameYear = d.getFullYear() === now.getFullYear()
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  if (sameYear) return `${mm}/${dd}`
  return `${String(d.getFullYear()).slice(2)}/${mm}/${dd}`
}

// ========== 移动端 ActionSheet（声明式） ==========
const sheetOpen = ref(false)
const sheetActions = ref<ActionSheetAction[]>([])
function openSheet(actions: ActionSheetAction[]) {
  sheetActions.value = actions
  sheetOpen.value = true
}
function onSheetSelect(action: ActionSheetAction) {
  sheetOpen.value = false
  ;(action as any).callback?.()
}

function openRowActions(row: any) {
  const actions: ActionSheetAction[] = []
  if (!isRowDir(row)) {
    actions.push({ name: '预览', callback: () => preview(row) } as any)
    actions.push({ name: '下载', callback: () => doDownload(row) } as any)
  }
  actions.push({ name: '复制到…', callback: () => startCopyMove('copy', [row.path]) } as any)
  actions.push({ name: '移动到…', callback: () => startCopyMove('move', [row.path]) } as any)
  actions.push({ name: '重命名', callback: () => doRename(row) } as any)
  actions.push({ name: '删除', color: '#EF4444', callback: () => doDelete(row) } as any)
  openSheet(actions)
}

function openSortSheet() {
  openSheet([
    { name: '按名称' + (sortKey.value === 'name' ? (sortOrder.value === 'ascending' ? ' ↑' : ' ↓') : ''), callback: () => { sortKey.value = 'name'; sortOrder.value = 'ascending' } } as any,
    { name: '按大小' + (sortKey.value === 'size' ? (sortOrder.value === 'ascending' ? ' ↑' : ' ↓') : ''), callback: () => { sortKey.value = 'size'; sortOrder.value = 'descending' } } as any,
    { name: '按修改时间' + (sortKey.value === 'time' ? (sortOrder.value === 'ascending' ? ' ↑' : ' ↓') : ''), callback: () => { sortKey.value = 'time'; sortOrder.value = 'descending' } } as any,
    { name: '反转顺序', callback: () => { sortOrder.value = sortOrder.value === 'ascending' ? 'descending' : 'ascending' } } as any,
  ])
}

function openMoreSheet() {
  const actions: ActionSheetAction[] = []
  if (path.value && !inSearchMode.value) {
    actions.push({ name: '新建文件夹', callback: doCreateFolder } as any)
  }
  if (path.value) {
    actions.push({ name: isFavorite(path.value) ? '取消收藏' : '收藏当前目录', callback: () => toggleFavorite(path.value) } as any)
  }
  actions.push({ name: '多选模式', callback: () => { selectMode.value = true } } as any)
  actions.push({ name: '排序', callback: openSortSheet } as any)
  if (inSearchMode.value) {
    actions.push({ name: '退出搜索', callback: exitSearch } as any)
  }
  openSheet(actions)
}
</script>

<template>
  <!-- ========== 桌面端 ========== -->
  <el-container v-if="!isMobile" class="page">
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
      <div v-if="dragging" class="drop-overlay">
        <el-icon :size="48"><Upload /></el-icon>
        <span>松开以上传文件</span>
      </div>

      <div v-if="selection.length" class="batch-bar">
        <span>已选 {{ selection.length }} 项</span>
        <el-button size="small" @click="batchDownload">批量下载</el-button>
        <el-button size="small" @click="batchCopy">复制到…</el-button>
        <el-button size="small" @click="batchMove">移动到…</el-button>
        <el-button size="small" type="danger" @click="batchDelete">批量删除</el-button>
      </div>

      <el-table :data="sortedItems" stripe @row-dblclick="openFolder" @selection-change="onSelectionChange" @sort-change="onSortChange" style="width: 100%">
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
        <el-table-column prop="name" label="名称" sortable="custom" />
        <el-table-column prop="size" label="大小" width="110" sortable="custom">
          <template #default="{ row }">{{ isRowDir(row) ? '—' : formatBytes(row.additional?.size) }}</template>
        </el-table-column>
        <el-table-column prop="time" label="修改时间" width="170" sortable="custom">
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

  <!-- ========== 移动端 ========== -->
  <div v-else class="m-files">
    <!-- 顶部：返回 + 当前目录 + 面包屑 + 搜索 -->
    <div class="m-files-head">
      <div class="m-files-bar">
        <button
          class="m-files-back"
          :class="{ disabled: !crumbs.length }"
          :disabled="!crumbs.length"
          @click="goUp"
          aria-label="返回上级"
        >
          <van-icon name="arrow-left" size="20" />
        </button>
        <div class="m-files-title">
          {{ crumbs.length ? crumbs[crumbs.length - 1] : '共享文件夹' }}
        </div>
        <button
          v-if="path"
          class="m-files-fav"
          :class="{ active: isFavorite(path) }"
          @click="toggleFavorite(path)"
          aria-label="收藏"
        >
          <van-icon :name="isFavorite(path) ? 'star' : 'star-o'" size="20" />
        </button>
      </div>
      <div class="m-crumbs-wrap">
        <div class="m-crumbs">
          <span class="m-crumb-item" @click="loadShares">
            <van-icon name="wap-home-o" size="14" />
            共享
          </span>
          <template v-for="(c, i) in crumbs" :key="i + c">
            <span class="m-crumb-sep">/</span>
            <span class="m-crumb-item" :class="{ active: i === crumbs.length - 1 }" @click="crumbJump(i)">{{ c }}</span>
          </template>
        </div>
      </div>
      <van-search
        v-model="searchPattern"
        placeholder="搜索当前目录"
        shape="round"
        @search="doSearch"
      >
        <template #right-icon>
          <van-icon v-if="inSearchMode" name="cross" @click="exitSearch" />
        </template>
      </van-search>
      <div v-if="favorites.length" class="m-favs">
        <van-tag
          v-for="f in favorites"
          :key="f"
          type="primary"
          plain
          closeable
          @click="openFolder({ path: f, isdir: true })"
          @close="toggleFavorite(f)"
          class="m-fav-tag"
        >{{ f.split('/').pop() || f }}</van-tag>
      </div>
    </div>

    <!-- 多选工具栏 -->
    <div v-if="selectMode" class="m-batch-bar">
      <div class="m-batch-info">已选 {{ selectedPaths.size }} 项</div>
      <van-button size="mini" @click="batchDownload">下载</van-button>
      <van-button size="mini" @click="batchCopy">复制</van-button>
      <van-button size="mini" @click="batchMove">移动</van-button>
      <van-button size="mini" type="danger" @click="batchDelete">删除</van-button>
      <van-button size="mini" plain @click="exitSelectMode">完成</van-button>
    </div>

    <van-pull-refresh v-model="refreshing" @refresh="onPullRefresh">
      <van-empty v-if="!loading && !sortedItems.length" description="目录为空" />
      <div v-else class="m-list">
        <div
          v-for="row in sortedItems"
          :key="row.path"
          class="m-row"
          :class="{ 'm-row-selected': selectedPaths.has(row.path) }"
          @click="openFolder(row)"
        >
          <!-- 左：图标 / 缩略图 / 选择框 -->
          <div class="m-row-left">
            <van-checkbox
              v-if="selectMode"
              :model-value="selectedPaths.has(row.path)"
              shape="square"
              @click.stop
              @update:model-value="toggleSelect(row)"
            />
            <img
              v-else-if="isThumbable(row) && thumbs[row.path]"
              :src="thumbs[row.path]"
              class="m-row-thumb"
            />
            <FileTypeIcon
              v-else
              :name="row.name"
              :is-dir="isRowDir(row)"
              :size="40"
            />
          </div>

          <!-- 中：文件名 + meta -->
          <div class="m-row-mid">
            <div class="m-row-name">{{ row.name }}</div>
            <div class="m-row-meta">
              <span v-if="!isRowDir(row)" class="m-row-size">{{ formatBytes(row.additional?.size) }}</span>
              <span v-else class="m-row-size">文件夹</span>
              <span v-if="row.additional?.time?.mtime" class="m-row-dot">·</span>
              <span v-if="row.additional?.time?.mtime" class="m-row-date">{{ shortDate(row.additional.time.mtime) }}</span>
            </div>
          </div>

          <!-- 右：操作 / 进入 -->
          <button
            v-if="!selectMode"
            class="m-row-action"
            @click.stop="openRowActions(row)"
            aria-label="更多操作"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
        </div>
      </div>
    </van-pull-refresh>

    <!-- 文件上传隐藏 input -->
    <input ref="uploadInput" type="file" multiple style="display:none" @change="onUploadPicked" />

    <!-- 浮动操作按钮 (FAB) -->
    <div v-if="!selectMode" class="m-fab-group">
      <van-button v-if="canUpload" round type="primary" icon="upgrade" class="m-fab" @click="triggerUpload" />
      <van-button round icon="ellipsis" class="m-fab m-fab-more" @click="openMoreSheet" />
    </div>

    <!-- 视频/音频/文本预览 popup（图片走 ImagePreview） -->
    <van-popup
      v-model:show="previewOpen"
      position="bottom"
      :style="{ height: '100%' }"
    >
      <van-nav-bar :title="previewTitle" left-arrow @click-left="previewOpen = false" />
      <div class="m-preview-body">
        <video v-if="previewType === 'video' && previewSrc" :src="previewSrc" class="m-preview-media" controls autoplay playsinline />
        <audio v-else-if="previewType === 'audio' && previewSrc" :src="previewSrc" controls style="width:100%" />
        <pre v-else-if="previewType === 'text'" class="m-preview-text">{{ previewText }}</pre>
      </div>
    </van-popup>

    <van-action-sheet
      v-model:show="sheetOpen"
      :actions="sheetActions"
      cancel-text="取消"
      close-on-click-action
      @select="onSheetSelect"
    />

    <FolderPicker
      v-model="copyMovePickerOpen"
      :initial="path"
      :title="copyMoveMode === 'copy' ? '复制到…' : '移动到…'"
      @confirm="onCopyMoveConfirm"
    />
  </div>
</template>

<style scoped>
/* ========== Desktop ========== */
.page { height: 100%; display: flex; flex-direction: column; }
.header {
  display: flex; align-items: center; padding: 10px 16px; gap: 8px;
  position: sticky; top: 0; z-index: 10;
  background: var(--sl-bg-card);
  border-bottom: var(--sl-border);
}
.page-title { margin: 0 8px 0 4px; font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); white-space: nowrap; }
a { cursor: pointer; color: var(--sl-primary); }
.preview-body { display: flex; justify-content: center; align-items: center; min-height: 50vh; border-radius: var(--sl-radius-sm); overflow: hidden; }
.preview-media { max-width: 100%; max-height: 70vh; }
.preview-text {
  width: 100%; max-height: 70vh; overflow: auto;
  background: var(--el-fill-color); padding: 16px; border-radius: var(--sl-radius-sm);
  white-space: pre-wrap; word-break: break-all; font-family: 'SF Mono', Consolas, Monaco, monospace; font-size: 13px;
}
.thumb {
  width: 40px; height: 40px; object-fit: cover; border-radius: var(--sl-radius-sm); cursor: pointer; display: block;
  background: var(--el-fill-color);
}
.thumb-ph { color: #c0c4cc; }

:deep(.el-table) {
  border-radius: var(--sl-radius-sm); overflow: hidden;
  --el-table-border-color: var(--el-border-color-lighter);
}
:deep(.el-table th.el-table__cell) {
  background: var(--el-fill-color); font-weight: 600; font-size: 12px;
  text-transform: uppercase; letter-spacing: 0.03em;
}
:deep(.el-table tr) { transition: background var(--sl-transition-fast); }
:deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(0, 0, 0, 0.015);
}
:deep(.el-main) { padding: 12px 16px; position: relative; }
.drag-over { outline: 2px dashed var(--sl-primary); outline-offset: -4px; background: rgba(99, 102, 241, 0.04); }
.drop-overlay {
  position: absolute; inset: 0; z-index: 100;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgba(255,255,255,0.85); backdrop-filter: blur(4px);
  color: var(--sl-primary); font-size: 14px; font-weight: 500;
  pointer-events: none;
}
.batch-bar {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 8px;
  background: var(--el-color-primary-light-9); border-radius: var(--sl-radius-sm);
  font-size: 13px; color: var(--el-text-color-primary);
}
.favorites-bar {
  display: flex; align-items: center; gap: 6px; padding: 6px 16px;
  overflow-x: auto; flex-shrink: 0;
  font-size: 12px; color: var(--el-text-color-secondary);
}
.fav-tag { cursor: pointer; }

/* ========== Mobile (shadcn-style) ========== */
.m-files {
  min-height: 100%;
  padding-bottom: 100px;
  max-width: 100vw;
  overflow-x: hidden;
  background: hsl(var(--background));
}
.m-files-head {
  background: hsl(var(--card));
  border-bottom: 1px solid hsl(var(--border));
  position: sticky;
  top: 0;
  z-index: 8;
}
.m-files-bar {
  display: flex; align-items: center;
  padding: 8px 10px;
  gap: 4px;
}
.m-files-back {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none;
  color: hsl(var(--foreground));
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}
.m-files-back:active { background: hsl(var(--muted)); }
.m-files-back.disabled { color: hsl(var(--muted-foreground) / 0.4); cursor: default; }
.m-files-title {
  flex: 1; min-width: 0;
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-align: center;
  letter-spacing: -0.01em;
}
.m-files-fav {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none;
  color: hsl(var(--muted-foreground));
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}
.m-files-fav:active { background: hsl(var(--muted)); }
.m-files-fav.active { color: hsl(38 92% 50%); }

/* 面包屑：横向滚动 + 两端渐变蒙板 */
.m-crumbs-wrap {
  position: relative;
  padding: 6px 0 10px;
}
.m-crumbs-wrap::before,
.m-crumbs-wrap::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0;
  width: 16px;
  pointer-events: none;
  z-index: 1;
}
.m-crumbs-wrap::before {
  left: 0;
  background: linear-gradient(to right, hsl(var(--card)), transparent);
}
.m-crumbs-wrap::after {
  right: 0;
  background: linear-gradient(to left, hsl(var(--card)), transparent);
}
.m-crumbs {
  display: flex; align-items: center; gap: 4px;
  padding: 0 16px;
  font-size: 13px;
  overflow-x: auto;
  white-space: nowrap;
  color: hsl(var(--muted-foreground));
  scrollbar-width: none;
}
.m-crumbs::-webkit-scrollbar { display: none; }
.m-crumb-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
}
.m-crumb-item.active { color: hsl(var(--foreground)); font-weight: 500; background: hsl(var(--muted)); }
.m-crumb-sep { color: hsl(var(--muted-foreground) / 0.5); flex-shrink: 0; }

.m-favs {
  display: flex; align-items: center; padding: 0 16px 10px;
  gap: 6px;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}
.m-favs::-webkit-scrollbar { display: none; }
.m-fav-tag { flex-shrink: 0; }

.m-batch-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px;
  background: hsl(var(--muted));
  border-bottom: 1px solid hsl(var(--border));
  position: sticky; top: 0; z-index: 9;
  font-size: 13px;
  flex-wrap: wrap;
}
.m-batch-info { flex: 1; min-width: 0; color: hsl(var(--foreground)); font-weight: 500; }

/* shadcn-style 列表卡片 */
.m-list {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  margin: 10px 12px;
  overflow: hidden;
}
.m-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: hsl(var(--card));
  border-bottom: 1px solid hsl(var(--border));
  cursor: pointer;
  transition: background var(--sl-transition-fast);
  min-width: 0;
}
.m-row:last-child { border-bottom: none; }
.m-row:active { background: hsl(var(--muted)); }
.m-row-selected { background: hsl(var(--brand) / 0.06); }

.m-row-left {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.m-row-thumb {
  width: 36px; height: 36px;
  object-fit: cover;
  border-radius: 6px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
}

.m-row-mid {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-row-name {
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.35;
  letter-spacing: -0.01em;
}
.m-row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.3;
}
.m-row-size, .m-row-date { flex-shrink: 0; }
.m-row-dot { color: hsl(var(--muted-foreground) / 0.5); }

.m-row-action {
  flex-shrink: 0;
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.m-row-action:active { background: hsl(var(--muted)); }

.m-fab-group {
  position: fixed; right: 16px;
  bottom: calc(56px + var(--sl-safe-bottom) + 16px);
  display: flex; flex-direction: column; gap: 10px; z-index: 99;
}
.m-fab {
  width: 48px; height: 48px;
  box-shadow: 0 4px 12px -2px hsl(240 5% 30% / 0.18);
  border: 1px solid hsl(var(--border));
}
.m-fab-more { background: hsl(var(--card)) !important; color: hsl(var(--foreground)) !important; }

.m-preview-body {
  flex: 1; display: flex; align-items: center; justify-content: center;
  background: #000; height: calc(100% - 46px); overflow: auto;
}
.m-preview-media { max-width: 100%; max-height: 100%; }
.m-preview-text {
  width: 100%; height: 100%; overflow: auto; padding: 16px;
  background: var(--sl-bg-card); color: var(--el-text-color-primary);
  white-space: pre-wrap; word-break: break-all;
  font-family: 'SF Mono', Consolas, Monaco, monospace; font-size: 13px; box-sizing: border-box;
}
</style>
