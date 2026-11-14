<script setup lang="ts">
import FileFolderIcon from '../components/FileFolderIcon.vue'
import FileTypeIcon from '../components/FileTypeIcon.vue'
import {useIsMobile} from '../composables/useIsMobile'
import {Document,ArrowLeft,ArrowRight,Refresh,Search} from '@element-plus/icons-vue'
const isMobile=useIsMobile()
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
function jump(index:number){trail.value=trail.value.slice(0,index+1);query.value='';load()}
function back() {trail.value.pop();query.value='';load()}
onActivated(()=>load(offset.value)); onDeactivated(()=>{generation++;busy.value=false;selected.value=null})
</script>
<template>
<section class="drive-page"><WorkspaceHeader title="Drive 文件" description="浏览个人文件与团队共享资料。"><el-button :loading="busy" @click="load(offset)"><el-icon><Refresh/></el-icon>刷新</el-button></WorkspaceHeader>
<el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon />
<div class="drive-toolbar"><el-radio-group v-model="mode" @change="root"><el-radio-button value="personal">我的文件</el-radio-button><el-radio-button value="teams">团队文件夹</el-radio-button></el-radio-group><el-input v-model="query" placeholder="筛选当前页文件" aria-label="筛选 Drive 文件" clearable><template #prefix><el-icon><Search/></el-icon></template></el-input></div>
<nav class="drive-location" aria-label="Drive 目录"><el-button :disabled="!trail.length || busy" aria-label="上一级" title="上一级" @click="back"><el-icon><ArrowLeft/></el-icon></el-button><div class="drive-crumbs"><button :disabled="busy" @click="root">{{mode === 'teams' ? '团队文件夹' : '我的文件'}}</button><template v-for="(part,index) in trail" :key="part.id"><span>/</span><button :disabled="busy" :aria-current="index===trail.length-1?'page':undefined" @click="jump(index)">{{part.name}}</button></template></div></nav>
<div class="drive-list-heading"><strong>{{trail[trail.length-1]?.name || (mode==='teams'?'团队文件夹':'我的文件')}}</strong><span>{{query ? visible.length+' 项匹配' : items.length+' 个项目'}}</span></div>
<div v-if="isMobile" class="drive-mobile-list" v-loading="busy"><button v-for="row in visible" :key="row.id||row.name" class="drive-mobile-row" @click="enter(row)"><FileTypeIcon :name="row.name" :is-dir="row.directory" :size="40"/><span class="drive-item-copy"><strong>{{row.name}}</strong><small>{{row.directory?'文件夹':row.size==null?'大小未知':formatBytes(row.size)}} · {{displayTime(row.modified)}}</small></span><el-icon class="drive-chevron"><ArrowRight/></el-icon></button><el-empty v-if="!visible.length&&!busy" :description="error?'暂时无法读取文件':query?'没有匹配文件':'此目录暂无文件'"/></div>
<el-table v-else v-loading="busy" :data="visible" @row-dblclick="enter" empty-text="暂无文件" class="drive-table"><el-table-column label="名称" min-width="240"><template #default="{row}"><button class="drive-name" @click="enter(row)"><FileFolderIcon v-if="row.directory"/><span v-else class="drive-item-icon"><el-icon><Document/></el-icon></span><span class="drive-desktop-name">{{row.name}}</span></button></template></el-table-column><el-table-column label="大小" width="110"><template #default="{row}">{{row.directory ? '—' : row.size == null ? '未返回' : formatBytes(row.size)}}</template></el-table-column><el-table-column label="修改时间" width="185"><template #default="{row}">{{displayTime(row.modified)}}</template></el-table-column></el-table>
<footer><span>第 {{offset / 100 + 1}} 页 · {{items.length}} 项</span><el-button :disabled="busy || offset === 0" @click="load(Math.max(0,offset-100))">上一页</el-button><el-button :disabled="busy || !more" @click="load(offset+100)">下一页</el-button></footer>
<el-dialog :model-value="!!selected" title="文件信息" width="min(560px,94vw)" @update:model-value="selected=null"><el-descriptions v-if="selected" :column="1" border><el-descriptions-item label="名称">{{selected.name}}</el-descriptions-item><el-descriptions-item label="大小">{{selected.size == null ? '未返回' : formatBytes(selected.size)}}</el-descriptions-item><el-descriptions-item label="修改时间">{{displayTime(selected.modified)}}</el-descriptions-item><el-descriptions-item label="文件 ID">{{selected.id || '未返回'}}</el-descriptions-item></el-descriptions></el-dialog>
</section>
</template>
<style scoped>
.drive-page{padding:28px;box-sizing:border-box;height:100%;overflow:auto}header,.drive-toolbar,nav,footer{display:flex;align-items:center;gap:14px;flex-wrap:wrap}header{justify-content:space-between}h1{margin:6px 0;font-size:26px}small{letter-spacing:2px}small,header p,footer{font-size:12px;color:var(--el-text-color-secondary)}.drive-toolbar{margin:24px 0}.drive-toolbar .el-input{max-width:280px}nav{margin-bottom:18px;font-size:12px}.drive-name{background:none;border:0;cursor:pointer;color:var(--el-text-color-primary);display:flex;align-items:center;gap:12px;text-align:left;overflow-wrap:anywhere;padding:10px 0}.drive-name:hover{color:var(--el-color-primary)}footer{margin-top:18px;justify-content:flex-end}footer>span{margin-right:auto}@media(max-width:640px){.drive-page{padding:16px}}

.drive-location{gap:10px;margin-bottom:14px}.drive-crumbs{display:flex;align-items:center;gap:8px;flex:1;min-width:0;overflow-x:auto;white-space:nowrap}.drive-crumbs button{border:0;background:none;color:var(--el-text-color-secondary);font:inherit;cursor:pointer;padding:8px 0;max-width:240px;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}.drive-crumbs button[aria-current]{color:var(--el-text-color-primary);font-weight:600}.drive-crumbs button:hover{color:var(--el-color-primary)}.drive-list-heading{display:flex;justify-content:space-between;gap:12px;margin:0 0 12px;font-size:13px}.drive-list-heading span{color:var(--el-text-color-secondary);font-size:12px}.drive-item-icon{width:28px;height:28px;flex:0 0 28px;display:grid;place-items:center;border-radius:8px;background:var(--el-fill-color-light);color:var(--el-text-color-secondary);font-size:20px}.drive-desktop-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.drive-name{width:100%;min-height:40px;font:inherit}.drive-mobile-list{background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:12px;overflow:hidden}.drive-mobile-row{display:flex;width:100%;gap:12px;align-items:center;padding:14px 12px;border:0;border-bottom:1px solid hsl(var(--border));background:none;color:hsl(var(--foreground));font:inherit;text-align:left;cursor:pointer}.drive-mobile-row:last-child{border-bottom:0}.drive-mobile-row:active{background:hsl(var(--muted))}.drive-item-copy{flex:1;min-width:0}.drive-item-copy strong{display:block;font-size:14px;font-weight:500;overflow-wrap:anywhere}.drive-item-copy small{display:block;margin-top:5px;font-size:11px;letter-spacing:0;color:hsl(var(--muted-foreground));line-height:1.5}.drive-chevron{color:hsl(var(--muted-foreground));font-size:13px}button:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}@media(max-width:640px){.drive-toolbar .el-input{flex-basis:100%}.drive-location .el-button{flex-shrink:0}.drive-page footer{gap:8px}.drive-page footer>span{flex-basis:100%;margin-bottom:4px}}
</style>
