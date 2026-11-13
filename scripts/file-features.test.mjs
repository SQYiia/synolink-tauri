import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function load(path,require=()=>({}),environment={}){
 const exports={};const source=readFileSync(path,'utf8').replace(/if\(import\.meta\.hot\).*\n/g,'')
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('exports','require',...Object.keys(environment),js)(exports,require,...Object.values(environment));return exports
}
const helpers=load('src/utils/fileFeatures.ts')
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function harness(restored=[]){
 const calls=[],intervals=[],timeouts=[],watchers=[],storage=new Map([['synolink.operations',JSON.stringify(restored)]])
 let status=()=>Promise.resolve({success:true,data:{finished:true}}),stop=()=>Promise.resolve({success:true}),start=()=>Promise.resolve({success:true,data:{taskid:'nas-task'}})
 class Client{constructor(url){this.baseUrl=url;this.sid='';this.apiInfo={}}
 async ensureFileFeature(){} fileFeature(api,method,params){calls.push({api,method,params,account:this.account,sid:this.sid});return start()}
 fileTaskRequest(kind,method,id){calls.push({kind,method,id,account:this.account,sid:this.sid});return method==='stop'?stop():status()}
 async upload(){return {success:true}}}
 const dsm=new Client('https://nas');Object.assign(dsm,{account:'alice',sid:'session-a'})
 const api=load('src/composables/useFileOperations.ts',name=>name.includes('/dsm')?{dsm,DsmClient:Client}:name.includes('fileFeatures')?helpers:{reactive:x=>x,ref:value=>({value}),watch:(value,fn)=>watchers.push(()=>fn(value))},{localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setInterval:fn=>{intervals.push(fn);return 1},setTimeout:fn=>{timeouts.push(fn);return 1}})
 return {api,dsm,calls,intervals,timeouts,watchers,storage,setStatus:fn=>status=fn,setStop:fn=>stop=fn,setStart:fn=>start=fn}
}
test('share defaults and archive destination validation',()=>{
 assert.match(helpers.fileFeatureError(408),/不存在/);assert.match(helpers.fileFeatureError(414),/已存在/);assert.match(helpers.fileFeatureError(416),/空间不足/)
 assert.match(helpers.randomSharePassword(),/^[A-Za-z0-9]{12}$/)
 assert.equal(helpers.shareExpiry(new Date(2026,11,28,23)), '2027-01-04')
 assert.equal(helpers.archiveDestination([{path:'/a/report',isdir:true}],'/backup','照片 & 资料.zip','7z'),'/backup/照片 & 资料.7z')
 for(const folder of ['/a/report','/a/report/child','/a//report/child','/a/../report','C:\\x'])assert.throws(()=>helpers.archiveDestination([{path:'/a/report',isdir:true}],folder,'a','zip'))
 assert.throws(()=>helpers.archiveDestination([],'/backup','../a','zip'))
 assert.throws(()=>helpers.validShareUrl('javascript:alert(1)'))
 assert.equal(helpers.validShareUrl('https://nas/link?id=1'),'https://nas/link?id=1')
})
test('DSM file feature parameters preserve quoted strings, unicode and arrays; unavailable APIs never submit',async()=>{
 const calls=[]
 const {DsmClient}=load('src/api/dsm.ts',name=>name.includes('plugin-http')?{fetch:async(url,options)=>{calls.push({url,params:new URLSearchParams(options.body||new URL(url).search)});return new Response(JSON.stringify({success:true,data:{taskid:'task'}}))}}:name.includes('errorHistory')?{recordError:async()=>{}}:{})
 const c=new DsmClient('https://nas');c.apiInfo=Object.fromEntries(['Sharing','Compress','CopyMove','Extract'].map(name=>['SYNO.FileStation.'+name,{minVersion:1,maxVersion:name==='Extract'?2:3,path:'entry.cgi'}]))
 await c.shareCreate('/文档/a & b.txt','p"&\\字','2026-12-01');await c.compressStart(['/a','/b'], '/备份/a.zip','zip','secret');await c.extractStart('/a.zip','/b','p',false,true);await c.fileTaskRequest('compress','stop','id');await c.shareDelete('link')
 assert.equal(JSON.parse(calls[0].params.get('path')),'/文档/a & b.txt');assert.equal(JSON.parse(calls[0].params.get('password')),'p"&\\字')
 assert.equal(calls[1].params.get('version'),'3');assert.equal(JSON.parse(calls[1].params.get('level')),'moderate');assert.deepEqual(JSON.parse(calls[1].params.get('path')),['/a','/b'])
 assert.equal(calls[2].params.get('overwrite'),'false');assert.equal(calls[2].params.get('keep_dir'),'true');assert.equal(JSON.parse(calls[3].params.get('taskid')),'id');assert.equal(JSON.parse(calls[4].params.get('id')),'link')
 delete c.apiInfo['SYNO.FileStation.Sharing'];await assert.rejects(c.shareCreate('/a','p','2026-12-01'),/不支持/);assert.equal(calls.length,5)
 c.apiInfo['SYNO.FileStation.Compress'].maxVersion=2;await assert.rejects(c.compressStart(['/a'],'/b.zip','zip',''),/不支持/)
})
test('restore accepts legacy task metadata but removes credentials, passwords and raw errors',()=>{
 const h=harness([{id:'old',sourceUrl:'https://nas',account:'alice',kind:'copy',name:'old',status:'running',taskid:'t',password:'secret',sid:'secret',error:'secret'}])
 assert.equal(h.api.fileOperations[0].status,'waiting');assert.deepEqual(h.api.fileOperations[0].directories,[])
 h.watchers.forEach(w=>w());assert.equal(h.storage.get('synolink.operations').includes('secret'),false)
})
test('task completion marks source/destination directories and rejects partial failure or incomplete status',async()=>{
 const h=harness();const task=await h.api.startCopyMove(['/src/a'],'/dest',true);await tick()
 assert.equal(task.status,'done');assert.ok(h.api.directoryRevision('/dest/child')>0);assert.ok(h.api.directoryRevision('/src')>0)
 const partial=harness();partial.setStatus(async()=>({success:true,data:{finished:true,errors:[{code:105}]}}));const p=await partial.api.startCopyMove(['/a'],'/b',false);await tick();assert.equal(p.status,'error');assert.notEqual(p.progress,100)
 const missing=harness();missing.setStatus(async()=>({success:true,data:{}}));const m=await missing.api.startCopyMove(['/a'],'/b',false);await tick();assert.equal(m.status,'waiting')
 assert.equal(helpers.fileTaskResult({finished:false}).progress,null)
})
test('account changes invalidate in-flight status and resume only queries under the source identity',async()=>{
 const h=harness(),pending=deferred();h.setStatus(()=>pending.promise);const task=await h.api.startCopyMove(['/a'],'/b',false)
 h.dsm.account='bob';h.dsm.sid='b';h.intervals[0]();pending.resolve({success:true,data:{finished:true}});await tick();assert.equal(task.status,'waiting');assert.equal(h.api.directoryRevision('/b'),0)
 h.api.refreshOperation(task);assert.equal(h.calls.filter(c=>c.method==='status').length,1)
 h.dsm.account='alice';h.dsm.sid='renewed';h.intervals[0]();h.setStatus(async()=>({success:true,data:{finished:true}}));h.api.refreshOperation(task);await tick();assert.equal(task.status,'done');assert.equal(h.calls.filter(c=>c.method==='start').length,1);assert.equal(h.calls.at(-1).sid,'renewed')
})
test('cancellation beats stale status; failed cancellation stays queryable and records cannot stop a running task',async()=>{
 const h=harness(),pending=deferred();h.setStatus(()=>pending.promise);const task=await h.api.startCopyMove(['/a'],'/b',false)
 h.api.removeOperation(task);assert.equal(h.api.fileOperations.length,1)
 await h.api.cancelOperation(task);assert.equal(task.status,'cancelled');pending.resolve({success:true,data:{finished:true}});await tick();assert.equal(task.status,'cancelled')
 const f=harness(),old=deferred();f.setStatus(()=>old.promise);const t=await f.api.startCopyMove(['/a'],'/b',false);f.setStop(async()=>{throw Error('secret')});await f.api.cancelOperation(t);assert.equal(t.status,'waiting');assert.equal(t.error.includes('secret'),false)
 f.api.refreshOperation(t);assert.equal(f.calls.filter(c=>c.method==='status').length,1);old.resolve({success:true,data:{finished:true}});await tick();assert.equal(t.status,'waiting');f.setStatus(async()=>({success:true,data:{finished:true}}));f.api.refreshOperation(t);await tick();assert.equal(t.status,'done')
})
test('uncertain submission retains task metadata without resubmitting or persisting archive secrets',async()=>{
 const h=harness();h.setStart(async()=>{throw Error('request?password=secret')})
 await assert.rejects(h.api.startFileTask('compress','a.zip',['/b'],c=>c.fileFeature('Compress','start',{password:'secret'})),/未确认/)
 assert.equal(h.api.fileOperations[0].status,'waiting');h.watchers.forEach(w=>w());assert.equal(h.storage.get('synolink.operations').includes('secret'),false)
 h.api.refreshOperation(h.api.fileOperations[0]);assert.equal(h.calls.length,1)
})
