import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { createSessionObservationStore, scanSessionIndex } from './session-observation.mjs'

const home = path.resolve(process.env.HOME || os.homedir())
const index = scanSessionIndex({
  homeDir: home,
  openclawDir: path.join(home, '.openclaw'),
})

function largestEntry(source) {
  return index
    .filter(entry => entry.source === source)
    .sort((left, right) => right.size - left.size)[0]
}

test('本机最大 Claude 历史会话第一页在 2 秒内有界返回', { timeout: 5_000 }, async (t) => {
  const entry = largestEntry('claude-code')
  if (!entry) return t.skip('未发现 Claude Code 本机会话样本')
  const store = createSessionObservationStore({ homeDir: home, openclawDir: path.join(home, '.openclaw') })
  const started = performance.now()
  const page = await store.readEvents({ source: 'claude-code', sessionId: entry.sessionId, limit: 30 })
  const elapsedMs = performance.now() - started
  assert.ok(elapsedMs < 2_000, `Claude 第一页耗时 ${elapsedMs.toFixed(2)}ms`)
  assert.ok(page.events.length <= 30)
  assert.ok(page.scannedBytes <= 24 * 1024 * 1024)
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= page.maxResponseBytes)
  t.diagnostic([
    'source=claude-code',
    `sizeMB=${(entry.size / 1024 / 1024).toFixed(2)}`,
    `elapsedMs=${elapsedMs.toFixed(2)}`,
    `events=${page.events.length}`,
    `scanLimited=${page.scanLimited}`,
    `responseSizeLimited=${page.responseSizeLimited}`,
  ].join(' '))
})

test('本机最大 Codex 历史会话保持有界分页', { timeout: 5_000 }, async (t) => {
  const entry = largestEntry('codex')
  if (!entry) return t.skip('未发现 Codex 本机会话样本')
  const store = createSessionObservationStore({ homeDir: home, openclawDir: path.join(home, '.openclaw') })
  const started = performance.now()
  const first = await store.readEvents({ source: 'codex', sessionId: entry.sessionId, limit: 30 })
  const elapsedMs = performance.now() - started
  assert.ok(first.events.length <= 30)
  assert.ok(first.hasMore && first.nextCursor)
  const second = await store.readEvents({ source: 'codex', sessionId: entry.sessionId, cursor: first.nextCursor, limit: 30 })
  assert.ok(second.events.length <= 30)
  assert.equal(new Set([...first.events, ...second.events].map(event => event.id)).size, first.events.length + second.events.length)
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= first.maxResponseBytes)
  t.diagnostic([
    'source=codex',
    `sizeMB=${(entry.size / 1024 / 1024).toFixed(2)}`,
    `elapsedMs=${elapsedMs.toFixed(2)}`,
    `events=${first.events.length}`,
    `scanLimited=${first.scanLimited}`,
    `responseSizeLimited=${first.responseSizeLimited}`,
  ].join(' '))
})
