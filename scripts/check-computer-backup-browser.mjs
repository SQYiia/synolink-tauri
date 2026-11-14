import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/computer-backup-browser');await mkdir(output,{recursive:true})
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/computer-backup-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div>');return}const name=req.url.slice(1);if(name.includes('/')||name.includes('..'))throw Error();res.setHeader('Content-Type',extname(name)==='.js'?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})

 const page=await browser.newPage({viewport:{width:1280,height:900},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async()=>{window.fixture=(await import('/fixture.js')).mount()})
 await page.getByRole('button',{name:'新建电脑备份',exact:true}).click()
 await page.evaluate(()=>window.fixture.cancelPicker(true));await page.getByRole('button',{name:'选择文件夹',exact:true}).click();assert.equal(await page.getByPlaceholder('选择本地文件夹').inputValue(),'')
 await page.evaluate(()=>window.fixture.cancelPicker(false));await page.getByRole('button',{name:'选择文件夹',exact:true}).click()
 await page.getByRole('button',{name:'选择目录',exact:true}).click()
 await page.getByText('backup',{exact:true}).dblclick()
 await page.getByRole('dialog',{name:'选择备份目标目录',exact:true}).getByRole('button',{name:'确定',exact:true}).click()
 await page.getByRole('button',{name:'保存任务',exact:true}).click()
 await page.getByText('尚未执行',{exact:true}).waitFor()
 await page.getByRole('button',{name:'执行备份',exact:true}).click();await page.getByRole('button',{name:'开始备份',exact:true}).click()
 await page.getByText('上传文件',{exact:true}).waitFor()
 await page.locator('.el-message-box').waitFor({state:'hidden'});await page.screenshot({path:resolve(output,'computer-backup-desktop.png'),fullPage:true})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 await page.getByRole('button',{name:'取消备份',exact:true}).click();await page.getByText('已中断',{exact:true}).waitFor()
 await page.evaluate(()=>window.fixture.deny(true));await page.getByRole('button',{name:'执行备份',exact:true}).click();await page.getByRole('button',{name:'开始备份',exact:true}).click();await page.getByText('NAS 拒绝备份请求（code=105）',{exact:true}).waitFor()
 const call=await page.evaluate(()=>window.fixture.calls.find(c=>c.cmd==='computer_backup_create'));assert.equal(call.args.destination,'/backup');assert.equal(call.args.account,'alice');assert.equal(call.args.source,'C:\\Users\\Alice\\Documents')
 await page.evaluate(()=>window.fixture.account());await page.getByText('还没有电脑备份任务',{exact:true}).waitFor();assert.equal(await page.getByText('C:\\Users\\Alice\\Documents',{exact:true}).count(),0)
 await page.evaluate(()=>window.fixture.close());assert.deepEqual(errors,[])
 console.log('Computer backup UI: folder selection/cancellation, create, confirm/start, progress, cancel, denied request, long names and account isolation passed. Real NAS verification remains pending.')

}finally{await browser?.close();await new Promise(r=>server.close(r))}
