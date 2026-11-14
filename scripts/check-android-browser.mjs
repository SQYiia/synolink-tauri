import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const out = resolve('.npm-cache/android-browser-test')
await mkdir(out, { recursive: true })
await build({ configFile: false, plugins: [vue()], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: out, emptyOutDir: true, lib: { entry: resolve('scripts/heic-browser-entry.ts'), formats: ['es'], fileName: () => 'test.js', cssFileName: 'test' } } })
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/test.css"><body></body></html>'); return }
  if (!/^\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(req.url)) { res.writeHead(404).end(); return }
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await readFile(resolve(out, req.url.slice(1))))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
let browser
try {
 browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
 const page = await browser.newPage({ viewport: { width: 412, height: 915 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36', isMobile: true, hasTouch: true })
 await page.goto('http://127.0.0.1:'+server.address().port)
 assert.equal(await page.evaluate(() => innerWidth), 412)
 const migrated = await page.evaluate(async () => {
   const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' })
   await new Promise((resolve, reject) => {
     const open = indexedDB.open('synolink-images', 1)
     open.onupgradeneeded = () => {
       const store = open.result.createObjectStore('images', { keyPath: 'key' })
       store.createIndex('used', 'used')
       for (let i = 0; i < 2000; i++) store.put({ key: String(i), used: i, size: jpeg.size, blob: jpeg })
     }
     open.onsuccess = () => { open.result.close(); resolve() }
     open.onerror = () => reject(open.error)
   })
   const { writeImageCache, readImageCache } = await import('/test.js')
   await writeImageCache('100', jpeg)
   await writeImageCache('new', jpeg)
   return [await readImageCache('0'), (await readImageCache('1'))?.size, (await readImageCache('new'))?.size]
 })
 assert.deepEqual(migrated, [null, 4, 4])
 await page.evaluate(async () => { const m = await import('/test.js'); window.workspace = await m.showWorkspace(4000) })
 for (const route of ['files','album','videos']) {
  await page.evaluate(route => window.workspace.navigate('/app/'+route), route)
  await page.waitForTimeout(2200)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, route+' must fit phone width')
  if (route === 'album') {
   await page.getByText('4,000 张', { exact: true }).waitFor()
   const cells = page.locator('.m-cell')
   assert.ok(await cells.count() > 0 && await cells.count() <= 48)
   await page.locator('.m-album-body').evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight })
   await page.waitForFunction(() => [...document.querySelectorAll('.m-cell img')].some(img => img.alt === 'Media 999.jpg'), null, { timeout: 10000 })
   assert.ok(await cells.count() <= 48)
   await page.locator('.m-album-body').evaluate(el => { el.scrollTop = 0 })
   await page.getByAltText('Media 0.jpg', { exact: true }).waitFor()
  }
  await page.screenshot({ path: resolve(out, route+'.png') })
 }
 await page.evaluate(() => window.workspace.navigate('/app/applications'))
 const card = page.locator('.package-card').filter({hasText:'Hyper Backup'})
 await card.getByRole('button',{name:'卸载',exact:true}).click()
 await page.locator('.van-dialog').getByRole('button',{name:'确定',exact:true}).click()
 await card.waitFor({state:'detached'})
 await page.getByRole('button',{name:'搜索第三方套件',exact:true}).click()
 const center = page.getByRole('dialog',{name:'套件中心',exact:true})
 await center.getByRole('textbox',{name:'搜索在线套件'}).fill('communitydemo')
 const community = center.locator('.catalog article')
 assert.equal(await community.count(),1)
 await community.getByRole('button',{name:'下载安装',exact:true}).click()
 await page.locator('.van-dialog').getByRole('button',{name:'确定',exact:true}).click()
 await center.getByRole('button',{name:'确认安装',exact:true}).click()
 await page.locator('.van-dialog').getByRole('button',{name:'确定',exact:true}).click()
 await center.getByText('安装版本已确认：1.0',{exact:true}).waitFor()
 await center.getByRole('button',{name:'第三方套件源',exact:true}).click()
 await center.getByRole('button',{name:'填入 SynoCommunity 来源',exact:true}).click()
 assert.equal(await center.getByRole('textbox',{name:'套件源地址'}).inputValue(),'https://packages.synocommunity.com')
 await center.getByRole('button',{name:'添加来源',exact:true}).click()
 await center.locator('.feed').filter({hasText:'SynoCommunity'}).waitFor()
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),true)
 await page.screenshot({path:resolve(out,'package-center.png')})
 await center.getByLabel('Close this dialog').click()
 for(const dark of [false,true]){
  await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark)
  for(const route of ['dashboard','applications','monitor','downloads','backups','drive','containers','vmm','me','diagnostics']){
   await page.evaluate(route=>window.workspace.navigate('/app/'+route),route);await page.waitForTimeout(350)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' phone overflow')
   await page.screenshot({path:resolve(out,`${route}-${dark?'dark':'light'}.png`)})
  }
 }
 await page.setViewportSize({ width: 915, height: 412 })
 await page.waitForTimeout(300)
 assert.ok(await page.locator('.van-tabbar').isVisible(), 'Touch navigation remains visible in landscape')
 console.log('Android phone and landscape UI smoke checks passed.')
} finally { await browser?.close(); server.close() }
