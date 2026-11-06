import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const exports={}
new Function('exports',ts.transpileModule(readFileSync(new URL('../src/utils/driveBackup.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports)
test('Drive preserves opaque long IDs and rejects rounded numeric IDs',()=>{
 assert.equal(exports.driveItem({file_id:'987654321012345678',name:'中文',type:'dir'}).id,'987654321012345678')
 assert.equal(exports.driveItem({file_id:'1',type:'dir'}).directory,true)
 assert.throws(()=>exports.driveItem({file_id:987654321012345678}),/精度/)
})
test('backup missing and numeric results never imply success',()=>{
 assert.equal(exports.backupResult(undefined).tone,'info');assert.equal(exports.backupResult(2).tone,'info')
 assert.equal(exports.backupResult('fail').tone,'danger');assert.equal(exports.backupResult('done').tone,'success')
 assert.equal(exports.backupTask({repo_id:123}).id,'')
 assert.throws(()=>exports.rowsOf({},'task_list'),/格式/)
})
test('dates preserve NAS strings and handle missing timestamps',()=>{
 assert.equal(exports.displayTime('2026/11/01 03:00'),'2026/11/01 03:00');assert.equal(exports.displayTime(0),'未返回')
})
