<script setup lang="ts">
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
const logOpen = ref(false), logName = ref(''), logText = ref(''), logError = ref(''), logLoading = ref(false), logOffset = ref(0), logTotal = ref(0)
let active = false, generation = 0, logGeneration = 0, context = '', timer: ReturnType<typeof setInterval> | undefined
function currentContext() { return JSON.stringify([dsm.baseUrl, dsm.account]) }
async function refresh() {
  if (loading.value) return
  const current = currentContext(), token = ++generation
  if (current !== context) { items.value = []; resources.value = {}; updated.value = ''; logOpen.value = false; context = current }
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
  const token = ++logGeneration, captured = currentContext()
  logOpen.value = true; logName.value = name; logOffset.value = offset; logText.value = ''; logError.value = ''; logLoading.value = true
  try {
    const result = await dsm.containerLogs(name, offset)
    if (!active || token !== logGeneration || captured !== currentContext()) return
    if (!result.success) throw new Error(apiError(result.error?.code))
    if (!Array.isArray(result.data?.logs)) throw new Error('无法识别日志响应')
    logText.value = result.data.logs.map((line: any) => `${line.created ?? ''} ${line.stream ?? ''}  ${line.text ?? ''}`).join('\n')
    logTotal.value = Number(result.data.total ?? offset + result.data.logs.length)
  } catch (e: any) { if (token === logGeneration && active) logError.value = e.message || '日志加载失败' }
  finally { if (token === logGeneration) logLoading.value = false }
}
function stop() { active = false; generation++; logGeneration++; loading.value = false; logLoading.value = false; logOpen.value = false; clearInterval(timer) }
onActivated(() => { active = true; refresh(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refresh() }, 5000) })
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
        <footer><el-button @click="showLogs(c.name)">日志</el-button><div><el-button v-if="['stopped','exited','created'].includes(c.status)" :disabled="!!pending || !!error" @click="operate(c.name, 'start')">启动</el-button><template v-if="c.status === 'running'"><el-button :disabled="!!pending || !!error" @click="operate(c.name, 'restart')">重启</el-button><el-button :disabled="!!pending || !!error" @click="operate(c.name, 'stop')">停止</el-button></template><span v-if="pending === c.name">处理中…</span></div></footer>
      </article>
    </div>
    <el-empty v-if="!visible.length && !loading" :description="error ? '暂时无法读取容器' : query ? '没有匹配容器' : '暂无容器'" />
    <el-dialog v-model="logOpen" :title="logName + ' · 日志'" width="min(900px, 94vw)" @closed="logGeneration++">
      <el-alert v-if="logError" :title="logError" type="error" :closable="false" />
      <p class="log-caption">每页最多 200 条，最新日志在前。</p>
      <pre class="container-log" aria-label="容器日志">{{ logLoading ? '正在加载…' : logError ? '读取失败，请重试' : logText || '暂无日志' }}</pre>
      <template #footer><el-button :disabled="logLoading || logOffset === 0" @click="showLogs(logName, Math.max(0, logOffset - 200))">上一页</el-button><el-button :disabled="logLoading || !!logError || logOffset + 200 >= logTotal" @click="showLogs(logName, logOffset + 200)">下一页</el-button><el-button :loading="logLoading" @click="showLogs(logName)">刷新日志</el-button></template>
    </el-dialog>
  </section>
</template>
<style scoped>
.container-page { height:100%; overflow:auto; padding:28px; box-sizing:border-box; } header,.container-title,footer,.resource-row,.container-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; }h1 { margin:6px 0; font-size:26px; }.eyebrow { font-size:10px; letter-spacing:2px; }header p,.eyebrow,.image-name,.resource-row,.container-toolbar>span,.log-caption { color:var(--el-text-color-secondary); font-size:12px; }.container-toolbar { margin:24px 0; }.container-toolbar .el-input { max-width:320px; }.container-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:16px; }.container-card { background:var(--el-bg-color); border:1px solid var(--el-border-color); padding:20px; border-radius:16px; }.container-title h3 { font-size:16px; margin:0; overflow-wrap:anywhere; }.image-name { overflow-wrap:anywhere; }.resource-row { padding:16px 0; border-bottom:1px solid var(--el-border-color); margin-bottom:16px; }.resource-row strong { display:block; color:var(--el-text-color-primary); font-size:20px; margin-top:6px; font-weight:500; }.container-log { background:#101723; color:#d7e6ed; padding:18px; border-radius:12px; max-height:55vh; min-height:180px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.8 Consolas,monospace; }footer{flex-wrap:wrap}footer>div{display:flex;gap:6px;align-items:center}@media(max-width:640px){.container-page{padding:16px}.container-grid{grid-template-columns:1fr}}
</style>
