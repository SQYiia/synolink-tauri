import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
function fixture(){
 globalThis.document={hidden:false}
 const dsm={baseUrl:'https://nas',account:'alice',sid:'one',vmmGuestList:async()=>({success:true,data:{guests:[{guest_id:'vm'}]}}),vmmHostList:async()=>({success:true,data:{hosts:[{}]}}),vmmStorageList:async()=>({success:true,data:{storages:[{}]}})}
 const exports={},messages=[]
 new Function('exports','require',ts.transpileModule(readFileSync('src/composables/useVmm.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,name=>name==='vue'?{reactive:x=>x,computed:fn=>({get value(){return fn()}}),onActivated:()=>{},onDeactivated:()=>{},onScopeDispose:()=>{}}:name==='element-plus'?{ElMessage:{success:x=>messages.push(x),error:x=>messages.push(x)}}:{dsm})
 return {dsm,exports,messages}
}
test('VMM preserves successful sections when another request fails; missing capacity stays unknown',async()=>{
 const {dsm,exports:e}=fixture();await e.vmmRefresh();assert.ok(Number.isNaN(e.vmmStorages.value[0].size));assert.ok(Number.isNaN(e.vmmHosts.value[0].totalRam))
 dsm.vmmHostList=async()=>{throw Error('offline')};await e.vmmRefresh();assert.equal(e.vmmGuests.value.length,1);assert.equal(e.vmmHosts.value.length,0);assert.equal(e.vmmStorages.value.length,1)
})
test('VMM discards late data after page deactivation and session change',async()=>{
 const {dsm,exports:e}=fixture();let resolve;dsm.vmmGuestList=()=>new Promise(r=>resolve=r)
 const work=e.vmmRefresh();e.vmmStopPolling();resolve({success:true,data:{guests:[{guest_id:'stale'}]}});await work;assert.equal(e.vmmGuests.value.length,0)
 const next=e.vmmRefresh();dsm.sid='two';resolve({success:true,data:{guests:[{guest_id:'stale'}]}});await next;assert.equal(e.vmmGuests.value.length,0)
})
test('VMM repeated refresh does not invalidate the active query; stale action produces no toast',async()=>{
 const {dsm,exports:e,messages}=fixture();let resolve
 dsm.vmmGuestList=()=>new Promise(r=>resolve=r)
 const first=e.vmmRefresh();await e.vmmRefresh();resolve({success:true,data:{guests:[{guest_id:'vm'}]}});await first;assert.equal(e.vmmGuests.value.length,1);assert.equal(e.vmmLoading.value,false)
 dsm.vmmGuestPowerOn=()=>new Promise(r=>resolve=r)
 const action=e.vmmPowerOn('vm');dsm.account='bob';resolve({success:true});assert.equal(await action,false);assert.deepEqual(messages,[])
})
