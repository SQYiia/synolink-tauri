<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import LazyThumb from './LazyThumb.vue'
import { readSidecars } from '../utils/sidecars'
import { formatBytes } from '../utils/format'
const props = defineProps<{file:any;fallback:string}>()
const emit = defineEmits<{play:[file:any]}>()
const root = ref<HTMLElement>(), data = ref<Awaited<ReturnType<typeof readSidecars>>>(), details = ref(false), ready = ref(false), warning = ref('')
let observer:IntersectionObserver|undefined, disposed = false
async function load() { const timer = setTimeout(() => { if(!disposed) ready.value = true }, 1200); try { const result = await readSidecars(props.file); if(!disposed) data.value = result } catch { if(!disposed) warning.value = '附加资料读取失败，已使用视频缩略图' } finally { clearTimeout(timer); if(!disposed) ready.value = true } }
onMounted(() => { observer = new IntersectionObserver(entries => { if(entries.some(e=>e.isIntersecting)) { observer?.disconnect(); void load() } },{rootMargin:'100px'}); if(root.value) observer.observe(root.value) })
onBeforeUnmount(()=>{disposed=true;observer?.disconnect()})
</script>
<template><article ref="root" class="local-film video-card">
<button class="cover" :class="{poster:data?.poster}" :aria-label="'播放 ' + file.name" @click="emit('play',file)"><LazyThumb v-if="ready" :src="data?.poster || fallback" :fallback-src="data?.poster ? fallback : ''" :alt="file.name" :aspect-ratio="data?.poster ? '2/3' : '16/9'" :retryable="false" /><span class="play">▶</span></button>
<div class="meta"><h2>{{ data?.metadata?.title || file.name }}</h2><p>{{ data?.metadata?.year || formatBytes(file.additional?.size ?? file.size) }} <span v-if="data?.metadata?.rating"> · ★ {{ data.metadata.rating }}</span></p><button v-if="data?.metadata" @click="details=true">影视资料</button><span v-if="data?.warning || warning" class="warning" :title="data?.warning || warning">资料读取异常</span></div>
<el-dialog v-model="details" :title="data?.metadata?.title || file.name" width="min(700px,94vw)" append-to-body><template v-if="data?.metadata"><p>{{ data.metadata.year }} · {{ data.metadata.genres.join(' / ') }}</p><p class="plot">{{ data.metadata.plot || '暂无简介' }}</p><p v-if="data.metadata.actors.length">演员：{{ data.metadata.actors.join('、') }}</p><el-button type="primary" @click="details=false;emit('play',file)">播放视频</el-button></template></el-dialog>
</article></template>
<style scoped>.local-film{min-width:0}.cover{width:100%;border:0;padding:0;border-radius:12px;overflow:hidden;background:#1b2433;position:relative;cursor:pointer;aspect-ratio:16/9}.cover.poster{aspect-ratio:2/3}.play{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:30px;opacity:0;background:#0003}.cover:hover .play,.cover:focus-visible .play{opacity:1}.meta{padding:12px 2px}.meta h2{font-size:13px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta p{font-size:12px;color:var(--el-text-color-secondary)}.meta button{border:0;background:var(--el-fill-color-light);padding:6px 10px;border-radius:6px;color:var(--el-text-color-primary);cursor:pointer}.warning{font-size:11px;color:#ad7328}.plot{white-space:pre-wrap;line-height:1.9}</style>
