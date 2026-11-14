export type HyperAction='backup'|'cancel'|'suspend'|'resume'
export interface HyperDraft{name:string;share:string;directory:string;sources:string[];compress:boolean}
export function hyperParams(input:HyperDraft){
 const name=input.name.trim(),share=input.share,directory=input.directory.trim().replace(/\.hbk$/i,'')
 const segment=(s:string)=>!!s&&s!=='.'&&s!=='..'&&!/[\\/\x00-\x1f"<>:|?*]/.test(s)&&!/[. ]$/.test(s)
 if(!segment(name)||name.length>32)throw Error('任务名称需为 1–32 个字符，不能包含路径或特殊字符')
 if(!segment(share)||!segment(directory)||directory.length>100)throw Error('请选择目标共享文件夹并填写有效的备份目录名')
 if(!Array.isArray(input.sources)||!input.sources.length)throw Error('请至少选择一个 NAS 源目录')
 const paths=[...new Set(input.sources)]
 for(const p of paths){if(!p.startsWith('/')||p.split('/').slice(1).some(s=>!segment(s)))throw Error('源目录路径无效');if(p.split('/')[1]===share)throw Error('源目录与目标不能位于同一个共享文件夹')}
 const source={app_list:[],app_config:[],file_list:paths,backup_volumes:[],backup_filter:{whitelist:[],exclude_list:[]}}
 return {action:'create',target_type:'image',transfer_type:'image_local',data_type:'data',share,target_id:directory+'.hbk',name,source,backup_params:{enable_notify:true,enable_version_file_log:false,bkp_config:true,dest_auto_unmount:false,enable_data_compress:input.compress===true,enable_data_encrypt:false},schedule:{schedule_enable:false,hour:3,min:0,date_type:0,repeat:0,repeat_hour:0,last_work_hour:3,week_name:'0,1,2,3,4,5,6'},incheck_schedule:{schedule_enable:false},rotate_params:{enable_rotate:false}}
}
export function hyperId(value:unknown){if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<0))return '';return typeof value==='string'&&value.trim()||typeof value==='number'?String(value):''}
export function hyperState(raw:any){
 const status=typeof raw?.status==='string'?raw.status:'',state=typeof raw?.state==='string'?raw.state:''
 const suspended=state==='backupable'&&status==='none'&&raw?.last_bkp_result==='suspend'
 const idle=state==='backupable'&&status==='none'&&!suspended
 const running=state==='backupable'&&['backingup','waiting'].includes(status)
 const actions:HyperAction[]=idle?['backup']:suspended?['resume']:running?(status==='backingup'?['suspend','cancel']:['cancel']):[]
 const labels:Record<string,string>={none:'空闲',backingup:'正在备份',waiting:'等待执行',canceling:'正在取消',suspending:'正在暂停',discarding:'处理中',restore:'正在恢复',relink:'正在重新连接'}
 const label=suspended?'已暂停':state==='error_detect'?'正在检查完整性':state&&state!=='backupable'?(({broken:'目标不可用',unauth:'需要重新授权',endofservice:'服务不可用'} as Record<string,string>)[state]||'状态：'+state):labels[status]||'状态待确认'
 const progress=raw?.progress?.progress
 return {state,status,label,actions,progress:typeof progress==='number'&&Number.isFinite(progress)&&progress>=0&&progress<=100?progress:null}
}
export function hyperShares(data:any){if(!Array.isArray(data?.share_list))throw Error('无法识别 Hyper Backup 目标共享文件夹');return data.share_list.map((row:any)=>Array.isArray(row)?{name:row[0],status:row[1]}:{name:row.share,status:row.status}).filter((r:any)=>typeof r.name==='string'&&r.name&&r.status===0)}
export function hyperError(code:unknown){const known:Record<string,string>={'105':'当前账号没有备份管理权限','106':'登录已过期，请重新登录','119':'登录已过期，请重新登录','102':'当前 NAS 未提供此接口','103':'当前套件不支持此操作','104':'当前套件接口版本不兼容'};return known[String(code)]||`Hyper Backup 请求失败（code=${typeof code==='number'?code:'未知'}）`}
function checked(result:any){if(result?.success!==true||result?.data?.has_fail===true)throw Error(hyperError(result?.error?.code));return result.data??{}}
export async function createHyperBackup(client:any,draft:HyperDraft,valid:()=>boolean,checkpoint:(phase:string,repoId?:string)=>void){
 const params=hyperParams(draft);const check=()=>{if(!valid())throw Error('连接或页面已变化，请在来源 NAS 核对创建结果')};check()
 await client.loadApiInfo();check()
 for(const api of ['SYNO.Backup.Task','SYNO.Backup.Repository','SYNO.Backup.Storage.Share.Local','SYNO.FileStation.List']){const info=client.apiInfo[api];if(!info||!Number.isInteger(info.minVersion)||!Number.isInteger(info.maxVersion)||info.minVersion!==1||info.maxVersion<1)throw Error('当前 NAS 缺少兼容的备份创建接口')}
 const shares=hyperShares(checked(await client.hyperBackupRequest('SYNO.Backup.Storage.Share.Local','list')));check();if(!shares.some((s:any)=>s.name===draft.share))throw Error('目标共享文件夹不可用于备份')
 const list=checked(await client.hyperBackupTasks());check();if(!Array.isArray(list.task_list))throw Error('无法核对现有任务');if(list.task_list.some((t:any)=>t.name===params.name))throw Error('同名备份任务已存在，请修改名称')
 const files=checked(await client.listAll('/'+params.share));check();if(!Array.isArray(files.files))throw Error('无法核对目标目录');if(files.files.some((f:any)=>[params.target_id,params.target_id.slice(0,-4)].includes(f.name)))throw Error('目标备份目录已存在，请使用新的目录名')
 checkpoint('repository-submitting');const repo=checked(await client.hyperBackupRequest('SYNO.Backup.Repository','create',{...params,name:params.name},true));const repoId=hyperId(repo.repo_id)
 if(!repoId)throw Error('未收到仓库编号，请先在 DSM 核对，勿重复创建')
 checkpoint('repository-created',repoId);check()
 checkpoint('task-submitting',repoId);const task=checked(await client.hyperBackupRequest('SYNO.Backup.Task','create',{...params,repo_id:repoId},true));const taskId=hyperId(task.task_id)
 if(!taskId)throw Error('未收到任务编号，请刷新列表或在 DSM 核对，勿重复创建')
 checkpoint('done',repoId);return taskId
}
