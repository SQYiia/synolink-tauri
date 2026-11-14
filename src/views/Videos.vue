<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, Folder, Refresh, VideoCamera } from '@element-plus/icons-vue'
import { dsm } from '../api/dsm'
import { useMediaScan } from '../composables/useMediaScan'
import FolderPicker from '../components/FolderPicker.vue'
import VideoLibraryCard from '../components/VideoLibraryCard.vue'
import JellyfinLibrary from '../components/JellyfinLibrary.vue'
const source = ref('nas')
const sidecarRevision = ref(0)
import { clearSidecarCache } from '../utils/sidecars'
function refreshLibrary() { clearSidecarCache(); sidecarRevision.value++; void scan() }
import { useIsMobile } from '../composables/useIsMobile'

const isMobile = useIsMobile()

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'ts', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', '3gp'])

function isVideo(f: any): boolean {
  if (f.isdir) return false
  const name = (f.name as string) || ''
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return VIDEO_EXT.has(ext)
}

const {
  folder, loading, scanError, items: videos, visibleCount, visibleItems: visibleVideos, sentinel,
  scan, onPickFolder, cleanup,
} = useMediaScan({
  extensions: 'mp4,webm,mov,mkv,avi,ts,m4v,mpg,mpeg,wmv,flv,3gp',
  filterFn: isVideo,
  visibleInit: 40,
  visibleStep: 40,
  storageKeyPrefix: 'video:folder',
  sortBy: 'crtime',
  sortDirection: 'desc',
})

const playerOpen = ref(false)
const playingSrc = ref('')
const playingName = ref('')
const playingPath = ref('')
const pickerOpen = ref(false)
const playerError = ref('')
const buffering = ref(false)
const playbackRate = ref(1)
let playingRevision = ''
let savedPlayingFrame = false
async function rememberPlayingFrame() {
  const video = videoEl.value
  if (!video || !video.videoWidth || !playingRevision || savedPlayingFrame) return
  const path = playingPath.value, server = dsm.baseUrl, account = dsm.account, revision = playingRevision
  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    canvas.width = canvas.height = 1
    if (!blob || path !== playingPath.value || server !== dsm.baseUrl || account !== dsm.account) return
    const cache = await import('../utils/imageCache')
    await cache.writeImageCache(cache.imageCacheKey(server, account, path, revision, '640'), blob)
    savedPlayingFrame = true
  } catch { /* Playback must not be affected by optional cover caching. */ }
}
function setRate(rate: number) { playbackRate.value = rate; if (videoEl.value) videoEl.value.playbackRate = rate }
function playbackError() { buffering.value = false; playerError.value = videoEl.value?.error?.code === 2 ? '视频读取失败，请检查连接后重试' : '当前视频格式或编码暂不支持内置播放' }
function retryPlayback() { playerError.value = ''; buffering.value = true; videoEl.value?.load(); void videoEl.value?.play().catch(() => { buffering.value = false }) }
const videoEl = ref<HTMLVideoElement | null>(null)

const PROGRESS_KEY = `video:progress:${dsm.baseUrl}:${dsm.account}`
const DURATION_KEY = `video:duration:${dsm.baseUrl}:${dsm.account}`

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
  try { localStorage.setItem(DURATION_KEY, JSON.stringify(durations.value)) } catch {}
}

function saveProgress() {
  const el = videoEl.value
  if (!el || !playingPath.value) return
  // Only save if played past 5s and not near end (last 10s)
  if (el.currentTime > 5 && el.duration - el.currentTime > 10) {
    const map = loadProgress()
    map[playingPath.value] = el.currentTime
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(map)) } catch {}
  }
}

function restoreProgress() {
  const el = videoEl.value
  if (!el || !playingPath.value) return
  const map = loadProgress()
  const t = map[playingPath.value]
  if (t && t > 5 && isFinite(el.duration) && t < el.duration - 10) {
    el.currentTime = t
    ElMessage.info(`已恢复到上次播放位置 ${formatTime(t)}`)
  }
}

function clearProgress(path: string) {
  const map = loadProgress()
  delete map[path]
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(map)) } catch {}
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

function onVideoLoaded() {
  const el = videoEl.value
  if (el) el.playbackRate = playbackRate.value
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

onBeforeUnmount(() => { saveProgress(); videoEl.value?.pause(); cleanup() })

function coverOf(v: any) {
  const t = v.additional?.time
  const revision: Record<string, string> = t?.mtime ? { revision: JSON.stringify([t.mtime, t.ctime ?? 0, sizeOf(v) ?? 0]) } : {}
  return dsm.mediaUrl('thumb', v.path, { size: 'medium', ...revision })
}

function play(v: any) {
  playerError.value = ''; buffering.value = true; playbackRate.value = 1
  savedPlayingFrame = false
  const time = v.additional?.time
  playingRevision = time?.mtime ? JSON.stringify([time.mtime, time.ctime ?? 0, sizeOf(v) ?? 0]) : ''
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


</script>

<template>
  <div class="source-tabs"><el-radio-group v-model="source"><el-radio-button value="nas">NAS 文件</el-radio-button><el-radio-button value="jellyfin">Jellyfin 影视库</el-radio-button></el-radio-group></div>
  <JellyfinLibrary v-if="source === 'jellyfin'" />
  <div v-show="source === 'nas'" class="video-library" :class="{ 'is-mobile': isMobile }">
    <header class="library-header">
      <div><span class="eyebrow">你的私人放映室</span><h1>视频库 <span v-if="videos.length">{{ videos.length }}</span></h1></div>
      <div class="library-actions">
        <el-button @click="pickerOpen = true"><el-icon><Folder /></el-icon><span>选择目录</span></el-button>
        <el-button :loading="loading" :disabled="!folder" @click="refreshLibrary"><el-icon><Refresh /></el-icon><span>刷新</span></el-button>
      </div>
    </header>
    <div v-if="folder" class="library-path"><el-icon><Folder /></el-icon><span :title="folder">{{ folder }}</span><span class="library-label">全部视频</span></div>
    <div v-if="loading" class="scan-message" role="status">正在更新视频库，已找到 {{ videos.length }} 个视频，已有内容可以播放…</div>
    <div v-if="scanError" class="scan-message error" role="alert">{{ scanError }} <button @click="scan">重新扫描</button></div>
    <main class="library-content">
      <div v-if="!folder || (!videos.length && !loading)" class="library-empty">
        <el-icon><VideoCamera /></el-icon><h2>{{ folder ? '这里还没有视频' : '把喜欢的视频放在一起' }}</h2>
        <p>{{ folder ? '尝试选择其他目录，或刷新视频库。' : '选择 NAS 上的视频目录，开始浏览与播放。' }}</p>
        <el-button @click="pickerOpen = true">选择视频目录</el-button>
      </div>
      <div class="video-grid">
        <VideoLibraryCard v-for="v in visibleVideos" :key="v.path + v.additional?.time?.mtime + sidecarRevision" :file="v" :fallback="coverOf(v)" @play="play" />
      </div>
      <div ref="sentinel" class="sentinel"><span v-if="visibleCount < videos.length">已显示 {{ visibleCount }} / {{ videos.length }} · 向下浏览更多</span><span v-else-if="videos.length">{{ videos.length }} 个视频 · 已全部显示</span></div>
    </main>
    <el-dialog v-model="playerOpen" class="sl-video-dialog" fullscreen :show-close="false" destroy-on-close append-to-body :title="playingName">
      <template #header><header class="player-header"><div><span>正在播放</span><h2 :title="playingName">{{ playingName }}</h2></div><button class="player-close" aria-label="关闭播放器" @click="playerOpen = false"><el-icon><Close /></el-icon></button></header></template>
      <div class="player-stage">
        <video v-if="playingSrc" ref="videoEl" :src="playingSrc" crossorigin="anonymous" controls autoplay playsinline preload="metadata" controlslist="nodownload noremoteplayback" disableRemotePlayback
          @loadedmetadata="onVideoLoaded" @timeupdate="onTimeUpdate" @ended="onVideoEnded"
          @loadeddata="rememberPlayingFrame"
          @waiting="buffering = true" @playing="buffering = false" @canplay="buffering = false" @error="playbackError" />
        <div v-if="buffering && !playerError" class="player-status" role="status"><span class="buffer-spinner"></span>正在加载视频…</div>
        <div v-if="playerError" class="player-failure" role="alert"><el-icon><VideoCamera /></el-icon><h3>暂时无法播放</h3><p>{{ playerError }}</p><button @click="retryPlayback">重新加载</button></div>
      </div>
      <footer class="player-footer"><span>自动记忆播放位置</span><div class="speed-control"><span>播放速度</span><button v-for="rate in [0.75, 1, 1.25, 1.5, 2]" :key="rate" :aria-pressed="playbackRate === rate" :class="{ active: playbackRate === rate }" @click="setRate(rate)">{{ rate }}×</button></div><span class="exit-hint">Esc 退出播放</span></footer>
    </el-dialog>
    <FolderPicker v-model="pickerOpen" :initial="folder" title="选择视频目录" @confirm="onPickFolder" />
  </div>
</template>
<style>
.el-dialog.sl-video-dialog { margin: 0; padding: 0; background: #101114; color: #eceef4; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.sl-video-dialog .el-dialog__header { padding: 0; margin: 0; }
.sl-video-dialog .el-dialog__body { padding: 0; display: flex; flex: 1; min-height: 0; flex-direction: column; color: #eceef4; }
</style>
<style scoped>
.source-tabs { padding:24px 32px 0;max-width:1600px;margin:auto;box-sizing:border-box; }
.video-library { padding: 28px 32px; max-width: 1600px; margin: 0 auto; width: 100%; box-sizing: border-box; }
.library-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 26px; }
.eyebrow { font-size: 11px; color: var(--el-text-color-secondary); letter-spacing: .15em; }
h1 { margin: 8px 0 0; font-size: 26px; font-weight: 650; letter-spacing: -.04em; } h1 span { font-size: 13px; font-weight: 400; color: var(--el-text-color-secondary); margin-left: 8px; }
.library-actions { display: flex; gap: 8px; }.library-actions .el-button { margin: 0; border-radius: 9px; }.library-actions span { margin-left: 6px; }
.library-path { display: flex; align-items: center; gap: 10px; padding-bottom: 18px; border-bottom: 1px solid var(--el-border-color-lighter); margin-bottom: 22px; font-size: 12px; color: var(--el-text-color-secondary); }
.library-path > span:first-of-type { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.library-label { font-size: 11px; }
.scan-message { padding: 10px 14px; margin-bottom: 16px; border-radius: 8px; background: var(--el-fill-color-light); font-size: 12px; color: var(--el-text-color-secondary); }.scan-message.error { color: var(--el-color-danger); }
.video-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 26px 20px; }
.video-card { cursor: pointer; min-width: 0; border-radius: 12px; outline-offset: 5px; }.video-card:focus-visible { outline: 2px solid var(--el-color-primary); }
.cover-wrap { position: relative; border-radius: 12px; overflow: hidden; background: #1d2431; aspect-ratio: 16/9; }
.cover-wrap :deep(.lazy-thumb) { background: linear-gradient(135deg, #242f43, #141923); color: #9da9bd; }.cover-wrap :deep(.fallback), .cover-wrap :deep(.placeholder) { color: #9da9bd; }.cover-wrap :deep(.error-reason) { font-size: 10px; }
.video-format,.video-duration { position: absolute; z-index: 2; color: #fff; background: #0008; border: 1px solid #ffffff18; border-radius: 5px; font-size: 10px; padding: 3px 6px; pointer-events: none; }.video-format { top: 10px; left: 10px; }.video-duration { right: 10px; bottom: 10px; }
.play-mask { position: absolute; inset: 0; display: grid; place-items: center; background: #0001; opacity: 0; transition: opacity .2s; pointer-events: none; }.play-mask > span { display: grid; place-items: center; color: white; background: #ffffff22; backdrop-filter: blur(8px); border: 1px solid #ffffff55; width: 54px; height: 54px; border-radius: 50%; font-size: 32px; }.video-card:hover .play-mask,.video-card:focus-visible .play-mask { opacity: 1; }
.video-meta { padding: 13px 2px 0; }.video-meta h2 { font-size: 13px; font-weight: 550; color: var(--el-text-color-primary); margin: 0 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.video-meta > div { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--el-text-color-secondary); }.play-label { display: flex; align-items: center; gap: 3px; opacity: 0; transition: opacity .2s; }.video-card:hover .play-label { opacity: 1; }
.library-empty { text-align: center; padding: 80px 16px; color: var(--el-text-color-secondary); }.library-empty > .el-icon { font-size: 48px; }.library-empty h2 { font-size: 18px; color: var(--el-text-color-primary); }.library-empty p { font-size: 12px; margin-bottom: 24px; }.sentinel { text-align: center; padding: 28px; font-size: 11px; color: var(--el-text-color-placeholder); }
.player-header { height: 78px; padding: 0 26px; display: flex; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 1px solid #ffffff0d; }.player-header > div { min-width: 0; }.player-header span { font-size: 10px; color: #848b9a; letter-spacing: .15em; }.player-header h2 { margin: 5px 0 0; font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.player-close { border: 1px solid #ffffff22; background: #ffffff06; color: #d8dce5; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; font-size: 19px; cursor: pointer; flex-shrink: 0; }
.player-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #050506; }.player-stage video { width: 100%; height: 100%; object-fit: contain; }.player-status { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); padding: 10px 16px; border-radius: 20px; background: #242630dd; font-size: 12px; display: flex; align-items: center; gap: 8px; pointer-events: none; }.buffer-spinner { width: 12px; height: 12px; border: 2px solid #ffffff30; border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
.player-failure { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #101114ee; }.player-failure > .el-icon { font-size: 42px; color: #7f899c; }.player-failure h3 { margin: 20px 0 6px; font-size: 18px; font-weight: 500; }.player-failure p { font-size: 12px; color: #9199a9; }.player-failure button { padding: 10px 20px; background: #ffffff12; border: 1px solid #ffffff25; color: white; border-radius: 8px; cursor: pointer; margin-top: 16px; }
.player-footer { min-height: 64px; display: flex; align-items: center; justify-content: space-between; padding: 8px 26px; gap: 16px; box-sizing: border-box; color: #808897; font-size: 11px; }.speed-control { display: flex; align-items: center; gap: 5px; }.speed-control > span { margin-right: 10px; }.speed-control button { background: transparent; border: 0; padding: 7px 10px; border-radius: 6px; color: #9ba3b3; cursor: pointer; }.speed-control button.active { color: white; background: #ffffff15; }button:focus-visible { outline: 2px solid #91b6ee; outline-offset: 3px; }
@media(max-width: 700px) { .video-library { padding: 18px 14px; }.library-header { gap: 8px; margin-bottom: 20px; }h1 { font-size: 22px; }.library-actions .el-button { padding: 8px; }.library-actions span { display: none; }.video-grid { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 20px 12px; }.cover-wrap { border-radius: 8px; }.video-meta h2 { font-size: 12px; }.play-label { display: none; }.player-header { height: 64px; padding: 0 16px; }.player-footer { flex-wrap: wrap; justify-content: center; padding: 10px; }.player-footer > span { display: none; }.player-header h2 { font-size: 13px; } }
</style>
