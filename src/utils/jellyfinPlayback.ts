export const TICKS_PER_SECOND = 10_000_000
export function resumeSeconds(item: any): number {
 const ticks=Number(item?.UserData?.PlaybackPositionTicks)
 const duration=Number(item?.RunTimeTicks)
 return !item?.UserData?.Played && Number.isFinite(ticks) && ticks>0 && (!Number.isFinite(duration)||ticks<duration) ? ticks/TICKS_PER_SECOND : 0
}
/** Media links are restricted to the authenticated server and its reverse-proxy prefix. */
export function playbackUrl(base: string, path: string): string {
 const root=new URL(base+'/')
 const relative=path.startsWith(root.pathname)?new URL(path,root.origin).href:path.replace(/^\/(?!\/)/,'')
 const url=new URL(relative,root)
 if(url.origin!==root.origin||url.username||url.password||!url.pathname.startsWith(root.pathname)) throw new Error('播放地址不属于当前 Jellyfin 服务')
 for(const key of [...url.searchParams.keys()])if(['api_key','apikey','access_token','token'].includes(key.toLowerCase()))url.searchParams.delete(key)
 url.hash=''
 return url.href
}
export function playbackProfile(bitrate: number) {
 return { Name:'SynoLink HLS',MaxStreamingBitrate:bitrate,MaxStaticBitrate:bitrate,
  DirectPlayProfiles:[],
  TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Protocol:'hls',Context:'Streaming',MaxAudioChannels:'2',MinSegments:2,SegmentLength:4,CopyTimestamps:true}],
  CodecProfiles:[{Type:'Video',Codec:'h264',Conditions:[{Condition:'EqualsAny',Property:'VideoProfile',Value:'baseline|main|high',IsRequired:true},{Condition:'LessThanEqual',Property:'VideoLevel',Value:'51',IsRequired:true},{Condition:'LessThanEqual',Property:'VideoBitDepth',Value:'8',IsRequired:true}]}],
  SubtitleProfiles:['srt','subrip','ass','ssa','pgssub','dvdsub','dvbsub','vtt','webvtt'].map(Format=>({Format,Method:'Encode'})),
 }
}
export function selectPlayback(info:any) {
 if(info?.ErrorCode)throw new Error('Jellyfin 无法提供播放流（'+String(info.ErrorCode)+'）')
 const source=info?.MediaSources?.find((s:any)=>s.SupportsTranscoding!==false && s.TranscodingUrl)
 if(!source || !info.PlaySessionId)throw new Error('服务器未提供兼容的 HLS 播放流，请检查转码权限和服务器配置')
 if(source.TranscodingSubProtocol && source.TranscodingSubProtocol.toLowerCase()!=='hls')throw new Error('服务器返回的播放协议不受支持')
 return {source,sessionId:String(info.PlaySessionId)}
}
