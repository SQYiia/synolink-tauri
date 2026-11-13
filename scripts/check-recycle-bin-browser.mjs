import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/recycle-bin-browser');await mkdir(output,{recursive:true})
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/recycle-bin-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div>');return}const name=req.url.slice(1);if(name.includes('/')||name.includes('..'))throw Error();res.setHeader('Content-Type',extname(name)==='.js'?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async()=>{window.fixture=await(await import('/fixture.js')).mount()})
 await page.getByRole('button',{name:'回收站',exact:true}).click();const dialog=page.getByRole('dialog',{name:'回收站',exact:true})
 await page.getByLabel('回收站共享文件夹').selectOption('/share');await dialog.getByText('105 项',{exact:true}).waitFor()
 await dialog.getByRole('button',{name:'下一页',exact:true}).click();await dialog.getByText('第 2 页',{exact:true}).waitFor();await dialog.getByRole('button',{name:'上一页',exact:true}).click()
 await dialog.getByRole('button',{name:'文件夹 · 旧照片',exact:true}).click();await dialog.getByText('child.jpg',{exact:true}).waitFor();await dialog.getByRole('button',{name:'上一级',exact:true}).click()
 await page.getByLabel('筛选当前页').fill('deleted-0.txt');await page.getByLabel('选择 deleted-0.txt',{exact:true}).check();await page.getByLabel('恢复目标目录',{exact:true}).fill('/restore');await page.evaluate(()=>window.fixture.conflict(true))
 await dialog.getByRole('button',{name:'恢复到指定目录',exact:true}).click();await page.locator('.el-message-box').getByRole('button',{name:'恢复',exact:true}).click();await dialog.getByText('目标目录存在同名项目，请选择其他目录；不会覆盖或合并',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.method==='restore').length),0)
 await page.evaluate(()=>window.fixture.conflict(false));await dialog.getByRole('button',{name:'恢复到指定目录',exact:true}).click();await page.locator('.el-message-box').getByRole('button',{name:'恢复',exact:true}).click();await dialog.getByText('恢复任务已提交，请在传输中心查看结果；完成后自动刷新。',{exact:true}).waitFor()
 const call=await page.evaluate(()=>window.fixture.calls.find(c=>c.method==='restore'));assert.equal(call.params.overwrite,false);assert.equal(call.params.remove_src,true);assert.deepEqual(JSON.parse(call.params.path),['/share/#recycle/deleted-0.txt'])
 await page.evaluate(()=>window.fixture.finishRestore());await dialog.getByText('104 项',{exact:true}).waitFor();await page.getByLabel('筛选当前页').fill('deleted-1.txt');await page.getByLabel('选择 deleted-1.txt',{exact:true}).check()
 await dialog.getByRole('button',{name:'永久删除所选',exact:true}).click();await page.locator('.el-message-box').getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.method==='delete').length),0)
 await dialog.getByRole('button',{name:'永久删除所选',exact:true}).click();await page.locator('.el-message-box').getByRole('button',{name:'永久删除',exact:true}).click();await dialog.getByText('已永久删除 1 个项目',{exact:true}).waitFor();await dialog.getByText('103 项',{exact:true}).waitFor()
 await page.getByLabel('筛选当前页').fill('deleted-2.txt');await page.getByLabel('选择 deleted-2.txt',{exact:true}).check();await page.evaluate(()=>window.fixture.deleteMode('unknown'));await dialog.getByRole('button',{name:'永久删除所选',exact:true}).click();await page.locator('.el-message-box').getByRole('button',{name:'永久删除',exact:true}).click();await dialog.getByText('删除结果未确认或部分失败，请刷新核实；不会自动重试',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'永久删除所选',exact:true}).isDisabled(),true)
 await page.evaluate(()=>window.fixture.deny(true));await dialog.getByRole('button',{name:'刷新回收站',exact:true}).click();await dialog.getByText('无法访问回收站：可能未启用、目录已不存在，或当前账号没有权限',{exact:true}).waitFor();await page.evaluate(()=>window.fixture.deny(false));await dialog.getByRole('button',{name:'刷新回收站',exact:true}).click();await page.getByLabel('筛选当前页').fill('');await page.waitForTimeout(400);await page.screenshot({path:resolve(output,'recycle-desktop.png')})
 await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});await page.locator('.m-fab-more').click();await page.locator('.van-action-sheet').getByText('回收站',{exact:true}).click();await page.getByLabel('回收站共享文件夹').selectOption('/share');await dialog.getByText('103 项',{exact:true}).waitFor();await page.waitForTimeout(500);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'recycle-mobile.png')})
 await page.getByLabel('筛选当前页').fill('deleted-3.txt');await page.getByLabel('选择 deleted-3.txt',{exact:true}).check();await dialog.getByRole('button',{name:'永久删除所选',exact:true}).click();await page.locator('.van-dialog').getByRole('button',{name:'取消',exact:true}).click()
 await page.evaluate(()=>window.fixture.hold());await dialog.getByRole('button',{name:'刷新回收站',exact:true}).click();await page.evaluate(()=>window.fixture.switchAccount());await dialog.waitFor({state:'hidden'});await page.evaluate(()=>window.fixture.release());await page.waitForTimeout(300);assert.equal(await dialog.count(),0);assert.equal(await page.locator('.recycle-list article').count(),0)
 assert.deepEqual(errors,[]);console.log('Recycle bin desktop/mobile pagination, folders, restore conflict/completion, permanent deletion, cancel, unknown result, permissions and account isolation passed.')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
