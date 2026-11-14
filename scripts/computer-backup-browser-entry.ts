import {createApp} from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '../src/styles/base.css'
import '../src/styles/polish.css'
import '../src/styles/desktop.css'
import '../src/styles/workspace-pages.css'
import ComputerBackupPanel from '../src/components/ComputerBackupPanel.vue'
import {dsm} from '../src/api/dsm'
export function mount(){
 dsm.baseUrl='https://nas';dsm.account='alice';dsm.sid='session'
 const tasks:any[]=[];const calls:any[]=[];let denied=false,cancelPicker=false
 dsm.listShare=async()=>({success:true,data:{shares:[{name:'backup',path:'/backup',isdir:true}]}})
 dsm.listFolders=async()=>({success:true,data:{files:[]}})
 ;(window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  calls.push({cmd,args})
  if(cmd==='plugin:dialog|open')return cancelPicker?null:'C:\\Users\\Alice\\Documents'
  if(cmd==='computer_backup_snapshot')return tasks.filter(t=>t.account===args.account).map(t=>({...t}))
  if(cmd==='computer_backup_create'){if(denied)throw Error('无法保存备份任务');tasks.push({...args,id:'1',status:'idle',message:'',output:'',total:0,completed:0,bytes:0,current:''});return}
  const task=tasks.find(t=>t.id===args?.id)
  if(cmd==='computer_backup_start'){if(denied)throw Error('NAS 拒绝备份请求（code=105）');Object.assign(task,{status:'uploading',total:10,completed:2,bytes:4096,current:'中文长文件名'.repeat(20)+'.txt',output:'/backup/SynoLink-fixture'});return}
  if(cmd==='computer_backup_cancel'){task.status='interrupted';task.message='已取消；已上传的文件保留在本次备份目录';return}
  if(cmd==='computer_backup_remove'){tasks.splice(tasks.indexOf(task),1);return}
  throw Error('Unexpected command '+cmd)
 }}
 document.querySelector('#app')!.classList.add('backup-page');const app=createApp(ComputerBackupPanel);app.use(ElementPlus);app.mount('#app')
 return {calls,deny:(v:boolean)=>{denied=v},cancelPicker:(v:boolean)=>{cancelPicker=v},account:()=>{dsm.account='bob';dsm.sid='bob'},close:()=>app.unmount()}
}
