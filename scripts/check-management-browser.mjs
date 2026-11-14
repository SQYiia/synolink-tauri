import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/management-browser')
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/management-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div>');return}const name=req.url.slice(1);if(!['fixture.js','fixture.css'].includes(name))throw Error();res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async()=>{window.fixture=(await import('/fixture.js')).mount()})
  await page.getByText('nginx:stable',{exact:true}).waitFor()
  await page.getByRole('textbox',{name:'镜像仓库'}).fill('redis');await page.getByRole('button',{name:'拉取镜像',exact:true}).click();await page.getByText('redis:latest',{exact:true}).waitFor()
  await page.locator('article').filter({hasText:'redis:latest'}).getByRole('button',{name:'删除标签'}).click();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.getByText('redis:latest',{exact:true}).count(),1)
  await page.evaluate(()=>window.fixture.kind('projects'));await page.getByText('Demo project',{exact:true}).waitFor()
  await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByText(/Compose down/).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click()
  await page.getByRole('button',{name:'项目详情',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(!(await page.getByRole('dialog').innerText()).includes('TOP_SECRET'));await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})
  await page.evaluate(()=>window.fixture.kind('snapshots'));await page.getByText('Before upgrade',{exact:true}).waitFor();await page.getByRole('textbox',{name:'快照描述'}).fill('New snapshot');await page.getByRole('button',{name:'创建快照'}).click();await page.getByText('New snapshot',{exact:true}).waitFor()
  await page.locator('article').first().getByRole('button',{name:'恢复',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();await page.evaluate(()=>window.fixture.running());assert.ok(await page.locator('article').first().getByRole('button',{name:'恢复',exact:true}).isDisabled())
  await page.screenshot({path:resolve(output,`snapshots-${width}.png`)});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[])
  assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>['delete','stop','restore_start'].includes(c.method)).length),0)
  await page.evaluate(()=>window.fixture.fail());await page.getByRole('button',{name:'刷新列表'}).click();await page.getByText(/code=105/).waitFor();await page.close()
 }
 console.log('Desktop/mobile image pull, cancellation, Compose overview, snapshot creation and restore guards, permission failures passed.')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
