import { fetch } from '@tauri-apps/plugin-http'
import { imageCacheKey, readImageCache, writeImageCache } from '../utils/imageCache'
import { jellyfinBase } from '../utils/filmMetadata'
export class JellyfinClient {
 base: string
 token = ''
 userId = ''
 constructor(base: string) { this.base = jellyfinBase(base) }
 async request(path: string, query: Record<string, string> = {}, body?: any) {
  const url = new URL(this.base + path)
  Object.entries(query).forEach(([k,v]) => url.searchParams.set(k,v))
  const response = await fetch(url.href, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'MediaBrowser Client="SynoLink", Device="Desktop", DeviceId="synolink-desktop", Version="0.1.13"' + (this.token ? ', Token="' + this.token.replace(/["\\]/g, '') + '"' : '') }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(response.status === 401 ? 'Jellyfin 登录已失效，请重新连接' : 'Jellyfin 请求失败（HTTP ' + response.status + '）')
  return response.json()
 }
 async login(username: string, password: string) {
  const data = await this.request('/Users/AuthenticateByName', {}, { Username: username, Pw: password })
  if (!data.AccessToken || !data.User?.Id) throw new Error('登录响应缺少凭据')
  this.token = data.AccessToken; this.userId = data.User.Id
 }
 list(start = 0, search = '', parent = '') {
  return this.request('/Items', { UserId: this.userId, StartIndex: String(start), Limit: '60', Fields: 'Overview,Genres,People', SortBy: parent ? 'SortName' : 'DateCreated', SortOrder: parent ? 'Ascending' : 'Descending', ...(parent ? { ParentId: parent } : { Recursive: 'true', IncludeItemTypes: 'Movie,Series' }), ...(search ? { SearchTerm: search } : {}) })
 }
 detail(id: string) { return this.request('/Users/' + encodeURIComponent(this.userId) + '/Items/' + encodeURIComponent(id)) }
 async poster(id: string, tag: string) {
  const key = imageCacheKey(this.base, this.userId, 'jellyfin:' + id, tag, 'poster-400')
  const cached = await Promise.race([readImageCache(key), new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))])
  if(cached) return cached
  const url = new URL(this.base + '/Items/' + encodeURIComponent(id) + '/Images/Primary')
  url.searchParams.set('format', 'jpg'); url.searchParams.set('maxWidth', '400'); url.searchParams.set('quality', '85'); url.searchParams.set('tag', tag)
  const response = await fetch(url.href, { headers: { Authorization: 'MediaBrowser Token="' + this.token.replace(/["\\]/g, '') + '"' }, signal: AbortSignal.timeout(15000) })
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('海报加载失败')
  const blob = await response.blob()
  void writeImageCache(key, blob)
  return blob
 }
}
