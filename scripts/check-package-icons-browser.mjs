import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/package-icons-browser')
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/package-icons-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><link rel="stylesheet" href="/fixture.css"><div id="app"></div>');return}const name=req.url.slice(1);if(!/^(fixture\.(js|css)|package-icons\/[a-z_]+\.png)$/.test(name))throw Error();res.setHeader('Content-Type',name.endsWith('.png')?'image/png':name.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async()=>{(await import('/fixture.js')).mount()})
 await page.waitForFunction(()=>document.querySelectorAll('.package-icon img').length===3&&[...document.querySelectorAll('.package-icon img')].every(img=>img.naturalWidth>0))
 assert.equal(await page.locator('.package-icon svg').count(),1)
 await page.locator('.package-icon img').first().evaluate(img=>{img.src='/missing.png'})
 await page.waitForFunction(()=>document.querySelectorAll('.package-icon svg').length===2)
 assert.deepEqual(errors,[]);await page.screenshot({path:resolve(output,'fallback.png')})
 console.log('Bundled Drive/Photos/VMM icons load offline; broken NAS and broken local images fall back without loops; unknown packages use neutral symbol.')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
