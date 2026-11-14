<script setup lang="ts">
import {ref,computed,onMounted,onActivated,onDeactivated,onBeforeUnmount} from 'vue'
import {invoke} from '@tauri-apps/api/core'
import {open} from '@tauri-apps/plugin-dialog'
import {ElMessageBox} from 'element-plus'
import {dsm} from '../api/dsm'
import {formatBytes} from '../utils/format'
import FolderPicker from './FolderPicker.vue'
import {isWindows} from '../utils/platform'
interface Task{id:string;name:string;source:string;destination:string;status:string;message:string;output:string;total:number;completed:number;bytes:number;current:string}
const tasks=ref<Task[]>([]),error=ref(''),busy=ref(false),creating=ref(false),picker=ref(false),name=ref('电脑文件备份'),source=ref(''),destination=ref('')
const activeStates=['scanning','uploading','verifying','cancelling']
const running=computed(()=>tasks.value.some(t=>activeStates.includes(t.status)))
const labels:Record<string,string>={idle:'尚未执行',scanning:'扫描文件',uploading:'上传文件',verifying:'校验内容',done:'备份完成',error:'需要处理',interrupted:'已中断',cancelling:'正在取消'}
let active=false,generation=0,scope='',timer:ReturnType<typeof setInterval>|undefined,reading=false
function identity(){return JSON.stringify([dsm.baseUrl,dsm.account,dsm.sid])}
function syncScope(){const next=identity();if(scope!==next){scope=next;generation++;tasks.value=[];creating.value=false;picker.value=false;busy.value=false;error.value='';source.value='';destination.value=''}return next}
async function refresh(){if(!active||!isWindows||reading)return;const current=syncScope(),gen=generation;reading=true;try{const rows=await invoke<Task[]>('computer_backup_snapshot',{sourceUrl:dsm.baseUrl,account:dsm.account});if(active&&gen===generation&&current===identity()){if(!Array.isArray(rows))throw Error('无法读取电脑备份任务');tasks.value=rows}}catch(e){if(active&&gen===generation&&current===identity())error.value=e instanceof Error?e.message:String(e)}finally{reading=false}}
async function chooseSource(){const current=syncScope();const chosen=await open({directory:true,multiple:false,title:'选择要备份的电脑文件夹'});if(current===identity()&&active&&typeof chosen==='string')source.value=chosen}
async function command(action:string,args:Record<string,unknown>){if(busy.value)return;const current=syncScope(),gen=generation;busy.value=true;error.value='';try{await invoke(`computer_backup_${action}`,args);if(active&&gen===generation&&current===identity()){if(action==='create')creating.value=false;await refresh()}}catch(e){if(active&&gen===generation&&current===identity())error.value=e instanceof Error?e.message:String(e)}finally{if(gen===generation)busy.value=false}}
function create(){return command('create',{name:name.value,source:source.value,destination:destination.value,sourceUrl:dsm.baseUrl,account:dsm.account})}
async function start(task:Task){const current=identity();try{await ElMessageBox.confirm('将扫描电脑文件夹，在 NAS 目标目录下新建独立备份目录。上传后会重新读取 NAS 文件进行内容校验。请保持软件运行；关闭软件或切换账号将中断备份。','执行备份',{confirmButtonText:'开始备份',cancelButtonText:'取消',type:'info'})}catch{return}if(current!==identity())return;await command('start',{id:task.id})}
async function remove(task:Task){const current=identity();try{await ElMessageBox.confirm('仅移除此任务配置，电脑文件与 NAS 上的备份文件均会保留。','移除备份任务',{confirmButtonText:'移除任务',cancelButtonText:'取消',type:'warning'})}catch{return}if(current!==identity())return;await command('remove',{id:task.id})}
function activate(){if(active)return;active=true;void refresh();timer=setInterval(()=>{if(!document.hidden)void refresh()},1500)}
function stop(){active=false;generation++;clearInterval(timer);creating.value=false;picker.value=false}
onMounted(activate);onActivated(activate);onDeactivated(stop);onBeforeUnmount(stop)
</script>
<template>
<section v-if="isWindows" class="computer-backup">
 <header><div><h2>电脑文件夹备份</h2><p>将本地文件夹完整备份到 NAS，保留目录结构，每次执行创建独立副本。</p></div><el-button type="primary" :disabled="busy" @click="syncScope();creating=true">新建电脑备份</el-button></header>
 <el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon/>
 <div v-if="!tasks.length" class="backup-empty"><strong>还没有电脑备份任务</strong><p>选择电脑文件夹与 NAS 目标目录，保存后即可执行备份。</p></div>
 <article v-for="task in tasks" :key="task.id" class="computer-task">
  <div class="task-title"><h3>{{task.name}}</h3><el-tag :type="task.status==='done'?'success':task.status==='error'?'danger':'info'">{{labels[task.status]||task.status}}</el-tag></div>
  <dl><dt>电脑文件夹</dt><dd>{{task.source}}</dd><dt>NAS 目录</dt><dd>{{task.destination}}</dd><template v-if="task.output"><dt>本次备份</dt><dd>{{task.output}}</dd></template></dl>
  <div v-if="activeStates.includes(task.status)||task.total" class="task-progress"><el-progress :percentage="task.total?Math.floor(task.completed/task.total*100):0"/><span>已校验 {{task.completed}} / {{task.total}} 个文件 · {{formatBytes(task.bytes)}}</span><p v-if="task.current">{{task.current}}</p></div>
  <p v-if="task.message" class="task-message" role="status">{{task.message}}</p>
  <div class="task-actions"><el-button v-if="activeStates.includes(task.status)" :disabled="busy||task.status==='cancelling'" @click="command('cancel',{id:task.id})">取消备份</el-button><el-button v-else type="primary" :disabled="busy||running" @click="start(task)">执行备份</el-button><el-button :disabled="busy||activeStates.includes(task.status)" @click="remove(task)">移除任务</el-button></div>
 </article>
 <p class="backup-footnote">手动执行完整备份，包含空文件夹。链接、云端占位文件和不可读取的文件会提示处理；源文件在备份期间发生变化时不会标记成功。暂不包含定时执行或自动增量备份。</p>
 <el-dialog v-model="creating" title="新建电脑备份" width="min(580px,94vw)" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy">
  <el-form label-position="top" @submit.prevent="create"><el-form-item label="任务名称"><el-input v-model="name" maxlength="80" :disabled="busy"/></el-form-item><el-form-item label="电脑文件夹"><div class="folder-field"><el-input :model-value="source" readonly placeholder="选择本地文件夹"/><el-button :disabled="busy" @click="chooseSource">选择文件夹</el-button></div></el-form-item><el-form-item label="NAS 目标目录"><div class="folder-field"><el-input :model-value="destination" readonly placeholder="选择已有的 NAS 目录"/><el-button :disabled="busy" @click="picker=true">选择目录</el-button></div></el-form-item></el-form>
  <p class="backup-footnote">每次执行都会新建 SynoLink 备份目录，不覆盖已有文件。内容校验会从 NAS 读取上传文件，请预留足够的网络流量与存储空间。</p>
  <template #footer><el-button :disabled="busy" @click="creating=false">取消</el-button><el-button type="primary" :loading="busy" :disabled="!name.trim()||!source||!destination" @click="create">保存任务</el-button></template>
 </el-dialog>
 <FolderPicker v-if="picker" v-model="picker" :initial="destination" title="选择备份目标目录" @confirm="value=>{destination=value;picker=false}"/>
</section>
</template>
<style scoped>
.computer-backup{padding:20px;border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--card));margin-bottom:20px}header,.task-title,.task-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}h2{margin:0;font-size:18px}header p,.backup-empty p,.backup-footnote{font-size:13px;line-height:1.7;color:hsl(var(--muted-foreground))}.backup-empty{padding:28px 0 16px}.backup-empty strong{font-size:14px;font-weight:500}.computer-task{border-top:1px solid hsl(var(--border));padding:18px 0}.task-title h3{font-size:15px;margin:0;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:84px minmax(0,1fr);gap:8px;font-size:13px;line-height:1.6}dt{color:hsl(var(--muted-foreground))}dd{margin:0;overflow-wrap:anywhere}.task-actions{justify-content:flex-start}.task-actions .el-button{margin-left:0}.task-progress,.task-message{font-size:12px;line-height:1.6;overflow-wrap:anywhere}.task-progress span{color:hsl(var(--muted-foreground))}.folder-field{display:flex;gap:8px;width:100%}.backup-footnote{margin-bottom:0}.el-alert{margin-top:16px}@media(max-width:640px){.computer-backup{padding:16px}.folder-field{flex-wrap:wrap}.folder-field .el-input{min-width:180px;flex:1}}
</style>
