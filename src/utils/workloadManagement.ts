export type ManagementKind='images'|'projects'|'snapshots'
export const managementApis={images:'SYNO.Docker.Image',projects:'SYNO.Docker.Project',snapshots:'SYNO.Virtualization.GuestProtect.Snap'}
export function managementRequest(kind:ManagementKind,action:string,args:Record<string,any>={}){
 const required=(key:string)=>{if(typeof args[key]!=='string'||!args[key].trim())throw Error('缺少操作对象');return args[key]}
 if(action==='list')return {method:'list',params:kind==='images'?{offset:0,limit:-1,show_dsm:false}:kind==='snapshots'?{guest_id:required('guest_id')}:{}}
 if(kind==='images'){
  if(!['pull','delete'].includes(action))throw Error('不支持的镜像操作')
  const repository=required('repository'),tag=required('tag')
  if(!/^[a-z0-9][a-z0-9._:/-]*$/.test(repository)||repository.includes('://')||!/^\w[\w.-]{0,127}$/.test(tag))throw Error('请填写有效的镜像仓库和标签')
  return {method:action,params:action==='pull'?{repository,tag}:{name:repository,tag}}
 }
 if(kind==='projects'){
  if(!['get','start','stop','build'].includes(action))throw Error('不支持的项目操作')
  return {method:action,params:{id:required('id')}}
 }
 if(action==='create')return {method:'create_start',params:{guest_id:required('guest_id'),desc:String(args.desc??'').slice(0,512),taken_by:'user',is_user_locked:false}}
 if(action==='delete')return {method:'delete_start',params:{gsnap_ids:JSON.stringify([required('gsnap_id')]),deleted_by:'user',site:'main'}}
 if(action==='restore')return {method:'restore_start',params:{guest_id:required('guest_id'),gsnap_id:required('gsnap_id'),is_gsnap_created:false,poweroff_guest:false}}
 throw Error('不支持的快照操作')
}
export function managementRows(kind:ManagementKind,data:any):any[]{
 if(kind==='images'){
  if(!Array.isArray(data?.images))throw Error('无法识别镜像列表')
  return data.images.flatMap((r:any)=>(Array.isArray(r.tags)&&r.tags.length?r.tags:['']).map((tag:string)=>({id:String(r.id??'')+':'+tag,repository:String(r.repository??''),tag:String(tag),name:String(r.repository??r.id??'未知镜像')+(tag?':'+tag:''),size:r.size,status:r.upgradable?'可更新':'本地镜像'})))
 }
 if(kind==='projects'){
  const rows=Array.isArray(data)?data:Array.isArray(data?.projects)?data.projects:data&&typeof data==='object'?Object.values(data):null
  if(!rows||rows.some((r:any)=>!r||typeof r.id!=='string'||typeof r.name!=='string'))throw Error('无法识别项目列表')
  return rows.map((r:any)=>({id:r.id,name:r.name,path:r.path??'',status:r.status??r.state??'状态未知',locked:r.is_package===true}))
 }
 if(!Array.isArray(data?.gsnaps))throw Error('无法识别快照列表')
 return data.gsnaps.map((r:any)=>({id:String(r.gsnap_id??''),name:String(r.desc||r.gsnap_id||'未命名快照'),status:r.is_user_locked?'已锁定':'快照',locked:r.is_user_locked===true}))
}
