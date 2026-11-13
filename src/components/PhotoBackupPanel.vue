<script setup lang="ts">
import {ref,onMounted,onActivated,onDeactivated,onBeforeUnmount,computed} from 'vue'
import {invoke} from '@tauri-apps/api/core'
import {dsm} from '../api/dsm'
import {isAndroid} from '../utils/platform'
import FolderPicker from './FolderPicker.vue'
const snapshot=ref<any>({}),albums=ref<any[]>([]),selected=ref<string[]>([]),destination=ref(''),wifiOnly=ref(true),includeVideos=ref(false),busy=ref(false),message=ref(''),picker=ref(false)
const running=computed(()=>!!snapshot.value.running)
const labels:Record<string,string>={starting:'正在启动',scanning:'扫描相册',preparing:'读取原文件',uploading:'上传中',verifying:'校验中',watching:'等待新增照片',waitingNetwork:'等待网络',waitingLogin:'等待登录恢复',paused:'已暂停',timeout:'已达后台运行时限',error:'需要处理'}
let timer:ReturnType<typeof setInterval>|undefined,active=false,generation=0,scope='',loaded=false
function identity(){return JSON.stringify([dsm.baseUrl,dsm.account])}
async function action(action:string,config?:any){return invoke<any>('photo_backup_action',{action,config:config??null,sourceUrl:dsm.baseUrl,sourceAccount:dsm.account})}
async function refresh(){if(!isAndroid||!active||!dsm.sid)return;const current=identity();if(scope!==current){generation++;scope=current;loaded=false;busy.value=false;picker.value=false;snapshot.value={};albums.value=[];selected.value=[];destination.value='';message.value=''}const gen=generation
 try{const data=await action('snapshot');if(gen!==generation||current!==identity()||!active)return;snapshot.value=data;if(!loaded){loaded=true;const config=data.config;if(config){selected.value=config.albums||[];destination.value=config.destination||'';wifiOnly.value=config.wifiOnly!==false;includeVideos.value=!!config.includeVideos}}}catch{if(gen===generation)message.value='无法读取原生备份状态'}
}
async function loadAlbums(request=false){if(busy.value)return;busy.value=true;message.value='';const gen=generation,current=identity();try{if(request)await action('requestLibrary');const result=await action('albums');if(gen!==generation||current!==identity()||!active)return;albums.value=result.albums||[];snapshot.value.access=result.access;if(result.access==='denied')message.value='照片权限未授予，请在系统设置中允许访问'}catch{if(gen===generation&&current===identity())message.value='无法读取相册，请检查照片权限'}finally{if(gen===generation)busy.value=false}}
async function start(){if(busy.value||running.value)return;if(!selected.value.length||!destination.value){message.value='请选择相册和 NAS 目标目录';return}busy.value=true;message.value='';const gen=generation,current=identity();try{await action('start',{albums:selected.value,destination:destination.value,wifiOnly:wifiOnly.value,includeVideos:includeVideos.value});if(gen===generation&&current===identity())await refresh()}catch(e){if(gen===generation&&current===identity())message.value=String(e)}finally{if(gen===generation)busy.value=false}}
async function pause(){busy.value=true;try{await action('pause');await refresh()}catch{message.value='暂停失败，请重试'}finally{busy.value=false}}
async function recheck(){busy.value=true;try{await action('recheck');message.value='本地校验记录已重置，下次启动会重新核对 NAS 文件，不删除照片'}catch{message.value='请先暂停备份再重新校验'}finally{busy.value=false}}
function activate(){if(active)return;active=true;void refresh();if(isAndroid)timer=setInterval(()=>{if(!document.hidden)void refresh()},2000)}
function deactivate(){active=false;generation++;clearInterval(timer);picker.value=false}
onMounted(activate);onActivated(activate);onDeactivated(deactivate);onBeforeUnmount(deactivate)
</script>
<template>
<section class="photo-backup"><header><div><small>PHONE BACKUP</small><h2>手机相册自动备份</h2><p>原图与视频保留原始内容，后台扫描新增文件并上传到 NAS。</p></div><el-tag v-if="isAndroid">{{labels[snapshot.status]||'未启动'}}</el-tag></header>
 <p v-if="!isAndroid" class="notice">请在 Android 版中授权相册并配置自动备份。Windows 可通过文件页查看 NAS 中的备份文件。</p>
 <template v-else>
 <el-alert v-if="message||snapshot.message" :title="message||snapshot.message" :type="snapshot.status==='error'?'warning':'info'" :closable="false"/>
 <el-alert v-if="snapshot.access==='partial'" title="当前仅能访问授权的部分照片。新增照片可能需要重新授权，扫描完成不代表整个相册已备份。" type="warning" :closable="false"/>
 <div class="backup-controls"><el-button :loading="busy" :disabled="running" @click="loadAlbums(true)">授权 / 重新选择照片权限</el-button><el-button :disabled="busy||running" @click="loadAlbums()">刷新相册</el-button></div>
 <el-checkbox-group v-model="selected" :disabled="running||busy" class="album-options"><el-checkbox v-for="album in albums" :key="album.id" :value="album.id">{{album.name}} · {{album.count}} 项</el-checkbox></el-checkbox-group>
 <p v-if="!albums.length" class="note">{{selected.length?'已保存 '+selected.length+' 个相册，可刷新查看详情':'尚未读取手机相册'}}</p>
 <label>NAS 目标目录<div class="target"><el-input v-model="destination" aria-label="照片备份目标目录" placeholder="选择一个已有的备份目录" :disabled="busy||running"/><el-button :disabled="busy||running" @click="picker=true">选择目录</el-button></div></label>
 <div class="backup-controls"><el-checkbox v-model="wifiOnly" :disabled="busy||running">仅 Wi-Fi 上传</el-checkbox><el-checkbox v-model="includeVideos" :disabled="busy||running">包含视频</el-checkbox></div>
 <p class="note">文件名会附加内容指纹以避免覆盖同名照片。已有备份会跳过；手机上的原文件不会删除。</p>
 <div class="backup-controls"><el-button v-if="!running" type="primary" :loading="busy" @click="start">启动自动备份</el-button><el-button v-else :loading="busy" @click="pause">暂停备份</el-button><el-button :disabled="busy||running" @click="recheck">重新校验已有备份</el-button></div>
 <div v-if="snapshot.updated" class="progress"><span>本轮新备份 {{snapshot.copied||0}} 项 · 已跳过 {{snapshot.skipped||0}} 项</span><el-progress v-if="snapshot.status==='uploading'&&snapshot.total" :percentage="Math.min(100,Math.round(snapshot.bytes/snapshot.total*100))"/><small>上传后完成 NAS 内容校验才计入已备份。</small></div>
 <p class="note">支持切换应用后继续运行。系统后台时限或进程终止会暂停备份；重新打开软件并登录来源账号后恢复。此功能仍待安卓真机验收。</p>
 </template>
 <FolderPicker v-if="picker" v-model="picker" :initial="destination" title="选择照片备份目录" @confirm="value=>{destination=value;picker=false}"/>
</section>
</template>
<style scoped>
.photo-backup{padding:24px;border:1px solid var(--el-border-color-lighter);border-radius:18px;margin:0 0 24px;background:var(--el-bg-color)}header{display:flex;align-items:center;justify-content:space-between;gap:16px}small{color:var(--el-text-color-secondary);font-size:11px}h2{font-size:20px;margin:8px 0}header p,.note,.notice{font-size:13px;line-height:1.7;color:var(--el-text-color-secondary)}.backup-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:16px 0}.backup-controls .el-button{margin:0}.album-options{display:flex;flex-wrap:wrap;gap:10px;max-height:200px;overflow:auto}.album-options :deep(.el-checkbox){max-width:100%;white-space:normal;height:auto;min-height:32px}.album-options :deep(.el-checkbox__label){overflow-wrap:anywhere}.target{display:flex;gap:10px;margin-top:8px}label{font-size:13px}.progress{padding:12px;background:var(--el-fill-color-light);border-radius:12px;font-size:13px}.progress small{display:block;margin-top:8px}.el-alert{margin:12px 0}@media(max-width:600px){.photo-backup{padding:16px}header{align-items:flex-start}h2{font-size:18px}.target{flex-wrap:wrap}.target .el-input{min-width:160px;flex:1}}
</style>
