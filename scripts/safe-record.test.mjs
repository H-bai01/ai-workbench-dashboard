import test from 'node:test'
import assert from 'node:assert/strict'
import { createSafeRecord, ensureSafeValue, ownValue, safeRecordFrom } from '../src/utils/safe-record.mjs'

test('保留键作为普通动态键存取且不接触任何原型', () => {
  const objectBefore = Object.getOwnPropertyDescriptors(Object.prototype)
  const functionBefore = Object.getOwnPropertyDescriptors(Function.prototype)
  const map = createSafeRecord()
  for (const [index, key] of ['__proto__', 'constructor', 'prototype'].entries()) {
    const bucket = ensureSafeValue(map, key, () => ({ tokens: 0, cost: 0 }))
    bucket.tokens += 10 + index
    bucket.cost += index + 0.5
  }
  assert.equal(Object.getPrototypeOf(map), null)
  assert.deepEqual(Object.keys(map).sort(), ['__proto__', 'constructor', 'prototype'].sort())
  assert.deepEqual(ownValue(map, '__proto__'), { tokens: 10, cost: 0.5 })
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), objectBefore)
  assert.deepEqual(Object.getOwnPropertyDescriptors(Function.prototype), functionBefore)
  assert.equal(Number.isNaN(Object.values(map).reduce((sum, row) => sum + row.tokens, 0)), false)
})

test('安全字典重复聚合不丢失、不重复创建桶', () => {
  const map = safeRecordFrom({})
  for (let pass = 0; pass < 2; pass++) {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      ensureSafeValue(map, key, () => ({ tokens: 0 })).tokens += 1
    }
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(map).map(([key, row]) => [key, row.tokens])),
    Object.fromEntries([['__proto__', 2], ['constructor', 2], ['prototype', 2]]),
  )
})
