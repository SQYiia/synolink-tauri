<script setup lang="ts">
import {ref,onActivated,onDeactivated,onUnmounted} from 'vue'
import {dsm} from '../api/dsm'
import {snapshotFileClient} from '../composables/useFileOperations'
import {taskState} from '../utils/workloadDetails'
const rows=ref<any[]>([]),error=ref(''),loading=ref(false)
let active=false,epoch=0,timer:ReturnType<typeof setInterval>|undefined,scope=''
const identity=()=>JSON.stringify([dsm.baseUrl,dsm.account,dsm.sid])
async function refresh(){
 if(loading.value||!active)return
 const captured=identity(),token=++epoch,client=snapshotFileClient()
 if(captured!==scope){rows.value=[];scope=captured}
 const valid=()=>active&&token===epoch&&captured===identity()
 loading.value=true
 try{
  const result=await client.vmmTaskList();if(!valid())return
  if(!result.success||!Array.isArray(result.data?.task_ids))throw Error('无法读取任务列表，请检查 VMM 权限')
  const ids=result.data.task_ids.filter((id:unknown)=>typeof id==='string'),next:any[]=[]
  for(let i=0;i<ids.length;i+=2){if(!valid())return;const batch=await Promise.all(ids.slice(i,i+2).map(async(id:string)=>{try{const r=await client.vmmTaskGet(id);if(!r.success)throw Error();return {id,...taskState(r.data)}}catch{return {id,state:'等待查询',progress:null,detail:'查询中断，可刷新重试'}}}));next.push(...batch)}
  if(valid()){rows.value=next;error.value=''}
 }catch(e:any){if(valid())error.value=e.message||'任务查询失败'}finally{if(token===epoch)loading.value=false}
}
function stop(){active=false;epoch++;loading.value=false;clearInterval(timer)}
onActivated(()=>{active=true;refresh();timer=setInterval(()=>{if(!document.hidden)refresh()},5000)})
onDeactivated(stop);onUnmounted(stop)
</script>
<template><section class="vmm-tasks"><header><div><h3>VMM 后台任务</h3><p>显示当前账号可查询的异步任务；电源指令请以虚拟机状态为准。</p></div><el-button :loading="loading" @click="refresh">刷新任务</el-button></header><el-alert v-if="error" :title="error+'；上次结果可能已过期'" type="warning" :closable="false"/><article v-for="row in rows" :key="row.id"><div><strong>{{row.state}}</strong><small>{{row.id}}</small></div><el-progress v-if="row.progress!==null" :percentage="row.progress" :status="row.state==='失败'?'exception':undefined"/><p>{{row.detail}}</p></article><p v-if="!rows.length&&!error&&!loading">暂无可查询任务</p></section></template>
<style scoped>.vmm-tasks{margin-top:24px;border-top:1px solid var(--el-border-color);padding-top:20px}.vmm-tasks header{display:flex;justify-content:space-between;gap:16px;align-items:center}.vmm-tasks h3{margin:0}.vmm-tasks p,small{font-size:12px;color:var(--el-text-color-secondary)}article{padding:16px 0;border-bottom:1px solid var(--el-border-color-lighter)}small{display:block;overflow-wrap:anywhere;margin:6px 0}@media(max-width:640px){header{flex-wrap:wrap}}</style>
