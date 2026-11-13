import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/photo-backup-browser');await mkdir(output,{recursive:true})
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/photo-backup-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div>');return}const name=req.url.slice(1);if(name.includes('/')||name.includes('..'))throw Error();res.setHeader('Content-Type',extname(name)==='.js'?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:390,height:844},userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async()=>{window.fixture=(await import('/fixture.js')).mount()})
 await page.getByRole('button',{name:'启动自动备份',exact:true}).click();await page.getByText('请选择相册和 NAS 目标目录',{exact:true}).waitFor()
 await page.evaluate(()=>window.fixture.deny(true));await page.getByRole('button',{name:'授权 / 重新选择照片权限'}).click();await page.getByText('照片权限未授予，请在系统设置中允许访问',{exact:true}).waitFor()
 await page.evaluate(()=>window.fixture.deny(false));await page.getByRole('button',{name:'授权 / 重新选择照片权限'}).click();await page.getByText('当前仅能访问授权的部分照片。新增照片可能需要重新授权，扫描完成不代表整个相册已备份。',{exact:true}).waitFor()
 await page.locator('.album-options .el-checkbox').filter({hasText:'Camera'}).click();await page.getByRole('textbox',{name:'照片备份目标目录'}).fill('/photos/手机备份');await page.getByRole('button',{name:'启动自动备份',exact:true}).click();await page.getByRole('button',{name:'暂停备份',exact:true}).waitFor()
 const config=await page.evaluate(()=>window.fixture.calls.find(c=>c.action==='start').config);assert.deepEqual(config,{albums:['external:1'],destination:'/photos/手机备份',wifiOnly:true,includeVideos:false})
 assert.equal(await page.getByRole('textbox',{name:'照片备份目标目录'}).isDisabled(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'photo-backup-mobile.png'),fullPage:true})
 await page.getByRole('button',{name:'暂停备份',exact:true}).click();await page.getByRole('button',{name:'启动自动备份',exact:true}).waitFor();await page.getByRole('button',{name:'重新校验已有备份'}).click();await page.getByText('本地校验记录已重置，下次启动会重新核对 NAS 文件，不删除照片',{exact:true}).waitFor()
 await page.evaluate(()=>window.fixture.account());await page.waitForFunction(()=>document.querySelector('[aria-label="照片备份目标目录"]').value==='');assert.equal(await page.locator('.album-options .el-checkbox').count(),0)
 await page.evaluate(()=>window.fixture.close());assert.deepEqual(errors,[])
 const desktop=await browser.newPage({viewport:{width:1280,height:800}});await desktop.goto('http://127.0.0.1:'+server.address().port);await desktop.evaluate(async()=>{(await import('/fixture.js')).mount()});await desktop.getByText('请在 Android 版中授权相册并配置自动备份。Windows 可通过文件页查看 NAS 中的备份文件。',{exact:true}).waitFor();assert.equal(await desktop.getByRole('button',{name:'启动自动备份'}).count(),0)
 console.log('Photo backup UI: denied/partial permissions, explicit album selection, Wi-Fi defaults, native queue controls, account isolation and desktop fallback passed. Native device execution remains pending.')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
