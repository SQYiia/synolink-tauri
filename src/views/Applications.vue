<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref } from 'vue'
import { useRouter } from 'vue-router'
import PackageCenter from '../components/PackageCenter.vue'
import WorkspaceHeader from '../components/WorkspaceHeader.vue'
import { packageResult } from '../utils/packageManagement'
import { confirm } from '../utils/feedback'
import { dsm } from '../api/dsm'
import { apiError, integrations, mapPackage, packageState, type NasPackage } from '../utils/packages'
const router = useRouter()
const selected = ref<NasPackage>(), detailOpen = ref(false), operation = ref(''), outcome = ref('')
let active = true
function canControl(p:NasPackage) { return !!capabilities.value['SYNO.Core.Package.Control'] && (p.startable || p.operations.includes('start') || p.operations.includes('stop')) && ['running','stop','stopped'].includes(p.status) }
function details(p:NasPackage) { selected.value=p;detailOpen.value=true }
async function control(p:NasPackage, action:'start'|'stop'|'uninstall') {
 if(operation.value||busy.value||context!==JSON.stringify([dsm.baseUrl,dsm.account]))return
 const identity=JSON.stringify([dsm.baseUrl,dsm.account]);operation.value=p.id;outcome.value='';error.value=''
 try {
  const text=action==='uninstall'?'卸载 '+p.name+'？套件及其数据可能被删除，依赖它的服务也可能受到影响。':action==='stop'?'停止 '+p.name+'？使用此套件的服务会暂时不可用。':'启动 '+p.name+'？'
  if(!await confirm(text,'确认套件操作',{danger:action!=='start'}))return
  if(!active||identity!==JSON.stringify([dsm.baseUrl,dsm.account]))return
  if(action==='uninstall'&&p.uninstallPages)throw Error('此套件需要专用卸载选项，请在 DSM 套件中心操作')
  packageResult(await dsm.packageFeasibility(p.id,action))
  if(!active||identity!==JSON.stringify([dsm.baseUrl,dsm.account]))return
  packageResult(await (action==='uninstall'?dsm.packageUninstall(p.id):dsm.packageControl(p.id,action)))
  for(let i=0;i<30;i++){
   if(!active||identity!==JSON.stringify([dsm.baseUrl,dsm.account]))return
   const result=packageResult(await dsm.packageList())
   if(!active||identity!==JSON.stringify([dsm.baseUrl,dsm.account]))return
   if(!Array.isArray(result.packages))throw Error('无法确认套件状态')
   packages.value=result.packages.map(mapPackage);const found=packages.value.find(x=>x.id===p.id)
   if(action==='uninstall'?!found:found?.status===(action==='start'?'running':'stop')||(action==='stop'&&found?.status==='stopped')){outcome.value=p.name+'：'+(action==='uninstall'?'已卸载':action==='start'?'已启动':'已停止');selected.value=found;return}
   await new Promise(r=>setTimeout(r,1000))
  }
  outcome.value='操作已提交，但尚未确认状态变化，请刷新或在 DSM 中检查'
 }catch(e){if(active&&identity===JSON.stringify([dsm.baseUrl,dsm.account]))error.value=e instanceof Error?e.message:String(e)}finally{operation.value=''}
}
const packages = ref<NasPackage[]>([]), query = ref(''), filter = ref('all'), busy = ref(false), error = ref(''), updated = ref('')
const capabilities = ref<Record<string, any>>({})
let generation = 0, context = ''
const filtered = computed(() => packages.value.filter(p => (p.name + p.id).toLowerCase().includes(query.value.toLowerCase()) && (filter.value !== 'ready' || !!entry(p))))
function entry(p: NasPackage) { const item = integrations[p.id]; return item && capabilities.value[item.api] ? item : undefined }
async function refresh() {
  const current = JSON.stringify([dsm.baseUrl, dsm.account]), token = ++generation
  if (context !== current) { packages.value = []; updated.value = ''; capabilities.value = {}; context = current }
  busy.value = true; error.value = ''
  try {
    await dsm.loadApiInfo()
    const result = await dsm.packageList()
    if (token !== generation || current !== JSON.stringify([dsm.baseUrl, dsm.account])) return
    if (!result.success) throw new Error(apiError(result.error?.code))
    if (!Array.isArray(result.data?.packages)) throw new Error('套件列表响应格式不兼容')
    packages.value = result.data.packages.map(mapPackage).sort((a: NasPackage, b: NasPackage) => a.name.localeCompare(b.name))
    capabilities.value = { ...dsm.apiInfo }; updated.value = new Date().toLocaleTimeString()
  } catch (e: any) { if (token === generation) error.value = e.message || '无法连接 NAS' }
  finally { if (token === generation) busy.value = false }
}
onActivated(()=>{active=true;void refresh()})
onDeactivated(() => { active=false; generation++; busy.value = false; detailOpen.value=false })
</script>
<template>
  <section class="apps-page">
    <WorkspaceHeader title="套件中心" description="管理 NAS 应用，让设备发挥更多作用。"><el-button :loading="busy" @click="refresh"><el-icon><Refresh /></el-icon>刷新套件</el-button></WorkspaceHeader>
    <div class="package-overview"><div><strong>{{packages.length}}</strong><span>已安装套件</span></div><div><strong>{{packages.filter(p=>p.status==='running').length}}</strong><span>正在运行</span></div><div><strong>{{packages.filter(p=>!!entry(p)).length}}</strong><span>可在 SynoLink 中使用</span></div></div>
    <el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon />
    <PackageCenter :installed="packages" :capabilities="capabilities" @changed="refresh" />
    <el-alert v-if="outcome" :title="outcome" type="info" :closable="false" />
    <h2 class="installed-title">已安装</h2><div class="apps-toolbar"><el-input v-model="query" placeholder="搜索套件名称" clearable aria-label="搜索套件" /><el-radio-group v-model="filter"><el-radio-button value="all">全部套件</el-radio-button><el-radio-button value="ready">已接入</el-radio-button></el-radio-group><span>{{ packages.length }} 个套件 · {{ updated ? '更新于 ' + updated : '等待更新' }}</span></div>
    <div v-if="filtered.length" class="apps-grid">
      <article v-for="p in filtered" :key="p.id" class="package-card">
        <div class="package-heading"><div class="package-mark">{{ p.name.slice(0, 1).toUpperCase() }}</div><div><h3>{{ p.name }}</h3><small>{{ p.version }}</small></div></div>
        <p class="package-description">{{ p.description || p.id }}</p>
        <div class="package-controls"><el-button @click="details(p)">详情</el-button><el-button :loading="operation===p.id" :disabled="!!operation||busy||!canControl(p)" @click="control(p,p.status==='running'?'stop':'start')">{{ p.status==='running'?'停止':'启动' }}</el-button><el-button type="danger" plain :disabled="!!operation||busy||!capabilities['SYNO.Core.Package.Uninstallation']" @click="control(p,'uninstall')">卸载</el-button></div>
        <footer><el-tag :type="p.status === 'running' ? 'success' : 'info'">{{ packageState(p.status) }}</el-tag><el-button v-if="entry(p)" :disabled="p.status !== 'running'" @click="router.push(entry(p)!.path)">{{ entry(p)!.label }}</el-button><span v-else class="not-integrated">尚未接入</span></footer>
      </article>
    </div>
    <el-empty v-else-if="!busy" :description="error ? '套件读取失败，请重试' : query || filter !== 'all' ? '没有匹配的套件' : '当前账号未返回套件'" />
<el-dialog v-model="detailOpen" :title="selected?.name" width="min(650px,94vw)" append-to-body><template v-if="selected"><el-descriptions :column="1" border><el-descriptions-item label="套件标识">{{ selected.id }}</el-descriptions-item><el-descriptions-item label="版本">{{ selected.version }}</el-descriptions-item><el-descriptions-item label="状态">{{ packageState(selected.status) }}</el-descriptions-item><el-descriptions-item label="维护者">{{ selected.maintainer || '未提供' }}</el-descriptions-item><el-descriptions-item label="依赖信息">{{ selected.dependencies }}</el-descriptions-item></el-descriptions><p>{{ selected.description }}</p><el-button type="danger" plain :disabled="!!operation||busy||!!error||!capabilities['SYNO.Core.Package.Uninstallation']" @click="control(selected,'uninstall')">卸载套件</el-button></template></el-dialog>
    <p class="apps-note">“已接入”表示 SynoLink 已提供对应页面。未接入套件仍可查看版本和状态。相册目前通过文件管理读取照片。</p>
  </section>
</template>
<style scoped>
.package-controls{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.package-controls .el-button{margin:0}
.apps-page { padding:28px; overflow:auto; height:100%; box-sizing:border-box; }
header,.apps-toolbar,footer,.package-heading { display:flex; align-items:center; gap:16px; } header,footer { justify-content:space-between; }h1 { margin:6px 0; font-size:26px; }header p,.apps-note,.apps-toolbar>span { color:var(--el-text-color-secondary); font-size:12px; } .eyebrow { font-size:10px; letter-spacing:2px; color:var(--el-text-color-secondary); }
.apps-toolbar { margin:24px 0; flex-wrap:wrap; }.apps-toolbar .el-input { max-width:280px; }.apps-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }.package-card { border:1px solid var(--el-border-color); border-radius:16px; padding:20px; background:var(--el-bg-color); display:flex; flex-direction:column; }.package-mark { width:42px; height:42px; display:grid; place-items:center; border-radius:12px; background:var(--el-color-primary-light-9); color:var(--el-color-primary); font-size:22px; font-weight:700; }.package-heading h3 { font-size:15px; margin:0 0 5px; overflow-wrap:anywhere; }.package-heading small,.not-integrated { color:var(--el-text-color-secondary); font-size:11px; }.package-description { line-height:1.7; color:var(--el-text-color-secondary); font-size:12px; flex:1; overflow-wrap:anywhere; max-height:80px; overflow:auto; }.apps-note { margin-top:24px; line-height:1.8; }@media(max-width:640px){.apps-page{padding:16px}.apps-grid{grid-template-columns:1fr}header{align-items:flex-start}}
.installed-title{font-size:17px;margin:24px 0 0}.apps-toolbar{margin-top:12px}
</style>
