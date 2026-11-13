import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/desktop-design');await mkdir(output,{recursive:true})
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/file-features-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div>');return}const name=req.url.slice(1);if(name.includes('/')||name.includes('..'))throw Error();res.setHeader('Content-Type',extname(name)==='.js'?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async()=>{window.fixture=await(await import('/fixture.js')).mount(true)})
 await page.getByText('2026 年度旅行计划.pdf',{exact:true}).waitFor();await page.screenshot({path:resolve(output,'files-light.png')})
 await page.keyboard.press('Control+k');await page.getByRole('dialog',{name:'全局搜索',exact:true}).waitFor();await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'传输中心',exact:true}).click();await page.getByRole('dialog',{name:'传输中心',exact:true}).waitFor();await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'路径',exact:true}).click();await page.getByRole('textbox',{name:'目录路径',exact:true}).waitFor();await page.getByRole('button',{name:'路径',exact:true}).click()
 for(const width of [1440,1100,900,760]){await page.setViewportSize({width,height:900});await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('.content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:resolve(output,'files-'+width+'.png')})}
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.waitForTimeout(600);await page.screenshot({path:resolve(output,'files-dark.png')});assert.deepEqual(errors,[])
 console.log('Desktop shell: light/dark, 1440/1100/900/760 widths, keyboard search, transfer drawer and address controls passed.')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
