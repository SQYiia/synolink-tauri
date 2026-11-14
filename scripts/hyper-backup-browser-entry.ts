import {createApp} from 'vue'
import ElementPlus from 'element-plus'
import Vant from 'vant'
import * as icons from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'vant/lib/index.css'
import '../src/styles/base.css'
import '../src/styles/polish.css'
import '../src/styles/desktop.css'
import '../src/styles/workspace-pages.css'
import HyperBackupPanel from '../src/components/HyperBackupPanel.vue'
import {dsm,DsmClient} from '../src/api/dsm'
export function mount(){
 dsm.baseUrl='https://nas';dsm.account='alice';dsm.sid='session'
 let tasks:any[]=[{task_id:'1',name:'日常文档',state:'backupable',status:'none',last_bkp_result:'done',last_bkp_time:'2026/11/14 09:00'}],failCreate=false,denied=false
 const calls:any[]=[];const info=Object.fromEntries(['SYNO.Backup.Task','SYNO.Backup.Repository','SYNO.Backup.Storage.Share.Local','SYNO.FileStation.List'].map(k=>[k,{path:'entry.cgi',minVersion:1,maxVersion:2}]))
 DsmClient.prototype.loadApiInfo=async function(){this.apiInfo=info;return info}
 DsmClient.prototype.listAll=async()=>({success:true,data:{files:[]}})
 dsm.listShare=async()=>({success:true,data:{shares:[{name:'documents',path:'/documents',isdir:true}]}});dsm.listFolders=async()=>({success:true,data:{files:[]}})
 DsmClient.prototype.entry=async function(api:string,method:string,opts:any={}){const p=opts.params||{};calls.push({api,method,params:p,account:this.account,post:opts.post});if(api==='SYNO.Backup.Storage.Share.Local')return {success:true,data:{share_list:[['backup',0],['readonly',1]]}};if(api==='SYNO.Backup.Repository')return {success:true,data:{repo_id:9}};if(method==='list')return {success:true,data:{task_list:tasks.map(t=>({...t}))}};if(method==='status')return {success:true,data:{...tasks.find(t=>t.task_id===p.task_id)}};if(method==='create'){if(failCreate)throw Error('响应超时');tasks.push({task_id:'2',name:p.name,state:'backupable',status:'none'});return {success:true,data:{task_id:'2'}}}if(denied)return {success:false,error:{code:105}};const t=tasks.find(t=>t.task_id===p.task_id);if(method==='backup'||method==='resume')t.status='backingup';if(method==='suspend'){t.status='none';t.last_bkp_result='suspend'}if(method==='cancel'){t.status='none';t.last_bkp_result='interrupt'}return {success:true}}
 document.querySelector('#app')!.classList.add('backup-page');const app=createApp(HyperBackupPanel);app.use(ElementPlus);app.use(Vant);for(const [name,icon]of Object.entries(icons))app.component(name,icon);app.mount('#app')
 return {calls,fail:(v:boolean)=>{failCreate=v},deny:(v:boolean)=>{denied=v},account:()=>{dsm.account='bob';dsm.sid='bob';tasks=[]},close:()=>app.unmount()}
}
