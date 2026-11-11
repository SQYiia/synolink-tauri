import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function load(path, ua, modules = {}, window = undefined) {
 const js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
 const exports = {}
 new Function('require', 'exports', 'navigator', 'window', js)(name => modules[name] || {}, exports, { userAgent: ua }, window)
 return exports
}
test('Android media URLs use WebView custom-protocol origin and preserve paths', () => {
 const { dsm } = load('../src/api/dsm.ts', 'Mozilla/5.0 (Linux; Android 14)')
 const url = new URL(dsm.mediaUrl('stream', '/视频/a b.mp4'))
 assert.equal(url.origin, 'http://dsm.localhost')
 assert.equal(url.searchParams.get('path'), '/视频/a b.mp4')
})
test('iOS media URLs retain the native dsm scheme', () => {
 const { dsm } = load('../src/api/dsm.ts', 'Mozilla/5.0 (iPhone)')
 assert.match(dsm.mediaUrl('image', '/a.heic'), /^dsm:\/\/localhost\/image/)
})
test('Android landscape and tablets retain touch controls at desktop widths', () => {
 const { useIsMobile } = load('../src/composables/useIsMobile.ts', 'Android', { '../utils/platform': { isMobileUA: true }, vue: { ref: value => ({ value }), readonly: x => x } }, { innerWidth: 1100, addEventListener() {} })
 assert.equal(useIsMobile().value, true)
})
