import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function module(path, require = () => {throw Error('Unexpected dependency')}) { const exports={}; new Function('exports','require',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports,require);return exports }
const meta=module('../src/utils/filmMetadata.ts')
test('Jellyfin URL preserves reverse proxy prefix and rejects credentials and unsafe schemes',()=>{
 assert.equal(meta.jellyfinBase('https://nas/jellyfin/'),'https://nas/jellyfin')
 for(const url of ['file:///x','https://user:secret@nas','https://nas/?api_key=x']) assert.throws(()=>meta.jellyfinBase(url))
})
test('sidecar matching prefers exact filename; generic movie metadata only for single-video folders',()=>{
 const files=['Movie.MKV','Movie.nfo','movie-poster.PNG','poster.jpg'].map(name=>({name,path:'/movies/'+name}))
 assert.equal(meta.sidecarCandidates('/movies/Movie.MKV',files).poster.name,'movie-poster.PNG')
 assert.equal(meta.sidecarCandidates('/movies/Other.mkv',[{name:'movie.nfo'},{name:'Other.mkv'}]).nfo.name,'movie.nfo')
 assert.equal(meta.sidecarCandidates('/movies/Other.mkv',[{name:'movie.nfo'},{name:'Other.mkv'},{name:'Another.mp4'}]).nfo,undefined)
})
test('Jellyfin uses scoped authenticated pagination, safe poster URLs, and reports expired sessions',async()=>{
 const calls=[];let status=200
 const {JellyfinClient}=module('../src/api/jellyfin.ts',name=>name.includes('package.json')?{version:'test'}:name.includes('jellyfinPlayback')?module('../src/utils/jellyfinPlayback.ts'):name.includes('filmMetadata')?meta:name.includes('imageCache')?{imageCacheKey:()=>'',readImageCache:async()=>null,writeImageCache:async()=>{}}:{fetch:async(url,options)=>{calls.push({url:new URL(url),options});return {ok:status===200,status,headers:new Headers({'content-type':'image/jpeg'}),json:async()=>({AccessToken:'secret',User:{Id:'user-a'}}),blob:async()=>new Blob(['image'],{type:'image/jpeg'})}}})
 const c=new JellyfinClient('https://nas/jellyfin');await c.login('alice','password');await c.list(60,'test');await c.list(0,'','series1');await c.poster('id','v2')
 assert.equal(calls[0].url.pathname,'/jellyfin/Users/AuthenticateByName');assert.equal(JSON.parse(calls[0].options.body).Pw,'password')
 assert.equal(calls[1].url.searchParams.get('Fields'),'Overview,Genres,People');assert.equal(calls[1].url.searchParams.get('UserId'),'user-a');assert.equal(calls[1].url.searchParams.get('StartIndex'),'60')
 assert.equal(calls[2].url.searchParams.get('ParentId'),'series1');assert.equal(calls[2].url.searchParams.has('Recursive'),false)
 assert.match(calls[3].options.headers.Authorization,/Token="secret"/);assert.equal(calls[3].url.href.includes('secret'),false)
 status=401;await assert.rejects(c.list(),/登录已失效/)
})
