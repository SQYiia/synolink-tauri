<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onDeactivated } from 'vue'
import Hls from 'hls.js'
import type { JellyfinClient } from '../api/jellyfin'
import { nativeHlsLoader } from '../utils/nativeHlsLoader'
import { resumeSeconds, selectPlayback, TICKS_PER_SECOND } from '../utils/jellyfinPlayback'
const props=defineProps<{client:JellyfinClient;item:any;fromStart?:boolean}>()
const emit=defineEmits<{close:[]}>()
const video=ref<HTMLVideoElement>(), error=ref(''), loading=ref(true), syncError=ref('')
const audio=ref<number>(), subtitle=ref(-1), bitrate=ref(20000000), streams=ref<any[]>([])
const audios=computed(()=>streams.value.filter(s=>s.Type==='Audio'))
const subtitles=computed(()=>streams.value.filter(s=>s.Type==='Subtitle'))
let hls:Hls|undefined, generation=0, session:any, disposed=false, position=props.fromStart?0:resumeSeconds(props.item)
let reports=Promise.resolve()
function report(kind:'start'|'progress'|'stop',current=session){
 if(!current || (kind!=='start'&&!current.started))return
 const v=video.value
 const data={ItemId:props.item.Id,MediaSourceId:current.source.Id,PlaySessionId:current.sessionId,PositionTicks:Math.round(position*TICKS_PER_SECOND),CanSeek:true,IsPaused:v?.paused??true,IsMuted:v?.muted??false,VolumeLevel:Math.round((v?.volume??1)*100),PlayMethod:'Transcode',AudioStreamIndex:current.audio,SubtitleStreamIndex:current.subtitle}
 reports=reports.then(()=>props.client.reportPlayback(kind,data)).then(()=>{syncError.value=''}).catch(()=>{syncError.value='观看进度同步失败，稍后会重试'})
}
function stop(){
 progress();const current=session;session=undefined
 if(current){report('stop',current);reports=reports.then(()=>props.client.stopEncoding(current.sessionId)).catch(()=>{})}
 hls?.destroy();hls=undefined
 video.value?.pause();video.value?.removeAttribute('src');video.value?.load()
}
async function start(){
 const gen=++generation;stop();loading.value=true;error.value=''
 if(!Hls.isSupported()){error.value='当前设备不支持 HLS 播放';loading.value=false;return}
 try {
  const result=selectPlayback(await props.client.playbackInfo(props.item.Id,{bitrate:bitrate.value,audio:audio.value,subtitle:subtitle.value}))
  if(disposed||gen!==generation){void props.client.stopEncoding(result.sessionId).catch(()=>{});return}
  session={...result,audio:audio.value??result.source.DefaultAudioStreamIndex,subtitle:subtitle.value,started:false}
  streams.value=result.source.MediaStreams||[];audio.value=session.audio
  hls=new Hls({loader:nativeHlsLoader(props.client),startPosition:position,maxBufferLength:20,maxMaxBufferLength:30})
  hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal){error.value=data.response?.code===401?'登录已失效，请关闭播放器后重新连接':'播放失败，请检查网络、转码权限和 Jellyfin 服务';loading.value=false;stop()}})
  hls.on(Hls.Events.MANIFEST_PARSED,()=>{loading.value=false;void video.value?.play().catch(()=>{})})
  hls.loadSource(props.client.streamUrl(result.source.TranscodingUrl));hls.attachMedia(video.value!)
 } catch(e){if(gen===generation&&!disposed){error.value=e instanceof Error?e.message:'播放失败';loading.value=false;stop()}}
}
function playing(){loading.value=false;if(session&&!session.started){session.started=true;report('start')}}
function progress(){if(video.value && session?.started && video.value.readyState>0)position=video.value.currentTime}
function close(){dispose();emit('close')}
function dispose(){if(disposed)return;disposed=true;generation++;clearInterval(timer);stop()}
function key(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();close()}}
const timer=setInterval(()=>{if(session?.started&&!video.value?.paused)report('progress')},10000)
onMounted(()=>{document.addEventListener('keydown',key);void start()})
onDeactivated(close)
onBeforeUnmount(()=>{dispose();document.removeEventListener('keydown',key)})
</script>
<template>
<Teleport to="body"><section class="jelly-player" role="dialog" aria-modal="true" :aria-label="item.Name+' 播放器'">
 <header><div><small>JELLYFIN · 正在播放</small><h2>{{ item.Name }}</h2></div><button aria-label="关闭播放器" @click="close">✕</button></header>
 <main><video ref="video" controls playsinline disablepictureinpicture disableremoteplayback controlslist="nodownload noremoteplayback" @playing="playing" @timeupdate="progress" @pause="report('progress')" @seeked="progress();report('progress')" @ended="progress();close()" @waiting="loading=true" />
 <div v-if="error" class="player-message" role="alert"><p>{{ error }}</p><button @click="start">重新播放</button></div><div v-else-if="loading" class="buffering" role="status">正在准备播放…</div></main>
 <footer><label>音轨<select v-model="audio" :disabled="loading||!audios.length" @change="start"><option v-for="s in audios" :key="s.Index" :value="s.Index">{{ s.DisplayTitle||s.Language||'音轨 '+s.Index }}</option></select></label><label>字幕<select v-model="subtitle" :disabled="loading" @change="start"><option :value="-1">关闭</option><option v-for="s in subtitles" :key="s.Index" :value="s.Index">{{ s.DisplayTitle||s.Language||'字幕 '+s.Index }}</option></select></label><label>最高码率<select v-model="bitrate" :disabled="loading" @change="start"><option :value="20000000">20 Mbps</option><option :value="8000000">8 Mbps</option><option :value="4000000">4 Mbps</option><option :value="2000000">2 Mbps</option></select></label><span role="status">{{ syncError||'观看进度同步到 Jellyfin' }}</span></footer>
</section></Teleport>
</template>
<style scoped>
.jelly-player{position:fixed;inset:0;z-index:4000;display:flex;flex-direction:column;background:#080c13;color:#eef2f8;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}header{display:flex;align-items:center;justify-content:space-between;padding:18px 26px;border-bottom:1px solid #ffffff12}small{font-size:10px;letter-spacing:2px;color:#94a3b8}h2{font-size:18px;margin:6px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}header>div{min-width:0}button,select{border:1px solid #ffffff24;background:#1b2433;color:#eef2f8;border-radius:10px;padding:10px 14px;cursor:pointer}main{flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center}video{width:100%;height:100%;object-fit:contain;background:#080c13}.player-message{position:absolute;text-align:center;padding:24px;background:#111827e8;border-radius:16px;max-width:85%}.buffering{position:absolute;top:18px;background:#111827dd;padding:10px 18px;border-radius:30px;pointer-events:none}footer{display:flex;align-items:center;gap:20px;padding:16px 26px;flex-wrap:wrap;border-top:1px solid #ffffff12}label{font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:8px}select{max-width:250px}footer>span{font-size:12px;color:#94a3b8;margin-left:auto}@media(max-width:650px){header{padding:12px 16px}footer{padding:12px;gap:10px}label{flex:1;min-width:0;flex-direction:column;align-items:stretch}select{width:100%;padding:8px;font-size:12px}footer>span{margin:0;width:100%;text-align:center}h2{font-size:15px}}
</style>
