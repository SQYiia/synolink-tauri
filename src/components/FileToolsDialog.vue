<script setup lang="ts">
import { ref, onBeforeUnmount, onDeactivated } from 'vue'
import { dsm, type DsmClient } from '../api/dsm'
import { identity, snapshotFileClient, startFileTask } from '../composables/useFileOperations'
import { randomSharePassword, shareExpiry, validShareUrl, archiveDestination, normalizeNasPath, parentDirectory, fileFeatureError } from '../utils/fileFeatures'
import { confirm, toast } from '../utils/feedback'
import FolderPicker from './FolderPicker.vue'
type Mode='share'|'manage'|'compress'|'extract'
const visible=ref(false),mode=ref<Mode>('share'),busy=ref(false),error=ref(''),rows=ref<any[]>([])
const password=ref(''),protectedLink=ref(true),expiry=ref(''),url=ref(''),uncertain=ref(false),copyText=ref('')
const folder=ref(''),filename=ref(''),format=ref<'zip'|'7z'>('zip'),overwrite=ref(false),subfolder=ref(true),picker=ref(false)
const links=ref<any[]>([]),offset=ref(0),total=ref(0)
let generation=0,scope='',sid='',client:DsmClient
function valid(gen:number){return visible.value&&generation===gen&&scope===identity()&&sid===dsm.sid}
function reset(){generation++;visible.value=false;picker.value=false;password.value='';url.value='';copyText.value='';links.value=[];busy.value=false;rows.value=[]}
function open(next:Mode,selected:any[]=[]){
 reset();mode.value=next;rows.value=selected.map(r=>({...r,isdir:!!(r.isdir===true||r.isdir===1)}));client=snapshotFileClient();scope=identity();sid=dsm.sid
 error.value='';uncertain.value=false;protectedLink.value=true;password.value=next==='share'?randomSharePassword():'';expiry.value=shareExpiry();format.value='zip';overwrite.value=false;subfolder.value=true
 folder.value=selected[0]?parentDirectory(selected[0].path):'';filename.value=selected.length===1?selected[0].name:'归档';offset.value=0;total.value=0;visible.value=true
 if(next==='manage')void list()
 else void checkCapability()
}
async function checkCapability(){const gen=generation;busy.value=true;try{await client.ensureFileFeature('SYNO.FileStation.'+(mode.value==='share'?'Sharing':mode.value==='compress'?'Compress':'Extract'))}catch{if(valid(gen)){error.value='当前 NAS 未提供兼容的操作接口，或接口发现失败';uncertain.value=true}}finally{if(valid(gen))busy.value=false}}
async function list(page=offset.value){const gen=generation;if(busy.value)return;busy.value=true;error.value='';links.value=[]
 try{const res=await client.shareList(page);if(!valid(gen))return;if(!res.success)throw new Error(fileFeatureError(res.error?.code));if(!Array.isArray(res.data?.links)||!Number.isFinite(res.data?.total))throw new Error('分享列表响应不完整');links.value=res.data.links;offset.value=page;total.value=res.data.total}
 catch(e){if(valid(gen))error.value=e instanceof Error?e.message:'读取分享失败'}finally{if(valid(gen))busy.value=false}
}
async function createShare(){if(!valid(generation)||!dsm.sid){reset();return}if(busy.value||uncertain.value)return;const gen=generation
 if(protectedLink.value&&!password.value){error.value='请输入访问密码';return}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(expiry.value)||expiry.value<new Date().toLocaleDateString('sv-SE')){error.value='请选择今天或之后的有效期';return}
 busy.value=true;error.value=''
 try{const res=await client.shareCreate(rows.value[0].path,protectedLink.value?password.value:'',expiry.value);if(!valid(gen))return
 if(!res.success){error.value=fileFeatureError(res.error?.code);return}
 url.value=validShareUrl(res.data?.links?.[0]?.url)
 }catch{if(valid(gen)){uncertain.value=true;error.value='创建结果未确认，请先到分享管理检查，避免重复生成链接'}}finally{if(valid(gen))busy.value=false}
}
async function copy(value:string){copyText.value=value;try{await navigator.clipboard.writeText(value);toast('已复制','success')}catch{error.value='自动复制不可用，请选中下方文本手动复制'}}
function copyLink(link:any){try{void copy(validShareUrl(link.url))}catch{error.value='NAS 返回的分享地址无效'}}
async function revoke(link:any){const gen=generation;if(busy.value||!await confirm('撤销后，此链接将无法继续访问。','撤销分享',{danger:true,confirmText:'撤销'}))return;if(!valid(gen))return;busy.value=true;error.value=''
 try{const res=await client.shareDelete(String(link.id));if(!valid(gen))return;if(!res.success)throw Error(fileFeatureError(res.error?.code));busy.value=false;await list(links.value.length===1&&offset.value>0?offset.value-50:offset.value)}
 catch{if(valid(gen))error.value='撤销结果未确认，请刷新列表检查'}finally{if(valid(gen))busy.value=false}
}
async function archive(){if(busy.value||uncertain.value)return;const gen=generation;error.value=''
 let destination:string
 try{destination=mode.value==='compress'?archiveDestination(rows.value,folder.value,filename.value,format.value):normalizeNasPath(folder.value)}catch(e){error.value=(e as Error).message;return}
 if(mode.value==='extract'&&overwrite.value&&!await confirm('解压将覆盖目标目录中的同名文件，确定继续？','覆盖确认',{danger:true,confirmText:'覆盖并解压'}))return
 if(!valid(gen))return;busy.value=true
 try{
  if(mode.value==='compress'){
   const res=await client.listAll(folder.value);if(!valid(gen))return
   if(!res.success||!Array.isArray(res.data?.files)){error.value='无法检查目标目录，请确认读取权限';return}
   if(res.data.files.some((f:any)=>f.path===destination||f.name===destination.split('/').pop())){error.value='目标文件已存在，请更换名称';return}
  }
  if(!valid(gen))return
  const kind=mode.value==='compress'?'compress':'extract',paths=rows.value.map(r=>r.path),secret=password.value,chosenFormat=format.value,replace=overwrite.value,createFolder=subfolder.value
  const task=await startFileTask(kind,kind==='compress'?destination:rows.value[0].name,[kind==='compress'?parentDirectory(destination):destination],c=>kind==='compress'?c.compressStart(paths,destination,chosenFormat,secret):c.extractStart(paths[0],destination,secret,replace,createFolder))
  if(!valid(gen))return
  if(task.status==='waiting')error.value='任务已提交，连接发生变化，请在传输中心查询'
  else{toast('任务已提交，可在传输中心查看进度','success');reset()}
 }catch(e){if(valid(gen)){error.value=e instanceof Error?e.message:'无法提交任务';uncertain.value=error.value.includes('未确认')||error.value.includes('未收到任务编号')}}finally{if(valid(gen))busy.value=false}
}
const timer=setInterval(()=>{if(visible.value&&(scope!==identity()||sid!==dsm.sid))reset()},250)
onDeactivated(reset);onBeforeUnmount(()=>{clearInterval(timer);reset()})
defineExpose({open})
</script>
<template>
<el-dialog :model-value="visible" :title="{share:'分享链接',manage:'分享管理',compress:'创建压缩包',extract:'解压到…'}[mode]" width="min(640px,94vw)" top="8vh" destroy-on-close @update:model-value="(value:boolean)=>{if(!value)reset()}">
 <div class="file-tools"><el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon/>
 <template v-if="mode==='share'">
 <p class="selected-name">{{rows[0]?.name}}</p>
 <template v-if="!url"><el-checkbox v-model="protectedLink" :disabled="busy">使用访问密码</el-checkbox><el-input v-if="protectedLink" v-model="password" aria-label="分享密码" show-password :disabled="busy"/><label>有效期至<el-date-picker v-model="expiry" type="date" value-format="YYYY-MM-DD" :clearable="false" :disabled="busy" aria-label="分享有效期"/></label><p class="note">创建后可复制链接和密码；撤销链接可停止分享。</p><el-button type="primary" :loading="busy" :disabled="uncertain" @click="createShare">创建分享链接</el-button><el-button @click="open('manage')">分享管理</el-button></template>
 <template v-else><el-input :model-value="url" readonly aria-label="分享地址"/><div class="actions"><el-button @click="copy(url)">复制链接</el-button><el-button v-if="protectedLink" @click="copy(password)">复制密码</el-button><el-button @click="copy(url+(protectedLink?'\n密码：'+password:'')+'\n有效期至：'+expiry)">复制分享信息</el-button></div></template>
 </template>
 <template v-else-if="mode==='manage'">
 <div class="actions"><span>{{total}} 个链接</span><el-button :loading="busy" @click="list()">刷新列表</el-button></div>
 <article v-for="link in links" :key="link.id" class="share-row"><strong>{{link.name||link.path}}</strong><p>{{link.has_password?'密码保护':'无密码'}} · {{link.date_expired&&link.date_expired!=='0'?'有效期至 '+link.date_expired:'无到期日期'}} · {{link.status==='valid'?'有效':link.status==='invalid'?'已失效':link.status||'未知状态'}}</p><el-button :disabled="busy" @click="copyLink(link)">复制链接</el-button><el-button type="danger" plain :disabled="busy" @click="revoke(link)">撤销</el-button></article>
 <el-empty v-if="!links.length&&!busy" description="暂无分享链接"/><div class="actions"><el-button :disabled="busy||offset===0" @click="list(offset-50)">上一页</el-button><span>第 {{offset/50+1}} 页</span><el-button :disabled="busy||offset+links.length>=total" @click="list(offset+50)">下一页</el-button></div>
 </template>
 <template v-else>
 <p class="selected-name">{{mode==='compress'?'已选 '+rows.length+' 项':rows[0]?.name}}</p>
 <label>目标目录<div class="destination"><el-input v-model="folder" aria-label="目标目录" :disabled="busy"/><el-button :disabled="busy" @click="picker=true">选择</el-button></div></label>
 <template v-if="mode==='compress'"><label>压缩文件名<el-input v-model="filename" aria-label="压缩文件名" :disabled="busy"/></label><el-radio-group v-model="format" :disabled="busy"><el-radio-button value="zip">ZIP</el-radio-button><el-radio-button value="7z">7z</el-radio-button></el-radio-group><p class="note">普通压缩级别；同名文件需要改名，不更新已有压缩包。</p></template>
 <template v-else><el-checkbox v-model="subfolder" :disabled="busy">新建与压缩包同名的子目录</el-checkbox><el-checkbox v-model="overwrite" :disabled="busy">覆盖同名文件</el-checkbox><p class="note">保留压缩包内部目录结构。</p></template>
 <label>{{mode==='compress'?'加密密码（可选）':'解压密码（如有）'}}<el-input v-model="password" show-password aria-label="压缩包密码" :disabled="busy"/></label>
 <el-button type="primary" :loading="busy" :disabled="uncertain" @click="archive">{{mode==='compress'?'开始压缩':'开始解压'}}</el-button>
 </template>
 <el-input v-if="copyText" v-model="copyText" type="textarea" :rows="3" readonly aria-label="可复制的分享信息"/>
 </div>
</el-dialog>
<FolderPicker v-if="picker" v-model="picker" :initial="folder" title="选择目标目录" @confirm="value=>{folder=value;picker=false}"/>
</template>
<style scoped>
.file-tools{max-height:70dvh;overflow:auto;padding:2px;display:flex;flex-direction:column;gap:14px}.file-tools label{display:flex;flex-direction:column;gap:8px;font-size:13px}.selected-name,.share-row strong{overflow-wrap:anywhere}.selected-name{margin:0;font-weight:600}.note,.share-row p{font-size:12px;color:var(--el-text-color-secondary);line-height:1.6;margin:0}.destination,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.destination .el-input{flex:1;min-width:0}.actions .el-button{margin:0}.share-row{border:1px solid var(--el-border-color-lighter);border-radius:12px;padding:14px}.share-row p{margin:8px 0}.file-tools :deep(.el-date-editor){max-width:100%}.file-tools :deep(.el-checkbox){white-space:normal;height:auto;min-height:28px}@media(max-width:600px){.share-row{padding:12px}.actions{justify-content:space-between}}
</style>
