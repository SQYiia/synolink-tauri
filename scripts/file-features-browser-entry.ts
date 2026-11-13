import {createApp,h,KeepAlive} from 'vue'
import {createRouter,createMemoryHistory,RouterView} from 'vue-router'
import {createPinia} from 'pinia'
import ElementPlus from 'element-plus'
import Vant from 'vant'
import * as icons from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'vant/lib/index.css'
import '../src/styles/base.css'
import '../src/styles/polish.css'
import Files from '../src/views/Files.vue'
import FileOperations from '../src/components/FileOperations.vue'
import {dsm,DsmClient} from '../src/api/dsm'
import {fileOperations} from '../src/composables/useFileOperations'
export async function mount(){
 dsm.baseUrl='https://fixture-nas';dsm.account='alice';dsm.sid='session'
 dsm.apiInfo=Object.fromEntries(['Sharing','Compress','Extract','CopyMove','Rename'].map(name=>['SYNO.FileStation.'+name,{path:'entry.cgi',minVersion:1,maxVersion:['Extract','Rename'].includes(name)?2:3}]))
 const names=['Archive.zip','Notes.txt','旅行照片'.repeat(14)+'.txt']
 const files=names.map(name=>({name,path:'/share/'+name,isdir:false,additional:{size:100,time:{mtime:1700000000}}}))
 const shares=[{name:'share',path:'/share',isdir:true}]
 let links:any[]=[],createError=0,compressDone=false,taskNumber=0
 const calls:any[]=[]
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
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/app/files',component:Files},{path:'/other',component:{render:()=>h('p','其他页面')}}]})
 const app=createApp({render:()=>h('div',[h(RouterView,{}, {default:({Component}:any)=>h(KeepAlive,{},()=>Component?h(Component):null)}),h(FileOperations)])})
 app.use(createPinia());app.use(router);app.use(ElementPlus);app.use(Vant);for(const [name,icon] of Object.entries(icons))app.component(name,icon)
 await router.push('/app/files?open=/share');await router.isReady();app.mount('#app')
 return {calls,holdRename:()=>{holdRename=true},releaseRename:()=>{holdRename=false;releaseRename()},addFile:(name:string)=>{files.push({name,path:'/share/'+name,isdir:false,additional:{size:100,time:{mtime:1700000000}}})},operations:fileOperations,finish:()=>{compressDone=true},pending:()=>{compressDone=false},setCreateError:(code:number)=>{createError=code},switchAccount:()=>{dsm.account='bob';dsm.sid='bob-session'},navigate:(path:string)=>router.push(path),close:()=>app.unmount()}
}
