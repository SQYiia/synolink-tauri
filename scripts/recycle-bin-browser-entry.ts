import {mount as mountFiles} from './file-features-browser-entry'
import {dsm,DsmClient} from '../src/api/dsm'
export async function mount(){
 const base=await mountFiles()
 for(const name of ['List','Delete'])dsm.apiInfo['SYNO.FileStation.'+name]={path:'entry.cgi',minVersion:1,maxVersion:2}
 const root='/share/#recycle',calls:any[]=[],bins:Record<string,any[]>={}
 const item=(name:string,folder=root,isdir=false)=>({name,path:folder+'/'+name,isdir})
 bins[root]=[item('旧照片',root,true),item('中文与很长的照片名称'.repeat(10)+'.HEIC'),...Array.from({length:103},(_,i)=>item('deleted-'+i+'.txt'))]
 bins[root+'/旧照片']=[item('child.jpg',root+'/旧照片')]
 let denied=false,deleteMode='',conflict=false,finished=false,job:any=null,hold=false,release:()=>void=()=>{}
 const originalEntry=DsmClient.prototype.entry,originalAll=DsmClient.prototype.listAll
 DsmClient.prototype.listFiles=async function(path,options={}){
  if(!path.includes('#recycle'))return {success:true,data:{files:[],total:0}}
  calls.push({method:'list',path,account:this.account})
  if(hold)await new Promise<void>(r=>{release=r})
  if(denied)return {success:false,error:{code:407}} as any
  const files=bins[path]||[];return {success:true,data:{files:files.slice(options.offset||0,(options.offset||0)+(options.limit||100)),total:files.length}}
 }
 DsmClient.prototype.listAll=async function(path=''){
  if(path.includes('#recycle'))return {success:true,data:{files:[...(bins[path]||[])]}}
  if(path==='/restore')return {success:true,data:{files:conflict?[item('deleted-0.txt','/restore')]:[]}}
  return originalAll.call(this,path)
 }
 DsmClient.prototype.entry=async function(api,method,options){
  if(api.endsWith('Delete')){
   const paths=JSON.parse(options!.params!.path);calls.push({method:'delete',paths,account:this.account})
   if(deleteMode==='unknown')throw Error('lost response')
   if(deleteMode==='permission')return {success:false,error:{code:407}} as any
   for(const folder of Object.keys(bins))bins[folder]=bins[folder]!.filter(row=>!paths.includes(row.path))
   return {success:true} as any
  }
  if(api.endsWith('CopyMove')){
   if(method==='start'){job=options!.params;calls.push({method:'restore',params:job,account:this.account});return {success:true,data:{taskid:'restore-job'}}}
   if(method==='status'){if(finished&&job){const paths=JSON.parse(job.path);for(const folder of Object.keys(bins))bins[folder]=bins[folder]!.filter(row=>!paths.includes(row.path));job=null}return {success:true,data:{finished}}}
  }
  return originalEntry.call(this,api,method,options)
 }
 return {...base,calls,deny:(value:boolean)=>{denied=value},deleteMode:(value:string)=>{deleteMode=value},conflict:(value:boolean)=>{conflict=value},finishRestore:()=>{finished=true},hold:()=>{hold=true},release:()=>{hold=false;release()}}
}
