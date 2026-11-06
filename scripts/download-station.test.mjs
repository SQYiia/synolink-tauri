import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function load(overrides = {}) {
 const dsm = { baseUrl:'https://nas', account:'alice', apiInfo:{ task:{} }, dsInfo:async()=>({success:true}), dsTaskList:async()=>({success:true,data:{tasks:[{id:'1',status:'downloading'}]}}), dsStatistic:async()=>({success:true,data:{speed_download:12}}), ...overrides }
 const js=ts.transpileModule(readFileSync(new URL('../src/composables/useDownloadStation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const exports={}; new Function('require','exports',js)(name=>name==='vue'?{reactive:x=>x,computed:fn=>({get value(){return fn()}})}:{dsm},exports);return {api:exports,dsm}
}
test('zero speed, missing speed and BT metadata have distinct hints',()=>{
 const {api}=load(); const missing=api.mapTask({status:'downloading'});assert.match(api.getTaskHint(missing),/未返回/)
 const bt=api.mapTask({status:'downloading',type:'bt',additional:{transfer:{speed_download:0}}});assert.match(api.getTaskHint(bt),/元数据/)
 bt.size=100;bt.seeders=0;bt.peers=0;assert.match(api.getTaskHint(bt),/未连接/)
 bt.speedDownload=10;assert.equal(api.getTaskHint(bt),'')
})
test('task refresh survives statistics failure and reports stale task requests',async()=>{
 const {api,dsm}=load({dsStatistic:async()=>{throw Error('offline')}});await api.dsRefresh();assert.equal(api.dsTasks.value.length,1);assert.match(api.dsReason.value,/统计/);assert.ok(api.dsLastUpdate.value)
 dsm.dsTaskList=async()=>({success:false,error:{code:119}});await api.dsRefresh();assert.match(api.dsReason.value,/会话失效/);assert.equal(api.dsTasks.value.length,1)
})
test('old account requests cannot populate new account data',async()=>{
 let release;const {api,dsm}=load({dsTaskList:()=>new Promise(r=>release=r)});const request=api.dsRefresh();await new Promise(r=>setTimeout(r,0));dsm.account='bob';release({success:true,data:{tasks:[{id:'old'}]}});await request;assert.equal(api.dsTasks.value.length,0)
})
test('task actions reject partial failures and creation normalizes newline links',async()=>{
 let sent;const {api}=load({dsTaskCreate:async args=>{sent=args;return {success:true}}});assert.throws(()=>api.assertTaskAction({success:true,data:[{id:'1',error:404}]}),/任务 ID/);api.assertTaskAction({success:true,data:[{id:'1',error:0}]});await api.dsCreateTask(' https://a/file\n\nhttps://b/file ');assert.equal(sent.uri,'https://a/file,https://b/file')
})
