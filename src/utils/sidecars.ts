import { dsm } from '../api/dsm'
import { parseNfo, sidecarCandidates } from './filmMetadata'
const directories = new Map<string, { time: number; promise: Promise<any[]> }>()
export function clearSidecarCache() { directories.clear() }
let active = 0
const waiting: (()=>void)[] = []
async function limit<T>(fn:()=>Promise<T>):Promise<T> {
 if(active >= 3) await new Promise<void>(resolve => waiting.push(resolve)); else active++
 try { return await fn() } finally { const next = waiting.shift(); if(next) next(); else active-- }
}
export async function readSidecars(file:any) {
 const context = JSON.stringify([dsm.baseUrl,dsm.account]), dir = file.path.slice(0,file.path.lastIndexOf('/')), key = context + dir
 const check = () => { if(context !== JSON.stringify([dsm.baseUrl,dsm.account])) throw new Error('账号已切换') }
 return limit(async () => {
  check()
  let entry = directories.get(key)
  if(!entry || Date.now()-entry.time > 30000) {
   const promise = dsm.listAll(dir).then(r => { if(!r.success) throw new Error('目录读取失败'); return r.data.files })
   entry = {time:Date.now(),promise}; directories.set(key,entry)
   if(directories.size > 100) directories.delete(directories.keys().next().value!)
   promise.catch(() => directories.delete(key))
  }
  const files = await entry.promise; check()
  const {nfo,poster} = sidecarCandidates(file.path,files)
  let metadata: ReturnType<typeof parseNfo> | undefined, warning = ''
  if(nfo) {
   try { const bytes = await dsm.readSidecar(nfo.path,2097152); check(); metadata = parseNfo(new TextDecoder().decode(bytes)) }
   catch(e) { warning = e instanceof Error ? e.message : 'NFO 读取失败' }
  }
  check()
  const revision = poster ? JSON.stringify([poster.additional?.time?.mtime,poster.additional?.size]) : ''
  return {metadata,warning,poster:poster ? dsm.mediaUrl('image',poster.path,{revision}) : ''}
 })
}
