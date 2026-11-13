export interface SearchClient { listAll:()=>Promise<any>;searchAll:(path:string,pattern:string,signal?:AbortSignal)=>Promise<any[]> }
export async function searchSharedFolders(client:SearchClient,pattern:string,signal:AbortSignal,isCurrent=()=>true){
 const check=()=>{if(signal.aborted||!isCurrent())throw new Error('搜索已取消')}
 check();const listing=await client.listAll();check()
 if(!listing.success||!Array.isArray(listing.data?.shares))throw new Error('无法读取共享文件夹，请检查账号权限')
 const shares=[...new Set<string>(listing.data.shares.map((s:any)=>s.path).filter((path:any)=>typeof path==='string'&&/^\/[^/]+$/.test(path)&&!['/.','/..'].includes(path)))]
 const results:any[]=[],seen=new Set<string>();let cursor=0,failed=0
 async function worker(){while(cursor<shares.length){check();const path=shares[cursor++]!;try{const rows=await client.searchAll(path,pattern,signal);check();for(const row of rows){if(typeof row?.path==='string'&&row.path.startsWith(path+'/')&&!seen.has(row.path)){seen.add(row.path);results.push(row)}}}catch(e){check();failed++}}}
 await Promise.all([worker(),worker()]);check()
 return {files:results,failed,shares:shares.length}
}
