<script setup lang="ts">
import {computed,ref,watch,onMounted,onActivated,onDeactivated,onUnmounted} from 'vue'
import {dsm} from '../api/dsm'
import {snapshotFileClient} from '../composables/useFileOperations'
import {managementRows,type ManagementKind} from '../utils/workloadManagement'
import {taskState} from '../utils/workloadDetails'
import {confirm} from '../utils/feedback'
import {formatBytes} from '../utils/format'
const props=defineProps<{kind:ManagementKind;guestId?:string;guestStatus?:string}>()
const rows=ref<any[]>([]),error=ref(''),notice=ref(''),loading=ref(false),busy=ref(false),query=ref('')
const repository=ref(''),tag=ref('latest'),description=ref(''),detail=ref(''),detailOpen=ref(false)
const title=computed(()=>({images:'容器镜像',projects:'Compose 项目',snapshots:'虚拟机快照'}[props.kind]))
const filtered=computed(()=>rows.value.filter(r=>r.name.toLowerCase().includes(query.value.toLowerCase())))
let active=true,epoch=0,timer:ReturnType<typeof setInterval>|undefined,scope='',taskId=''
const context=()=>JSON.stringify([dsm.baseUrl,dsm.account,dsm.sid,props.kind,props.guestId])
const taskClient=ref<ReturnType<typeof snapshotFileClient>>()
function reset(){epoch++;rows.value=[];error.value='';notice.value='';detail.value='';detailOpen.value=false;description.value='';repository.value='';tag.value='latest';taskId='';taskClient.value=undefined;loading.value=false;busy.value=false;scope=context()}
async function refresh(){
 if(!active)return
 if(scope!==context())reset()
 if(loading.value)return
 const token=epoch,captured=context(),client=snapshotFileClient();loading.value=true
 try{
  const r=await client.manageWorkload(props.kind,'list',{guest_id:props.guestId})
  if(!active||token!==epoch||captured!==context())return
  if(!r.success)throw Error(`列表读取失败（code=${r.error?.code??'未知'}）`)
  rows.value=managementRows(props.kind,r.data);error.value=''
  if(taskId&&taskClient.value&&client.apiInfo['SYNO.Virtualization.API.Task.Info']){
   const task=await taskClient.value.vmmTaskGet(taskId)
   if(!active||token!==epoch||captured!==context())return
   if(task.success){const state=taskState(task.data);notice.value=`${state.state}${state.progress!==null?' · '+state.progress+'%':''} ${state.detail}`;if(task.data?.finish===true||state.state==='失败'){taskId='';busy.value=false}}
   else {notice.value='任务等待查询，请到 VMM 后台任务核对';busy.value=false}
  }
 }catch(e:any){if(active&&token===epoch&&captured===context())error.value=e.message||'读取失败'}finally{if(token===epoch)loading.value=false}
}
async function operate(action:string,row?:any){
 if(busy.value||scope!==context())return
 const captured=context(),token=epoch,client=snapshotFileClient()
 let message=''
 if(action==='delete')message=props.kind==='images'?`删除镜像标签「${row.name}」？不会强制删除正在使用的镜像。`:`删除快照「${row.name}」？此恢复点将无法再使用。`
 if(action==='stop')message=`停止项目「${row.name}」可能移除项目容器和网络（Compose down），服务将中断。是否继续？`
 if(action==='start')message=`启动项目「${row.name}」将创建或启动其容器。是否继续？`
 if(action==='build')message=`构建项目「${row.name}」会执行其构建配置并消耗 NAS 资源。是否继续？`
 if(action==='restore'){
  if(props.guestStatus!=='shutdown'){error.value='请先正常关闭虚拟机，再恢复快照';return}
  message=`恢复「${row.name}」将回退虚拟机磁盘和配置，快照之后的数据会丢失。本操作不会自动备份当前状态，确认已保留所需数据？`
 }
 if(message&&!await confirm(message,'确认操作',{danger:['delete','restore','stop'].includes(action),confirmText:'确认执行'}))return
 if(!active||token!==epoch||captured!==context()||busy.value)return
 if(action==='restore'&&props.guestStatus!=='shutdown'){error.value='虚拟机状态已变化，请先关机再恢复';return}
 busy.value=true;notice.value='';error.value=''
 try{
  const r=await client.manageWorkload(props.kind,action,{guest_id:props.guestId,gsnap_id:row?.id,id:row?.id,repository:row?.repository??repository.value.trim(),tag:row?.tag??tag.value.trim(),desc:description.value})
  if(!active||token!==epoch||captured!==context())return
  if(!r.success)throw Error(`操作未成功（code=${r.error?.code??'未知'}），请刷新核对后重试`)
  if(action==='get'){
   const data=r.data??{};detail.value=JSON.stringify({name:data.name,path:data.path,status:data.status,containers:Array.isArray(data.containers)?data.containers.map((c:any)=>({name:c.Name??c.name,image:c.Config?.Image??c.image,status:c.State?.Status??c.status})):[]},null,2);detailOpen.value=true
  }else{
   notice.value='请求已提交，请以刷新后的 NAS 状态为准。';description.value=''
   const id=r.data?.task_id
   if(typeof id==='string'&&props.kind==='snapshots'&&client.apiInfo['SYNO.Virtualization.API.Task.Info']){taskId=id;taskClient.value=client}
   await refresh()
  }
 }catch(e:any){if(active&&token===epoch&&captured===context())error.value=(e.message||'请求中断')+'；结果不明确时请先刷新核对，避免重复提交。'}finally{if(token===epoch)busy.value=!!taskId}
}
function start(){active=true;refresh();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden&&!detailOpen.value)refresh()},5000)}
function stop(){active=false;epoch++;loading.value=false;busy.value=false;detail.value='';detailOpen.value=false;clearInterval(timer)}
watch(()=>[props.kind,props.guestId],()=>{reset();refresh()})
onMounted(start);onActivated(start);onDeactivated(stop);onUnmounted(stop)
</script>
<template><section class="workload-manager"><header><div><h3>{{title}}</h3><p>{{kind==='images'?'管理 NAS 本地镜像；拉取新标签不会自动更新现有容器。':kind==='projects'?'管理已有 Compose 项目，查看容器组成与部署目录。':'快照用于恢复虚拟机状态；恢复前需先关机。'}}</p></div><el-button :loading="loading" @click="refresh">刷新列表</el-button></header>
<el-alert v-if="error" :title="error" type="warning" :closable="false"/><el-alert v-if="notice" :title="notice" type="info" :closable="false"/>
<div v-if="kind==='images'" class="manager-form"><el-input v-model="repository" aria-label="镜像仓库" placeholder="镜像仓库，如 nginx"/><el-input v-model="tag" aria-label="镜像标签" placeholder="标签"/><el-button type="primary" :disabled="busy||!repository.trim()||!!error" @click="operate('pull')">拉取镜像</el-button></div>
<div v-if="kind==='snapshots'" class="manager-form"><el-input v-model="description" maxlength="512" aria-label="快照描述" placeholder="快照描述（可选）"/><el-button type="primary" :disabled="busy||!guestId||!!error" @click="operate('create')">创建快照</el-button></div>
<el-input v-model="query" clearable aria-label="筛选管理列表" placeholder="按名称筛选" class="manager-search"/>
<article v-for="row in filtered" :key="row.id"><div class="manager-info"><strong>{{row.name}}</strong><small>{{row.status}}<template v-if="kind==='images'"> · {{typeof row.size==='number'?formatBytes(row.size):'大小未知'}}</template></small><small v-if="row.path">{{row.path}}</small></div><div class="manager-actions">
<template v-if="kind==='images'"><el-button :disabled="busy||!!error||!row.repository||!row.tag" @click="operate('pull',row)">重新拉取</el-button><el-button type="danger" plain :disabled="busy||!!error||!row.repository||!row.tag" @click="operate('delete',row)">删除标签</el-button></template>
<template v-if="kind==='projects'"><el-button :disabled="busy" @click="operate('get',row)">项目详情</el-button><el-button v-for="(label,action) in {start:'启动',stop:'停止',build:'构建'}" :key="action" :disabled="busy||!!error||row.locked" @click="operate(action,row)">{{label}}</el-button></template>
<template v-if="kind==='snapshots'"><el-button :disabled="busy||!!error||!row.id||guestStatus!=='shutdown'" @click="operate('restore',row)">恢复</el-button><el-button type="danger" plain :disabled="busy||!!error||row.locked||!row.id" @click="operate('delete',row)">删除</el-button></template>
</div></article><el-empty v-if="!filtered.length&&!loading" :description="error?'列表暂不可用':query?'没有匹配项':'暂无记录'"/>
<el-dialog v-model="detailOpen" title="Compose 项目详情" width="min(760px,94vw)"><pre>{{detail}}</pre><p>此处仅展示项目概要，不展示环境变量或凭据。</p></el-dialog></section></template>
<style scoped>.workload-manager{margin-top:24px;border-top:1px solid var(--el-border-color);padding-top:20px}.workload-manager header{display:flex;align-items:center;justify-content:space-between;gap:16px}.workload-manager h3{margin:0}.workload-manager p,small{font-size:12px;color:var(--el-text-color-secondary);line-height:1.7}.manager-form,.manager-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.manager-form{margin:18px 0}.manager-form .el-input{flex:1;min-width:140px}.manager-search{max-width:360px;margin:12px 0}article{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;border-bottom:1px solid var(--el-border-color-lighter)}.manager-info{min-width:0}.manager-info strong,.manager-info small{display:block;overflow-wrap:anywhere}.manager-actions .el-button{margin:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7}.el-alert{margin:10px 0}@media(max-width:640px){article,header{flex-direction:column;align-items:stretch!important}.manager-form .el-input{flex-basis:100%}.manager-actions{justify-content:flex-start}}</style>
