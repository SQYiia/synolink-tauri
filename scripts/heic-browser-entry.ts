import Vant from 'vant'
import 'vant/lib/index.css'
export { convertHeic } from '../src/utils/heic'
export { imageCacheKey, readImageCache, writeImageCache } from '../src/utils/imageCache'
export { captureVideoFrame } from '../src/utils/videoFrame'
import Videos from '../src/views/Videos.vue'
import Album from '../src/views/Album.vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createApp, h, ref } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { Close, Download, Delete, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import PhotoViewer from '../src/components/PhotoViewer.vue'
import { dsm } from '../src/api/dsm'
import '../src/styles/base.css'
import '../src/styles/polish.css'
import { createPinia } from 'pinia'
import { useAppStore } from '../src/stores/app'
import AppShell from '../src/layouts/AppShell.vue'
import Dashboard from '../src/views/Dashboard.vue'
import Files from '../src/views/Files.vue'
import Monitor from '../src/views/Monitor.vue'
import Vmm from '../src/views/Vmm.vue'
import Applications from '../src/views/Applications.vue'
import Drive from '../src/views/Drive.vue'
import Backups from '../src/views/Backups.vue'
import Containers from '../src/views/Containers.vue'
import Downloads from '../src/views/Downloads.vue'
import * as icons from '@element-plus/icons-vue'
import { enqueueImage } from '../src/utils/imageQueue'
import LazyThumb from '../src/components/LazyThumb.vue'

export function showCachedCoverUnderLoad() {
  const releases: Array<() => void> = []
  for (let i = 0; i < 6; i++) enqueueImage(done => { releases.push(done) })
  dsm.baseUrl = 'https://nas'; dsm.account = 'alice'; dsm.sid = 'fixture'
  const source = `dsm://localhost/thumb?path=${encodeURIComponent('/photo/a.heic')}&revision=v1&scope=${dsm.mediaScope}`
  const root = document.createElement('div'); root.id = 'cached-under-load'; document.body.append(root)
  const app = createApp({ render: () => h(LazyThumb, { src: source, eager: true }) }); app.mount(root)
  return () => { for (const done of releases) done(); app.unmount(); root.remove() }
}

export async function showWorkspace() {
  dsm.sid = 'fixture'; dsm.baseUrl = 'https://nas'; dsm.account = 'alice'
  let mediaCount = 1
  localStorage.setItem('album:folder:https://nas:alice','/photos')
  localStorage.setItem('video:folder:https://nas:alice','/videos')
  const scanAttempts = new Map<string,number>()
  dsm.searchStart = async path => {const attempt=(scanAttempts.get(path)||0)+1;scanAttempts.set(path,attempt);return {success:true,data:{taskid:path+'|'+attempt}}}
  dsm.searchList = async (id,options) => ({success:true,data:{finished:true,files:options?.offset || id.endsWith('|1') ? [] : Array.from({length:mediaCount},(_,i)=>({name:'Media '+i+(id.startsWith('/photos|')?'.jpg':'.mp4'),path:id.split('|')[0]+'/'+i+(id.startsWith('/photos|')?'.jpg':'.mp4'),additional:{size:1000,time:{mtime:1700000000,crtime:1700000000}}}))}})
  dsm.searchStop = async () => ({success:true})
  dsm.mediaImageBlob = async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#6a8c9a"/></svg>'],{type:'image/svg+xml'})
  const info = {path:'entry.cgi',minVersion:1,maxVersion:1}
  dsm.loadApiInfo = async () => { dsm.apiInfo = Object.fromEntries(['SYNO.SynologyDrive.Files','SYNO.SynologyDrive.TeamFolders','SYNO.Backup.Task','SYNO.ActiveBackup.Task','SYNO.Core.Package','SYNO.Core.Package.Control','SYNO.Core.Package.Server','SYNO.Core.Package.Installation','SYNO.Core.Package.Feed','SYNO.Core.Package.Setting','SYNO.Core.Package.Uninstallation','SYNO.Docker.Container','SYNO.Docker.Container.Resource','SYNO.DownloadStation.Task'].map(key => [key,info]));return dsm.apiInfo }

  const packageRows:any[]=[{id:'ContainerManager',name:'Container Manager',version:'24.0',additional:{status:'running',startable:true,description:'管理 NAS 上的容器服务'}},{id:'DownloadStation',name:'Download Station',version:'4.0',additional:{status:'running',startable:true}},{id:'HyperBackup',name:'Hyper Backup',version:'4.1',additional:{status:'running',startable:true}}]
  dsm.packageList=async()=>({success:true,data:{packages:packageRows}})
  dsm.packageFeasibility=async()=>({success:true,data:{}})
  dsm.packageControl=async(id,action)=>{packageRows.find(p=>p.id===id).additional.status=action==='start'?'running':'stop';return {success:true}}
  dsm.packageCatalog=async()=>({success:true,data:{packages:[{id:'DownloadStation',name:'Download Station',version:'4.1',link:'https://example.com/ds.spk',md5:'abc',size:1234},{id:'Demo',name:'演示套件',version:'1.0',link:'https://example.com/demo.spk',md5:'abc',size:1234}]}})
  let selectedPackage=''
  dsm.packageDownload=async p=>{selectedPackage=p.id;return {success:true,data:{taskid:'task'}}}
  dsm.packageDownloadStatus=async()=>({success:true,data:{finished:true,progress:1}})
  dsm.packageDownloadedInfo=async()=>({success:true,data:{id:selectedPackage,name:selectedPackage,version:selectedPackage==='Demo'?'1.0':'4.1',filename:'/volume1/@tmp/demo'}})
  dsm.packageCheck=async()=>({success:true,data:{volume_path:'/volume1',volume_list:[{mount_point:'/volume1',display:'存储卷 1'}]}})
  dsm.packageInstall=async info=>{const found=packageRows.find(p=>p.id===info.id);if(found)found.version=info.version;else packageRows.push({...info,additional:{status:'running',startable:true}});return {success:true,data:{}}}
  const feedRows:any[]=[]
  dsm.packageFeeds=async()=>({success:true,data:{items:feedRows}})
  dsm.packageFeedSave=async(name,feed,original)=>{const found=feedRows.find(f=>f.feed===original);if(found)Object.assign(found,{name,feed});else feedRows.push({name,feed});return {success:true}}
  dsm.packageFeedDelete=async feed=>{feedRows.splice(feedRows.findIndex(f=>f.feed===feed),1);return {success:true}}
  dsm.packageSettings=async()=>({success:true,data:{enable_autoupdate:true,autoupdateall:false,autoupdateimportant:true}})
  dsm.packageAutoUpdate=async()=>({success:true})

  dsm.driveFiles = async (path,offset=0) => ({success:true,data:{items:offset ? [{file_id:'99',name:'Last file.txt',type:'file',size:8}] : path==='/mydrive' ? [{file_id:'987654321012345678',name:'Projects',type:'dir'}] : [{file_id:'doc1',name:'Report.pdf',type:'file',size:2048,modified_time:1700000000}],total:path==='/mydrive'?101:1}})
  dsm.driveTeamFolders = async () => ({success:true,data:{items:[{file_id:'team1',name:'Design Team'}],total:1}})
  dsm.hyperBackupTasks = async () => ({success:true,data:{task_list:[{task_id:'hb1',name:'Nightly NAS backup',last_bkp_result:'fail',last_bkp_time:'2026/11/01 02:00'}]}})
  dsm.hyperBackupStatus = async () => ({success:true,data:{last_bkp_result:'fail',last_bkp_error:'Destination offline',last_bkp_time:'2026/11/01 02:00'}})
  dsm.activeBackupTasks = async () => ({success:false,error:{code:105}})
  const containers = [{id:'c1',name:'nginx-demo',image:'nginx:alpine',status:'stopped'},{id:'c2',name:'redis-demo',image:'redis:7',status:'running'}]
  dsm.containerList = async () => ({success:true,data:{containers}})
  dsm.containerResources = async () => ({success:true,data:{resources:[{name:'redis-demo',cpu:0.8,memory:12000000}]}})
  dsm.containerAction = async (name,action) => { const item=containers.find(c=>c.name===name);if(!item)throw Error('wrong container');item.status=action==='stop'?'stopped':'running';return {success:true} }
  dsm.containerLogs = async () => ({success:true,data:{logs:[{created:'2026-11-01',stream:'stdout',text:'Server ready <script>not executed</script>'}],total:1}})
  let settings = {bt_max_download:50,bt_max_upload:0,http_max_download:0,ftp_max_download:0,default_destination:'Downloads'}
  dsm.dsConfig = async () => ({success:true,data:settings})
  dsm.dsSetConfig = async values => {Object.assign(settings,values);return {success:true}}
  const guest = { guest_id: 'vm1', guest_name: 'Ubuntu Server', status: 'shutdown', vcpu_num: 2, vram_size: 2048, autorun: 0, description: 'Development', vdisks: [{vdisk_id:'d1',vdisk_size:40960}], vnics:[{vnic_id:'n1',network_name:'Default VM Network',mac:'02:00:00:00:00:01'}] }
  dsm.vmmGuestList = async () => ({ success:true, data:{guests:[guest]} })
  dsm.vmmHostList = async () => ({ success:true, data:{hosts:[]} })
  dsm.vmmStorageList = async () => ({ success:true, data:{storages:[]} })
  dsm.vmmGuestSet = async (id, settings) => { if(id !== 'vm1') throw Error('wrong VM'); Object.assign(guest, settings, {guest_name: settings.new_guest_name || guest.guest_name}); return {success:true} }
  dsm.dsInfo = async () => ({ success: true, data: {} } as any)
  dsm.dsTaskList = async () => ({ success: true, data: { tasks: [{ id: 'fixture-task', title: 'Ubuntu.torrent', type: 'bt', status: 'downloading', size: 100000, additional: { transfer: { speed_download: 0 }, detail: { connected_seeders: 0, connected_leechers: 0, destination: 'downloads' } } }] } } as any)
  dsm.dsStatistic = async () => ({ success: true, data: { speed_download: 0, speed_upload: 0 } } as any)
  dsm.systemUtilization = async () => ({ success: true, data: { memory: {total_real:4194304,memory_size:8388608,avail_real:262144,cached:2800000,buffer:100000,real_usage:25} } })
  dsm.entry = async () => ({ success: true, data: {} })
  dsm.listAll = async () => ({ success: true, data: { shares: ['Documents', 'Photos', 'Videos', 'Backup'].map(name => ({ name, path: '/' + name, isdir: true, additional: { time: { mtime: 1700000000 } } })) } })
  const root = document.createElement('div'); document.body.append(root)
  const pinia = createPinia(), app = createApp(AppShell)
  app.use(pinia); app.use(ElementPlus); app.use(Vant)
  for (const [name, icon] of Object.entries(icons)) app.component(name, icon)
  const store = useAppStore(pinia)
  store.load = async () => {}
  store.accounts = [{ id: 'fixture', account: 'alice', serverId: 'fixture', rememberPassword: false }]
  store.currentAccountId = 'fixture'
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/app/album', component: Album }, { path: '/app/videos', component: Videos }, { path: '/app/drive', component: Drive }, { path: '/app/backups', component: Backups }, { path: '/app/applications', component: Applications }, { path: '/app/containers', component: Containers }, { path: '/app/dashboard', component: Dashboard }, { path: '/app/files', component: Files }, { path: '/app/vmm', component: Vmm }, { path: '/app/monitor', component: Monitor }, { path: '/app/downloads', component: Downloads },
  ] })
  app.use(router); await router.push('/app/dashboard'); await router.isReady(); app.mount(root)
  return { renewMediaSession: () => { mediaCount++; dsm.sid = 'renewed-fixture' }, addMedia: () => { mediaCount++ }, navigate: (path: string) => router.push(path), close: () => { app.unmount(); root.remove() } }
}

export function showViewer(blob: Blob) {
  // Use the real viewer with a local public fixture; no NAS credentials required.
  dsm.mediaImageBlob = async () => blob
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ setup() {
    const open = ref(true), index = ref(0)
    return () => h(PhotoViewer, {
      modelValue: open.value, 'onUpdate:modelValue': (value: boolean) => { open.value = value },
      src: 'fixture', name: 'Autumn afternoon.HEIC', index: index.value, total: 3993,
      size: '1.6 MB', date: '2026/10/27 22:05:35',
      onNext: () => { index.value++ }, onPrev: () => { index.value-- },
    })
  } })
  app.use(ElementPlus)
  for (const [name, icon] of Object.entries({ Close, Download, Delete, ArrowLeft, ArrowRight })) app.component(name, icon)
  app.mount(root)
}

export async function makeVideoFixture(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 640; canvas.height = 360
  const context = canvas.getContext('2d')!
  const stream = canvas.captureStream(15)
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
  const chunks: Blob[] = []
  recorder.ondataavailable = e => { chunks.push(e.data) }
  const stopped = new Promise<Blob>(resolve => { recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })) })
  recorder.start()
  let frame = 0
  const timer = setInterval(() => {
    context.fillStyle = '#263950'; context.fillRect(0, 0, 640, 360)
    context.fillStyle = '#70bdca'; context.fillRect(40 + frame++ * 4, 80, 150, 150)
    context.fillStyle = '#fff'; context.font = '24px sans-serif'; context.fillText('A quiet afternoon', 40, 300)
  }, 65)
  await new Promise(resolve => setTimeout(resolve, 1400))
  recorder.stop(); clearInterval(timer); stream.getTracks().forEach(track => track.stop())
  return stopped
}

export function showVideoLibrary(source: string, cover: Blob) {
  dsm.baseUrl = 'https://fixture'; dsm.account = 'fixture'; dsm.sid = 'fixture'
  dsm.mediaImageBlob = async descriptor => {
    if (descriptor.includes('Ocean')) throw new Error('Fixture without cover')
    return cover
  }
  dsm.mediaUrl = (kind, path) => kind === 'stream' ? source : `fixture://thumb?path=${encodeURIComponent(path)}`
  dsm.searchStart = async () => ({ success: true, data: { taskid: 'fixture' } })
  dsm.searchList = async (_id, options) => ({ success: true, data: { finished: true, files: options?.offset ? [] : ['A quiet afternoon.webm', 'Weekend escape.mp4', 'City lights.mov', 'Ocean memories.mp4'].map((name, i) => ({ name, path: '/video/' + name, additional: { size: 12000000 + i * 4000000, time: { mtime: 1, crtime: 1 } } })) } })
  dsm.searchStop = async () => ({ success: true })
  dsm.listAll = async () => ({success:true,data:{files:[{name:'A quiet afternoon.nfo',path:'/video/A quiet afternoon.nfo'},{name:'A quiet afternoon-poster.jpg',path:'/video/A quiet afternoon-poster.jpg'}]}})
  dsm.readSidecar = async () => new TextEncoder().encode('<movie><title>静谧午后</title><year>2024</year><plot>一个悠闲的下午。</plot><genre>生活</genre></movie>').buffer
  localStorage.setItem('video:folder:https://fixture:fixture', '/video')
  const root = document.createElement('div'); document.body.append(root)
  document.body.style.cssText = 'margin:0;font-family:Segoe UI,sans-serif;background:#f7f8fa'
  const app = createApp(Videos)
  app.use(ElementPlus)
  app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] }))
  app.mount(root)
}

export { parseNfo } from '../src/utils/filmMetadata'
import JellyfinLibrary from '../src/components/JellyfinLibrary.vue'
import { JellyfinClient } from '../src/api/jellyfin'
export function showJellyfinTest() {
 const movie = {Id:'movie1',Name:'星海旅人',Type:'Movie',ProductionYear:2024,CommunityRating:8.6,ImageTags:{Primary:'v1'},Genres:['科幻','冒险'],Overview:'一封来自遥远星球的信，带来一次穿越星海的旅行。',People:[{Name:'陈星'}],RunTimeTicks:72000000000}
 const series = {...movie,Id:'series1',Name:'山海之间',Type:'Series'}
 const original = JellyfinClient.prototype.request, poster = JellyfinClient.prototype.poster
 JellyfinClient.prototype.request = async function(path,query,body) {
  if(body) return {AccessToken:'fixture-token',User:{Id:'fixture-user'}}
  if(path.endsWith('/Items/movie1')) return movie
  if(path.endsWith('/Items/series1')) return series
  if(query?.ParentId) return {Items:[{...movie,Id:'episode1',Name:'第一集 · 启程',Type:'Episode'}],TotalRecordCount:1}
  if(query?.SearchTerm) return {Items:[movie],TotalRecordCount:1}
  return {Items:[movie,series,...Array.from({length:6},(_,i)=>({...movie,Id:'movie'+(i+2),Name:['北方来信','岛屿时光','城市漫游','深蓝','最后一班列车','春日回声'][i]}))],TotalRecordCount:8}
 }
 JellyfinClient.prototype.poster = async function(id) { const canvas=document.createElement('canvas');canvas.width=300;canvas.height=450;const ctx=canvas.getContext('2d')!;const g=ctx.createLinearGradient(0,0,300,450);g.addColorStop(0,id==='series1'?'#315e5d':'#243854');g.addColorStop(1,'#111722');ctx.fillStyle=g;ctx.fillRect(0,0,300,450);ctx.fillStyle='#d0b180';ctx.beginPath();ctx.arc(150,150,65,0,Math.PI*2);ctx.fill();ctx.fillStyle='white';ctx.font='22px sans-serif';ctx.fillText(id==='series1'?'山海之间':'星海旅人',95,330);return new Promise(resolve=>canvas.toBlob(b=>resolve(b!),'image/jpeg')) }
 const secrets=new Map<string,string>();const old=(window as any).__TAURI_INTERNALS__
 ;(window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{if(cmd==='save_password')secrets.set(args.accountId,args.password);if(cmd==='read_password')return secrets.get(args.accountId)||null;if(cmd==='delete_password')secrets.delete(args.accountId)}}
 const root=document.createElement('div');document.body.append(root);const app=createApp(JellyfinLibrary);app.use(ElementPlus);app.mount(root)
 return ()=>{app.unmount();root.remove();JellyfinClient.prototype.request=original;JellyfinClient.prototype.poster=poster;(window as any).__TAURI_INTERNALS__=old}
}
