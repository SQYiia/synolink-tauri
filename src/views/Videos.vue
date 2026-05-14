<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { openUrl } from '@tauri-apps/plugin-opener'
import { dsm } from '../api/dsm'
import { formatBytes } from '../utils/format'
import { useMediaScan } from '../composables/useMediaScan'
import FolderPicker from '../components/FolderPicker.vue'
import LazyThumb from '../components/LazyThumb.vue'

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'ts', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', '3gp'])

function isVideo(f: any): boolean {
  if (f.isdir) return false
  const name = (f.name as string) || ''
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return VIDEO_EXT.has(ext)
}

const {
  folder, loading, items: videos, visibleCount, visibleItems: visibleVideos, sentinel,
  scan, onPickFolder, onBaseUrlChange, initFromStorage, setupSentinel, cleanup,
} = useMediaScan({
  extensions: 'mp4,webm,mov,mkv,avi,ts,m4v,mpg,mpeg,wmv,flv,3gp',
  filterFn: isVideo,
  visibleInit: 40,
  visibleStep: 40,
  storageKeyPrefix: 'video:folder',
})

const playerOpen = ref(false)
const playingSrc = ref('')
const playingName = ref('')
const playingPath = ref('')
const pickerOpen = ref(false)
const videoEl = ref<HTMLVideoElement | null>(null)

const PROGRESS_KEY = 'video:progress'
const DURATION_KEY = 'video:duration'

const durations = ref<Record<string, number>>(loadDurations())

function loadProgress(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') } catch { return {} }
}

function loadDurations(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(DURATION_KEY) || '{}') } catch { return {} }
}

function saveDuration(path: string, dur: number) {
  if (!path || !dur || !isFinite(dur)) return
  durations.value[path] = dur
  localStorage.setItem(DURATION_KEY, JSON.stringify(durations.value))
}

function saveProgress() {
  const el = videoEl.value
  if (!el || !playingPath.value) return
  // Only save if played past 5s and not near end (last 10s)
  if (el.currentTime > 5 && el.duration - el.currentTime > 10) {
    const map = loadProgress()
    map[playingPath.value] = el.currentTime
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map))
  }
}

function restoreProgress() {
  const el = videoEl.value
  if (!el || !playingPath.value) return
  const map = loadProgress()
  const t = map[playingPath.value]
  if (t && t > 5) {
    el.currentTime = t
    ElMessage.info(`已恢复到上次播放位置 ${formatTime(t)}`)
  }
}

function clearProgress(path: string) {
  const map = loadProgress()
  delete map[path]
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(map))
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

function onVideoLoaded() {
  const el = videoEl.value
  if (el && playingPath.value && el.duration) {
    saveDuration(playingPath.value, el.duration)
  }
  restoreProgress()
}

let lastSaveTime = 0

function onTimeUpdate() {
  const now = Date.now()
  if (now - lastSaveTime < 5000) return
  lastSaveTime = now
  saveProgress()
}

function onVideoEnded() {
  if (playingPath.value) clearProgress(playingPath.value)
}

onMounted(() => {
  const hasFolder = initFromStorage()
  if (hasFolder) scan()
  setupSentinel()
})

onBeforeUnmount(() => { cleanup() })

watch(() => dsm.baseUrl, () => { onBaseUrlChange() })

function coverOf(v: any) {
  return dsm.mediaUrl('thumb', v.path, { size: 'small' })
}

function play(v: any) {
  playingName.value = v.name
  playingPath.value = v.path
  playingSrc.value = dsm.mediaUrl('stream', v.path)
  playerOpen.value = true
}

watch(playerOpen, (open) => {
  if (!open) {
    saveProgress()
    playingSrc.value = ''
    playingName.value = ''
    playingPath.value = ''
  }
})

function sizeOf(v: any): number | string | undefined {
  return v?.additional?.size ?? v?.size ?? v?.filesize ?? v?.additional?.real_size
}

function qualityTag(v: any): string {
  const ext = (v.name as string)?.toLowerCase().split('.').pop() ?? ''
  return ext.toUpperCase()
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
            <div class="duration" v-if="durations[v.path]">{{ formatTime(durations[v.path]) }}</div>
            <div class="play-mask">
              <el-icon :size="48"><VideoPlay /></el-icon>
            </div>
          </div>
          <div class="meta">
            <div class="name">{{ v.name }}</div>
            <div class="row">
              <span class="size">{{ formatBytes(sizeOf(v)) }}</span>
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
          ref="videoEl"
          :src="playingSrc"
          class="player"
          controls
          autoplay
          preload="metadata"
          @loadedmetadata="onVideoLoaded"
          @timeupdate="onTimeUpdate"
          @ended="onVideoEnded"
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
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 0 14px; }
.title { margin: 0; font-size: 24px; font-weight: 700; color: var(--el-text-color-primary); }
.actions { display: flex; gap: 8px; }
.folder-bar {
  display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--el-text-color-secondary);
  background: var(--sl-bg-card); border-radius: var(--sl-radius-md); padding: 10px 14px; margin-bottom: 14px;
  box-shadow: var(--sl-shadow-sm);
}
.folder-path { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count { color: var(--sl-primary); font-weight: 600; }
.body { min-height: 200px; }
.empty { text-align: center; padding: 80px 0; color: var(--el-text-color-secondary); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.sentinel {
  text-align: center; padding: 16px 0; font-size: 12px; color: var(--el-text-color-secondary);
  min-height: 40px;
}
.card {
  cursor: pointer; background: var(--sl-bg-card); border-radius: var(--sl-radius-md); overflow: hidden;
  transition: transform var(--sl-transition-normal), box-shadow var(--sl-transition-normal);
  box-shadow: var(--sl-shadow-sm);
}
.card:hover { transform: translateY(-4px) scale(1.01); box-shadow: var(--sl-shadow-hover); }
.card:active { transform: scale(0.98); }
.cover-wrap { position: relative; }
.cover-wrap::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40%;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.4));
  pointer-events: none;
}
.quality {
  position: absolute; top: 10px; right: 10px;
  padding: 3px 10px; border-radius: var(--sl-radius-pill); font-size: 11px; font-weight: 600;
  background: rgba(0, 0, 0, 0.55); color: #fff; backdrop-filter: blur(6px);
  z-index: 1;
}
.duration {
  position: absolute; bottom: 10px; right: 10px;
  padding: 2px 8px; border-radius: var(--sl-radius-pill); font-size: 11px; font-weight: 600;
  background: rgba(0, 0, 0, 0.65); color: #fff; backdrop-filter: blur(6px);
  z-index: 1;
}
.play-mask {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #fff; opacity: 0; transition: opacity var(--sl-transition-normal); background: rgba(0, 0, 0, 0.25);
  z-index: 1;
}
.card:hover .play-mask { opacity: 1; }
.meta { padding: 12px 14px; }
.row { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; }
.name {
  font-size: 14px; color: var(--el-text-color-primary); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; font-weight: 600;
}
.size { font-size: 12px; color: var(--el-text-color-secondary); }
.player-box { display: flex; justify-content: center; align-items: center; background: #000; border-radius: var(--sl-radius-md); overflow: hidden; }
.player { width: 100%; max-height: 75vh; background: #000; }
.player-tip { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 10px; text-align: center; }
</style>
