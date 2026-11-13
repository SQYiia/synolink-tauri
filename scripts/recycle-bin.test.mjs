import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
function load(path,require=()=>({})){const exports={};new Function('exports','require',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,require);return exports}
const helpers=load('src/utils/fileFeatures.ts')
const r=load('src/utils/recycleBin.ts',()=>helpers)
test('recycle boundaries forbid root deletion, traversal, sibling bins and ordinary files',()=>{
 assert.equal(r.recycleRoot('/照片'),'/照片/#recycle')
 for(const path of ['/','/a/b','/a/../b'])assert.throws(()=>r.recycleRoot(path))
 for(const path of ['/a/#recycle','/a/#recycle2/x','/b/#recycle/x','/a/file','/a/#recycle/../x','/a/#recycle//x'])assert.throws(()=>r.recyclePath('/a/#recycle',path))
 assert.equal(r.recyclePath('/a/#recycle','/a/#recycle/folder/file'),'/a/#recycle/folder/file')
})
test('recycle lists only validated direct children and preserves directory flags',()=>{
 assert.equal(r.recycleRows('/a/#recycle','/a/#recycle',[{name:'照片',path:'/a/#recycle/照片',isdir:'true'}])[0].isdir,true)
 for(const row of [{name:'x',path:'/a/x'},{name:'fake',path:'/a/#recycle/x'},{name:'x',path:'/a/#recycle/folder/x'}])assert.throws(()=>r.recycleRows('/a/#recycle','/a/#recycle',[row]))
})
test('restore destination cannot be any recycle bin or filesystem root',()=>{
 const paths=['/a/#recycle/x']
 for(const dest of ['/','/b/#recycle','/b/#recycle/sub','/b/../c'])assert.throws(()=>r.restoreDestination('/a/#recycle',paths,dest))
 assert.equal(r.restoreDestination('/a/#recycle',paths,'/b/restored'),'/b/restored')
 assert.throws(()=>r.restoreDestination('/a/#recycle',[],'/b'))
})
test('deletion response distinguishes partial and whole failures from success',()=>{
 assert.equal(r.recycleDeleteSucceeded({success:true}),true)
 for(const res of [{},{success:false},{success:true,error:{code:1}},{success:true,data:{errors:[{code:1}]}},{success:true,data:{files:[{error:{code:1}}]}}])assert.equal(r.recycleDeleteSucceeded(res),false)
})
test('recycle API discovery uses documented v2 for List and Delete',async()=>{
 const {DsmClient}=load('src/api/dsm.ts');const c=new DsmClient('https://nas')
 c.apiInfo={'SYNO.FileStation.List':{minVersion:1,maxVersion:2},'SYNO.FileStation.Delete':{minVersion:1,maxVersion:2}}
 assert.equal(await c.ensureFileFeature('SYNO.FileStation.List'),2);assert.equal(await c.ensureFileFeature('SYNO.FileStation.Delete'),2)
 c.apiInfo['SYNO.FileStation.Delete'].maxVersion=1;await assert.rejects(c.ensureFileFeature('SYNO.FileStation.Delete'))
})
