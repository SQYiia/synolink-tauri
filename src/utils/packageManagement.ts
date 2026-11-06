import { apiError } from './packages'
export function packageResult(response:any):any {
 if(response?.success !== true) throw new Error(apiError(response?.error?.code))
 const data=response.data ?? {}
 if(data.success === false || data.has_fail === true) throw new Error('套件操作失败，请检查 NAS 套件中心（'+(data.error?.code ?? data.message ?? '未知原因')+'）')
 if(Array.isArray(data.result)) for(const result of data.result) packageResult(result)
 return data
}
export function newerPackage(candidate:string,current:string):boolean {
 if(!/^\d+(?:[.\-]\d+)*$/.test(candidate)||!/^\d+(?:[.\-]\d+)*$/.test(current))return false
 const a=candidate.split(/[.\-]/).map(BigInt),b=current.split(/[.\-]/).map(BigInt)
 for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]??0n,y=b[i]??0n;if(x!==y)return x>y}return false
}
export function installationBlock(info:any,check:any):string {
 const a=info.additional || info
 if(info.codesign_error) return 'SPK 签名校验未通过，请在 DSM 套件中心确认来源与信任设置'
 if(a.install_reboot === true) return '此套件安装要求重启，请在 DSM 套件中心完成'
 for(const k of ['break_pkgs','replace_pkgs','dependent_packages']) if(a[k] && Object.keys(a[k]).length) return '此套件涉及依赖或替换，请先在 DSM 套件中心处理'
 if(check.is_occupied === true) return 'NAS 正在处理其他套件，请稍后重试'
 if(check.wizard || info.install_pages || a.install_pages || info.install_uifile || a.install_uifile) return '此套件需要专用安装向导，请在 DSM 套件中心完成配置'
 return ''
}
