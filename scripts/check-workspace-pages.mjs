import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/workspace-pages');await mkdir(output,{recursive:true})
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/heic-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css">');return}const name=req.url.slice(1);if(!/^(?:[a-zA-Z0-9_.-]+|package-icons\/[a-z_]+\.png)$/.test(name)||name.includes('..'))throw Error();res.setHeader('Content-Type',extname(name)==='.svg'?'image/svg+xml':extname(name)==='.png'?'image/png':extname(name)==='.js'?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async()=>{window.fixture=await(await import('/fixture.js')).showWorkspace()})
 for(const [route,title] of [['dashboard','概览'],['applications','套件中心'],['monitor','性能监控'],['downloads','下载站'],['backups','备份中心'],['drive','Drive 文件'],['containers','容器'],['vmm','虚拟机'],['me','设置']]){
  await page.evaluate(path=>window.fixture.navigate('/app/'+path),route);await page.locator('.workspace-page-header').getByRole('heading',{name:title,exact:true}).waitFor();await page.waitForTimeout(400)
  await page.screenshot({path:resolve(output,route+'.png')});assert.ok(await page.locator('.content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),route+' horizontal overflow')
 }
 await page.evaluate(()=>window.fixture.navigate('/app/applications'));await page.getByRole('heading',{name:'套件中心',exact:true}).waitFor()
 const normal=page.getByRole('button',{name:'刷新套件',exact:true}),danger=page.locator('.package-card').first().getByRole('button',{name:'卸载',exact:true})
 assert.notEqual(await normal.evaluate(el=>getComputedStyle(el).color),await danger.evaluate(el=>getComputedStyle(el).color))
 await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.waitForTimeout(500);await page.screenshot({path:resolve(output,'applications-dark.png')})
 for(const route of ['dashboard','applications','monitor','downloads','backups','drive','containers','vmm','me']){await page.setViewportSize({width:1100,height:800});await page.evaluate(path=>window.fixture.navigate('/app/'+path),route);await page.waitForTimeout(300);assert.ok(await page.locator('.content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),route+' compact overflow')}
 await page.evaluate(()=>window.fixture.close());assert.deepEqual(errors,[]);console.log('Nine workspace pages: headings, light/dark screenshots, 1440/1100 layouts and destructive action styling passed.')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
