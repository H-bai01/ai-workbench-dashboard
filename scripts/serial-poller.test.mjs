import test from 'node:test'
import assert from 'node:assert/strict'
import { createSerialPoller } from '../src/utils/serial-poller.ts'

function fakeTimers() {
  let nextId = 1
  const scheduled = new Map()
  return {
    setTimer(callback, delay) {
      const id = nextId++
      scheduled.set(id, { callback, delay })
      return id
    },
    clearTimer(id) {
      scheduled.delete(id)
    },
    entries() {
      return [...scheduled.entries()]
    },
    fire(id) {
      const entry = scheduled.get(id)
      assert.ok(entry)
      scheduled.delete(id)
      entry.callback()
    },
  }
}

test('串行轮询等待任务完成后再安排下一次运行', async () => {
  const timers = fakeTimers()
  let release
  let runs = 0
  const poller = createSerialPoller({
    task: () => {
      runs += 1
      return new Promise(resolve => { release = resolve })
    },
    getDelayMs: () => 1000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })

  poller.start()
  const [[firstId, first]] = timers.entries()
  assert.equal(first.delay, 1000)
  timers.fire(firstId)
  await Promise.resolve()
  assert.equal(runs, 1)
  assert.equal(timers.entries().length, 0)

  release()
  await poller.runNow()
  assert.equal(runs, 1)
  assert.equal(timers.entries().length, 1)
})

test('立即刷新复用进行中的任务且停止后不再调度', async () => {
  const timers = fakeTimers()
  let runs = 0
  const poller = createSerialPoller({
    task: async () => { runs += 1 },
    getDelayMs: () => 250,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })

  poller.start()
  await Promise.all([poller.runNow(), poller.runNow()])
  assert.equal(runs, 1)
  assert.equal(timers.entries().length, 1)

  poller.stop()
  assert.equal(timers.entries().length, 0)
  await poller.runNow()
  assert.equal(runs, 1)
})

test('重新调度会读取最新延迟且任务错误不会中断轮询', async () => {
  const timers = fakeTimers()
  const errors = []
  let delay = 100
  const poller = createSerialPoller({
    task: async () => { throw new Error('synthetic failure') },
    getDelayMs: () => delay,
    onError: error => errors.push(error),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })

  poller.start()
  delay = 500
  poller.reschedule()
  const [[id, entry]] = timers.entries()
  assert.equal(entry.delay, 500)
  timers.fire(id)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(errors.length, 1)
  assert.equal(timers.entries()[0][1].delay, 500)
})
