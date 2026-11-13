import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function load(path, require=()=>{throw Error('Unexpected import')}){const exports={};new Function('exports','require',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports,require);return exports}
const playback=load('../src/utils/jellyfinPlayback.ts')
test('playback URLs preserve prefixes, strip query credentials and reject foreign endpoints',()=>{
 for(const path of ['/Videos/a.m3u8','/jellyfin/Videos/a.m3u8','https://nas/jellyfin/Videos/a.m3u8'])assert.equal(playback.playbackUrl('https://nas/jellyfin',path+'?api_key=secret'),'https://nas/jellyfin/Videos/a.m3u8')
 for(const path of ['https://other/Videos/a','//other/a','../a','https://nas/outside/a','https://user:pass@nas/jellyfin/a'])assert.throws(()=>playback.playbackUrl('https://nas/jellyfin',path))
})
test('resume rejects completed and invalid positions; stream negotiation rejects incompatible results',()=>{
 assert.equal(playback.resumeSeconds({UserData:{PlaybackPositionTicks:1200000000},RunTimeTicks:2400000000}),120)
 for(const UserData of [{Played:true,PlaybackPositionTicks:20},{PlaybackPositionTicks:-1},{PlaybackPositionTicks:Infinity},{PlaybackPositionTicks:300}])assert.equal(playback.resumeSeconds({UserData,RunTimeTicks:200}),0)
 assert.throws(()=>playback.selectPlayback({MediaSources:[]}))
 assert.throws(()=>playback.selectPlayback({ErrorCode:'NotAllowed'}))
 assert.equal(playback.selectPlayback({PlaySessionId:'p',MediaSources:[{Id:'a',TranscodingUrl:'/a.m3u8'}]}).source.Id,'a')
})
test('negotiation, ordered endpoints and 204 responses use native authenticated requests',async()=>{
 const calls=[]
 const {JellyfinClient}=load('../src/api/jellyfin.ts',name=>name.includes('package.json')?{version:'test'}:name.includes('jellyfinPlayback')?playback:name.includes('filmMetadata')?{jellyfinBase:x=>x}:name.includes('imageCache')?{}:{fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:204,json(){throw Error('204 has no body')}}}})
 const c=new JellyfinClient('https://nas/jellyfin');c.userId='u';c.token='secret'
 await c.playbackInfo('item',{bitrate:4000000,audio:2,subtitle:4});await c.reportPlayback('start',{ItemId:'item'});await c.reportPlayback('progress',{});await c.reportPlayback('stop',{});await c.stopEncoding('session')
 const body=JSON.parse(calls[0].options.body);assert.equal(body.AudioStreamIndex,2);assert.equal(body.SubtitleStreamIndex,4);assert.equal(body.EnableDirectPlay,false);assert.equal(body.DeviceProfile.TranscodingProfiles[0].Protocol,'hls')
 assert.match(calls[2].url,/Sessions\/Playing\/Progress/);assert.match(calls[3].url,/Stopped/);assert.equal(calls[4].options.method,'DELETE')
 for(const call of calls){assert.equal(call.options.maxRedirections,0);assert.match(call.options.headers.Authorization,/secret/);assert.equal(call.url.includes('secret'),false)}
})
test('native HLS loader handles segments, limits, HTTP errors and cancellation',async()=>{
 let mode='success', calls=[]
 const {nativeHlsLoader}=load('../src/utils/nativeHlsLoader.ts',()=>({fetch:async(url,options)=>{calls.push({url,options});if(mode==='wait')await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('abort'))));return new Response('segment',{status:mode==='error'?401:200,headers:mode==='large'?{'content-length':'999999999'}:{}})}}))
 const Loader=nativeHlsLoader({streamUrl:path=>playback.playbackUrl('https://nas',path),headers:()=>({Authorization:'secret'})})
 const context={url:'https://nas/a.ts?api_key=secret',responseType:'arraybuffer',rangeStart:2,rangeEnd:8}
 const run=()=>new Promise(resolve=>new Loader().load(context,{timeout:1000},{onSuccess:r=>resolve(r),onError:e=>resolve(e),onTimeout:()=>resolve('timeout')}))
 assert.equal(new TextDecoder().decode((await run()).data),'segment');assert.equal(calls[0].options.headers.Range,'bytes=2-7');assert.equal(calls[0].options.maxRedirections,0);assert.equal(calls[0].url,'https://nas/a.ts')
 mode='error';assert.equal((await run()).code,401)
 mode='large';assert.equal((await run()).text,'播放流请求失败')
 mode='wait';const loader=new Loader();let callback=false;loader.load(context,{timeout:1000},{onSuccess:()=>callback=true,onError:()=>callback=true,onTimeout:()=>callback=true});loader.abort();await new Promise(r=>setTimeout(r,10));assert.equal(callback,false)
})
