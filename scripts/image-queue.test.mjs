import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function queueFactory() {
  const source = readFileSync(new URL('../src/utils/imageQueue.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('exports', code)(exports)
  return exports.createImageQueue
}

test('thumbnail requests share a concurrency limit and drain after completion', () => {
  const enqueue = queueFactory()(2)
  const callbacks = []
  for (let i = 0; i < 7; i++) enqueue(done => callbacks.push(done))
  assert.equal(callbacks.length, 2)
  callbacks[0]()
  assert.equal(callbacks.length, 3)
  callbacks[0]()
  assert.equal(callbacks.length, 3, 'duplicate load events must not release a second slot')
  for (let i = 1; i < 6; i++) callbacks[i]()
  assert.equal(callbacks.length, 7)
})

test('cancelled thumbnails release slots without running obsolete queued loads', () => {
  const enqueue = queueFactory()(1)
  let finish
  const cancelActive = enqueue(done => { finish = done })
  let obsoleteRan = false
  const cancelPending = enqueue(() => { obsoleteRan = true })
  cancelPending()
  let nextRan = false
  enqueue(() => { nextRan = true })
  cancelActive()
  assert.equal(obsoleteRan, false)
  assert.equal(nextRan, true)
  finish()
})
