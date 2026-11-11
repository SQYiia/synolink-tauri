export interface DiagnosticResult { name: string; status: 'ok' | 'warning' | 'error'; detail: string; elapsed: number }
export async function runDiagnostics(client: any, cancelled: () => boolean = () => false, progress: (rows: DiagnosticResult[]) => void = () => {}): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = []
  results.push({ name: '连接安全', status: client.allowInsecure || !client.baseUrl.startsWith('https:') ? 'warning' : 'ok', detail: client.allowInsecure ? '当前允许无效证书；未验证证书可信性' : client.baseUrl.startsWith('https:') ? '已启用 HTTPS 证书校验，连通性将在下方检查' : '当前使用 HTTP', elapsed: 0 })
  if (!client.sid) return [...results, { name: '登录状态', status: 'error', detail: '请先登录 NAS', elapsed: 0 }]
  const checks: Array<[string, () => Promise<any>]> = [
    ['接口发现', async () => { await client.loadApiInfo(); return {success: Object.keys(client.apiInfo).length > 0} }],
    ['文件访问', () => client.listShare({limit:1})],
    ['性能数据', () => client.systemUtilization()],
    ['存储卷', () => client.storageInfo()],
  ]
  for (const [name, request] of checks) {
    if (cancelled()) break
    const start = Date.now()
    try {
      const response = await request()
      if(cancelled()) break
      const code = Number(response?.error?.code)
      results.push({name, status: response?.success ? 'ok' : 'error', detail: response?.success ? '接口响应正常' : code === 105 ? '账号权限不足' : [106,107,119].includes(code) ? '登录会话失效' : [102,103,104].includes(code) ? '接口不可用或版本不兼容' : '接口返回失败' + (Number.isFinite(code) ? '（code=' + code + '）' : ''), elapsed: Date.now()-start})
      if(response?.success && name==='存储卷' && (!Array.isArray(response.data?.volumes) || response.data.volumes.some((v:any)=>!validCapacity(v)))) results[results.length-1]={name,status:'warning',detail:'接口响应成功，但容量数据不完整',elapsed:Date.now()-start}
      if(response?.success && name==='性能数据' && (!response.data?.cpu || !response.data?.memory)) results[results.length-1]={name,status:'warning',detail:'接口响应成功，但性能数据不完整',elapsed:Date.now()-start}
    } catch {
      if(cancelled()) break
      // Never retain exception messages: network errors can include URLs and session tokens.
      results.push({name,status:'error',detail:'请求失败，请检查网络、地址、证书或反向代理',elapsed:Date.now()-start})
    }
    progress([...results])
  }
  return results
}
export function diagnosticReport(version: string, results: DiagnosticResult[], errors: unknown[] = [], platform = 'unknown') {
  return JSON.stringify({version,platform,errors,createdAt:new Date().toISOString(),checks:results.map(({name,status,detail,elapsed})=>({name,status,detail,elapsed}))},null,2)
}

function validCapacity(v:any){const total=v?.size_total_byte??v?.size_total??v?.size?.total,free=v?.size_free_byte??v?.size_free_user??v?.size?.free;return [total,free].every(n=>(typeof n==='string'&&n.trim()!==''||typeof n==='number')&&Number.isFinite(Number(n))&&Number(n)>=0)&&Number(free)<=Number(total)}
