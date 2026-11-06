export function jellyfinBase(value: string): string {
 const url = new URL(value.trim())
 if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入有效的 HTTP/HTTPS 服务地址')
 return url.href.replace(/\/+$/, '')
}
export function sidecarCandidates(path: string, files: any[]) {
 const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase()
 const find = (names: string[]) => names.map(n => files.find(f => !f.isdir && String(f.name).toLowerCase() === n)).find(Boolean)
 const single = files.filter(f => !f.isdir && /\.(mp4|webm|mov|mkv|avi|ts|m4v|mpg|mpeg|wmv|flv|3gp)$/i.test(f.name)).length === 1
 return { nfo: find([stem + '.nfo', ...(single ? ['movie.nfo'] : [])]), poster: find([stem + '-poster.jpg', stem + '-poster.png', stem + '.jpg', stem + '.png', 'poster.jpg', 'poster.png', 'folder.jpg']) }
}
export function parseNfo(text: string) {
 if (text.length > 2097152 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('NFO 内容不受支持')
 const doc = new DOMParser().parseFromString(text, 'application/xml')
 if (doc.querySelector('parsererror') || !['movie', 'tvshow', 'episodedetails'].includes(doc.documentElement.tagName)) throw new Error('NFO 格式无效')
 const get = (name: string) => Array.from(doc.documentElement.children).find(n => n.tagName === name)?.textContent?.trim() || ''
 return { title: get('title'), year: get('year'), plot: get('plot'), rating: get('rating') || doc.querySelector('rating > value')?.textContent || '', genres: Array.from(doc.querySelectorAll('genre')).map(n => n.textContent || ''), actors: Array.from(doc.querySelectorAll('actor > name')).map(n => n.textContent || '') }
}
