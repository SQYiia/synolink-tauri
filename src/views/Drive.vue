<script setup lang="ts">
import WorkspaceHeader from '../components/WorkspaceHeader.vue'
import { computed, onActivated, onDeactivated, ref } from 'vue'
import { dsm } from '../api/dsm'
import { apiError } from '../utils/packages'
import { displayTime, driveItem, rowsOf } from '../utils/driveBackup'
import { formatBytes } from '../utils/format'
const mode = ref('personal'), items = ref<ReturnType<typeof driveItem>[]>([]), trail = ref<Array<{id:string;name:string}>>([])
const busy = ref(false), error = ref(''), offset = ref(0), more = ref(false), query = ref(''), selected = ref<ReturnType<typeof driveItem> | null>(null)
let generation = 0, context = ''
const visible = computed(() => items.value.filter(i => i.name.toLowerCase().includes(query.value.toLowerCase())))
async function load(page = 0) {
  const captured = JSON.stringify([dsm.baseUrl,dsm.account]), token = ++generation
  busy.value = true; error.value = ''; items.value = []; selected.value = null
  if (context !== captured) { trail.value = []; mode.value = 'personal'; page = 0; context = captured }
  offset.value = page
  try {
    if (!Object.keys(dsm.apiInfo).length) await dsm.loadApiInfo()
    const teams = mode.value === 'teams' && !trail.value.length
    if (!dsm.apiInfo[teams ? 'SYNO.SynologyDrive.TeamFolders' : 'SYNO.SynologyDrive.Files']) throw new Error('当前 NAS 未提供 Drive 接口，请检查 Synology Drive Server 套件')
    const folder = trail.value[trail.value.length - 1]
    const result = teams ? await dsm.driveTeamFolders(page) : await dsm.driveFiles(folder ? 'id:' + folder.id : '/mydrive', page)
    if (token !== generation || captured !== JSON.stringify([dsm.baseUrl,dsm.account])) return
    if (!result.success) throw new Error(apiError(result.error?.code) + (result.error?.code === 105 ? '；可重新登录以建立 Drive 会话' : ''))
    items.value = rowsOf(result.data, 'items').map(raw => ({ ...driveItem(raw), ...(teams ? { directory: true } : {}) }))
    more.value = result.data.total != null ? page + items.value.length < Number(result.data.total) : items.value.length === 100
  } catch(e:any) { if(token===generation) { error.value=e.message || '无法读取 Drive'; more.value=false } }
  finally { if(token===generation) busy.value=false }
}
function enter(item:ReturnType<typeof driveItem>) { if(item.directory && item.id) {trail.value.push({id:item.id,name:item.name});query.value='';load()} else selected.value=item }
function root() { trail.value=[];query.value='';load() }
function back() {trail.value.pop();query.value='';load()}
onActivated(()=>load(offset.value)); onDeactivated(()=>{generation++;busy.value=false;selected.value=null})
</script>
<template>
<section class="drive-page"><WorkspaceHeader title="Drive 文件" description="浏览个人文件与团队共享资料。"><el-button :loading="busy" @click="load(offset)">刷新</el-button></WorkspaceHeader>
<el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon />
<div class="drive-toolbar"><el-radio-group v-model="mode" @change="root"><el-radio-button value="personal">我的文件</el-radio-button><el-radio-button value="teams">团队文件夹</el-radio-button></el-radio-group><el-input v-model="query" placeholder="筛选当前页文件" aria-label="筛选 Drive 文件" clearable /></div>
<nav><el-button :disabled="!trail.length || busy" @click="back">上一级</el-button><el-button link @click="root">{{mode === 'teams' ? '团队文件夹' : '我的文件'}}</el-button><span v-for="part in trail" :key="part.id">/ {{part.name}}</span></nav>
<el-table v-loading="busy" :data="visible" @row-dblclick="enter" empty-text="暂无文件" class="drive-table"><el-table-column label="名称" min-width="220"><template #default="{row}"><button class="drive-name" @click="enter(row)"><el-icon><Folder v-if="row.directory"/><Document v-else/></el-icon>{{row.name}}</button></template></el-table-column><el-table-column label="大小" width="110"><template #default="{row}">{{row.directory ? '—' : row.size == null ? '未返回' : formatBytes(row.size)}}</template></el-table-column><el-table-column label="修改时间" min-width="170"><template #default="{row}">{{displayTime(row.modified)}}</template></el-table-column></el-table>
<footer><span>第 {{offset / 100 + 1}} 页 · {{items.length}} 项</span><el-button :disabled="busy || offset === 0" @click="load(Math.max(0,offset-100))">上一页</el-button><el-button :disabled="busy || !more" @click="load(offset+100)">下一页</el-button></footer>
<el-dialog :model-value="!!selected" title="文件信息" width="min(560px,94vw)" @update:model-value="selected=null"><el-descriptions v-if="selected" :column="1" border><el-descriptions-item label="名称">{{selected.name}}</el-descriptions-item><el-descriptions-item label="大小">{{selected.size == null ? '未返回' : formatBytes(selected.size)}}</el-descriptions-item><el-descriptions-item label="修改时间">{{displayTime(selected.modified)}}</el-descriptions-item><el-descriptions-item label="文件 ID">{{selected.id || '未返回'}}</el-descriptions-item></el-descriptions></el-dialog>
</section>
</template>
<style scoped>
.drive-page{padding:28px;box-sizing:border-box;height:100%;overflow:auto}header,.drive-toolbar,nav,footer{display:flex;align-items:center;gap:14px;flex-wrap:wrap}header{justify-content:space-between}h1{margin:6px 0;font-size:26px}small{letter-spacing:2px}small,header p,footer{font-size:12px;color:var(--el-text-color-secondary)}.drive-toolbar{margin:24px 0}.drive-toolbar .el-input{max-width:280px}nav{margin-bottom:18px;font-size:12px}.drive-name{background:none;border:0;cursor:pointer;color:var(--el-text-color-primary);display:flex;align-items:center;gap:10px;text-align:left;overflow-wrap:anywhere;padding:10px 0}.drive-name:hover{color:var(--el-color-primary)}footer{margin-top:18px;justify-content:flex-end}footer>span{margin-right:auto}@media(max-width:640px){.drive-page{padding:16px}}
</style>
