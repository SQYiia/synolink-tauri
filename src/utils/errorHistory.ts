export type ErrorModule = 'api' | 'image' | 'download'
export interface ErrorRecord { time: number; module: ErrorModule; operation: 'request' | 'thumbnail' | 'original' | 'transfer'; code: number | null; elapsed: number; retry: 'none' | 'failed' | 'recovered' }
const MAX_AGE=7*24*60*60*1000
async function key(identity:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));return 'synolink.errors.'+Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')}
function sanitize(raw:any):ErrorRecord|null {
 if(!raw || !['api','image','download'].includes(raw.module) || !['request','thumbnail','original','transfer'].includes(raw.operation) || !['none','failed','recovered'].includes(raw.retry) || !Number.isFinite(raw.time) || raw.time>Date.now() || raw.time<Date.now()-MAX_AGE)return null
 return {time:raw.time,module:raw.module,operation:raw.operation,code:Number.isInteger(raw.code)?raw.code:null,elapsed:Number.isFinite(raw.elapsed)?Math.max(0,raw.elapsed):0,retry:raw.retry}
}
function read(k:string):ErrorRecord[]{try{const value=JSON.parse(localStorage.getItem(k)||'[]');return Array.isArray(value)?value.map(sanitize).filter((v):v is ErrorRecord=>!!v).slice(-100):[]}catch{return []}}
let writes=Promise.resolve()
export function recordError(identity:string,module:ErrorModule,operation:ErrorRecord['operation'],code:unknown,elapsed:number,retry:ErrorRecord['retry']='none') {
 writes=writes.then(async()=>{const k=await key(identity);const rows=read(k);rows.push({time:Date.now(),module,operation,code:typeof code==='number'&&Number.isInteger(code)?code:null,elapsed:Math.max(0,Math.round(elapsed)),retry});localStorage.setItem(k,JSON.stringify(rows.slice(-100)))}).catch(()=>{})
 return writes
}
export async function readErrors(identity:string){await writes;try{const k=await key(identity),rows=read(k);localStorage.setItem(k,JSON.stringify(rows));return rows}catch{return []}}
export async function clearErrors(identity:string){await writes;try{localStorage.removeItem(await key(identity))}catch{}}
