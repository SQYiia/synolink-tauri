import {createApp,h,ref} from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import WorkloadManager from '../src/components/WorkloadManager.vue'
import {dsm,DsmClient} from '../src/api/dsm'
export function mount(){
 dsm.baseUrl='https://fixture';dsm.account='alice';dsm.sid='sid'
 dsm.apiInfo=Object.fromEntries(['SYNO.Docker.Image','SYNO.Docker.Project','SYNO.Virtualization.GuestProtect.Snap'].map(api=>[api,{path:'entry.cgi',minVersion:1,maxVersion:1}]))
 const calls:any[]=[],kind=ref<'images'|'projects'|'snapshots'>('images'),status=ref('shutdown')
 let snapshots:any[]=[{gsnap_id:'s1',desc:'Before upgrade'}],images:any[]=[{id:'i',repository:'nginx',tags:['stable'],size:1024}],failure=false
 DsmClient.prototype.entry=async function(api,method,opts){
  const p=opts?.params??{};calls.push({api,method,params:p});if(failure)return {success:false,error:{code:105}}
  if(api==='SYNO.Docker.Image'){if(method==='list')return {success:true,data:{images}};if(method==='pull')images.push({id:'new',repository:p.repository,tags:[p.tag],size:12});if(method==='delete')images=images.filter(i=>i.repository!==p.name);return {success:true}}
  if(api==='SYNO.Docker.Project'){if(method==='list')return {success:true,data:{demo:{id:'demo',name:'Demo project',path:'/docker/demo',status:'running'}}};if(method==='get')return {success:true,data:{name:'Demo project',path:'/docker/demo',content:'TOP_SECRET',containers:[]}};return {success:true}}
  if(method==='list')return {success:true,data:{gsnaps:snapshots}}
  if(method==='create_start')snapshots.push({gsnap_id:'s2',desc:p.desc})
  if(method==='delete_start')snapshots=snapshots.filter(s=>!JSON.parse(p.gsnap_ids).includes(s.gsnap_id))
  return {success:true}
 }
 const app=createApp({render:()=>h(WorkloadManager,{kind:kind.value,guestId:'vm',guestStatus:status.value})});app.use(ElementPlus,{locale:zhCn});app.mount('#app')
 return {calls,kind:(value:any)=>{kind.value=value},running:()=>{status.value='running'},fail:()=>{failure=true},switchAccount:()=>{dsm.account='bob'},close:()=>app.unmount()}
}
