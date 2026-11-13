import { reactive, ref, watch } from 'vue'
import { dsm, DsmClient } from '../api/dsm'
import { fileTaskResult, fileFeatureError, parentDirectory, type FileTaskKind } from '../utils/fileFeatures'

export interface Operation {
 id:string;sourceUrl:string;account:string;kind:'upload'|FileTaskKind;name:string
 status:'running'|'waiting'|'done'|'error'|'cancelling'|'cancelled'
 taskid?:string;progress:number|null;error?:string;directories:string[]
}
// Persist only metadata; never serialize client objects, request bodies or raw exceptions.
export function operationMetadata(task:Operation):Operation {
 return {id:task.id,sourceUrl:task.sourceUrl,account:task.account,kind:task.kind,name:task.name,status:task.status,taskid:task.taskid,progress:task.progress,directories:task.directories}
}
function restore():Operation[]{
 try{const rows=JSON.parse(localStorage.getItem('synolink.operations')||'[]');if(!Array.isArray(rows))return []
 return rows.filter(t=>t&&typeof t.id==='string'&&typeof t.sourceUrl==='string'&&typeof t.account==='string'&&['upload','copy','move','compress','extract'].includes(t.kind)).map(t=>operationMetadata({...t,name:typeof t.name==='string'?t.name:'文件任务',directories:Array.isArray(t.directories)?t.directories.filter((d:unknown)=>typeof d==='string'):[],progress:typeof t.progress==='number'&&Number.isFinite(t.progress)?t.progress:null,status:['done','error','cancelled'].includes(t.status)?t.status:'waiting'}))
 }catch{return []}
}
export const fileOperations=reactive<Operation[]>(restore())
watch(fileOperations,tasks=>{try{localStorage.setItem('synolink.operations',JSON.stringify(tasks.map(operationMetadata)))}catch{}},{deep:true})
export const operationScope=ref(identity())
export function identity(){return JSON.stringify([dsm.baseUrl,dsm.account])}
export function snapshotFileClient(){
 const client=new DsmClient(dsm.baseUrl);client.account=dsm.account;client.sid=dsm.sid;client.synoToken=dsm.synoToken;client.apiInfo={...dsm.apiInfo};client.allowInsecure=dsm.allowInsecure;return client
}
function matches(task:Operation){return task.sourceUrl===dsm.baseUrl&&task.account===dsm.account&&!!dsm.sid}
const epochs=new Map<string,number>(), monitors=reactive(new Set<string>()), sessions=new Map<string,string>()
function invalidate(task:Operation){epochs.set(task.id,(epochs.get(task.id)||0)+1)}
export const directoryChanges=reactive<Record<string,number>>({})
export function directoryRevision(path:string){const parts=path.split('/').filter(Boolean);let revision=directoryChanges[JSON.stringify([dsm.baseUrl,dsm.account,'/'])]||0;for(let i=1;i<=parts.length;i++)revision+=directoryChanges[JSON.stringify([dsm.baseUrl,dsm.account,'/'+parts.slice(0,i).join('/')])]||0;return revision}
export function markDirectoriesChanged(sourceUrl:string,account:string,directories:string[]){for(const path of directories){const key=JSON.stringify([sourceUrl,account,path]);directoryChanges[key]=(directoryChanges[key]||0)+1}}
function dirty(task:Operation){markDirectoriesChanged(task.sourceUrl,task.account,task.directories)}
let previousSession=dsm.sid
// The DSM singleton is not reactive; keep account transitions observable even with no task poll in flight.
const contextTimer=setInterval(()=>{
 const next=identity()
 if(next!==operationScope.value||previousSession!==dsm.sid){operationScope.value=next;previousSession=dsm.sid
 for(const task of fileOperations){if(task.kind!=='upload'&&['running','cancelling'].includes(task.status)&&(!matches(task)||sessions.get(task.id)!==dsm.sid)){invalidate(task);task.status='waiting';task.error='连接已变化，请登录来源账号后重新查询'}}
 }
},250)
if(import.meta.hot)import.meta.hot.dispose(()=>clearInterval(contextTimer))
function newOperation(kind:Operation['kind'],name:string,directories:string[]){
 const task:Operation={id:crypto.randomUUID(),sourceUrl:dsm.baseUrl,account:dsm.account,kind,name,status:'running',progress:null,directories:[...new Set(directories)]};sessions.set(task.id,dsm.sid);fileOperations.unshift(task);return fileOperations[0]!
}
export async function trackedUpload(folder:string,file:File,overwrite:boolean){
 const task=newOperation('upload',file.name,[folder]),client=snapshotFileClient()
 try{const result=await client.upload(folder,file,overwrite);if(!result.success)throw Error();task.status='done';task.progress=100;dirty(task);return result}
 catch{task.status='error';task.error='上传失败，请重新选择该文件重试';return {success:false,error:{code:task.error}}}
}
export async function startFileTask(kind:FileTaskKind,name:string,directories:string[],submit:(client:DsmClient)=>Promise<any>){
 const client=snapshotFileClient(),sid=client.sid
 if(!sid)throw new Error('请先登录来源账号')
 await client.ensureFileFeature('SYNO.FileStation.'+(kind==='compress'?'Compress':kind==='extract'?'Extract':'CopyMove'))
 if(identity()!==JSON.stringify([client.baseUrl,client.account])||dsm.sid!==sid)throw new Error('连接已变化，请重新选择文件')
 const task=newOperation(kind,name,directories)
 try{
  // API discovery and capability checks are performed on this captured client.
  const result=await submit(client)
  if(!result.success){task.status='error';task.error=fileFeatureError(result.error?.code);throw new Error(task.error)}
  if(typeof result.data?.taskid!=='string'||!result.data.taskid){task.status='waiting';task.error='未收到任务编号，NAS 任务可能已启动，请检查目标目录；不要重复提交';throw new Error(task.error)}
  task.taskid=result.data.taskid
  if(!matches(task)||dsm.sid!==sid){task.status='waiting';return task}
  void monitor(task,client);return task
 }catch(e){if(task.status==='running'){task.status='waiting';task.error='提交结果未确认，请检查 NAS 任务和目标目录，避免重复提交'}throw new Error(task.error||'无法提交任务')}
}
export async function startCopyMove(paths:string[],destination:string,move:boolean){
 return startFileTask(move?'move':'copy',`${paths.length} 个项目 → ${destination}`,[destination,...(move?paths.map(parentDirectory):[])],async client=>{
  return client.fileFeature('SYNO.FileStation.CopyMove','start',{path:JSON.stringify(paths),dest_folder_path:JSON.stringify(destination),overwrite:false,remove_src:move},true)
 })
}
async function monitor(task:Operation,client=snapshotFileClient()){
 if(monitors.has(task.id)||task.kind==='upload')return
 monitors.add(task.id);const epoch=epochs.get(task.id)||0,sid=client.sid
 const valid=()=>matches(task)&&sid===dsm.sid&&epoch===(epochs.get(task.id)||0)&&task.status==='running'
 try{while(task.taskid&&valid()){
  const response=await client.fileTaskRequest(task.kind,'status',task.taskid)
  if(!valid())return
  if(!response.success)throw Error()
  const result=fileTaskResult(response.data);task.status=result.status;task.progress=result.progress
  if(result.status==='error'){task.error='NAS 报告部分项目失败，请检查权限、同名文件及剩余空间';dirty(task);return}
  if(result.status==='done'){dirty(task);return}
  await new Promise(resolve=>setTimeout(resolve,1500))
 }}catch{if(valid()){task.status='waiting';task.error='暂时无法查询；NAS 任务可能仍在运行，可重新查询'}}
 finally{monitors.delete(task.id);if(task.status==='running'&&!valid()){task.status='waiting';task.error='连接已变化，请登录来源账号后重新查询'}}
}
export function isOperationQuerying(task:Operation){return monitors.has(task.id)}
export function refreshOperation(task:Operation){
 if(!matches(task)||task.kind==='upload'||!task.taskid||monitors.has(task.id)||['done','cancelled','cancelling','running'].includes(task.status))return
 sessions.set(task.id,dsm.sid);task.status='running';task.error=undefined;void monitor(task)
}
export async function cancelOperation(task:Operation){
 if(!matches(task)||task.kind==='upload'||!task.taskid||!['running','waiting'].includes(task.status))return
 invalidate(task);const epoch=epochs.get(task.id),client=snapshotFileClient();sessions.set(task.id,client.sid);task.status='cancelling'
 try{const response=await client.fileTaskRequest(task.kind,'stop',task.taskid)
  if(!matches(task)||client.sid!==dsm.sid||epoch!==epochs.get(task.id))return
  if(!response.success)throw Error()
  task.status='cancelled';task.error='已取消；已完成的文件操作不会回滚';dirty(task)
 }catch{if(matches(task)&&epoch===epochs.get(task.id)){task.status='waiting';task.error='取消结果未确认，请重新查询；NAS 任务可能仍在运行'}}
 finally{if(task.status==='cancelling'){task.status='waiting';task.error='连接已变化，请重新查询取消结果'}}
}
export function removeOperation(task:Operation){if(['running','cancelling'].includes(task.status))return;invalidate(task);const index=fileOperations.indexOf(task);if(index>=0)fileOperations.splice(index,1)}
