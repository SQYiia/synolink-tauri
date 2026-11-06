import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const exports={};new Function('exports',ts.transpileModule(readFileSync(new URL('../src/utils/memory.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports)
const parse=exports.parseMemory
test('DSM reported usage wins over free memory subtraction',()=>{
 const m=parse({total_real:4194304,memory_size:8388608,avail_real:262144,cached:2800000,buffer:100000,real_usage:25})
 assert.equal(m.percentage,25);assert.equal(m.usedBytes,1073741824);assert.equal(m.totalBytes,4294967296);assert.equal(m.installedBytes,8589934592)
})
test('zero percent and numeric strings are valid',()=>{
 assert.equal(parse({total_real:'1024',real_usage:'0'}).usedBytes,0)
 assert.equal(parse({real_usage:'48'}).percentage,48)
 assert.equal(parse({real_usage:'48'}).usedBytes,null)
})
test('missing percentage falls back only with complete cache accounting',()=>{
 const m=parse({total_real:1000,avail_real:100,cached:500,buffer:100});assert.equal(m.percentage,30);assert.equal(m.usedBytes,300*1024)
 assert.equal(parse({total_real:1000,avail_real:100}).percentage,null)
 assert.equal(parse({total_real:1000,avail_real:2000,cached:0,buffer:0}).percentage,null)
})
test('missing, malformed and nonfinite data never become false 0 or 100 percent',()=>{
 for(const data of [null,{}, {real_usage:''},{real_usage:101},{real_usage:-1},{real_usage:Infinity},{real_usage:true},{total_real:'oops',avail_real:0},{memory_size:8192,avail_real:0}]) assert.equal(parse(data).percentage,null)
})
