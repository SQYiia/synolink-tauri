import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const exports = {}
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/utils/storage.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports)
const parse = exports.normalizeVolume

test('Core Storage byte fields retain byte units and calculate used capacity', () => {
  const v = parse({ volume_path: '/volume1', size_total_byte: '7676309151744', size_free_byte: '3738201395200', eppool_used_byte: '7279022080' })
  assert.equal(v._size, 7676309151744)
  assert.equal(v._free, 3738201395200)
  assert.equal(v._used, 3938107756544)
  assert.equal(v._pct, 51)
  assert.equal(v._name, '/volume1')
})
test('full and empty volumes preserve zero free/used values', () => {
  const full = parse({ size_total_byte: '1024', size_free_byte: '0' })
  assert.equal(full._used, 1024); assert.equal(full._free, 0); assert.equal(full._pct, 100)
  const empty = parse({ size_total_byte: 1024, size_free_byte: 1024 })
  assert.equal(empty._used, 0); assert.equal(empty._pct, 0)
  assert.equal(parse({ size: { total: 1024, free: 0 } })._pct, 100)
})
test('canonical byte fields take precedence over aliases and pool allocation', () => {
  const v = parse({ size_total_byte: '4096', size_free_byte: '1024', size_total: 4, size_used: 2, size: { total: 8, free: 4 }, eppool_used_byte: 500 })
  assert.equal(v._size, 4096); assert.equal(v._free, 1024); assert.equal(v._used, 3072)
})
test('legacy nested capacities and explicit zero usage remain supported', () => {
  const v = parse({ size: { total: '4096', used: '1024' } })
  assert.equal(v._free, 3072); assert.equal(v._pct, 25)
  assert.equal(parse({ size_total: 4096, size_used: 0 })._free, 4096)
  assert.equal(parse({ total: 4096, size_free: 2048 })._used, 2048)
})
test('missing or malformed capacity is unknown rather than zero', () => {
  for (const value of [undefined, null, '', ' ', 'oops', false, -1, Infinity, NaN, {}, []]) {
    const v = parse({ size_total_byte: value, size_free_byte: value })
    assert.equal(v._size, null); assert.equal(v._used, null); assert.equal(v._free, null); assert.equal(v._pct, null)
  }
  assert.equal(parse({ size_total_byte: 1024 })._pct, null)
  assert.equal(parse({ size_free_byte: 1024 })._size, null)
})
test('inconsistent and zero-sized volumes never report invalid percentages', () => {
  for (const v of [parse({ total: 100, free: 101 }), parse({ total: 100, used: 101 })]) {
    assert.equal(v._pct, null); assert.equal(v._used, null); assert.equal(v._free, null)
  }
  const v = parse({ size_total_byte: 0, size_free_byte: 0 })
  assert.equal(v._size, 0); assert.equal(v._used, 0); assert.equal(v._pct, null)
})
