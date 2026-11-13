import { normalizeNasPath } from './fileFeatures'
export function recycleRoot(share:string){
 const path=normalizeNasPath(share)
 if(path.split('/').filter(Boolean).length!==1||path.includes('#recycle'))throw Error('请选择有效的共享文件夹')
 return path+'/#recycle'
}
export function recyclePath(root:string,path:string,allowRoot=false){
 if(recycleRoot(root.split('/').slice(0,2).join('/'))!==root)throw Error('回收站根目录无效')
 const normalized=normalizeNasPath(path)
 if(normalized!==path||!(normalized.startsWith(root+'/')||(allowRoot&&normalized===root)))throw Error('操作仅限当前回收站内的项目')
 return normalized
}
export function recycleRows(root:string,folder:string,rows:any[]){
 recyclePath(root,folder,true)
 if(!Array.isArray(rows))throw Error('回收站列表响应不完整')
 return rows.map(row=>{
  if(typeof row?.path!=='string'||typeof row?.name!=='string'||row.name!==row.path.slice(row.path.lastIndexOf('/')+1))throw Error('回收站项目路径无效')
  recyclePath(root,row.path)
  if(row.path.slice(0,row.path.lastIndexOf('/'))!==folder)throw Error('回收站返回了目录外项目')
  return {...row,isdir:row.isdir===true||row.isdir===1||row.isdir==='true'}
 })
}
export function restoreDestination(root:string,paths:string[],destination:string){
 if(!paths.length)throw Error('请先选择回收站项目')
 paths.forEach(path=>recyclePath(root,path))
 const folder=normalizeNasPath(destination)
 if(folder==='/'||folder.split('/').includes('#recycle'))throw Error('请选择回收站以外的目标目录')
 return folder
}
export function recycleDeleteSucceeded(response:any){
 const issue=(value:any)=>value!=null&&(typeof value==='object'?Object.keys(value).length>0:!!value)
 const files=response?.data?.files
 return response?.success===true&&!issue(response.error)&&!issue(response.data?.errors)&&!issue(response.data?.error)&&(files===undefined||Array.isArray(files)&&!files.some((row:any)=>!row||issue(row.error)||issue(row.errors)))
}
