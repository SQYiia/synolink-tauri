<script setup lang="ts">
import { ref, computed, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { dsm } from '../api/dsm'
import { packageResult, newerPackage, installationBlock } from '../utils/packageManagement'
import { confirm } from '../utils/feedback'
const props=defineProps<{installed:any[];capabilities:Record<string,any>}>()
const emit=defineEmits<{changed:[]}>()
const open=ref(false),tab=ref('catalog'),query=ref(''),catalog=ref<any[]>([]),feeds=ref<any[]>([]),busy=ref(false),error=ref(''),notice=ref(''),phase=ref(''),progress=ref(0)
const updateMode=ref(''), settingsReady=ref(false)
const pendingUpdates=ref<any[]>([])
async function nextUpdate(){if(busy.value||prepared.value)return;const pkg=pendingUpdates.value.shift();if(pkg)await download(pkg)}
async function batchUpdate(){if(busy.value||prepared.value)return;pendingUpdates.value=catalog.value.filter(update);await nextUpdate()}
const feedName=ref(''),feedUrl=ref(''),originalFeed=ref('')
const prepared=ref<any>(),volume=ref(''),volumes=ref<any[]>([]),task=ref(''),upgrade=ref(false),block=ref(''),installing=ref(false)
let generation=0, active=true
const scope=()=>JSON.stringify([dsm.baseUrl,dsm.account])
let context=scope()
function valid(g:number,c:string){return active && generation===g && scope()===c && context===c}
const matching=computed(()=>catalog.value.filter(p=>(String(p.name||p.dname||p.id)).toLowerCase().includes(query.value.toLowerCase())))
function existing(p:any){return props.installed.find(i=>i.id===p.id)}
function update(p:any){return !!existing(p)&&newerPackage(String(p.version),existing(p).version)}
async function show(){open.value=true;if(!catalog.value.length)await refresh()}
async function refresh(){
 if(busy.value)return
 const g=++generation,c=scope();busy.value=true;error.value=''
 if(context!==c){catalog.value=[];feeds.value=[];prepared.value=undefined;context=c}
 try{const results=await Promise.allSettled([dsm.packageCatalog(false),dsm.packageCatalog(true)]);if(!valid(g,c))return;const rows=new Map<string,any>(),failures:string[]=[];results.forEach((r,i)=>{try{if(r.status==='rejected')throw r.reason;const data=packageResult(r.value);if(!Array.isArray(data.packages))throw Error('无法识别套件目录');for(const pkg of data.packages)if(!rows.has(pkg.id))rows.set(pkg.id,{...pkg,source:i?'第三方来源':'群晖来源'})}catch(e){failures.push((i?'第三方来源':'群晖来源')+'：'+(e instanceof Error?e.message:String(e)))}});catalog.value=[...rows.values()];error.value=failures.join('；')}catch(e){if(valid(g,c))error.value=e instanceof Error?e.message:String(e)}finally{if(g===generation)busy.value=false}
}
async function loadFeeds(){
 tab.value='feeds';if(busy.value)return
 const g=++generation,c=scope();busy.value=true;error.value=''
 try{const data=packageResult(await dsm.packageFeeds());if(!valid(g,c))return;const rows=data.feeds??data.items;if(!Array.isArray(rows))throw Error('当前 DSM 套件源格式暂不兼容');feeds.value=rows}catch(e){if(valid(g,c))error.value=e instanceof Error?e.message:String(e)}finally{if(g===generation)busy.value=false}
}
async function prepare(info:any,id:string,g:number,c:string){
 if(!valid(g,c))return
 const installed=props.installed.some(p=>p.id===info.id)
 packageResult(await dsm.packageFeasibility(info.id,'install'));if(!valid(g,c))return
 const checked=packageResult(await dsm.packageCheck(info));if(!valid(g,c))return
 prepared.value=info;upgrade.value=installed;task.value=id;volumes.value=checked.volume_list||[];volume.value=checked.volume_path||'';block.value=installationBlock(info,checked);phase.value='已完成检查，请确认安装信息'
 if(info.licence || info.additional?.licence)block.value='此套件需要阅读并接受许可协议，请在 DSM 套件中心完成安装'
}
async function download(p:any){
 if(busy.value||context!==scope())return
 const before=generation,original=scope();busy.value=true
 const accepted=await confirm('将下载 '+(p.name||p.id)+' '+p.version+' 到 NAS，下载后确认安装。','准备套件');busy.value=false
 if(!accepted||!valid(before,original))return
 const g=++generation,c=scope();busy.value=true;error.value='';notice.value='';prepared.value=undefined;progress.value=0;phase.value='正在下载到 NAS'
 try{
  const start=packageResult(await dsm.packageDownload(p));if(!valid(g,c))return
  const id=start.taskid;if(!id)throw Error('NAS 未返回下载任务标识')
  let done=false
  for(let i=0;i<300;i++){
   const status=packageResult(await dsm.packageDownloadStatus(id));if(!valid(g,c))return
   progress.value=Math.max(0,Math.min(100,Number(status.progress||0)*100))
   if(status.finished===true){done=true;break}
   await new Promise(r=>setTimeout(r,1000));if(!valid(g,c))return
  }
  if(!done)throw Error('下载等待超时，请在 NAS 套件中心检查任务')
  const info=packageResult(await dsm.packageDownloadedInfo(id));if(info.id!==p.id||String(info.version)!==String(p.version))throw Error('下载的套件标识或版本不匹配')
  await prepare(info,id,g,c)
 }catch(e){if(valid(g,c))error.value=e instanceof Error?e.message:String(e)}finally{if(g===generation){busy.value=false;if(!prepared.value)phase.value=''}}
}
async function upload(event:Event){
 const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file||busy.value||context!==scope())return
 const g=++generation,c=scope();busy.value=true;error.value='';notice.value='';prepared.value=undefined;phase.value='正在上传 SPK 到 NAS'
 try{const info=packageResult(await dsm.packageUpload(file));if(!valid(g,c))return;if(!info.id||!info.task_id)throw Error('上传响应缺少套件信息');await prepare(info,info.task_id,g,c)}catch(e){if(valid(g,c))error.value=e instanceof Error?e.message:String(e)}finally{if(g===generation){busy.value=false;if(!prepared.value)phase.value=''}}
}
async function install(){
 if(!prepared.value||busy.value||block.value)return
 const info=prepared.value,c=scope(),g=generation
 if(!await confirm((upgrade.value?'更新':'安装')+' '+info.name+' '+info.version+'？相关服务可能暂时停止。','确认套件操作'))return
 if(!valid(g,c))return
 busy.value=true;installing.value=true;error.value='';phase.value=upgrade.value?'正在更新':'正在安装'
 try{
  packageResult(await dsm.packageInstall(info,volume.value,task.value,upgrade.value));if(!valid(g,c))return
  phase.value='操作已提交，正在核实安装版本'
  let verified=false
  for(let i=0;i<60;i++){
   const data=packageResult(await dsm.packageList());if(!valid(g,c))return
   const found=data.packages?.find((p:any)=>p.id===info.id)
   if(found&&found.version===info.version&&!['installing','upgrading'].includes(found.additional?.status)){verified=true;break}
   await new Promise(r=>setTimeout(r,2000));if(!valid(g,c))return
  }
  notice.value=verified?'安装版本已确认：'+info.version:'尚未确认完成，请在 DSM 套件中心检查状态';prepared.value=undefined;emit('changed')
 }catch(e){if(valid(g,c))error.value=(e instanceof Error?e.message:String(e))+'。请先刷新状态再重试。'}finally{if(g===generation){busy.value=false;installing.value=false;phase.value=''}}
}
async function loadSettings(){
 tab.value='settings';if(busy.value)return
 const g=++generation,c=scope();busy.value=true;error.value='';settingsReady.value=false
 try{const data=packageResult(await dsm.packageSettings());if(!valid(g,c))return;if(typeof data.enable_autoupdate!=='boolean'||typeof data.autoupdateall!=='boolean'||typeof data.autoupdateimportant!=='boolean')throw Error('更新设置格式不兼容');updateMode.value=!data.enable_autoupdate?'disabled':data.autoupdateall?'all':data.autoupdateimportant?'important':'custom';settingsReady.value=true}catch(e){if(valid(g,c))error.value=e instanceof Error?e.message:String(e)}finally{if(g===generation)busy.value=false}
}
async function saveSettings(){
 if(busy.value||!settingsReady.value||!['disabled','important','all'].includes(updateMode.value))return
 const g=generation,c=scope()
 if(!await confirm('更改 NAS 套件自动更新策略？自动更新时套件服务可能短暂停止。','更新策略'))return
 if(!valid(g,c))return
 busy.value=true;error.value=''
 try{packageResult(await dsm.packageAutoUpdate(updateMode.value as 'disabled'|'important'|'all'));if(valid(g,c))notice.value='自动更新策略已保存'}catch(e){if(valid(g,c))error.value=e instanceof Error?e.message:String(e)}finally{if(g===generation)busy.value=false}
}
async function saveFeed(){
 if(busy.value||context!==scope())return
 const g=++generation,c=scope();busy.value=true;error.value='';let saved=false
 try{packageResult(await dsm.packageFeedSave(feedName.value,feedUrl.value,originalFeed.value||undefined));if(!valid(g,c))return;feedName.value='';feedUrl.value='';originalFeed.value='';catalog.value=[];notice.value='套件源已保存';saved=true}catch(e){if(valid(g,c))error.value=e instanceof Error?e.message:String(e)}finally{if(g===generation)busy.value=false}
 if(saved&&valid(g,c))await loadFeeds()
}
async function deleteFeed(feed:string){
 if(busy.value)return
 const c=scope(),g=generation
 if(!await confirm('移除套件源 '+feed+'？已安装的套件不会被卸载。','删除套件源'))return
 if(!valid(g,c))return
 busy.value=true;error.value='';let deleted=false
 try{packageResult(await dsm.packageFeedDelete(feed));if(valid(g,c)){catalog.value=[];notice.value='套件源已移除';deleted=true}}catch(e){if(valid(g,c))error.value=e instanceof Error?e.message:String(e)}finally{if(g===generation)busy.value=false}
 if(deleted&&valid(g,c))await loadFeeds()
}
function leave(){generation++;active=false;busy.value=false;installing.value=false;prepared.value=undefined;pendingUpdates.value=[];phase.value='';open.value=false}
onActivated(()=>{active=true;if(context!==scope()){catalog.value=[];feeds.value=[];notice.value='';error.value='';context=scope()}})
onDeactivated(leave)
onBeforeUnmount(leave)
</script>
<template>
<div class="package-center-actions"><el-button :disabled="!capabilities['SYNO.Core.Package.Server']" @click="show">安装 / 更新套件</el-button></div>
<el-dialog v-model="open" title="套件中心" width="min(1000px,96vw)" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" append-to-body>
 <div class="center-tabs"><el-button :disabled="busy" @click="tab='catalog';if(!catalog.length)refresh()">在线套件</el-button><el-button :disabled="busy||!capabilities['SYNO.Core.Package.Feed']" @click="loadFeeds">第三方套件源</el-button><el-button :disabled="busy||!capabilities['SYNO.Core.Package.Setting']" @click="loadSettings">自动更新</el-button><label class="upload">上传 SPK<input type="file" accept=".spk" :disabled="busy||!capabilities['SYNO.Core.Package.Installation']" @change="upload"></label></div>
 <el-alert v-if="error" :title="error" type="error" :closable="false"/><el-alert v-if="notice" :title="notice" type="info" :closable="false"/>
 <div v-if="pendingUpdates.length" class="phase">队列中还有 {{ pendingUpdates.length }} 个更新，每项均需确认。<el-button :disabled="busy||!!prepared" @click="nextUpdate">准备下一个</el-button><el-button :disabled="busy" @click="pendingUpdates=[]">清空队列</el-button></div>
 <div v-if="phase" class="phase" role="status">{{ phase }}<el-progress v-if="phase==='正在下载到 NAS'" :percentage="Math.round(progress)"/></div>
 <section v-if="prepared" class="prepared"><h3>{{ prepared.name || prepared.id }} <small>{{ prepared.version }}</small></h3><p>{{ prepared.description || prepared.additional?.description }}</p><p>维护者：{{ prepared.maintainer || prepared.additional?.maintainer || '未提供' }}</p><p>{{ upgrade ? '更新已安装套件' : '新安装' }} · 保留 DSM 的签名和依赖检查</p><el-select v-if="!upgrade" v-model="volume" placeholder="选择安装存储卷" :disabled="busy"><el-option v-for="v in volumes" :key="v.mount_point" :value="v.mount_point" :label="v.display || v.mount_point"/></el-select><el-alert v-if="block" :title="block" type="warning" :closable="false"/><el-button type="primary" :loading="installing" :disabled="busy||!!block||(!upgrade&&!volume)" @click="install">{{ upgrade?'确认更新':'确认安装' }}</el-button><el-button :disabled="busy" @click="prepared=undefined;phase=''">关闭安装信息</el-button></section>
 <template v-if="tab==='catalog'"><div class="catalog-toolbar"><el-input v-model="query" placeholder="搜索官方和已配置来源的套件"/><el-button :loading="busy" @click="refresh">检查更新</el-button><el-button :disabled="busy||!!prepared||!catalog.some(update)" @click="batchUpdate">逐项更新</el-button></div><div class="catalog"><article v-for="p in matching" :key="p.id+'-'+p.version"><div><strong>{{ p.name || p.dname || p.id }}</strong><p>{{ p.version }} · {{ p.source }} <span v-if="existing(p)"> · 已安装 {{ existing(p).version }}</span></p><p>{{ p.description || p.desc || p.id }}</p></div><el-button :disabled="busy||!p.link||!capabilities['SYNO.Core.Package.Installation']||(!!existing(p)&&!update(p))" @click="download(p)">{{ existing(p) ? update(p)?'下载更新':'已安装':'下载安装' }}</el-button></article></div><el-empty v-if="!matching.length&&!busy" description="暂无可用套件，或来源暂时无法访问"/></template>
 <template v-else-if="tab==='feeds'"><p>管理 DSM 第三方套件源。保存后检查在线套件目录，即可查看该来源提供的兼容套件。</p><form class="feed-form" @submit.prevent="saveFeed"><el-input v-model="feedName" aria-label="套件源名称" placeholder="来源名称" :disabled="busy"/><el-input v-model="feedUrl" aria-label="套件源地址" placeholder="https://packages.example.com" :disabled="busy"/><el-button native-type="submit" :disabled="busy||!feedName||!feedUrl">{{ originalFeed ? '保存修改' : '添加来源' }}</el-button><el-button v-if="originalFeed" :disabled="busy" @click="originalFeed='';feedName='';feedUrl=''">取消编辑</el-button></form><div v-for="(f,i) in feeds" :key="i" class="feed"><strong>{{ f.name || f.title }}</strong><span>{{ f.feed || f.url || f.link }}</span><el-button :disabled="busy" @click="feedName=f.name;feedUrl=f.feed;originalFeed=f.feed">编辑</el-button><el-button :disabled="busy" @click="deleteFeed(f.feed)">删除</el-button></div><el-empty v-if="!feeds.length&&!busy" description="没有返回第三方套件源"/></template>
<section v-if="tab==='settings'"><h3>NAS 套件自动更新</h3><p>由 NAS 执行，关闭 SynoLink 后仍然生效。</p><el-radio-group v-model="updateMode" :disabled="busy||!settingsReady"><el-radio value="disabled">关闭自动更新</el-radio><el-radio value="important">仅重要更新</el-radio><el-radio value="all">所有套件最新版本</el-radio><el-radio v-if="updateMode==='custom'" value="custom">当前为 DSM 自定义策略</el-radio></el-radio-group><p><el-button type="primary" :disabled="busy||!settingsReady||updateMode==='custom'" @click="saveSettings">保存策略</el-button></p></section>
</el-dialog>
</template>
<style scoped>.feed-form{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}.feed-form .el-input{max-width:300px}.package-center-actions{margin:18px 0}.center-tabs,.catalog-toolbar{display:flex;gap:12px;margin:16px 0;align-items:center}.upload{padding:8px 12px;border:1px solid var(--el-border-color);border-radius:8px;font-size:13px;cursor:pointer}.upload input{display:none}.catalog{max-height:50vh;overflow:auto}.catalog article{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;border-bottom:1px solid var(--el-border-color-lighter)}.catalog p{font-size:12px;color:var(--el-text-color-secondary);max-width:650px}.prepared{padding:20px;background:var(--el-fill-color-light);border-radius:12px;margin:16px 0}.prepared .el-button,.prepared .el-alert{margin-top:12px}.phase{padding:14px 0}.feed{padding:16px;border-bottom:1px solid var(--el-border-color-lighter)}.feed span{display:block;overflow-wrap:anywhere;margin-top:8px;color:var(--el-text-color-secondary)}.catalog-toolbar .el-input{max-width:500px}</style>
