import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('.npm-cache/hyper-backup-browser');await mkdir(output,{recursive:true})
await build({configFile:false,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:output,emptyOutDir:true,lib:{entry:resolve('scripts/hyper-backup-browser-entry.ts'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}})
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div>');return}const name=req.url.slice(1);if(name.includes('/')||name.includes('..'))throw Error();res.setHeader('Content-Type',extname(name)==='.js'?'text/javascript':'text/css');res.end(await readFile(resolve(output,name)))}catch{res.writeHead(404).end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})

 const page=await browser.newPage({viewport:{width:1280,height:900},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(async()=>{window.fixture=(await import('/fixture.js')).mount()})

 await page.getByText('日常文档',{exact:true}).waitFor()
 for(const [button,confirmation,state] of [['立即备份','确认立即备份','正在备份'],['暂停备份','确认暂停备份','已暂停'],['继续备份','确认继续备份','正在备份'],['取消备份','确认取消备份','空闲']]){await page.getByRole('button',{name:button,exact:true}).click();await page.getByRole('button',{name:confirmation,exact:true}).click();await page.locator('.hb-title .el-tag').filter({hasText:state}).waitFor();await page.locator('.el-message-box').waitFor({state:'hidden'})}
 await page.evaluate(()=>window.fixture.deny(true));await page.getByRole('button',{name:'立即备份',exact:true}).click();await page.getByRole('button',{name:'确认立即备份',exact:true}).click();await page.getByText(/当前账号没有备份管理权限/).waitFor();await page.evaluate(()=>window.fixture.deny(false))
 await page.getByRole('button',{name:'新建 NAS 备份',exact:true}).click();await page.getByRole('textbox',{name:'Hyper Backup 任务名称',exact:true}).fill('资料归档')
 await page.getByRole('button',{name:'添加源目录',exact:true}).click();await page.getByText('documents',{exact:true}).click();await page.getByRole('dialog',{name:'选择 NAS 源目录',exact:true}).getByRole('button',{name:'确定',exact:true}).click()
 await page.getByRole('dialog',{name:'新建 Hyper Backup 任务',exact:true}).locator('.el-select__wrapper').click();await page.getByRole('option',{name:'backup',exact:true}).click()
 await page.getByRole('button',{name:'核对并创建',exact:true}).click();await page.getByRole('button',{name:'创建任务',exact:true}).click();await page.getByText('任务已创建，请在列表中手动执行备份',{exact:true}).waitFor();await page.getByText('资料归档',{exact:true}).waitFor()
 const writes=await page.evaluate(()=>window.fixture.calls.filter(c=>c.method==='create'));assert.equal(writes.length,2);assert.equal(writes[0].api,'SYNO.Backup.Repository');assert.equal(writes[1].params.repo_id,'9');assert.deepEqual(JSON.parse(writes[1].params.source).file_list,['/documents']);assert.equal(writes[1].post,true)
 await page.locator('.el-message-box').waitFor({state:'hidden'});await page.screenshot({path:resolve(output,'hyper-desktop.png'),fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'hyper-mobile.png'),fullPage:true})
 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.fixture.fail(true));await page.getByRole('button',{name:'新建 NAS 备份',exact:true}).click();await page.getByRole('textbox',{name:'Hyper Backup 任务名称',exact:true}).fill('第二份备份');await page.getByRole('button',{name:'核对并创建',exact:true}).click();await page.getByRole('button',{name:'创建任务',exact:true}).click();await page.getByRole('dialog',{name:'新建 Hyper Backup 任务',exact:true}).getByText(/响应超时/).waitFor();assert.equal(await page.getByRole('button',{name:'核对并创建',exact:true}).isDisabled(),true)
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('synolink.hyperbackup.pending:'+JSON.stringify(['https://nas','alice']))).phase),'task-submitting')
 await page.getByRole('dialog',{name:'新建 Hyper Backup 任务',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
 await page.evaluate(()=>window.fixture.account());await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByText('暂无 Hyper Backup 任务',{exact:true}).waitFor();assert.equal(await page.locator('.hb-pending').count(),0)
 await page.evaluate(()=>window.fixture.close());assert.deepEqual(errors,[])
 console.log('Hyper Backup UI: run/pause/resume/cancel, denied request, creation, partial outcome journal, account isolation and responsive layout passed. Real NAS validation pending.')

}finally{await browser?.close();await new Promise(r=>server.close(r))}
