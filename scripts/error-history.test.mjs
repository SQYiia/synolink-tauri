import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)}
const e={};new Function('exports','localStorage',ts.transpileModule(readFileSync('src/utils/errorHistory.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(e,storage)
test('history is bounded, partitioned, whitelist-only and clearable',async()=>{
 for(let i=0;i<105;i++)await e.recordError('https://secret-nas\nalice','api','request',105,12)
 assert.equal((await e.readErrors('https://secret-nas\nalice')).length,100)
 assert.equal((await e.readErrors('https://secret-nas\nbob')).length,0)
 assert.equal(JSON.stringify([...memory]).includes('secret-nas'),false)
 await e.clearErrors('https://secret-nas\nalice');assert.equal((await e.readErrors('https://secret-nas\nalice')).length,0)
})
test('expired entries and arbitrary fields are removed when reading',async()=>{
 await e.recordError('test','image','thumbnail',404,1)
 const k=[...memory.keys()].find(k=>JSON.parse(memory.get(k)).some(x=>x.code===404))
 const row=JSON.parse(memory.get(k))[0];memory.set(k,JSON.stringify([{...row,time:Date.now()-8*86400000},{...row,password:'secret'}]))
 const rows=await e.readErrors('test');assert.equal(rows.length,1);assert.equal(JSON.stringify(rows).includes('secret'),false)
})
