import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/login-browser')
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/login-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div>');return}const name=req.url.slice(1);if(!['fixture.js','fixture.css'].includes(name))throw Error();res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 for(const mode of ['saved','manual','empty','expired','fail','otp']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async(mode)=>{window.fixture=await(await import('/fixture.js')).mount(mode)},mode)
  if(mode==='saved')await page.getByText('已进入文件页').waitFor()
  else if(mode==='otp'){await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'取消',exact:true}).click()}
  else await page.locator('.el-form').waitFor()
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(()=>window.fixture.calls.length),['saved','fail','otp'].includes(mode)?1:0,mode)
  assert.deepEqual(errors,[]);await page.close()
 }
 console.log('Saved-password automatic login, missing credential, manual/expired login, failed password and OTP cancellation passed.')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
