<script setup lang="ts">
import {ref,computed,onBeforeUnmount,onDeactivated,watch} from 'vue'
import {dsm,type DsmClient} from '../api/dsm'
import {identity,snapshotFileClient,startFileTask,markDirectoriesChanged,directoryRevision,fileOperations} from '../composables/useFileOperations'
import {recycleRoot,recyclePath,recycleRows,restoreDestination,recycleDeleteSucceeded} from '../utils/recycleBin'
import {confirm} from '../utils/feedback'
import FolderPicker from './FolderPicker.vue'
const visible=ref(false),busy=ref(false),error=ref(''),notice=ref(''),shares=ref<any[]>([]),share=ref(''),folder=ref(''),rows=ref<any[]>([]),offset=ref(0),total=ref(0),query=ref(''),selected=ref<string[]>([]),destination=ref(''),picker=ref(false),locked=ref(false)
const writing=ref(false)
const root=computed(()=>share.value?recycleRoot(share.value):'')
const filtered=computed(()=>rows.value.filter(row=>row.name.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const restoring=computed(()=>fileOperations.some(task=>task.sourceUrl===dsm.baseUrl&&task.account===dsm.account&&task.kind==='move'&&task.name.startsWith('恢复 ')&&task.directories.includes(folder.value)&&['running','waiting','cancelling'].includes(task.status)))
let client:DsmClient,scope='',sid='',generation=0,seenRevision=0
const valid=(gen:number)=>visible.value&&generation===gen&&scope===identity()&&sid===dsm.sid
function close(){generation++;visible.value=false;picker.value=false;rows.value=[];selected.value=[];shares.value=[];busy.value=false}
async function open(){
 if(writing.value)return
 close();client=snapshotFileClient();scope=identity();sid=dsm.sid;share.value='';folder.value='';query.value='';error.value='';notice.value='';locked.value=false;visible.value=true;busy.value=true;const gen=generation
 try{await client.ensureFileFeature('SYNO.FileStation.List');if(!valid(gen))return;const res=await client.listAll();if(!valid(gen))return;if(!res.success||!Array.isArray(res.data?.shares))throw Error('无法读取共享文件夹，请检查权限');shares.value=res.data.shares.filter((row:any)=>{try{return !!recycleRoot(row.path)}catch{return false}})}catch(e){if(valid(gen))error.value=(e as Error).message}finally{if(valid(gen))busy.value=false}
}
async function list(path=folder.value,page=0){
 if(busy.value||!share.value)return
 const gen=generation;busy.value=true;error.value='';selected.value=[];rows.value=[];seenRevision=directoryRevision(path)
 try{recyclePath(root.value,path,true);const res=await client.listFiles(path,{offset:page,limit:100,additional:'["size","time"]'});if(!valid(gen))return
  if(!res.success)throw Error('无法访问回收站：可能未启用、目录已不存在，或当前账号没有权限')
  const data=recycleRows(root.value,path,res.data?.files);if(!Number.isInteger(res.data?.total)||res.data.total<0)throw Error('回收站列表数量不完整，请重试')
  rows.value=data;folder.value=path;offset.value=page;total.value=res.data.total;locked.value=false
 }catch(e){if(valid(gen))error.value=(e as Error).message}finally{if(valid(gen))busy.value=false}
}
function chooseShare(){folder.value=root.value;destination.value=share.value;query.value='';notice.value='';void list(root.value)}
function toggle(path:string){if(selected.value.includes(path))selected.value=selected.value.filter(p=>p!==path);else selected.value.push(path)}
watch(query,()=>{selected.value=[]})
async function restore(){
 if(busy.value||locked.value||restoring.value||!selected.value.length)return
 const gen=generation,paths=[...selected.value],bound=client,sourceFolder=folder.value
 let target:string;try{target=restoreDestination(root.value,paths,destination.value)}catch(e){error.value=(e as Error).message;return}
 if(!await confirm(`将 ${paths.length} 个项目恢复到 ${target}。同名项目不会覆盖。`,'恢复回收站项目',{confirmText:'恢复'}))return
 if(!valid(gen))return;busy.value=true;writing.value=true;error.value='';notice.value=''
 try{
  const res=await bound.listAll(target);if(!valid(gen))return
  if(!res.success||!Array.isArray(res.data?.files))throw Error('无法读取恢复目录，请检查目录及权限')
  const names=new Set(res.data.files.map((row:any)=>String(row.name).normalize('NFC').toLowerCase()))
  if(paths.some(path=>names.has(path.slice(path.lastIndexOf('/')+1).normalize('NFC').toLowerCase())))throw Error('目标目录存在同名项目，请选择其他目录；不会覆盖或合并')
  await startFileTask('move',`恢复 ${paths.length} 项 → ${target}`,[sourceFolder,target],c=>c.fileFeature('SYNO.FileStation.CopyMove','start',{path:JSON.stringify(paths),dest_folder_path:JSON.stringify(target),overwrite:false,remove_src:true},true))
  if(valid(gen)){locked.value=true;notice.value='恢复任务已提交，请在传输中心查看结果；完成后自动刷新。'}
 }catch(e){if(valid(gen)){error.value=(e as Error).message;locked.value=error.value.includes('未确认')||error.value.includes('未收到')}}finally{writing.value=false;if(valid(gen))busy.value=false}
}
async function remove(){
 if(busy.value||locked.value||restoring.value||!selected.value.length)return
 const gen=generation,paths=[...selected.value],bound=client,sourceFolder=folder.value,bin=root.value
 paths.forEach(path=>recyclePath(bin,path))
 if(!await confirm(`永久删除选中的 ${paths.length} 个项目？文件夹中的内容也会删除，无法从回收站恢复。`,'永久删除',{danger:true,confirmText:'永久删除'}))return
 if(!valid(gen))return;busy.value=true;writing.value=true;error.value='';notice.value=''
 let sent=false
 try{
  await bound.ensureFileFeature('SYNO.FileStation.Delete');if(!valid(gen))return
  sent=true;locked.value=true
  const res=await bound.fileFeature('SYNO.FileStation.Delete','delete',{path:JSON.stringify(paths),recursive:true},true)
  markDirectoriesChanged(bound.baseUrl,bound.account,[sourceFolder])
  if(!valid(gen))return
  seenRevision=directoryRevision(sourceFolder)
  if(!recycleDeleteSucceeded(res))throw Error('NAS 报告删除失败或部分失败，请刷新核实')
  const check=await bound.listAll(sourceFolder);if(!valid(gen))return
  if(!check.success||!Array.isArray(check.data?.files)||check.data.files.some((row:any)=>paths.includes(row.path)))throw Error('删除结果未确认，请刷新核实；不会自动重复删除')
  notice.value=`已永久删除 ${paths.length} 个项目`;busy.value=false;await list(sourceFolder,0)
 }catch(e){if(sent)markDirectoriesChanged(bound.baseUrl,bound.account,[sourceFolder]);if(valid(gen)){seenRevision=directoryRevision(sourceFolder);error.value=sent?'删除结果未确认或部分失败，请刷新核实；不会自动重试':(e as Error).message}}finally{writing.value=false;if(valid(gen))busy.value=false}
}
watch([()=>directoryRevision(folder.value),busy],()=>{if(visible.value&&folder.value&&!busy.value&&seenRevision!==directoryRevision(folder.value))void list(folder.value,offset.value)})
const timer=setInterval(()=>{if(visible.value&&(scope!==identity()||sid!==dsm.sid))close()},250)
onDeactivated(close);onBeforeUnmount(()=>{clearInterval(timer);close()})
defineExpose({open})
</script>
<template>
 <el-dialog :model-value="visible" title="回收站" width="min(800px,94vw)" top="5vh" :show-close="!writing" :close-on-press-escape="!writing" :close-on-click-modal="false" @update:model-value="(value:boolean)=>{if(!value)close()}">
 <div class="recycle-panel">
  <p class="recycle-note">管理共享文件夹中的 #recycle。恢复到你指定的目录，不推断原始位置；永久删除无法撤销。</p>
  <label>共享文件夹<select v-model="share" aria-label="回收站共享文件夹" :disabled="busy" @change="chooseShare"><option value="">请选择共享文件夹</option><option v-for="item in shares" :key="item.path" :value="item.path">{{item.name}}</option></select></label>
  <el-alert v-if="error" :title="error" type="warning" :closable="false"/><el-alert v-if="notice" :title="notice" type="success" :closable="false"/>
  <el-alert v-if="restoring" title="当前目录有恢复任务尚未结束，请在传输中心核实后再操作" type="info" :closable="false"/>
  <el-empty v-if="!busy&&!error&&!shares.length" description="当前账号没有可访问的共享文件夹"/>
  <template v-if="share">
   <div class="recycle-actions"><el-button :disabled="busy||folder===root" @click="list(folder.slice(0,folder.lastIndexOf('/')))">上一级</el-button><el-button :disabled="busy" @click="list(folder,offset)">刷新回收站</el-button><span>{{total}} 项</span></div>
   <p class="recycle-path">{{folder}}</p><el-input v-model="query" aria-label="筛选当前页" placeholder="筛选当前页名称" clearable/>
   <div class="recycle-actions"><el-button :disabled="busy||locked||!filtered.length" @click="selected=filtered.map(row=>row.path)">全选当前页</el-button><el-button :disabled="busy" @click="selected=[]">取消选择</el-button><span>已选 {{selected.length}} 项</span></div>
   <div v-loading="busy" class="recycle-list"><article v-for="row in filtered" :key="row.path"><el-checkbox :model-value="selected.includes(row.path)" :disabled="busy||locked" :aria-label="'选择 '+row.name" @change="toggle(row.path)"/><button class="recycle-name" :disabled="!row.isdir||busy" @click="query='';list(row.path)">{{row.isdir?'文件夹 · ':''}}{{row.name}}</button></article><el-empty v-if="!busy&&!filtered.length&&!error" description="当前目录没有匹配项目"/></div>
   <div class="recycle-actions"><el-button :disabled="busy||offset===0" @click="list(folder,Math.max(0,offset-100))">上一页</el-button><span>第 {{offset/100+1}} 页</span><el-button :disabled="busy||offset+100>=total" @click="list(folder,offset+100)">下一页</el-button></div>
   <label>恢复目标目录<div class="recycle-actions"><el-input v-model="destination" aria-label="恢复目标目录" :disabled="busy||locked"/><el-button :disabled="busy||locked" @click="picker=true">选择目录</el-button></div></label>
   <div class="recycle-actions"><el-button type="primary" :disabled="busy||locked||restoring||!selected.length" @click="restore">恢复到指定目录</el-button><el-button type="danger" plain :disabled="busy||locked||restoring||!selected.length" @click="remove">永久删除所选</el-button></div>
  </template>
 </div>
 </el-dialog>
 <FolderPicker v-if="picker" v-model="picker" :initial="destination" title="选择恢复目录" @confirm="value=>{destination=value;picker=false}"/>
</template>
<style scoped>
.recycle-panel{max-height:76vh;overflow:auto;display:flex;flex-direction:column;gap:12px}.recycle-panel label{display:flex;flex-direction:column;gap:8px}.recycle-panel select{padding:10px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-bg-color);color:var(--el-text-color-primary);width:100%}.recycle-note{font-size:13px;line-height:1.7;color:var(--el-text-color-secondary);margin:0}.recycle-path{overflow-wrap:anywhere;margin:0;font-size:12px}.recycle-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.recycle-actions .el-button{margin:0}.recycle-actions .el-input{flex:1;min-width:140px}.recycle-list{border:1px solid var(--el-border-color-lighter);border-radius:12px;max-height:300px;overflow:auto;min-height:70px}.recycle-list article{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--el-border-color-lighter)}.recycle-name{border:0;background:none;color:var(--el-color-primary);text-align:left;font:inherit;overflow-wrap:anywhere;min-width:0;cursor:pointer}.recycle-name:disabled{color:var(--el-text-color-primary);cursor:default}
</style>
