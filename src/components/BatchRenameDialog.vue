<script setup lang="ts">
import { computed, ref, reactive, watch, onDeactivated, onBeforeUnmount } from 'vue'
import { dsm, type DsmClient } from '../api/dsm'
import { identity, snapshotFileClient, operationScope, markDirectoriesChanged } from '../composables/useFileOperations'
import { renamePreview, renameParent, runRenameBatch, type RenameSource, type RenameRow, type RenameRule } from '../utils/batchRename'
const visible = ref(false), busy = ref(false), finished = ref(false), error = ref(''), stopping = ref(false)
const sources = ref<RenameSource[]>([]), names = ref<string[]>([]), results = ref<RenameRow[]>([])
const rule = reactive<RenameRule>({ mode:'replace', find:'', replace:'', prefix:'', suffix:'', start:1, digits:3 })
const preview = computed(() => finished.value || busy.value ? results.value : renamePreview(sources.value, rule, names.value))
const ready = computed(() => !busy.value && !finished.value && !error.value && preview.value.some(row=>row.status==='pending') && !preview.value.some(row=>row.error))
let client:DsmClient, scope='', sid='', generation=0
const valid = (gen:number) => gen===generation && visible.value && scope===identity() && sid===dsm.sid && !stopping.value
function stop(){stopping.value=true}
function close(){stop();generation++;visible.value=false}
watch(operationScope,()=>{if(visible.value&&scope!==identity())close()})
onDeactivated(close);onBeforeUnmount(close)
function open(rows:RenameSource[], siblings:RenameSource[]){
  if(busy.value)return
  generation++;scope=identity();sid=dsm.sid;client=snapshotFileClient();sources.value=rows.map(r=>({...r}));names.value=siblings.map(r=>r.name)
  Object.assign(rule,{mode:'replace',find:'',replace:'',prefix:'',suffix:'',start:1,digits:3})
  results.value=[];error.value='';finished.value=false;stopping.value=false;visible.value=true
  if(!rows.length||rows.length>500||new Set(rows.map(r=>renameParent(r.path))).size!==1||!renameParent(rows[0]!.path))error.value='请选择同一目录内的 1–500 个项目，不支持共享目录重命名'
}
async function submit(){
  if(!ready.value)return
  if(!valid(generation)){close();return}
  const gen=generation, boundClient=client, folder=renameParent(sources.value[0]!.path)
  busy.value=true;results.value=renamePreview(sources.value,rule,names.value)
  try{
    await boundClient.ensureFileFeature('SYNO.FileStation.Rename')
    if(!valid(gen))return
    const listing=await boundClient.listAll(folder)
    if(!valid(gen))return
    if(!listing.success||!Array.isArray(listing.data?.files))throw Error('无法核对目录，请刷新后重试')
    if(sources.value.some(row=>!listing.data.files.some((file:any)=>file.path===row.path&&file.name===row.name)))throw Error('源文件已变化，请关闭并刷新目录后重试')
    results.value=renamePreview(sources.value,rule,listing.data.files.map((file:any)=>file.name))
    if(results.value.some(row=>row.error))throw Error('目录内容已变化，请检查预览中的冲突')
    await runRenameBatch(results.value,row=>boundClient.renameChecked(row.path,row.target),()=>valid(gen),()=>markDirectoriesChanged(boundClient.baseUrl,boundClient.account,[folder]))
    if(gen===generation)finished.value=true
  }catch(e){if(gen===generation){error.value=(e as Error).message;for(const row of results.value)if(row.status==='pending')row.status='stopped';finished.value=true}}
  finally{busy.value=false;if(gen===generation&&stopping.value){for(const row of results.value)if(row.status==='pending')row.status='stopped';finished.value=true}if(gen===generation&&(scope!==identity()||sid!==dsm.sid))close()}
}
const labels={pending:'待处理',unchanged:'不变',done:'已完成',error:'失败',unknown:'待核实',stopped:'未执行'}
defineExpose({open})
</script>

<template>
  <el-dialog v-model="visible" class="batch-rename-dialog" title="批量重命名" top="5vh" width="min(760px, calc(100vw - 24px))" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @closed="!visible && close()">
    <p class="rename-note">按下方顺序处理 {{ sources.length }} 项，保留文件扩展名。提交前重新检查同名冲突；停止不会撤销已完成的重命名。</p>
    <fieldset :disabled="busy||finished" class="rename-form">
      <label>命名方式<select v-model="rule.mode" aria-label="命名方式"><option value="replace">替换文字 / 添加前后缀</option><option value="number">按序号命名</option></select></label>
      <template v-if="rule.mode==='replace'"><label>查找文字<input v-model="rule.find" aria-label="查找文字" placeholder="留空保留原名" /></label><label>替换为<input v-model="rule.replace" aria-label="替换为" placeholder="支持替换为空" /></label></template>
      <template v-else><label>起始序号<input v-model.number="rule.start" aria-label="起始序号" type="number" min="0" max="999999999" /></label><label>序号位数<input v-model.number="rule.digits" aria-label="序号位数" type="number" min="1" max="9" /></label></template>
      <label>前缀<input v-model="rule.prefix" aria-label="前缀" /></label><label>后缀<input v-model="rule.suffix" aria-label="后缀" /></label>
    </fieldset>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div class="rename-preview" aria-label="重命名预览"><article v-for="row in preview" :key="row.path"><span class="rename-old">{{ row.name }}</span><strong>{{ row.target }}</strong><small :class="{'rename-error':row.error}">{{ row.error || labels[row.status] }}</small></article></div>
    <p v-if="busy" role="status">{{ stopping?'正在停止后续操作，等待当前请求结束':'正在核对并逐项重命名' }}</p>
    <p v-if="finished" role="status">已完成 {{ results.filter(r=>r.status==='done').length }} / {{ sources.length }} 项。未确认的结果请刷新目录核实。</p>
    <template #footer><el-button v-if="busy" :disabled="stopping" @click="stop">停止后续操作</el-button><el-button v-else @click="close">关闭</el-button><el-button type="primary" :disabled="!ready" @click="submit">确认重命名</el-button></template>
  </el-dialog>
</template>

<style scoped>
:global(.batch-rename-dialog){max-height:90vh;display:flex;flex-direction:column;margin-bottom:5vh}:global(.batch-rename-dialog .el-dialog__body){overflow-y:auto;min-height:0}:global(.batch-rename-dialog .el-dialog__header),:global(.batch-rename-dialog .el-dialog__footer){flex-shrink:0}
.rename-note{color:hsl(var(--muted-foreground));line-height:1.7;margin:0 0 16px}.rename-form{border:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 18px;min-width:0}.rename-form label{display:flex;flex-direction:column;gap:6px;min-width:0}.rename-form input,.rename-form select{width:100%;box-sizing:border-box;border:1px solid hsl(var(--border));background:hsl(var(--background));color:hsl(var(--foreground));border-radius:8px;padding:9px;font:inherit;min-width:0}.rename-form:disabled{opacity:.6}.rename-preview{max-height:320px;overflow:auto;margin-top:14px;border:1px solid hsl(var(--border));border-radius:10px}.rename-preview article{padding:12px;display:grid;gap:5px;border-bottom:1px solid hsl(var(--border));overflow-wrap:anywhere}.rename-preview article:last-child{border:0}.rename-old{color:hsl(var(--muted-foreground));font-size:12px}.rename-preview strong{font-weight:500}.rename-preview small{color:hsl(var(--muted-foreground))}.rename-preview .rename-error{color:var(--el-color-danger)}@media(max-width:480px){.rename-form{grid-template-columns:1fr}.rename-preview{max-height:240px}}
</style>
