export function containerDetails(data:any){
 const c=data?.container??data?.info??data
 if(!c||typeof c!=='object'||!Object.keys(c).length)throw Error('NAS 未返回容器详情')
 const list=(v:any)=>Array.isArray(v)?v:[]
 const text=(v:any)=>typeof v==='string'||typeof v==='number'?String(v):'—'
 return {
  restart:text(c.restart_policy?.Name??c.restart_policy??c.HostConfig?.RestartPolicy?.Name),
  health:text(c.health?.status??c.State?.Health?.Status),exit:text(c.exit_code??c.State?.ExitCode),
  ports:list(c.port_bindings??c.ports).map((p:any)=>`${text(p.host_port??p.hostPort)} → ${text(p.container_port??p.containerPort)} / ${text(p.type??p.protocol)}`),
  mounts:list(c.volume_bindings??c.volumes??c.Mounts).map((v:any)=>`${text(v.host_volume_file??v.Source)} → ${text(v.mount_point??v.Destination)}${v.read_only===true||v.RW===false?'（只读）':''}`),
  networks:list(c.networks??c.network).map((n:any)=>text(typeof n==='string'?n:n.name??n.Name)),
 }
}
export function taskState(data:any){
 const info=data?.task_info??{},status=String(info.status??'')
 const failed=!!data?.error||!!info.error||(Number(info.error_code)>0)||['error','failed','failure'].includes(status.toLowerCase())
 const progress=typeof info.progress==='number'&&Number.isFinite(info.progress)?Math.max(0,Math.min(100,info.progress)):null
 return {state:failed?'失败':data?.finish===true?'已结束':'处理中',progress,detail:failed?`任务失败（${info.error_code??info.error?.code??data?.error?.code??'未知错误'}）`:status}
}
