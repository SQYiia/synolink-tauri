import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function setup({sid='session',cache=async()=>null}={}) {
 const hooks={mounted:[],activated:[],deactivated:[],disposed:[]}, intervals=new Set(), calls=[], stopped=[]
 const storage=new Map([['test:https://nas:alice','/alice'],['test:https://nas:bob','/bob']])
 const dsm={baseUrl:'https://nas',account:'alice',sid,searchStart:async(path)=>{calls.push(path);return {success:true,data:{taskid:'t'+calls.length}}},searchList:async(_id,{offset})=>({success:true,data:{finished:true,files:offset?[]:[{name:'x.jpg',path:'/x.jpg'}]}}),searchStop:async(id)=>stopped.push(id)}
 const vue={ref:value=>({value}),shallowRef:value=>({value}),computed:fn=>({get value(){return fn()}}),markRaw:x=>x,nextTick:fn=>Promise.resolve().then(fn),watch:()=>{},onMounted:fn=>hooks.mounted.push(fn),onActivated:fn=>hooks.activated.push(fn),onDeactivated:fn=>hooks.deactivated.push(fn),onScopeDispose:fn=>hooks.disposed.push(fn)}
 const js=ts.transpileModule(readFileSync(new URL('../src/composables/useMediaScan.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const exports={};new Function('require','exports','localStorage','setInterval','clearInterval','requestAnimationFrame',js)(name=>name==='vue'?vue:name==='../api/dsm'?{dsm}:name==='element-plus'?{ElMessage:{success(){},error(){}}}:{readMediaCache:cache,writeMediaCache:async()=>{}},exports,{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fn=>{intervals.add(fn);return fn},fn=>intervals.delete(fn),fn=>queueMicrotask(fn))
 const scan=exports.useMediaScan({extensions:'jpg',filterFn:()=>true,storageKeyPrefix:'test'})
 const fire=key=>hooks[key].forEach(fn=>fn())
 return {dsm,scan,calls,stopped,fire,tick:()=>intervals.forEach(fn=>fn()),storage,intervals}
}
async function settle(){for(let i=0;i<12;i++)await new Promise(r=>setTimeout(r,2))}
test('initial mounted + activated scans once; KeepAlive return automatically scans again',async()=>{
 const h=setup();h.fire('mounted');h.fire('activated');await settle();assert.deepEqual(h.calls,['/alice']);assert.equal(h.scan.items.value.length,1)
 h.fire('deactivated');assert.equal(h.intervals.size,0);h.fire('activated');await settle();assert.deepEqual(h.calls,['/alice','/alice']);h.fire('disposed')
})
test('delayed session and same-server account switch use current saved folders automatically',async()=>{
 const h=setup({sid:''});h.fire('mounted');await settle();assert.equal(h.calls.length,0)
 h.dsm.sid='ready';h.tick();await settle();assert.deepEqual(h.calls,['/alice'])
 h.dsm.account='bob';h.tick();await settle();assert.deepEqual(h.calls,['/alice','/bob'])
 h.scan.onPickFolder('/bob-new');await settle();assert.equal(h.storage.get('test:https://nas:bob'),'/bob-new');assert.equal(h.storage.get('test:https://nas:alice'),'/alice');h.fire('disposed')
})
test('a blocked metadata cache cannot prevent automatic network scanning',async()=>{
 const h=setup({cache:()=>new Promise(()=>{})});h.fire('mounted');await new Promise(r=>setTimeout(r,1100));await settle();assert.deepEqual(h.calls,['/alice']);assert.equal(h.scan.loading.value,false);h.fire('disposed')
})
test('leaving during a pending request prevents old results from painting',async()=>{
 const h=setup();let resolve;h.dsm.searchList=()=>new Promise(r=>resolve=r);h.fire('mounted');await settle();h.fire('deactivated');resolve({success:true,data:{finished:true,files:[{name:'late.jpg'}]}});await settle();assert.equal(h.scan.items.value.length,0);assert.equal(h.scan.loading.value,false);assert.equal(h.stopped.length,1);h.fire('disposed')
})

test('first empty task automatically retries without refresh and preserves cached items',async()=>{
 const h=setup({cache:async()=>[{name:'cached.jpg'}]});const original=h.dsm.searchList
 h.dsm.searchList=async(id,opts)=>id==='t1'?{success:true,data:{finished:true,files:[]}}:original(id,opts)
 h.fire('mounted');await settle();assert.equal(h.scan.items.value[0].name,'cached.jpg');assert.equal(h.scan.loading.value,true)
 await new Promise(r=>setTimeout(r,1300));await settle();assert.equal(h.calls.length,2);assert.equal(h.scan.items.value[0].name,'x.jpg');assert.equal(h.scan.loading.value,false);h.fire('disposed')
})
test('temporary initial failure recovers automatically',async()=>{
 const h=setup();const original=h.dsm.searchStart;let first=true
 h.dsm.searchStart=async path=>{if(first){first=false;throw Error('Temporary NAS connection failure')}return original(path)}
 h.fire('mounted');await settle();assert.equal(h.scan.loading.value,true)
 await new Promise(r=>setTimeout(r,1300));await settle();assert.equal(h.scan.items.value.length,1);assert.equal(h.scan.scanError.value,'');h.fire('disposed')
})
test('same account renewed SID triggers scanning without navigation',async()=>{
 const h=setup();h.fire('mounted');await settle();h.dsm.sid='renewed-session';h.tick();await settle();assert.equal(h.calls.length,2);h.tick();await settle();assert.equal(h.calls.length,2);h.fire('disposed')
})
test('string false finished flag does not prematurely finish an empty initial batch',async()=>{
 const h=setup();let calls=0;h.dsm.searchList=async(_id,{offset})=>++calls===1?{success:true,data:{finished:'false',files:[]}}:{success:true,data:{finished:'true',files:offset?[]:[{name:'arrived.jpg'}]}}
 h.fire('mounted');await new Promise(r=>setTimeout(r,600));await settle();assert.equal(h.scan.items.value[0].name,'arrived.jpg');assert.equal(h.calls.length,1);h.fire('disposed')
})
test('leaving cancels pending automatic retry; stop cleanup cannot block completion',async()=>{
 const h=setup();h.dsm.searchList=async()=>({success:true,data:{finished:true,files:[]}});h.fire('mounted');await settle();h.fire('deactivated');await new Promise(r=>setTimeout(r,1300));assert.equal(h.calls.length,1);h.fire('disposed')
 const ready=setup();ready.dsm.searchStop=()=>new Promise(()=>{});ready.fire('mounted');await settle();assert.equal(ready.scan.loading.value,false);ready.fire('disposed')
})
test('genuinely empty folders settle after bounded retries',async()=>{
 const h=setup();h.dsm.searchList=async()=>({success:true,data:{finished:true,files:[]}});h.fire('mounted');await new Promise(r=>setTimeout(r,4500));await settle();assert.equal(h.calls.length,3);assert.equal(h.scan.loading.value,false);assert.equal(h.scan.items.value.length,0);h.fire('disposed')
})
