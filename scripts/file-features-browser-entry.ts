import {createApp,h,KeepAlive} from 'vue'
import {createRouter,createMemoryHistory,RouterView} from 'vue-router'
import {createPinia} from 'pinia'
import ElementPlus from 'element-plus'
import Vant from 'vant'
import * as icons from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'vant/lib/index.css'
import '../src/styles/base.css'
import '../src/styles/polish.css'
import '../src/styles/desktop.css'
import '../src/styles/workspace-pages.css'
import AppShell from '../src/layouts/AppShell.vue'
import {useAppStore} from '../src/stores/app'
import Files from '../src/views/Files.vue'
import FileOperations from '../src/components/FileOperations.vue'
import {dsm,DsmClient} from '../src/api/dsm'
import {fileOperations} from '../src/composables/useFileOperations'
export async function mount(withShell=false){
 dsm.baseUrl='https://fixture-nas';dsm.account='alice';dsm.sid='session'
 dsm.apiInfo=Object.fromEntries(['Sharing','Compress','Extract','CopyMove','Rename'].map(name=>['SYNO.FileStation.'+name,{path:'entry.cgi',minVersion:1,maxVersion:['Extract','Rename'].includes(name)?2:3}]))
 const names=['Archive.zip','Notes.txt','旅行照片'.repeat(14)+'.txt']
 const files=names.map(name=>({name,path:'/share/'+name,isdir:false,additional:{size:100,time:{mtime:1700000000}}}))
 if(withShell){files.splice(0,files.length,...['家庭照片','工作文档','影音资料','手机备份','2026 年度旅行计划.pdf','家庭收支明细.xlsx','产品设计稿.fig','周末旅行.mp4','README.md'].map((name,index)=>({name,path:'/share/'+name,isdir:index<4,additional:{size:(index+1)*682500,time:{mtime:1794474000-index*86000}}})))}
 const shares=[{name:'share',path:'/share',isdir:true}]
 let links:any[]=[],createError=0,compressDone=false,taskNumber=0
 const calls:any[]=[]
 DsmClient.prototype.searchAll=async function(path,pattern,signal){calls.push({api:'search',path,pattern});if(pattern==='slow')await new Promise(r=>setTimeout(r,500));if(signal?.aborted)throw Error('搜索已取消');if(pattern==='denied')throw Error('权限不足');return files.filter(f=>f.name.includes(pattern))}
 let holdRename=false,releaseRename:()=>void=()=>{}
 DsmClient.prototype.listAll=async function(folder=''){return {success:true,data:folder?{files:[...files,...(compressDone?[{name:'New.zip',path:'/share/New.zip',isdir:false,additional:{size:100}}]:[])]}:{shares}}}
 DsmClient.prototype.entry=async function(api,method,opts){
  const params=opts?.params||{};calls.push({api,method,params})
  if(api.endsWith('Rename')){
   if(holdRename)await new Promise<void>(resolve=>{releaseRename=resolve})
   const source=JSON.parse(params.path)[0],name=JSON.parse(params.name)[0],file=files.find(row=>row.path===source)
   if(!file)return {success:false,error:{code:408}} as any
   file.name=name;file.path='/share/'+name;return {success:true,data:{files:[{...file}]}}
  }
  if(api.endsWith('Sharing')){
   if(method==='list')return {success:true,data:{links:links.slice(Number(params.offset),Number(params.offset)+50),total:links.length}}
   if(method==='delete'){links=links.filter(l=>l.id!==JSON.parse(params.id));return {success:true} as any}
   if(method==='create'){
    if(createError===-1)throw new Error('network unavailable')
    if(createError)return {success:false,error:{code:createError}} as any
    const path=JSON.parse(params.path),row={id:String(links.length+1),name:path.split('/').pop(),path,url:'https://fixture-nas/sharing/'+(links.length+1),has_password:!!JSON.parse(params.password),date_expired:JSON.parse(params.date_expired),status:'valid'};links.push(row);return {success:true,data:{links:[row]}}
   }
  }
  if(method==='start'){
   if(api.endsWith('Extract')&&JSON.parse(params.password)!=='correct')return {success:false,error:{code:1403}} as any
   return {success:true,data:{taskid:'task-'+(++taskNumber)}}
  }
  if(method==='status')return {success:true,data:{finished:compressDone}}
  if(method==='stop')return {success:true} as any
  return {success:true,data:{}} as any
 }
 const router=createRouter({history:createMemoryHistory(),routes:withShell?[{path:'/app',component:AppShell,children:[{path:'files',component:Files,meta:{title:'文件'}}]}]:[{path:'/app/files',component:Files},{path:'/other',component:{render:()=>h('p','其他页面')}}]})
 const app=createApp({render:()=>withShell?h(RouterView):h('div',[h(RouterView,{}, {default:({Component}:any)=>h(KeepAlive,{},()=>Component?h(Component):null)}),h(FileOperations)])})
 app.use(createPinia());const store=useAppStore();store.loaded=true;store.currentServerId='demo';store.currentAccountId='alice';store.servers=[{id:'demo',name:'家庭 NAS',protocol:'https',host:'fixture-nas',port:5001,createTime:0}];store.accounts=[{id:'alice',serverId:'demo',account:'alice',password:''}];app.use(router);app.use(ElementPlus);app.use(Vant);for(const [name,icon] of Object.entries(icons))app.component(name,icon)
 await router.push('/app/files?open=/share');await router.isReady();app.mount('#app')
 return {calls,holdRename:()=>{holdRename=true},releaseRename:()=>{holdRename=false;releaseRename()},addFile:(name:string)=>{files.push({name,path:'/share/'+name,isdir:false,additional:{size:100,time:{mtime:1700000000}}})},operations:fileOperations,finish:()=>{compressDone=true},pending:()=>{compressDone=false},setCreateError:(code:number)=>{createError=code},switchAccount:()=>{dsm.account='bob';dsm.sid='bob-session'},navigate:(path:string)=>router.push(path),close:()=>app.unmount()}
}
