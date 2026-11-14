<script setup lang="ts">
import WorkloadManager from '../components/WorkloadManager.vue'
import {snapshotFileClient} from '../composables/useFileOperations'
import {containerDetails} from '../utils/workloadDetails'
import {invoke} from '@tauri-apps/api/core'
import {save} from '@tauri-apps/plugin-dialog'
import {isAndroid} from '../utils/platform'
import WorkspaceHeader from '../components/WorkspaceHeader.vue'
import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dsm } from '../api/dsm'
import { apiError, mapContainers } from '../utils/packages'
import { formatBytes } from '../utils/format'
import { confirm } from '../utils/feedback'
const items = ref<Array<{ id: string; name: string; image: string; status: string }>>([])
const query = ref(''), loading = ref(false), error = ref(''), resourceError = ref(''), updated = ref(''), pending = ref('')
const resources = ref<Record<string, any>>({})
const visible = computed(() => items.value.filter(c => (c.name + c.image).toLowerCase().includes(query.value.toLowerCase())))
const running = computed(() => items.value.filter(c => c.status === 'running').length)
const detailOpen=ref(false),detailName=ref(''),detail=ref<ReturnType<typeof containerDetails>>(),detailError=ref(''),detailBusy=ref(false)
let detailEpoch=0
async function showDetail(name:string){const token=++detailEpoch,captured=currentContext(),client=snapshotFileClient();detailOpen.value=true;detailName.value=name;detail.value=undefined;detailError.value='';detailBusy.value=true;try{const r=await client.containerDetail(name);if(!active||token!==detailEpoch||captured!==currentContext())return;if(!r.success)throw Error(apiError(r.error?.code));detail.value=containerDetails(r.data)}catch(e:any){if(active&&token===detailEpoch&&captured===currentContext())detailError.value=e.message||'详情读取失败'}finally{if(token===detailEpoch)detailBusy.value=false}}
const logFilter=ref(''),logFollow=ref(false),exporting=ref(false)
const filteredLog=computed(()=>logText.value.split('\n').filter(line=>line.toLowerCase().includes(logFilter.value.toLowerCase())).join('\n'))
async function copyLogs(){try{await navigator.clipboard.writeText(filteredLog.value);ElMessage.success('当前页日志已复制')}catch{ElMessage.warning('复制失败，请手动选择日志复制')}}
async function exportLogs(){exporting.value=true;const report=JSON.stringify({container:logName.value,exportedAt:new Date().toISOString(),offset:logOffset.value,log:filteredLog.value},null,2);try{if(new TextEncoder().encode(report).length>262144)throw Error('当前页日志过大，请筛选后导出');if(isAndroid){await invoke('export_android_report',{report,kind:'container-log'})}else{const path=await save({defaultPath:'SynoLink-container-log.json',filters:[{name:'JSON',extensions:['json']}]});if(path)await invoke('save_diagnostic_report',{path,report})}}catch(e:any){ElMessage.error(e.message||'导出失败')}finally{exporting.value=false}}
const logOpen = ref(false), logName = ref(''), logText = ref(''), logError = ref(''), logLoading = ref(false), logOffset = ref(0), logTotal = ref(0)
let active = false, generation = 0, logGeneration = 0, context = '', timer: ReturnType<typeof setInterval> | undefined
function currentContext() { return JSON.stringify([dsm.baseUrl, dsm.account,dsm.sid]) }
async function refresh() {
  if (loading.value) return
  const current = currentContext(), token = ++generation
  if (current !== context) { items.value = []; resources.value = {}; updated.value = ''; logOpen.value = false; detailOpen.value=false;detailEpoch++; context = current }
  loading.value = true
  try {
    if (!Object.keys(dsm.apiInfo).length) await dsm.loadApiInfo()
    if (!dsm.apiInfo['SYNO.Docker.Container']) throw new Error('当前 NAS 未提供容器接口，请检查 Container Manager / Docker 套件')
    const [list, usage] = await Promise.allSettled([dsm.containerList(), dsm.apiInfo['SYNO.Docker.Container.Resource'] ? dsm.containerResources() : Promise.resolve(null)])
    if (!active || token !== generation || current !== currentContext()) return
    if (list.status === 'rejected') throw new Error('无法读取容器列表，请检查 NAS 连接')
    if (!list.value.success) throw new Error(apiError(list.value.error?.code))
    items.value = mapContainers(list.value.data)
    resources.value = {}
    const resourceResult = usage.status === 'fulfilled' ? usage.value : null
    resourceError.value = resourceResult?.success ? '' : '资源占用暂不可用'
    for (const resource of resourceResult?.data?.resources ?? []) resources.value[resource.name] = resource
    error.value = ''; updated.value = new Date().toLocaleTimeString()
  } catch (e: any) { if (active && token === generation && current === currentContext()) error.value = e.message || '容器刷新失败' }
  finally { if (token === generation) loading.value = false }
}
async function operate(name: string, action: 'start' | 'stop' | 'restart') {
  if (pending.value || error.value) return
  const captured = currentContext(), label = { start: '启动', stop: '停止', restart: '重启' }[action]
  if (action !== 'start' && !await confirm(`确定${label}容器「${name}」？容器提供的服务将暂时中断。`, `${label}容器`, { confirmText: label })) return
  if (!active || captured !== currentContext() || pending.value) return
  pending.value = name
  try {
    const result = await dsm.containerAction(name, action)
    if (!active || captured !== currentContext()) return
    if (!result.success) throw new Error(apiError(result.error?.code))
    ElMessage.success(`${label}请求已提交，以刷新后的状态为准`)
    await refresh()
  } catch (e: any) { if (active && captured === currentContext()) ElMessage.error(e.message || '操作失败') }
  finally { pending.value = '' }
}
async function showLogs(name: string, offset = 0) {
  if(logName.value!==name||logOffset.value!==offset)logText.value=''
  const token = ++logGeneration, captured = currentContext()
  logOpen.value = true; logName.value = name; logOffset.value = offset; logError.value = ''; logLoading.value = true
  try {
    const client=snapshotFileClient();const result = await client.containerLogs(name, offset)
    if (!active || token !== logGeneration || captured !== currentContext()) return
    if (!result.success) throw new Error(apiError(result.error?.code))
    if (!Array.isArray(result.data?.logs)) throw new Error('无法识别日志响应')
    logText.value = result.data.logs.map((line: any) => `${line.created ?? ''} ${line.stream ?? ''}  ${line.text ?? ''}`).join('\n')
    logTotal.value = Number(result.data.total ?? offset + result.data.logs.length)
  } catch (e: any) { if (token === logGeneration && active && captured===currentContext()) logError.value = e.message || '日志加载失败' }
  finally { if (token === logGeneration) logLoading.value = false }
}
function stop() { detailEpoch++;detailOpen.value=false;logFollow.value=false;active = false; generation++; logGeneration++; loading.value = false; logLoading.value = false; logOpen.value = false; clearInterval(timer) }
onActivated(() => { active = true; refresh(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) {refresh();if(logOpen.value&&logFollow.value&&!logLoading.value&&logOffset.value===0)showLogs(logName.value)} }, 5000) })
onDeactivated(stop); onUnmounted(stop)
</script>
<template>
  <section class="container-page">
    <WorkspaceHeader title="容器" :description="items.length+' 个容器，'+running+' 个运行中'+(updated?'，更新于 '+updated:'')"><el-button :loading="loading" @click="refresh">刷新</el-button></WorkspaceHeader>
    <el-alert v-if="error" :title="error + '，当前列表可能已过期'" type="warning" :closable="false" show-icon />
    <div class="container-toolbar"><el-input v-model="query" placeholder="搜索容器或镜像" clearable aria-label="搜索容器" /><span>{{ resourceError }}</span></div>
    <div class="container-grid">
      <article v-for="c in visible" :key="c.id" class="container-card">
        <div class="container-title"><h3>{{ c.name }}</h3><el-tag :type="c.status === 'running' ? 'success' : 'info'">{{ c.status === 'running' ? '运行中' : ['stopped','exited'].includes(c.status) ? '已停止' : c.status }}</el-tag></div>
        <p class="image-name">{{ c.image || '镜像信息未返回' }}</p>
        <div class="resource-row"><span>CPU <strong>{{ resources[c.name]?.cpu != null ? Number(resources[c.name].cpu).toFixed(1) + '%' : '—' }}</strong></span><span>内存 <strong>{{ resources[c.name]?.memory != null ? formatBytes(resources[c.name].memory) : '—' }}</strong></span></div>
        <footer><el-button @click="showDetail(c.name)">详情</el-button><el-button @click="showLogs(c.name)">日志</el-button><div><el-button v-if="['stopped','exited','created'].includes(c.status)" :disabled="!!pending || !!error" @click="operate(c.name, 'start')">启动</el-button><template v-if="c.status === 'running'"><el-button :disabled="!!pending || !!error" @click="operate(c.name, 'restart')">重启</el-button><el-button :disabled="!!pending || !!error" @click="operate(c.name, 'stop')">停止</el-button></template><span v-if="pending === c.name">处理中…</span></div></footer>
      </article>
    </div>
    <WorkloadManager kind="images"/><WorkloadManager kind="projects"/>
    <el-empty v-if="!visible.length && !loading" :description="error ? '暂时无法读取容器' : query ? '没有匹配容器' : '暂无容器'" />
    <el-dialog v-model="detailOpen" :title="detailName+' · 容器详情'" width="min(760px,94vw)" @closed="detailEpoch++"><p v-if="detailBusy">正在读取…</p><el-alert v-if="detailError" :title="detailError" type="warning" :closable="false"/><template v-if="detail"><el-descriptions :column="1" border><el-descriptions-item label="重启策略">{{detail.restart}}</el-descriptions-item><el-descriptions-item label="健康状态">{{detail.health}}</el-descriptions-item><el-descriptions-item label="退出码">{{detail.exit}}</el-descriptions-item></el-descriptions><section v-for="group in ([{title:'端口映射',rows:detail.ports},{title:'挂载目录',rows:detail.mounts},{title:'网络',rows:detail.networks}])" :key="group.title"><h3>{{group.title}}</h3><p v-for="(row,i) in group.rows" :key="i" style="overflow-wrap:anywhere">{{row}}</p><p v-if="!group.rows.length">NAS 未返回此信息</p></section></template><template #footer><el-button :loading="detailBusy" @click="showDetail(detailName)">重新读取</el-button></template></el-dialog>
    <el-dialog v-model="logOpen" :title="logName + ' · 日志'" width="min(900px, 94vw)" @closed="logGeneration++">
      <el-alert v-if="logError" :title="logError" type="error" :closable="false" />
      <p class="log-caption">每页最多 200 条，最新日志在前。筛选、复制和导出仅针对当前页。</p><div class="log-tools"><el-input v-model="logFilter" clearable placeholder="筛选当前页日志" aria-label="筛选日志"/><el-switch v-model="logFollow" :disabled="logOffset!==0" active-text="自动刷新"/><el-button :disabled="!filteredLog||logLoading" @click="copyLogs">复制当前页</el-button><el-button :disabled="!filteredLog||logLoading" :loading="exporting" @click="exportLogs">导出 JSON</el-button></div>
      <pre class="container-log" aria-label="容器日志">{{ logLoading ? '正在加载…' : logError ? '读取失败，请重试' : filteredLog || '暂无匹配日志' }}</pre>
      <template #footer><el-button :disabled="logLoading || logOffset === 0" @click="showLogs(logName, Math.max(0, logOffset - 200))">上一页</el-button><el-button :disabled="logLoading || !!logError || logOffset + 200 >= logTotal" @click="showLogs(logName, logOffset + 200)">下一页</el-button><el-button :loading="logLoading" @click="showLogs(logName)">刷新日志</el-button></template>
    </el-dialog>
  </section>
</template>
<style scoped>
.log-tools{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:16px 0}.log-tools .el-input{flex:1;min-width:180px}.log-tools .el-button{margin:0}

.container-page { height:100%; overflow:auto; padding:28px; box-sizing:border-box; } header,.container-title,footer,.resource-row,.container-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; }h1 { margin:6px 0; font-size:26px; }.eyebrow { font-size:10px; letter-spacing:2px; }header p,.eyebrow,.image-name,.resource-row,.container-toolbar>span,.log-caption { color:var(--el-text-color-secondary); font-size:12px; }.container-toolbar { margin:24px 0; }.container-toolbar .el-input { max-width:320px; }.container-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:16px; }.container-card { background:var(--el-bg-color); border:1px solid var(--el-border-color); padding:20px; border-radius:16px; }.container-title h3 { font-size:16px; margin:0; overflow-wrap:anywhere; }.image-name { overflow-wrap:anywhere; }.resource-row { padding:16px 0; border-bottom:1px solid var(--el-border-color); margin-bottom:16px; }.resource-row strong { display:block; color:var(--el-text-color-primary); font-size:20px; margin-top:6px; font-weight:500; }.container-log { background:#101723; color:#d7e6ed; padding:18px; border-radius:12px; max-height:55vh; min-height:180px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.8 Consolas,monospace; }footer{flex-wrap:wrap}footer>div{display:flex;gap:6px;align-items:center}@media(max-width:640px){.container-page{padding:16px}.container-grid{grid-template-columns:1fr}}
</style>
