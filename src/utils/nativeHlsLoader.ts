import { fetch } from '@tauri-apps/plugin-http'
import type { Loader, LoaderContext, LoaderConfiguration, LoaderCallbacks, LoaderStats } from 'hls.js'
import type { JellyfinClient } from '../api/jellyfin'

/** Every playlist, key and segment is authenticated through the native HTTP client. */
export function nativeHlsLoader(client: JellyfinClient) {
 return class NativeLoader implements Loader<LoaderContext> {
  context: LoaderContext | null = null
  stats: LoaderStats = { aborted:false,loaded:0,total:0,retry:0,chunkCount:0,bwEstimate:0,loading:{start:0,first:0,end:0},parsing:{start:0,end:0},buffering:{start:0,first:0,end:0} }
  private controller = new AbortController()
  private timer?: ReturnType<typeof setTimeout>
  abort(){this.stats.aborted=true;this.controller.abort();clearTimeout(this.timer)}
  destroy(){this.abort()}
  load(context:LoaderContext,config:LoaderConfiguration,callbacks:LoaderCallbacks<LoaderContext>){
   this.context=context; this.stats.loading.start=performance.now()
   let timedOut=false
   this.timer=setTimeout(()=>{timedOut=true;this.controller.abort()},config.timeout||30000)
   void (async()=>{
    let status=0
    try {
     const url=client.streamUrl(context.url)
     const headers:Record<string,string>={...client.headers()}
     if(context.rangeEnd!==undefined)headers.Range=`bytes=${context.rangeStart||0}-${context.rangeEnd-1}`
     const response=await fetch(url,{headers,signal:this.controller.signal,maxRedirections:0,connectTimeout:15000})
     status=response.status;this.stats.loading.first=performance.now()
     if(!response.ok)throw new Error('HTTP '+status)
     const limit=context.responseType==='arraybuffer'?64*1024*1024:1024*1024
     if(Number(response.headers.get('content-length'))>limit)throw new Error('播放响应过大')
     const reader=response.body?.getReader();if(!reader)throw new Error('播放响应为空')
     const chunks:Uint8Array[]=[]
     try { while(true){const {done,value}=await reader.read();if(done)break;this.stats.loaded+=value.byteLength;if(this.stats.loaded>limit)throw new Error('播放响应过大');chunks.push(value)} }
     finally {await reader.cancel().catch(()=>{})}
     if(this.stats.aborted)return
     const bytes=new Uint8Array(this.stats.loaded);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
     this.stats.total=this.stats.loaded;this.stats.loading.end=performance.now();clearTimeout(this.timer)
     callbacks.onSuccess({url,data:context.responseType==='arraybuffer'?bytes.buffer:new TextDecoder().decode(bytes),code:status},this.stats,context,null)
    } catch {clearTimeout(this.timer);if(this.stats.aborted)return;if(timedOut)callbacks.onTimeout(this.stats,context,null);else callbacks.onError({code:status,text:'播放流请求失败'},context,null,this.stats)}
   })()
  }
 }
}
