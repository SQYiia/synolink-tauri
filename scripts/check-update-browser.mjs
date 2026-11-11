import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const out = resolve('.npm-cache/update-browser-test')
await mkdir(out, { recursive: true })
await build({ configFile: false, plugins: [vue()], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: out, emptyOutDir: true, lib: { entry: resolve('scripts/update-browser-entry.ts'), formats: ['es'], fileName: () => 'test.js', cssFileName: 'test' } } })
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<html><link rel="stylesheet" href="/test.css"><body></body></html>'); return }
  if (!['/test.js', '/test.css'].includes(req.url)) { res.writeHead(404).end(); return }
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await readFile(resolve(out, req.url.slice(1))))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
let browser
try {
 browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
 const page = await browser.newPage()
 await page.addInitScript(() => {
   window.isTauri = true
   window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
   window.__TAURI_INTERNALS__ = { transformCallback(fn) { window.progressCallback = fn; return 1 }, async invoke(cmd) {
     if (cmd === 'check_app_update') { if (window.failCheck) throw 'GitHub unavailable'; return window.noUpdate ? null : { version: '0.1.17', notes: '测试更新说明', size: 5000000 } }
     if (cmd === 'download_app_update') { if (window.failDownload) throw 'SHA256 校验失败'; window.progressCallback({ payload: { downloaded: 5000000, total: 5000000 } }); return }
     if (cmd === 'install_app_update') { window.installed = true; return }
     return 1
   } }
 })
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 const result = await page.evaluate(async () => {
   const m = await import('/test.js'); window.updateModule = m; m.mount()
   await m.checkForUpdates(); const detected = m.updates.available.version
   window.failDownload = true; await m.downloadUpdate(); const failed = m.updates.phase === 'idle' && m.updates.error.includes('SHA256')
   window.failDownload = false; await m.downloadUpdate(); const ready = m.updates.phase === 'ready'
   m.downloadQueue.value.push({ status: 'downloading' }); await m.installUpdate()
   const blocked = !window.installed && m.updates.error.includes('未完成')
   m.downloadQueue.value.pop(); m.updates.error = ''
   return { detected, failed, ready, blocked }
 })
 assert.deepEqual(result, { detected: '0.1.17', failed: true, ready: true, blocked: true })
 await page.waitForTimeout(400) // Wait for the dialog transition before visual capture.
 await page.screenshot({ path: resolve(out, 'update-dialog.png') })
 await page.getByRole('dialog', { name: '软件更新', exact: true }).getByRole('button', { name: '退出并安装', exact: true }).click()
 await page.getByRole('button', { name: '取消', exact: true }).click()
 assert.equal(await page.evaluate(() => !!window.installed), false)
 await page.getByRole('dialog', { name: '软件更新', exact: true }).getByRole('button', { name: '退出并安装', exact: true }).click()
 await page.getByRole('dialog', { name: '安装更新', exact: true }).getByRole('button', { name: '退出并安装', exact: true }).click()
 assert.equal(await page.evaluate(() => !!window.installed), true)
 const checks = await page.evaluate(async () => {
   const m = window.updateModule; m.updates.phase = 'idle'; window.noUpdate = true; await m.checkForUpdates(); const none = m.updates.available === null
   window.failCheck = true; await m.checkForUpdates(); return { none, error: m.updates.error }
 })
 assert.equal(checks.none, true); assert.match(checks.error, /GitHub unavailable/)
 console.log('Updater browser checks passed: discovery, failure/retry, progress, transfer guard, install confirmation, latest, network error.')
} finally { await browser?.close(); server.close() }
