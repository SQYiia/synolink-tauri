import {createApp} from 'vue'
import ElementPlus from 'element-plus'
import Vant from 'vant'
import 'element-plus/dist/index.css'
import 'vant/lib/index.css'
import '../src/styles/base.css'
import PhotoBackupPanel from '../src/components/PhotoBackupPanel.vue'
import {dsm} from '../src/api/dsm'
export function mount(){
 dsm.baseUrl='https://nas';dsm.account='alice';dsm.sid='session'
 const calls:any[]=[];let record:any={access:'denied',running:false,status:'paused'},denied=false
 ;(window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd!=='photo_backup_action')throw Error('Unexpected native command')
  calls.push(args)
  if(args.action==='requestLibrary')record.access=denied?'denied':'partial'
  if(args.action==='albums')return {access:record.access,albums:record.access==='denied'?[]:[{id:'external:1',name:'Camera',count:1234},{id:'external:2',name:'Screenshots',count:30}]}
  if(args.action==='start'){record={...record,running:true,status:'watching',config:args.config,updated:1,copied:2,skipped:5}}
  if(args.action==='pause'){record.running=false;record.status='paused'}
  if(args.action==='recheck'&&record.running)throw Error('running')
  return {...record}
 }}
 const app=createApp(PhotoBackupPanel);app.use(ElementPlus);app.use(Vant);app.mount('#app')
 return {calls,deny:(value:boolean)=>{denied=value},snapshot:(values:any)=>Object.assign(record,values),account:()=>{dsm.account='bob';dsm.sid='bob';record={access:'full',status:'paused',running:false}},close:()=>app.unmount()}
}
