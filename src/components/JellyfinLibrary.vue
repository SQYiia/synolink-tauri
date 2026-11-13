<script setup lang="ts">
import { isAndroid } from '../utils/platform'
import { ref, shallowRef, onMounted, onBeforeUnmount, onDeactivated, defineAsyncComponent } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { dsm } from '../api/dsm'
import { JellyfinClient } from '../api/jellyfin'
const JellyfinPlayer = defineAsyncComponent(() => import('./JellyfinPlayer.vue'))
import { resumeSeconds } from '../utils/jellyfinPlayback'
const playingItem = ref<any>(), fromStart = ref(false)
function play(restart=false){fromStart.value=restart;playingItem.value=selected.value;detailOpen.value=false}
onDeactivated(()=>{playingItem.value=undefined})
import JellyfinPoster from './JellyfinPoster.vue'
const scope = JSON.stringify([dsm.baseUrl, dsm.account])
const key = 'jellyfin:' + scope
const address = ref(''), username = ref(''), password = ref(''), remember = ref(!isAndroid)
const client = shallowRef<JellyfinClient>(); const items = ref<any[]>([]), total = ref(0), busy = ref(false), error = ref(''), search = ref('')
const trail = ref<{id:string;name:string}[]>([]), selected = ref<any>(), detailOpen = ref(false), settings = ref(true)
let generation = 0
function valid(gen:number) { return generation === gen && scope === JSON.stringify([dsm.baseUrl,dsm.account]) }
async function load(more = false) {
 if(!client.value || busy.value || !valid(generation)) return
 const gen = ++generation; busy.value = true; error.value = ''
 if(!more) { items.value = []; total.value = 0 }
 try { const data = await client.value.list(more ? items.value.length : 0, search.value, trail.value[trail.value.length - 1]?.id || ''); if(!Array.isArray(data.Items)) throw new Error('媒体库响应格式无效'); if(valid(gen)) { items.value = more ? [...items.value,...data.Items] : data.Items; total.value = data.TotalRecordCount ?? items.value.length } }
 catch(e) { if(valid(gen)) error.value = e instanceof Error ? e.message : '加载失败' }
 finally { if(generation === gen) busy.value = false }
}
async function connect() {
 if(busy.value || !valid(generation)) return
 const gen = ++generation; busy.value = true; error.value = ''
 try {
  const c = new JellyfinClient(address.value); await c.login(username.value.trim(),password.value)
  if(!valid(gen)) return
  if(remember.value) await invoke('save_password',{accountId:key,password:JSON.stringify({token:c.token,userId:c.userId,base:c.base})})
  else if (!isAndroid) await invoke('delete_password',{accountId:key})
  localStorage.setItem(key,JSON.stringify({base:c.base,username:username.value,remember:remember.value}))
  password.value = ''; client.value = c; settings.value = false; trail.value = []; items.value = []
 } catch(e) { if(valid(gen)) error.value = e instanceof Error ? e.message : String(e) }
 finally { if(generation === gen) busy.value = false }
 if(valid(gen) && client.value && !settings.value) await load()
}
async function disconnect() {
 generation++; busy.value = false; playingItem.value = undefined; client.value = undefined; items.value = []; selected.value = undefined; detailOpen.value = false; settings.value = true
 try { if (!isAndroid) await invoke('delete_password',{accountId:key}); localStorage.removeItem(key) } catch { error.value = '删除保存的连接失败，请重试' }
}
async function open(item:any) {
 if(busy.value) return

 selected.value = item; detailOpen.value = true
 const gen = generation
 try { const detail = await client.value!.detail(item.Id); if(valid(gen) && selected.value?.Id === item.Id) selected.value = detail } catch(e) { if(valid(gen)) error.value = e instanceof Error ? e.message : '详情读取失败' }
}
function browse() { const item = selected.value; trail.value.push({id:item.Id,name:item.Name}); search.value = ''; detailOpen.value = false; void load() }
function back(index:number) { trail.value = trail.value.slice(0,index); search.value = ''; void load() }
onMounted(async () => {
 const gen = generation
 try {
  const config = JSON.parse(localStorage.getItem(key) || 'null'); if(!config) return
  address.value = config.base; username.value = config.username; remember.value = !isAndroid && config.remember
  if(!remember.value) return
  const secret = await invoke<string|null>('read_password',{accountId:key}); if(!secret || !valid(gen)) return
  const saved = JSON.parse(secret); if(saved.base !== config.base) return
  const c = new JellyfinClient(config.base); c.token = saved.token; c.userId = saved.userId; client.value = c; settings.value = false; await load()
 } catch { error.value = '无法恢复 Jellyfin 连接，请重新登录' }
})
const contextTimer = setInterval(() => { if(scope !== JSON.stringify([dsm.baseUrl,dsm.account])) { generation++; playingItem.value = undefined; client.value = undefined; items.value = []; selected.value = undefined; detailOpen.value = false; password.value = ''; busy.value = false; settings.value = true; error.value = 'NAS 账号已切换，请切换到 NAS 文件后重新打开影视库' } },500)
onBeforeUnmount(() => { generation++; clearInterval(contextTimer) })
</script>
<template>
<section class="cinema">
 <header><div><span class="kicker">JELLYFIN · 私人影院</span><h2>让好故事，有一个好位置。</h2><p>电影、剧集与完整影视资料，来自你的 Jellyfin 媒体库。</p></div><el-button v-if="client" @click="settings = !settings">连接设置</el-button></header>
 <form v-if="settings" class="connection" @submit.prevent="connect">
  <h3>连接 Jellyfin</h3><p>填写 Jellyfin 服务地址（如 http://NAS地址:8096），使用 Jellyfin 账号登录。</p>
  <el-input v-model="address" aria-label="Jellyfin 服务地址" placeholder="http://192.168.1.10:8096" :disabled="busy" />
  <div class="credentials"><el-input v-model="username" aria-label="Jellyfin 用户名" placeholder="用户名" :disabled="busy" /><el-input v-model="password" type="password" show-password aria-label="Jellyfin 密码" placeholder="密码" :disabled="busy" /></div>
  <el-checkbox v-if="!isAndroid" v-model="remember">记住连接（令牌保存在系统凭据库）</el-checkbox><div><el-button type="primary" native-type="submit" :loading="busy">连接媒体库</el-button><el-button v-if="client" :disabled="busy" @click="disconnect">断开并忘记连接</el-button></div>
 </form>
 <div v-if="error" class="notice" role="alert">{{ error }}</div>
 <template v-if="client && !settings">
  <div class="toolbar"><div class="crumbs"><button :disabled="busy" @click="back(0)">全部影视</button><button v-for="(p,i) in trail" :key="p.id" :disabled="busy" @click="back(i+1)"> / {{ p.name }}</button></div><form @submit.prevent="load()"><el-input v-model="search" placeholder="搜索影视名称" aria-label="搜索影视" clearable /><el-button native-type="submit" :disabled="busy">搜索</el-button><el-button :loading="busy" @click="load()">刷新</el-button></form></div>
  <p class="count">{{ total }} 部 / 集</p>
  <div class="wall"><article v-for="item in items" :key="client.base + item.Id" class="film" role="button" tabindex="0" @keydown.enter.prevent="open(item)" @keydown.space.prevent="open(item)" @click="open(item)"><JellyfinPoster :client="client" :item="item" /><strong>{{ item.Name }}</strong><span>{{ item.ProductionYear || (item.Type === 'Series' ? '电视剧' : item.Type === 'Season' ? '季' : '') }} <b v-if="item.CommunityRating">★ {{ Number(item.CommunityRating).toFixed(1) }}</b></span></article></div>
  <p v-if="!items.length && !busy && !error" class="empty">暂无影视内容，请检查 Jellyfin 媒体库和当前账号权限。</p><p v-if="busy" class="empty">正在读取媒体库…</p><el-button v-if="items.length < total" :loading="busy" @click="load(true)">加载更多</el-button>
 </template>
 <el-dialog v-model="detailOpen" :title="selected?.Name" width="min(780px, 94vw)" destroy-on-close>
  <div v-if="selected && client" class="detail"><JellyfinPoster :key="selected.Id" :client="client" :item="selected" /><div><p>{{ selected.ProductionYear }} <span v-if="selected.CommunityRating"> · ★ {{ Number(selected.CommunityRating).toFixed(1) }}</span><span v-if="selected.RunTimeTicks"> · {{ Math.round(selected.RunTimeTicks / 600000000) }} 分钟</span></p><p>{{ selected.Genres?.join(' / ') }}</p><el-button v-if="['Series','Season','BoxSet','Folder'].includes(selected.Type)" @click="browse">浏览季 / 剧集</el-button><template v-if="['Movie','Episode','Video','MusicVideo'].includes(selected.Type)"><el-button type="primary" @click="play()">{{ resumeSeconds(selected)>0 ? '继续观看 · '+Math.floor(resumeSeconds(selected)/60)+' 分钟' : '播放' }}</el-button><el-button v-if="resumeSeconds(selected)>0" @click="play(true)">从头播放</el-button></template><h3>剧情简介</h3><p class="plot">{{ selected.Overview || '暂无简介' }}</p><h3 v-if="selected.People?.length">演职人员</h3><p>{{ selected.People?.slice(0,12).map((p:any)=>p.Name).join('、') }}</p></div></div>
 </el-dialog>
<JellyfinPlayer v-if="playingItem && client" :client="client" :item="playingItem" :from-start="fromStart" @close="playingItem=undefined" /></section>
</template>
<style scoped>
.cinema{padding:28px 32px;max-width:1500px;margin:auto}.cinema header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:28px}.kicker{font-size:11px;letter-spacing:2px;color:#8993a5}h2{font-size:27px;letter-spacing:-1px;margin:12px 0}header p,.connection p,.count{font-size:13px;color:var(--el-text-color-secondary)}.connection{max-width:580px;padding:26px;background:var(--el-fill-color-light);border:1px solid var(--el-border-color-lighter);border-radius:16px}.credentials{display:flex;gap:12px;margin-top:12px}.connection .el-checkbox{margin:14px 0}.toolbar,.toolbar form{display:flex;gap:12px;align-items:center;justify-content:space-between}.toolbar form{max-width:420px}.crumbs button{border:0;background:transparent;color:var(--el-text-color-primary);cursor:pointer}.wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:28px 20px;margin:20px 0}.film{border:0;padding:0;background:none;text-align:left;cursor:pointer;color:var(--el-text-color-primary);min-width:0}.film strong{display:block;margin:12px 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}.film>span{font-size:12px;color:var(--el-text-color-secondary);display:flex;justify-content:space-between}.film b{color:#c69740}.film:hover{transform:translateY(-3px)}.notice{padding:14px;background:#fef0f0;color:#a33131;border-radius:10px;margin:18px 0}.empty{text-align:center;padding:50px;color:var(--el-text-color-secondary)}.detail{display:grid;grid-template-columns:200px 1fr;gap:28px}.plot{white-space:pre-wrap;line-height:1.8}.detail p{line-height:1.7}.detail h3{margin-top:24px}@media(max-width:700px){.cinema{padding:18px 14px}.toolbar{align-items:stretch;flex-direction:column}.wall{grid-template-columns:repeat(2,minmax(0,1fr))}.detail{grid-template-columns:110px 1fr;gap:16px}h2{font-size:22px}}
</style>
