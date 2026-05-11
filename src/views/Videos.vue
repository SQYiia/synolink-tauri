<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, markRaw, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { openUrl } from '@tauri-apps/plugin-opener'
import { dsm } from '../api/dsm'
import FolderPicker from '../components/FolderPicker.vue'
import LazyThumb from '../components/LazyThumb.vue'

const router = useRouter()
const folder = ref('')
const loading = ref(false)
const videos = shallowRef<any[]>([])
const playerOpen = ref(false)
const playingSrc = ref('')
const playingName = ref('')
const pickerOpen = ref(false)
let scanGen = 0

const VISIBLE_INIT = 40
const VISIBLE_STEP = 40
const visibleCount = ref(VISIBLE_INIT)
const sentinel = ref<HTMLElement | null>(null)
let sentinelObserver: IntersectionObserver | null = null

const STORAGE_KEY = computed(() => `video:folder:${dsm.baseUrl}`)

onMounted(() => {
  if (!dsm.sid) {
    router.replace('/servers')
    return
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY.value)
    if (saved) {
      folder.value = saved
      scan()
    }
  } catch {}

  nextTick(() => {
    if (!sentinel.value) return
    sentinelObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && visibleCount.value < videos.value.length) {
          visibleCount.value = Math.min(videos.value.length, visibleCount.value + VISIBLE_STEP)
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

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'ts', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', '3gp'])

function isVideo(f: any): boolean {
  if (f.isdir) return false
  const name = (f.name as string) || ''
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return VIDEO_EXT.has(ext)
}

async function scan() {
  if (!folder.value) return
  loading.value = true
  videos.value = []
  visibleCount.value = VISIBLE_INIT
  scanGen++
  const gen = scanGen
  let taskid = ''
  try {
    const start = await dsm.searchStart(folder.value, '', true, {
      extension: 'mp4,webm,mov,mkv,avi,ts,m4v,mpg,mpeg,wmv,flv,3gp',
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

    let debugLogged = false
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
        if (!debugLogged) {
          // eslint-disable-next-line no-console
          console.log('[Videos] 首条搜索结果结构:', JSON.parse(JSON.stringify(batch[0])))
          debugLogged = true
        }
        for (const f of batch) markRaw(f)
        collected.push(...batch)
        offset += batch.length
        videos.value = collected.filter(isVideo)
        idleRounds = 0
        // 每拉完一页让出一帧，避免长时间独占主线程造成其他 Tab 卡顿
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

    ElMessage.success(`扫描完成：${videos.value.length} 个视频`)
  } catch (e: any) {
    ElMessage.error('扫描出错: ' + (e?.message ?? e))
  } finally {
    if (taskid) await dsm.searchStop(taskid).catch(() => {})
    loading.value = false
  }
}

function coverOf(v: any) {
  return dsm.mediaUrl('thumb', v.path, { size: 'small' })
}

/** 实际渲染到 DOM 的部分 */
const visibleVideos = computed(() => videos.value.slice(0, visibleCount.value))

function play(v: any) {
  playingName.value = v.name
  playingSrc.value = dsm.mediaUrl('stream', v.path)
  playerOpen.value = true
}

watch(playerOpen, (open) => {
  if (!open) {
    playingSrc.value = ''
    playingName.value = ''
  }
})

function formatSize(n?: number | string) {
  const num = typeof n === 'string' ? Number(n) : (n ?? 0)
  if (!num || isNaN(num)) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = num
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i]
}

/** 从多种可能字段中兜底取文件大小 */
function sizeOf(v: any): number | string | undefined {
  return v?.additional?.size ?? v?.size ?? v?.filesize ?? v?.additional?.real_size
}

/** 用扩展名推测清晰度标签（纯装饰） */
function qualityTag(v: any): string {
  const ext = (v.name as string)?.toLowerCase().split('.').pop() ?? ''
  return ext.toUpperCase()
}

function onPickFolder(p: string) {
  folder.value = p
  try { localStorage.setItem(STORAGE_KEY.value, p) } catch {}
  scan()
}

async function openExternal(v: any, e: Event) {
  e.stopPropagation()
  try {
    const url = dsm.downloadUrl(v.path, 'open')
    await openUrl(url)
  } catch (err: any) {
    ElMessage.error('打开外部播放器失败: ' + (err?.message ?? err))
  }
}

watch(() => dsm.baseUrl, () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY.value)
    folder.value = saved ?? ''
    videos.value = []
    visibleCount.value = VISIBLE_INIT
    if (saved) scan()
  } catch {}
})
</script>

<template>
  <div class="page">
    <header class="topbar">
      <h2 class="title">视频</h2>
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
      <span class="count">共 {{ videos.length }} 个</span>
    </div>

    <main class="body" v-loading="loading">
      <div v-if="!folder" class="empty">
        <el-icon :size="64" color="#c0c4cc"><VideoCamera /></el-icon>
        <div style="margin-top:12px">请选择要浏览的视频目录</div>
        <el-button type="primary" style="margin-top:16px" @click="pickerOpen = true">选择目录</el-button>
      </div>
      <div v-else-if="!videos.length && !loading" class="empty">
        <el-icon :size="64" color="#c0c4cc"><VideoCamera /></el-icon>
        <div style="margin-top:12px">此目录暂无视频</div>
      </div>

      <div class="grid">
        <div
          v-for="v in visibleVideos"
          :key="v.path"
          class="card"
          @click="play(v)"
          :title="v.name"
        >
          <div class="cover-wrap">
            <LazyThumb :src="coverOf(v)" :alt="v.name" aspect-ratio="16/9">
              <template #fallback>
                <el-icon :size="40"><VideoCamera /></el-icon>
              </template>
            </LazyThumb>
            <div class="quality">{{ qualityTag(v) }}</div>
            <div class="play-mask">
              <el-icon :size="48"><VideoPlay /></el-icon>
            </div>
          </div>
          <div class="meta">
            <div class="name">{{ v.name }}</div>
            <div class="row">
              <span class="size">{{ formatSize(sizeOf(v)) }}</span>
              <el-button size="small" link type="primary" @click="openExternal(v, $event)">
                <el-icon style="margin-right:3px"><Monitor /></el-icon>
                系统播放器
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部哨兵 -->
      <div ref="sentinel" class="sentinel">
        <span v-if="visibleCount < videos.length">
          已展示 {{ visibleCount }} / {{ videos.length }}，继续下滑加载…
        </span>
        <span v-else-if="videos.length > 0">共 {{ videos.length }} 个视频</span>
      </div>
    </main>

    <el-dialog
      v-model="playerOpen"
      :title="playingName"
      width="90%"
      top="3vh"
      destroy-on-close
    >
      <div class="player-box">
        <video
          v-if="playingSrc"
          :src="playingSrc"
          class="player"
          controls
          autoplay
          preload="metadata"
        />
      </div>
      <div class="player-tip">
        播放黑屏或进度条无法拖动？常见于 <b>mkv / avi / wmv</b> 等 WebView 不支持的封装，请点击列表卡片上的 "系统播放器" 用 VLC / PotPlayer 打开。
      </div>
    </el-dialog>

    <FolderPicker v-model="pickerOpen" :initial="folder" title="选择视频目录" @confirm="onPickFolder" />
  </div>
</template>

<style scoped>
.page { padding: 12px 16px 24px; max-width: 1400px; margin: 0 auto; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 6px 0 12px; }
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
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.sentinel {
  text-align: center; padding: 16px 0; font-size: 12px; color: var(--el-text-color-secondary);
  min-height: 40px;
}
.card {
  cursor: pointer; background: var(--el-bg-color); border-radius: 10px; overflow: hidden;
  transition: transform 0.15s, box-shadow 0.15s;
  border: 1px solid var(--el-border-color-lighter);
}
.card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.08); }
.cover-wrap { position: relative; }
.cover { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: var(--el-fill-color); }
.cover.placeholder { display: flex; align-items: center; justify-content: center; color: var(--el-text-color-placeholder); }
.quality {
  position: absolute; top: 8px; right: 8px;
  padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
  background: rgba(0,0,0,0.6); color: #fff; backdrop-filter: blur(4px);
}
.play-mask {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #fff; opacity: 0; transition: opacity 0.2s; background: rgba(0,0,0,0.3);
}
.card:hover .play-mask { opacity: 1; }
.meta { padding: 10px 12px; }
.row { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.name { font-size: 14px; color: var(--el-text-color-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.size { font-size: 12px; color: var(--el-text-color-secondary); }
.player-box { display: flex; justify-content: center; align-items: center; background: #000; border-radius: 6px; }
.player { width: 100%; max-height: 75vh; background: #000; }
.player-tip { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 10px; text-align: center; }
</style>
