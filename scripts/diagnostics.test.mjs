import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const exports={};new Function('exports',ts.transpileModule(readFileSync('src/utils/diagnostics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports)
test('diagnostics are read-only, classify permission failures and never export network secrets',async()=>{
 const client={baseUrl:'https://private-nas',sid:'secret',account:'private-user',apiInfo:{},async loadApiInfo(){this.apiInfo={test:{}}},listShare:async()=>({success:false,error:{code:105}}),systemUtilization:async()=>{throw Error('https://private-nas/?_sid=secret')},storageInfo:async()=>({success:true,data:{volumes:[]}})}
 const results=await exports.runDiagnostics(client);assert.equal(results.length,5);assert.equal(results[2].detail,'账号权限不足');assert.equal(results[3].status,'error');assert.equal(results[4].status,'ok');const report=exports.diagnosticReport('test',results);for(const secret of ['private-nas','private-user','secret'])assert.equal(report.includes(secret),false)
})
test('logged-out and cancelled diagnostics do not make requests',async()=>{
 assert.equal((await exports.runDiagnostics({baseUrl:'http://nas',sid:''})).at(-1).detail,'请先登录 NAS')
 assert.equal((await exports.runDiagnostics({baseUrl:'https://nas',sid:'yes'},()=>true)).length,1)
})

test('incomplete successful responses are warnings and cancellation drops in-flight results',async()=>{
 const client={baseUrl:'https://nas',sid:'yes',apiInfo:{},async loadApiInfo(){this.apiInfo={test:{}}},listShare:async()=>({success:true}),systemUtilization:async()=>({success:true,data:{}}),storageInfo:async()=>({success:true,data:{volumes:[{size_total_byte:100}]}})}
 const rows=await exports.runDiagnostics(client);assert.equal(rows[3].status,'warning');assert.equal(rows[4].status,'warning')
 let cancelled=false;client.loadApiInfo=async()=>{cancelled=true};const updates=[]
 const partial=await exports.runDiagnostics(client,()=>cancelled,r=>updates.push(r));assert.equal(partial.length,1);assert.equal(updates.length,0)
})
