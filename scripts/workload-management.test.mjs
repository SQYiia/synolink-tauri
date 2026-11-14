import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
function load(file,require=()=>({})){const exports={};new Function('exports','require',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,require);return exports}
const utils=load('src/utils/workloadManagement.ts'),{managementRequest:req,managementRows:rows}=utils
test('management validates actions and identifiers, preserves registry ports and snapshot JSON IDs',()=>{
 assert.deepEqual(req('images','pull',{repository:'registry.test:5000/team/web',tag:'v1'}).params,{repository:'registry.test:5000/team/web',tag:'v1'})
 assert.throws(()=>req('images','pull',{repository:'https://host',tag:'v1'}));assert.throws(()=>req('projects','delete',{id:'p'}))
 assert.deepEqual(JSON.parse(req('snapshots','delete',{gsnap_id:'a,"b'}).params.gsnap_ids),['a,"b'])
 const restore=req('snapshots','restore',{guest_id:'g',gsnap_id:'s'});assert.equal(restore.params.poweroff_guest,false);assert.equal(restore.method,'restore_start')
 assert.equal(req('projects','stop',{id:'p'}).params.id,'p')
})
test('management normalizes project maps and image tags without retaining secrets',()=>{
 assert.equal(rows('images',{images:[{id:'i',repository:'nginx',tags:['latest','stable']}]}).length,2)
 const projects=rows('projects',{p:{id:'p',name:'demo',is_package:true,content:'secret'}});assert.equal(projects[0].locked,true);assert.ok(!JSON.stringify(projects).includes('secret'))
 assert.throws(()=>rows('snapshots',{}));assert.equal(rows('snapshots',{gsnaps:[{gsnap_id:'s',desc:'before',is_user_locked:true}]} )[0].locked,true)
})
test('missing capability never submits an unknown management API',async()=>{
 let calls=0;const {DsmClient}=load('src/api/dsm.ts',name=>name.includes('workloadManagement')?utils:{})
 const client=new DsmClient('https://nas');client.entry=async()=>{calls++;return {success:true}}
 await assert.rejects(client.manageWorkload('images','list'),/未提供/);assert.equal(calls,0)
 client.apiInfo={'SYNO.Docker.Project':{path:'entry.cgi',minVersion:1,maxVersion:1}};await client.manageWorkload('projects','start',{id:'p'});assert.equal(calls,1)
})
