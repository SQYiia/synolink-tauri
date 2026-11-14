import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const exports={};new Function('exports',ts.transpileModule(readFileSync('src/utils/workloadDetails.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports)
test('container details only expose allowed fields; missing data is unknown',()=>{
 const row=exports.containerDetails({container:{environment:[{password:'secret'}],port_bindings:[{host_port:8080,container_port:80,type:'tcp'}],volume_bindings:[{host_volume_file:'/docker',mount_point:'/data',read_only:true}]}})
 assert.equal(row.restart,'—');assert.equal(row.ports[0],'8080 → 80 / tcp');assert.match(row.mounts[0],/只读/);assert.ok(!JSON.stringify(row).includes('secret'));assert.throws(()=>exports.containerDetails({}))
})
test('VMM task completion requires finish flag, and errors override completion',()=>{
 assert.equal(exports.taskState({finish:false,task_info:{progress:100}}).state,'处理中')
 assert.equal(exports.taskState({finish:true,task_info:{error_code:5}}).state,'失败')
 assert.equal(exports.taskState({finish:true,task_info:{status:'failed'}}).state,'失败')
 assert.equal(exports.taskState({finish:true}).state,'已结束')
 assert.equal(exports.taskState({}).progress,null)
})
