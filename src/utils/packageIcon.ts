/** Only NAS/catalog supplied raster icons; never invent a public package URL. */
export function packageIconSource(raw:any,baseUrl:string):string {
  const candidates=[raw.icon,raw.icon_256,raw.package_icon_256,raw.additional?.icon,raw.additional?.icon_256,raw.thumbnail]
  for(const value of candidates){
    if(typeof value!=='string'||!value.trim())continue
    try{
      const url=new URL(value,baseUrl+'/'),base=new URL(baseUrl)
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue
      if(url.origin!==base.origin&&url.protocol!=='https:')continue
      if([...url.searchParams.keys()].some(key=>/^(?:_sid|sid|token|synotoken|password)$/i.test(key)))continue
      return url.href
    }catch{}
  }
  return ''
}
