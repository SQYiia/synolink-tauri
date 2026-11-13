export type FileTaskKind = 'copy' | 'move' | 'compress' | 'extract'
export function parentDirectory(path: string) { return path.slice(0, path.lastIndexOf('/')) || '/' }
export function normalizeNasPath(path: string) {
 if (!path.startsWith('/') || /[\\\x00-\x1f]/.test(path) || path.split('/').some(p => p === '..' || p === '.')) throw new Error('目录路径无效')
 return path.replace(/\/+/g,'/').replace(/\/+$/,'') || '/'
}
export function archiveDestination(rows: {path:string;isdir?:boolean}[], folder: string, name: string, format: 'zip'|'7z') {
 const destination = normalizeNasPath(folder)
 if (!name.trim() || /[\/\\\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('请输入有效的压缩文件名')
 const filename = name.trim().replace(/\.(zip|7z)$/i,'') + '.' + format
 const target = (destination === '/' ? '' : destination) + '/' + filename
 for (const row of rows) {
  const source = normalizeNasPath(row.path)
  if (target === source || (row.isdir && (source === '/' || destination === source || destination.startsWith(source + '/')))) throw new Error('压缩目标不能放在选中的源目录内部')
 }
 return target
}
export function randomSharePassword() {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
 let result=''
 while(result.length<12){const bytes=crypto.getRandomValues(new Uint8Array(24));for(const byte of bytes){if(byte<248)result+=alphabet[byte%62];if(result.length===12)break}}
 return result
}
export function shareExpiry(now=new Date()) {
 const date=new Date(now);date.setDate(date.getDate()+7)
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
export function validShareUrl(value:unknown):string {
 if(typeof value!=='string')throw new Error('NAS 未返回分享地址，请到分享管理查看')
 const url=new URL(value)
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('NAS 返回的分享地址无效')
 return value
}
export function fileTaskResult(data:any): {status:'running'|'done'|'error';progress:number|null} {
 if(!data || typeof data!=='object')throw new Error('任务状态响应不完整')
 if(data.error || (data.errors&&(!Array.isArray(data.errors)||data.errors.length)))return {status:'error',progress:null}
 if(typeof data.finished!=='boolean')throw new Error('任务状态响应不完整')
 const finished=data.finished===true
 const value=typeof data.progress==='number'&&Number.isFinite(data.progress)?Math.max(0,Math.min(100,data.progress*100)):null
 return {status:finished?'done':'running',progress:finished?100:value}
}
export function fileFeatureError(code:unknown) {
 const messages:Record<string,string>={'105':'当前账号没有操作权限','119':'会话已失效，请重新登录','403':'当前账号没有操作权限','407':'操作不被允许，请检查目录权限','408':'文件或目录不存在','411':'目标文件系统只读','414':'目标项目已存在，请更换名称','415':'已超出存储配额','416':'目标空间不足','1403':'解压密码错误','1401':'无法识别压缩包格式','2000':'分享链接不存在'}
 return messages[String(code)] || `NAS 操作失败（${typeof code==='number'?code:'未知错误'}）`
}
