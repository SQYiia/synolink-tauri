import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function load(path,require=()=>({})) {
 const exports={}
 const js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('exports','require',js)(exports,require);return exports
}
const {renamePreview,runRenameBatch}=load('src/utils/batchRename.ts')
const rule={mode:'replace',find:'',replace:'',prefix:'',suffix:'',start:1,digits:3}
const source=(name,isdir=false)=>({path:'/share/'+name,name,isdir})
test('rename preview retains extensions and directory names, replaces literal text and numbers in selection order',()=>{
 const rows=[source('IMG.01.HEIC'),source('.hidden'),source('folder.with.dot',true)]
 const preview=renamePreview(rows,{...rule,mode:'number',prefix:'旅行-'},rows.map(r=>r.name))
 assert.deepEqual(preview.map(r=>r.target),['旅行-001.HEIC','旅行-002','旅行-003'])
 assert.ok(preview.every(r=>!r.error))
 assert.equal(renamePreview([source('a$a$.txt')],{...rule,find:'a$',replace:'$1'},[])[0].target,'$1$1.txt')
 assert.equal(renamePreview([source('a.txt')],rule,['a.txt'])[0].status,'unchanged')
})
test('rename rejects duplicate, existing, case-only, reserved, traversal and overlong names',()=>{
 assert.ok(renamePreview([source('a.txt'),source('aa.txt')],{...rule,find:'a',replace:''},[]).every(r=>r.error))
 for(const prefix of ['../','bad/','CON.','字'.repeat(90)])assert.ok(renamePreview([source('a.txt')],{...rule,prefix},[])[0].error)
 assert.ok(renamePreview([source('a.txt')],{...rule,prefix:'new-'},['NEW-a.txt'])[0].error)
 assert.ok(renamePreview([source('a.txt')],{...rule,find:'a',replace:'A'},['a.txt'])[0].error)
 assert.ok(renamePreview([source('a.txt')],{...rule,mode:'number',digits:Infinity},[])[0].error)
})
const plan=()=>renamePreview([source('a.txt'),source('b.txt'),source('c.txt')],{...rule,prefix:'new-'},[])
const success=row=>({success:true,data:{files:[{path:'/share/'+row.target}]}})
test('rename serializes writes, stops subsequent operations and records completed requests',async()=>{
 const rows=plan();let count=0,dirty=0,active=true
 await runRenameBatch(rows,async row=>{count++;active=false;return success(row)},()=>active,()=>dirty++)
 assert.equal(count,1);assert.equal(dirty,1);assert.deepEqual(rows.map(r=>r.status),['done','stopped','stopped'])
})
test('rename treats partial errors as failure and ambiguous response as unknown; never retries',async()=>{
 for(const [reply,status]of [[{success:true,data:{files:[{error:{code:1200}}]}},'error'],[{success:true,data:{files:[{path:'/share/new-a.txt'}],errors:{code:1200}}},'error'],[{success:true},'unknown'],[{success:false,error:{code:105}},'error']]){
  const rows=plan();let calls=0
  await runRenameBatch(rows,async()=>{calls++;return reply},()=>true,()=>{})
  assert.equal(calls,1);assert.deepEqual(rows.map(r=>r.status),[status,'stopped','stopped'])
 }
 const rows=plan();let dirty=0
 await runRenameBatch(rows,async()=>{throw Error('network')},()=>true,()=>dirty++)
 assert.equal(rows[0].status,'unknown');assert.equal(dirty,1)
})
test('rename identity change during a request prevents remaining writes',async()=>{
 let active=true,resolve;const promise=new Promise(r=>resolve=r),rows=plan();let calls=0
 const pending=runRenameBatch(rows,row=>{calls++;return promise},()=>active,()=>{})
 active=false;resolve(success(rows[0]));await pending
 assert.equal(calls,1);assert.equal(rows[1].status,'stopped')
})
test('checked rename discovers v2, encodes arrays and refuses unavailable capability',async()=>{
 const calls=[]
 const {DsmClient}=load('src/api/dsm.ts',name=>name.includes('plugin-http')?{fetch:async(url,options)=>{calls.push(new URLSearchParams(options.body));return new Response(JSON.stringify({success:true}))}}:name.includes('errorHistory')?{recordError:async()=>{}}:{})
 const c=new DsmClient('https://nas');c.apiInfo={'SYNO.FileStation.Rename':{path:'entry.cgi',minVersion:1,maxVersion:2}}
 await c.renameChecked('/share/a & 字.txt','"new".txt')
 assert.equal(calls[0].get('version'),'2');assert.deepEqual(JSON.parse(calls[0].get('path')),['/share/a & 字.txt']);assert.deepEqual(JSON.parse(calls[0].get('name')),['"new".txt'])
 c.apiInfo={'other':{}};await assert.rejects(c.renameChecked('/a','b'));assert.equal(calls.length,1)
})
