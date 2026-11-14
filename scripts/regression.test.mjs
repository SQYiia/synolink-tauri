import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function loadClient(fetch = async () => { throw new Error('Unexpected request') }, convertHeic, imageCache, captureVideoFrame) {
  const source = readFileSync(new URL('../src/api/dsm.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  const require = name => {
    if (name === '../utils/workloadManagement') {const exports={};new Function('exports',ts.transpileModule(readFileSync('src/utils/workloadManagement.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports);return exports}
    if (name === '../utils/errorHistory') return { recordError: async () => {} }
    if (name === '@tauri-apps/plugin-http') return { fetch }
    if (name === '@tauri-apps/api/core') return { invoke: async () => {} }
    if (name === '../utils/heic') return { convertHeic }
    if (name === '../utils/imageCache') return imageCache
    if (name === '../utils/videoFrame') return { captureVideoFrame }
    throw new Error(`Unexpected import ${name}`)
  }
  new Function('require', 'exports', js)(require, exports)
  return exports
}

test('album image descriptors use native authenticated HTTP, returning a correctly typed blob', async () => {
  const calls = []
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const api = loadClient(async (url, options) => {
    calls.push({ url: new URL(url), options })
    return new Response(png, { headers: { 'content-type': 'application/octet-stream' } })
  })
  api.dsm.baseUrl = 'https://nas:4748'
  api.dsm.account = 'alice'
  api.dsm.sid = 'session-for-test'
  api.dsm.allowInsecure = true
  const blob = await api.dsm.mediaImageBlob(api.dsm.mediaUrl('thumb', '/photo/中文 image.png'))
  assert.equal(calls[0].url.origin, 'https://nas:4748')
  assert.equal(calls[0].url.searchParams.get('_sid'), 'session-for-test')
  assert.equal(JSON.parse(calls[0].url.searchParams.get('path')), '/photo/中文 image.png')
  assert.equal(calls[0].options.danger.acceptInvalidCerts, true)
  assert.equal(blob.type, 'image/png')
  assert.equal(blob.size, png.byteLength)
})

test('HEIC thumbnail 404 falls back to original and local JPEG conversion', async () => {
  const calls = []
  const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0])
  const api = loadClient(async url => {
    const params = new URL(url).searchParams
    calls.push(params)
    if (params.get('api') === 'SYNO.FileStation.Thumb') return new Response('', { status: 404 })
    return new Response(heic)
  }, async (blob, dimension) => {
    assert.equal(blob.type, 'image/heic')
    assert.equal(dimension, 512)
    return new Blob(['converted'], { type: 'image/jpeg' })
  })
  const client = new api.DsmClient('https://nas')
  client.sid = 'test'
  client.apiInfo['SYNO.FileStation.Thumb'] = { path: 'entry.cgi', minVersion: 1, maxVersion: 3 }
  const path = '/photo/中文, "photo".HEIC'
  const result = await client.mediaImageBlob(client.mediaUrl('thumb', path))
  assert.equal(result.type, 'image/jpeg')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].get('version'), '2')
  assert.equal(JSON.parse(calls[0].get('path')), path)
  assert.deepEqual(JSON.parse(calls[1].get('path')), [path])
})

test('HEIC permission failures never trigger an original download', async () => {
  let requests = 0
  const api = loadClient(async () => { requests++; return new Response('{"success":false,"error":{"code":105}}') })
  const client = new api.DsmClient('https://nas')
  client.sid = 'test'
  await assert.rejects(client.mediaImageBlob(client.mediaUrl('thumb', '/photo/private.heic')), error => error.code === 105)
  assert.equal(requests, 1)
})

test('video thumbnail 404 captures an authenticated stream frame and caches it without downloading the movie', async () => {
  let requests = 0, captures = 0
  const entries = new Map()
  const cache = { imageCacheKey: (...parts) => JSON.stringify(parts), readImageCache: async key => entries.get(key), writeImageCache: async (key, blob) => { entries.set(key, blob) } }
  const api = loadClient(async url => {
    requests++
    assert.equal(new URL(url).searchParams.get('api'), 'SYNO.FileStation.Thumb')
    return new Response('', { status: 404 })
  }, undefined, cache, async source => {
    captures++
    const descriptor = new URL(source)
    assert.equal(descriptor.pathname, '/stream')
    assert.equal(descriptor.searchParams.get('path'), '/video/movie.mp4')
    assert.equal(descriptor.searchParams.get('scope'), client.mediaScope)
    return new Blob(['frame'], { type: 'image/jpeg' })
  })
  const client = new api.DsmClient('https://nas'); client.sid = 'test'
  const source = client.mediaUrl('thumb', '/video/movie.mp4', { revision: 'v1' })
  assert.equal((await client.mediaImageBlob(source)).type, 'image/jpeg')
  await client.mediaImageBlob(source)
  assert.equal(requests, 1); assert.equal(captures, 1)
})

test('slow NAS thumbnails fall back to frame capture instead of occupying the full image timeout', async () => {
  let captures = 0
  const api = loadClient(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }), undefined, undefined, async () => { captures++; return new Blob(['frame'], { type: 'image/jpeg' }) })
  const client = new api.DsmClient('https://nas'); client.sid = 'test'
  const blob = await client.mediaImageBlob(client.mediaUrl('thumb', '/video/movie.mp4'))
  assert.equal(blob.type, 'image/jpeg'); assert.equal(captures, 1)
})

test('cancelling a pending thumbnail does not start a video stream', async () => {
  let captures = 0
  const api = loadClient(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }), undefined, undefined, async () => { captures++; return new Blob() })
  const client = new api.DsmClient('https://nas'); client.sid = 'test'
  const controller = new AbortController()
  const pending = client.mediaImageBlob(client.mediaUrl('thumb', '/video/movie.mp4'), controller.signal)
  controller.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
  assert.equal(captures, 0)
})

test('HEIC cache skips download and decode across sessions but invalidates on file or account changes', async () => {
  const storage = new Map()
  const cache = {
    imageCacheKey: (...parts) => JSON.stringify(parts),
    readImageCache: async key => storage.get(key) || null,
    writeImageCache: async (key, blob) => { storage.set(key, blob) },
  }
  let requests = 0, conversions = 0
  const api = loadClient(async () => {
    requests++
    return new Response(new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')]))
  }, async () => { conversions++; return new Blob(['jpeg'], { type: 'image/jpeg' }) }, cache)
  const client = new api.DsmClient('https://nas')
  client.sid = 'one'; client.account = 'alice'
  const descriptor = (revision = 'v1') => client.mediaUrl('thumb', '/photo/a.heic', { revision })
  await client.mediaImageBlob(descriptor())
  client.sid = 'two'; client.mediaScope = 'new-session'
  await client.mediaImageBlob(descriptor())
  assert.equal(requests, 1)
  assert.equal(conversions, 1)
  await client.mediaImageBlob(descriptor('v2'))
  assert.equal(conversions, 2)
  client.account = 'bob'
  await client.mediaImageBlob(descriptor('v2'))
  assert.equal(conversions, 3)
})

test('native image loading retains original images larger than four megabytes', async () => {
  const bytes = new Uint8Array(5 * 1024 * 1024)
  bytes.set([255, 216, 255])
  const { DsmClient } = loadClient(async () => new Response(bytes))
  const client = new DsmClient('https://nas')
  client.sid = 'test'
  assert.equal((await client.imageBlob('image', '/photo/large.jpg')).size, bytes.length)
})

test('expired image requests recover their session once and retry with the new ID', async () => {
  const api = loadClient(async url => new URL(url).searchParams.get('_sid') === 'fresh'
    ? new Response(new Uint8Array([255, 216, 255]))
    : new Response('{"success":false,"error":{"code":119}}'))
  api.dsm.baseUrl = 'https://nas'
  api.dsm.sid = 'expired'
  let recoveries = 0
  api.setSessionRecoverer(async () => {
    recoveries++
    await new Promise(resolve => setTimeout(resolve, 10))
    api.dsm.sid = 'fresh'
    return true
  })
  const images = await Promise.all([api.dsm.imageBlob('thumb', '/a.jpg'), api.dsm.imageBlob('thumb', '/b.jpg')])
  assert.equal(recoveries, 1)
  assert.ok(images.every(blob => blob.type === 'image/jpeg'))
})

test('image permission errors are actionable and do not replay credentials', async () => {
  const api = loadClient(async () => new Response('{"success":false,"error":{"code":105}}'))
  api.dsm.baseUrl = 'https://nas'
  api.dsm.sid = 'test'
  let recoveries = 0
  api.setSessionRecoverer(async () => { recoveries++; return true })
  await assert.rejects(api.dsm.imageBlob('thumb', '/private.jpg'), error => error.code === 105 && error.message.includes('权限'))
  assert.equal(recoveries, 0)
})

test('re-requesting a failed thumbnail performs a fresh HTTP request', async () => {
  let requests = 0
  const { DsmClient } = loadClient(async () => ++requests === 1
    ? new Response('{"success":false,"error":{"code":801}}')
    : new Response(new Uint8Array([255, 216, 255])))
  const client = new DsmClient('https://nas')
  client.sid = 'test'
  await assert.rejects(client.imageBlob('thumb', '/photo.jpg'), /801/)
  assert.equal((await client.imageBlob('thumb', '/photo.jpg')).type, 'image/jpeg')
  assert.equal(requests, 2)
})

test('directory pagination returns all 1201 files', async () => {
  const { DsmClient } = loadClient()
  const client = new DsmClient('https://nas:5001')
  const files = Array.from({ length: 1201 }, (_, i) => ({ path: `/photos/${i}.jpg` }))
  const offsets = []
  client.listFiles = async (_path, { offset, limit }) => {
    offsets.push(offset)
    return { success: true, data: { files: files.slice(offset, offset + limit), total: files.length } }
  }
  const result = await client.listAll('/photos')
  assert.equal(result.data.files.length, 1201)
  assert.deepEqual(offsets, [0, 500, 1000])
})

test('page failures do not masquerade as a complete listing', async () => {
  const { DsmClient } = loadClient()
  const client = new DsmClient('https://nas')
  client.listFiles = async (_path, { offset }) => offset === 0
    ? { success: true, data: { total: 1000, files: Array.from({ length: 500 }, (_, i) => ({ path: `${i}` })) } }
    : { success: false, error: { code: 105 } }
  assert.equal((await client.listAll('/photos')).success, false)
})

test('search drains all pages and releases the NAS task', async () => {
  const { DsmClient } = loadClient()
  const client = new DsmClient('https://nas')
  let stopped = false
  client.searchStart = async () => ({ success: true, data: { taskid: 'search-1' } })
  client.searchStop = async id => { assert.equal(id, 'search-1'); stopped = true }
  client.searchList = async (_id, { offset = 0, limit }) => ({ success: true, data: {
    finished: true, files: Array.from({ length: Math.min(limit, 1300 - offset) }, (_, i) => ({ path: `${offset + i}` })),
  } })
  assert.equal((await client.searchAll('/', 'photo')).length, 1300)
  assert.equal(stopped, true)
})

test('cancelled search releases its NAS task', async () => {
  const { DsmClient } = loadClient()
  const client = new DsmClient('https://nas')
  let stopped = false
  client.searchStart = async () => { controller.abort();return { success: true, data: { taskid: 'search-2' } } }
  client.searchStop = async () => { stopped = true }
  const controller = new AbortController()
  await assert.rejects(client.searchAll('/', 'photo', controller.signal), /取消/)
  assert.equal(stopped, true)
})

test('uploads cannot overwrite without explicit opt-in and TLS is secure by default', async () => {
  const requests = []
  const { DsmClient } = loadClient(async (_url, options) => {
    requests.push(options)
    return new Response(JSON.stringify({ success: true }))
  })
  const client = new DsmClient('https://nas')
  const file = new File(['example'], 'example.txt')
  await client.upload('/docs', file)
  await client.upload('/docs', file, true)
  assert.equal(requests[0].body.get('overwrite'), 'false')
  assert.equal(requests[1].body.get('overwrite'), 'true')
  assert.equal(requests[0].danger.acceptInvalidCerts, false)
})

test('permission denial does not trigger credential replay', async () => {
  const api = loadClient(async () => new Response(JSON.stringify({ success: false, error: { code: 105 } })))
  let relogins = 0
  api.setSessionRecoverer(async () => { relogins++; return true })
  api.dsm.baseUrl = 'https://nas'
  const result = await api.dsm.entry('SYNO.FileStation.List', 'list')
  assert.equal(result.error.code, 105)
  assert.equal(relogins, 0)
})

test('concurrent expired requests share one login recovery', async () => {
  const api = loadClient(async url => new Response(JSON.stringify(
    new URL(url).searchParams.get('_sid') === 'fresh'
      ? { success: true, data: { files: [] } }
      : { success: false, error: { code: 119 } },
  )))
  api.dsm.baseUrl = 'https://nas'
  api.dsm.sid = 'expired'
  let relogins = 0
  api.setSessionRecoverer(async () => {
    relogins++
    await new Promise(resolve => setTimeout(resolve, 10))
    api.dsm.sid = 'fresh'
    return true
  })
  const results = await Promise.all([api.dsm.listFiles('/a'), api.dsm.listFiles('/b')])
  assert.ok(results.every(result => result.success))
  assert.equal(relogins, 1)
})

test('late responses from a previous NAS are discarded', async () => {
  let respond
  const api = loadClient(() => new Promise(resolve => { respond = resolve }))
  const client = new api.DsmClient('https://first-nas')
  const request = client.listFiles('/docs')
  client.baseUrl = 'https://second-nas'
  respond(new Response(JSON.stringify({ success: true, data: { files: [] } })))
  await assert.rejects(request, /连接已切换/)
})

test('logout uses each session ID and clears the local identity', async () => {
  const requests = []
  const api = loadClient(async url => { requests.push(new URL(url).searchParams); return new Response('{"success":true}') })
  const client = new api.DsmClient('https://nas')
  client.sid = 'file-session'
  client.dsSid = 'download-session'
  client.account = 'alice'
  await client.logout()
  assert.equal(requests[0].get('_sid'), 'download-session')
  assert.equal(requests[1].get('_sid'), 'file-session')
  assert.equal(client.sid, '')
  assert.equal(client.account, '')
})

test('HTML proxy error is reported instead of returning a fake API response', async () => {
  const { DsmClient } = loadClient(async () => new Response('<html>Bad gateway</html>', { status: 502 }))
  await assert.rejects(new DsmClient('https://nas').loadApiInfo())
})

function loadStore(accounts, invoke) {
  const persisted = new Map([['accounts', structuredClone(accounts)]])
  class LazyStore {
    async get(key) { return structuredClone(persisted.get(key)) }
    async set(key, value) { persisted.set(key, structuredClone(value)) }
    async save() {}
  }
  const exports = {}
  const source = readFileSync(new URL('../src/stores/app.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', js)(name => {
    if (name === '@tauri-apps/api/core') return { invoke }
    if (name === '@tauri-apps/plugin-store') return { LazyStore }
    if (name === 'pinia') return { defineStore: (_name, options) => () => Object.assign(options.state(), options.actions) }
    throw new Error(name)
  }, exports)
  return { store: exports.useAppStore(), persisted }
}

test('legacy plaintext password migrates to the OS vault and disappears from JSON', async () => {
  const calls = []
  const { store, persisted } = loadStore([{ id: 'account-1', serverId: 'nas-1', account: 'alice', password: 'test-password' }], async (command, args) => { calls.push({ command, args }) })
  await store.load()
  assert.equal(calls[0].command, 'save_password')
  assert.equal(calls[0].args.password, 'test-password')
  assert.equal(store.accounts[0].password, 'test-password')
  assert.equal(persisted.get('accounts')[0].rememberPassword, true)
  assert.equal('password' in persisted.get('accounts')[0], false)
})

test('vault failure never falls back to persisting a plaintext password', async () => {
  const { store, persisted } = loadStore([{ id: 'account-1', password: 'test-password' }], async () => { throw new Error('vault unavailable') })
  await store.load()
  assert.equal(persisted.get('accounts')[0].rememberPassword, false)
  assert.equal('password' in persisted.get('accounts')[0], false)
})

test('forgetting credentials removes the vault entry and in-memory password', async () => {
  const calls = []
  const { store, persisted } = loadStore([{ id: 'account-1', rememberPassword: true }], async (command) => {
    calls.push(command)
    return command === 'read_password' ? 'test-password' : undefined
  })
  await store.load()
  await store.forgetPasswords()
  assert.ok(calls.includes('delete_password'))
  assert.equal(store.accounts[0].password, '')
  assert.equal(persisted.get('accounts')[0].rememberPassword, false)
})

test('file names with commas are encoded as separate JSON paths', async () => {
  const { DsmClient } = loadClient()
  const client = new DsmClient('https://nas')
  const calls = []
  client.entry = async (_api, _method, options) => { calls.push(options.params); return { success: true } }
  await client.deletePath(['/docs/a,b.txt', '/docs/c.txt'])
  await client.copyMove(['/docs/a,b.txt'], '/backup')
  assert.deepEqual(JSON.parse(calls[0].path), ['/docs/a,b.txt', '/docs/c.txt'])
  assert.deepEqual(JSON.parse(calls[1].path), ['/docs/a,b.txt'])
})

test('VMM settings target guest ID and preserve zero autorun and empty description', async () => {
 const {DsmClient}=loadClient(); const client=new DsmClient('https://nas');let request;
 client.entry=async (...args)=>{request=args;return {success:true}};
 await client.vmmGuestSet('vm1',{new_guest_name:'测试 VM',description:'',autorun:0,vcpu_num:2,vram_size:2048});
 assert.equal(request[0],'SYNO.Virtualization.API.Guest');assert.equal(request[1],'set');
 assert.deepEqual(request[2].params,{guest_id:'vm1',new_guest_name:'测试 VM',description:'',autorun:0,vcpu_num:2,vram_size:2048});
})

test('package, container and download settings requests preserve identifiers and write scopes', async()=>{
 const {DsmClient}=loadClient();const client=new DsmClient('https://nas');const requests=[];client.entry=async(...args)=>{requests.push(args);return {success:true}};
 await client.packageList();assert.ok(['status','description','startable','available_operation'].every(x=>JSON.parse(requests.at(-1)[2].params.additional).includes(x)));
 await client.containerAction('a,b','restart');assert.equal(requests.at(-1)[2].params.name,'a,b');assert.equal(requests.at(-1)[2].post,true);
 await assert.rejects(()=>client.containerAction('a','delete'),/无效/);
 await client.containerLogs('a');assert.equal(requests.at(-1)[2].params.limit,200);
 await client.dsSetConfig({bt_max_download:0});assert.deepEqual(requests.at(-1)[2].params,{bt_max_download:0});
 await assert.rejects(()=>client.dsSetConfig({unknown:1}),/不支持/);
})

test('Drive uses its own session while backup uses the primary session',async()=>{
 const calls=[];const {DsmClient}=loadClient(async(url)=>{calls.push(new URL(url));return new Response(JSON.stringify({success:true,data:{}}))});const client=new DsmClient('https://nas');client.sid='main';client.driveSid='drive';
 await client.driveFiles('id:987654321012345678',100);assert.equal(calls[0].searchParams.get('_sid'),'drive');assert.equal(calls[0].searchParams.get('path'),'id:987654321012345678');assert.equal(calls[0].searchParams.get('offset'),'100');assert.equal(calls[0].searchParams.get('version'),'2');
 client.apiInfo={'SYNO.Backup.Task':{path:'entry.cgi',minVersion:1,maxVersion:1},'SYNO.ActiveBackup.Task':{path:'entry.cgi',minVersion:1,maxVersion:1}};
 await client.hyperBackupTasks();assert.equal(calls[1].searchParams.get('_sid'),'main');assert.equal(calls[1].searchParams.get('method'),'list');
 await client.activeBackupTasks();assert.equal(calls[2].searchParams.get('load_devices'),'false');
})

test('package management uses verified DSM fields, checks signatures and preserves feed identity',async()=>{
 const {DsmClient}=loadClient();const c=new DsmClient('https://nas');const calls=[];c.entry=async(api,method,options)=>{calls.push({api,method,...options});return {success:true,data:{}}}
 await c.packageControl('DownloadStation','stop');await c.packageFeasibility('DownloadStation','stop')
 assert.equal(calls[0].api,'SYNO.Core.Package.Control');assert.equal(calls[0].params.id,'DownloadStation');assert.equal(calls[0].post,true)
 assert.equal(calls[1].params.packages,'["DownloadStation"]');assert.equal(calls[1].params.type,'stop_check')
 await c.packageFeedSave('社区','https://packages.example.com','https://old.example.com');assert.deepEqual(JSON.parse(calls.at(-1).params.list),{name:'社区',feed:'https://packages.example.com',orifeed:'https://old.example.com'})
 await c.packageFeedDelete('https://old.example.com');assert.deepEqual(JSON.parse(calls.at(-1).params.list),['https://old.example.com'])
 await assert.rejects(c.packageFeedSave('bad','file:///etc/passwd'));await assert.rejects(c.packageControl('x','delete'))
 await c.packageInstall({id:'demo',filename:'/volume1/@tmp/demo'},'/volume1','download1',false);assert.equal(calls.at(-1).params.force,false);assert.equal(calls.at(-1).params.check_codesign,true);assert.equal(calls.at(-1).params.path,'/volume1/@tmp/demo')
 await c.packageInstall({id:'demo'},'/volume1','upload1',false);assert.equal(calls.at(-1).params.task_id,'upload1')
 await c.packageInstall({id:'demo'},'','upload2',true);assert.equal(calls.at(-1).method,'upgrade')
 await assert.rejects(c.packageDownload({id:'demo',link:'https://packages.example.com/demo',size:100,md5:''}))
})

test('Hyper Backup writes never automatically replay after session failure',async()=>{
 let calls=0,recoveries=0;const api=loadClient(async()=>{calls++;return new Response(JSON.stringify({success:false,error:{code:119}}))});api.dsm.baseUrl='https://nas';api.dsm.sid='old-session';api.dsm.apiInfo={'SYNO.Backup.Task':{path:'entry.cgi',minVersion:1,maxVersion:1}};api.setSessionRecoverer(async()=>{recoveries++;return true});
 const result=await api.dsm.hyperBackupRequest('SYNO.Backup.Task','backup',{task_id:'123'},true);assert.equal(result.success,false);assert.equal(calls,1);assert.equal(recoveries,0);
})
