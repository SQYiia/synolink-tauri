import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/file-features-browser');await mkdir(output,{recursive:true})
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/file-features-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const csp=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8')).app.security.csp
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Security-Policy',csp);if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div>');return}const name=req.url.slice(1);if(name.includes('/')||name.includes('..'))throw Error();res.setHeader('Content-Type',extname(name)==='.js'?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async()=>{window.fixture=await(await import('/fixture.js')).mount()})
 const row=name=>page.locator('.el-table__row').filter({hasText:name})
 async function menu(name,action){await row(name).click({button:'right'});await page.getByRole('menuitem',{name:action,exact:true}).click()}
 await menu('Notes.txt','分享链接');const password=await page.getByRole('textbox',{name:'分享密码'}).inputValue();assert.match(password,/^[A-Za-z0-9]{12}$/)
 await page.getByRole('button',{name:'创建分享链接',exact:true}).click();await page.getByRole('textbox',{name:'分享地址'}).waitFor();await page.getByRole('button',{name:'复制分享信息'}).click();assert.match(await page.getByRole('textbox',{name:'可复制的分享信息'}).inputValue(),/https:\/\/fixture-nas\/sharing\/1/)
 assert.equal(await page.evaluate(secret=>JSON.stringify(localStorage).includes(secret),password),false)
 await page.screenshot({path:resolve(output,'share-desktop.png')});await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'分享管理',exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.el-message-box').getByRole('button',{name:'撤销',exact:true}).click();await page.getByText('暂无分享链接',{exact:true}).waitFor();await page.keyboard.press('Escape')
 await page.evaluate(()=>window.fixture.setCreateError(105));await menu('Notes.txt','分享链接');await page.getByRole('button',{name:'创建分享链接',exact:true}).click();await page.getByText('当前账号没有操作权限',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.evaluate(()=>window.fixture.setCreateError(0))
 await page.evaluate(()=>window.fixture.setCreateError(-1));await menu('Notes.txt','分享链接');await page.getByRole('button',{name:'创建分享链接',exact:true}).click();await page.getByText('创建结果未确认，请先到分享管理检查，避免重复生成链接',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'创建分享链接',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');await page.evaluate(()=>window.fixture.setCreateError(0))
 await menu('Archive.zip','解压到…');await page.getByRole('textbox',{name:'压缩包密码'}).fill('wrong');await page.getByRole('button',{name:'开始解压',exact:true}).click();await page.getByText('解压密码错误',{exact:true}).first().waitFor();await page.keyboard.press('Escape')
 await menu('Notes.txt','创建压缩包');await page.getByRole('textbox',{name:'压缩文件名'}).fill('Archive');await page.getByRole('button',{name:'开始压缩',exact:true}).click();await page.getByText('目标文件已存在，请更换名称',{exact:true}).waitFor()
 await page.getByRole('textbox',{name:'压缩文件名'}).fill('New');await page.getByRole('button',{name:'开始压缩',exact:true}).click();await page.getByRole('dialog',{name:'创建压缩包'}).waitFor({state:'hidden'})
 const operation=page.locator('.operations article').filter({hasText:'New.zip'});await operation.getByText('进行中',{exact:true}).waitFor();await page.evaluate(()=>window.fixture.navigate('/other'));await page.evaluate(()=>window.fixture.finish());await operation.getByText('已完成',{exact:true}).waitFor();await page.evaluate(()=>window.fixture.navigate('/app/files'));await row('New.zip').waitFor()
 await page.evaluate(()=>window.fixture.pending());await menu('Notes.txt','创建压缩包');await page.getByRole('textbox',{name:'压缩文件名'}).fill('Cancel');await page.getByRole('button',{name:'开始压缩',exact:true}).click();await page.getByRole('dialog',{name:'创建压缩包'}).waitFor({state:'hidden'});const cancelling=page.locator('.operations article').filter({hasText:'Cancel.zip'});await cancelling.getByRole('button',{name:'取消任务',exact:true}).click();await page.locator('.el-message-box').getByRole('button',{name:'停止任务',exact:true}).click();await cancelling.getByText('已取消',{exact:true}).waitFor();await page.evaluate(()=>window.fixture.finish())
 // Multiple selection is sent as one archive task.
 await row('Archive.zip').locator('.el-checkbox').click();await row('Notes.txt').locator('.el-checkbox').click();await page.locator('.batch-bar').getByRole('button',{name:'压缩',exact:true}).click();await page.getByRole('dialog',{name:'创建压缩包'}).getByText('已选 2 项',{exact:true}).waitFor();await page.keyboard.press('Escape')
 await page.setViewportSize({width:390,height:844});await page.locator('.m-row').first().waitFor()
 // Touch long press opens the same action sheet without navigating.
 const mobileRow=page.locator('.m-row').filter({hasText:'Notes.txt'});await mobileRow.dispatchEvent('pointerdown',{pointerType:'touch',clientX:50,clientY:200});await page.waitForTimeout(550);await mobileRow.dispatchEvent('pointerup',{pointerType:'touch'});await page.getByText('分享链接',{exact:true}).click();await page.getByRole('textbox',{name:'分享密码'}).waitFor();await page.locator('.van-action-sheet').waitFor({state:'hidden'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'share-mobile.png')});await page.keyboard.press('Escape')
 await page.locator('.m-row').filter({hasText:'旅行照片'}).locator('.m-row-action').click();await page.getByText('创建压缩包',{exact:true}).click();await page.getByRole('textbox',{name:'压缩文件名'}).waitFor();await page.locator('.van-action-sheet').waitFor({state:'hidden'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'archive-mobile.png')})
 const calls=await page.evaluate(()=>window.fixture.calls.length);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.fixture.calls.length),calls)
 await mobileRow.locator('.m-row-action').click();await page.getByText('分享链接',{exact:true}).click();await page.evaluate(()=>window.fixture.switchAccount());await page.getByRole('dialog',{name:'分享链接',exact:true}).waitFor({state:'hidden'});assert.equal(await page.locator('.operations article').count(),0)
 assert.deepEqual(errors,[]);console.log('File sharing, revoke, permissions, archive conflicts/passwords, KeepAlive refresh, mobile long press, isolation and layout passed.')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
