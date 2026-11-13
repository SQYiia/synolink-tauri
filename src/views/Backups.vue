<script setup lang="ts">
import WorkspaceHeader from '../components/WorkspaceHeader.vue'
import PhotoBackupPanel from '../components/PhotoBackupPanel.vue'
import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue'
import { dsm } from '../api/dsm'
import { apiError } from '../utils/packages'
import { backupTask, backupResult, displayTime, rowsOf } from '../utils/driveBackup'
type Task = ReturnType<typeof backupTask> & { provider: string }
const tasks = ref<Task[]>([]), busy = ref(false), errors = ref<string[]>([]), unavailable = ref<string[]>([]), updated = ref(''), query = ref('')
const visible = computed(()=>tasks.value.filter(t=>t.name.toLowerCase().includes(query.value.toLowerCase())))
const detail = ref<Task | null>(null), detailError = ref(''), detailBusy = ref(false), detailData = ref<any>(null)
let generation = 0, detailGeneration = 0, active = false, context = '', timer: ReturnType<typeof setInterval> | undefined
const providers = [{name:'Hyper Backup',api:'SYNO.Backup.Task',key:'task_list',load:()=>dsm.hyperBackupTasks()}, {name:'Active Backup for Business',api:'SYNO.ActiveBackup.Task',key:'tasks',load:()=>dsm.activeBackupTasks()}]
function current(){return JSON.stringify([dsm.baseUrl,dsm.account])}
async function refresh(){
  if(busy.value)return
  const captured=current(), token=++generation
  if(context!==captured){tasks.value=[];detail.value=null;updated.value='';context=captured}
  busy.value=true; errors.value=[]
  try {
    await dsm.loadApiInfo()
    if(token!==generation || captured!==current())return
    const enabled=providers.filter(p=>!!dsm.apiInfo[p.api])
    unavailable.value=providers.filter(p=>!dsm.apiInfo[p.api]).map(p=>p.name)
    const results=await Promise.allSettled(enabled.map(p=>p.load()))
    if(token!==generation || captured!==current())return
    const next:Task[]=[], failures:string[]=[]
    results.forEach((result,index)=>{
      const provider=enabled[index]!
      try{
        if(result.status==='rejected')throw new Error('连接失败')
        if(!result.value.success)throw new Error(apiError(result.value.error?.code))
        next.push(...rowsOf(result.value.data,provider.key).map(raw=>({...backupTask(raw),provider:provider.name})))
      }catch(e:any){failures.push(provider.name+'：'+e.message)}
    })
    tasks.value=next;errors.value=failures;updated.value=new Date().toLocaleTimeString()
  }catch(e:any){if(token===generation) {tasks.value=[];errors.value=[e.message || '读取备份任务失败']}}
  finally{if(token===generation)busy.value=false}
}
async function showDetail(task:Task){
  detail.value=task;detailData.value=null;detailError.value=''
  const token=++detailGeneration,captured=current()
  if(task.provider!=='Hyper Backup' || !task.id)return
  detailBusy.value=true
  try{
    const result=await dsm.hyperBackupStatus(task.id)
    if(token!==detailGeneration || captured!==current() || !active)return
    if(!result.success)throw new Error(apiError(result.error?.code))
    const raw=result.data??{}
    detailData.value={time:raw.last_bkp_time,next:raw.next_bkp_time,result:raw.last_bkp_result,error:raw.last_bkp_error}
  }catch(e:any){if(token===detailGeneration)detailError.value=e.message || '详情读取失败'}
  finally{if(token===detailGeneration)detailBusy.value=false}
}
function stop(){active=false;generation++;detailGeneration++;busy.value=false;detailBusy.value=false;detail.value=null;clearInterval(timer)}
onActivated(()=>{active=true;refresh();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)refresh()},15000)})
onDeactivated(stop);onUnmounted(stop)
</script>
<template>
<section class="backup-page"><WorkspaceHeader title="备份中心" :description="'查看备份任务与最近执行结果'+(updated?'，更新于 '+updated:'')"><el-button :loading="busy" @click="refresh">刷新任务</el-button></WorkspaceHeader><PhotoBackupPanel/>
<el-alert v-for="message in errors" :key="message" :title="message" type="warning" :closable="false" show-icon />
<el-alert v-if="unavailable.length" :title="unavailable.join('、') + ' 的任务接口不可用，请检查对应套件是否已安装并启用。'" type="info" :closable="false" show-icon />
<div class="backup-toolbar"><el-input v-model="query" placeholder="搜索备份任务" aria-label="搜索备份任务" clearable/><span>{{tasks.length}} 个已读取任务</span></div>
<div class="backup-grid"><article v-for="(task,index) in visible" :key="task.provider + (task.id || index)" class="backup-card"><small>{{task.provider}}</small><h3>{{task.name}}</h3><el-tag :type="backupResult(task.result).tone">最近结果：{{backupResult(task.result).label}}</el-tag><dl><dt>任务状态</dt><dd>{{task.status}}</dd><dt>最近执行</dt><dd>{{displayTime(task.time)}}</dd><dt>下次执行</dt><dd>{{displayTime(task.next)}}</dd></dl><el-button @click="showDetail(task)">查看详情</el-button></article></div>
<el-empty v-if="!busy && !visible.length" :description="errors.length ? '部分任务读取失败，请查看上方提示' : unavailable.length === 2 ? '暂无可用的备份套件接口' : query ? '没有匹配任务' : '暂无备份任务'" />
<el-dialog :model-value="!!detail" title="备份任务详情" width="min(600px,94vw)" @update:model-value="detail=null;detailGeneration++"><template v-if="detail"><h3>{{detail.name}}</h3><el-alert v-if="detailError" :title="detailError" type="warning" :closable="false"/><el-descriptions v-loading="detailBusy" :column="1" border><el-descriptions-item label="套件">{{detail.provider}}</el-descriptions-item><el-descriptions-item label="最近结果">{{backupResult(detailData ? detailData.result : detail.result).label}}</el-descriptions-item><el-descriptions-item label="最近执行">{{displayTime(detailData ? detailData.time : detail.time)}}</el-descriptions-item><el-descriptions-item label="下次执行">{{displayTime(detailData ? detailData.next : detail.next)}}</el-descriptions-item><el-descriptions-item v-if="detailData?.error" label="NAS 错误">{{detailData.error}}</el-descriptions-item></el-descriptions><p class="note">此页面仅查看任务状态。未返回的结果不会被当作备份成功。</p></template></el-dialog>
</section>
</template>
<style scoped>
.backup-page{height:100%;overflow:auto;padding:28px;box-sizing:border-box}header,.backup-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px}h1{font-size:26px;margin:6px 0}small,header p,.backup-toolbar span,.note{color:var(--el-text-color-secondary);font-size:12px}.backup-toolbar{margin:24px 0}.backup-toolbar .el-input{max-width:300px}.backup-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}.backup-card{padding:22px;border-radius:16px;background:var(--el-bg-color);border:1px solid var(--el-border-color)}.backup-card h3{margin:10px 0 16px;overflow-wrap:anywhere}dl{font-size:12px;display:grid;grid-template-columns:70px 1fr;gap:12px;line-height:1.7}dt{color:var(--el-text-color-secondary)}dd{margin:0;overflow-wrap:anywhere}.el-alert{margin-top:14px}.note{line-height:1.8}@media(max-width:640px){.backup-page{padding:16px}.backup-grid{grid-template-columns:1fr}header{align-items:flex-start}}
</style>
