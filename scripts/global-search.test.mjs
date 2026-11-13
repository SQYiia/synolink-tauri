import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
function load(path,require=()=>({})){const exports={};new Function('exports','require',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,require);return exports}
const {searchSharedFolders}=load('src/utils/globalSearch.ts')
const listing=()=>({success:true,data:{shares:['/photo','/work','/blocked','/photo','/'].map(path=>({path}))}})
test('search covers shares, limits concurrency and retains partial results',async()=>{
 let active=0,max=0;const paths=[]
 const result=await searchSharedFolders({listAll:async()=>listing(),searchAll:async(path)=>{paths.push(path);max=Math.max(max,++active);await new Promise(r=>setTimeout(r,5));active--;if(path==='/blocked')throw Error();return [{path:path+'/report'},{path:path+'/report'},{path:'/wrong/report'}]}},'report',new AbortController().signal)
 assert.equal(max,2);assert.deepEqual(paths,['/photo','/work','/blocked']);assert.equal(result.failed,1);assert.equal(result.files.length,2)
})
test('cancel and identity change discard results and stop new scheduling',async()=>{
 for(const changeIdentity of [false,true]){let current=true;const controller=new AbortController();let calls=0
 await assert.rejects(searchSharedFolders({listAll:async()=>listing(),searchAll:async()=>{calls++;if(changeIdentity)current=false;else controller.abort();return []}},'x',controller.signal,()=>current),/已取消/);assert.equal(calls,1)}
 await assert.rejects(searchSharedFolders({listAll:async()=>({success:false}),searchAll:async()=>[]},'x',new AbortController().signal),/共享文件夹/)
})
test('search start encodes comma and quote in folder as one JSON array path',async()=>{
 const calls=[];const {DsmClient}=load('src/api/dsm.ts',name=>name.includes('plugin-http')?{fetch:async(url,options)=>{calls.push(new URLSearchParams(options.body));return new Response(JSON.stringify({success:true,data:{taskid:'task'}}))}}:name.includes('errorHistory')?{recordError:async()=>{}}:{})
 const client=new DsmClient('https://nas.test');client.apiInfo={'SYNO.FileStation.Search':{path:'entry.cgi',minVersion:2,maxVersion:2}};await client.searchStart('/share/a,"b','旅行')
 assert.deepEqual(JSON.parse(calls[0].get('folder_path')),['/share/a,"b']);assert.equal(calls[0].get('pattern'),'旅行')
})
test('package icons reject active content, embedded credentials and insecure external URLs',()=>{
 const {packageIconSource}=load('src/utils/packageIcon.ts')
 for(const icon of ['javascript:alert(1)','https://user:pass@example.com/a.png','http://example.com/a.png','https://example.com/a.png?_sid=secret'])assert.equal(packageIconSource({icon},'https://nas.test'),'')
 assert.equal(packageIconSource({icon:'/icons/a.png'},'https://nas.test'),'https://nas.test/icons/a.png')
 assert.equal(packageIconSource({icon_256:'https://cdn.test/a.png'},'https://nas.test'),'https://cdn.test/a.png')
})
