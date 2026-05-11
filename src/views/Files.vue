<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { openUrl } from '@tauri-apps/plugin-opener'
import { dsm } from '../api/dsm'

const router = useRouter()
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

onMounted(async () => {
  if (!dsm.sid) {
    router.replace('/servers')
    return
  }
  await loadShares()
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

async function doDownload(row: any) {
  const url = dsm.downloadUrl(row.path, 'download')
  try {
    await openUrl(url)
    ElMessage.success('已交由系统浏览器下载')
  } catch (e: any) {
    ElMessage.error('打开下载链接失败：' + (e?.message ?? e))
  }
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
    // 轮询 3 次
    let results: any[] = []
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 700))
      const list = await dsm.searchList(searchTaskId.value, { limit: 500 })
      if (list.success) results = (list.data as any)?.files ?? []
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

function formatSize(n?: number) {
  if (!n) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i]
}

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
    <el-main v-loading="loading">
      <el-table :data="items" stripe @row-dblclick="openFolder" style="width: 100%">
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
        <el-table-column prop="name" label="名称" />
        <el-table-column label="大小" width="110">
          <template #default="{ row }">{{ isRowDir(row) ? '—' : formatSize(row.additional?.size) }}</template>
        </el-table-column>
        <el-table-column label="修改时间" width="170">
          <template #default="{ row }">
            <span v-if="row.additional?.time?.mtime">{{ new Date(row.additional.time.mtime * 1000).toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button v-if="!isRowDir(row)" size="small" @click="preview(row)">预览</el-button>
            <el-button v-if="!isRowDir(row)" size="small" @click="doDownload(row)">下载</el-button>
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
  </el-container>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.header { display: flex; align-items: center; padding: 6px 12px; gap: 6px; }
.page-title { margin: 0 8px 0 4px; font-size: 20px; color: var(--el-text-color-primary); }
a { cursor: pointer; color: #409eff; }
.preview-body { display: flex; justify-content: center; align-items: center; min-height: 50vh; }
.preview-media { max-width: 100%; max-height: 70vh; }
.preview-text { width: 100%; max-height: 70vh; overflow: auto; background: #f5f7fa; padding: 12px; border-radius: 4px; white-space: pre-wrap; word-break: break-all; font-family: Consolas, Monaco, monospace; font-size: 13px; }
.thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; cursor: pointer; display: block; background: #f5f7fa; }
.thumb-ph { color: #c0c4cc; }
</style>
