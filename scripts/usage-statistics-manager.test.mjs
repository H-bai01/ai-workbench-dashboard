import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageStatisticsManager } from '../src/utils/usage-statistics-manager.mjs'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function withFetch(mock, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const request = {
  timelineUrl: 'http://127.0.0.1/timeline',
  localUsageUrl: 'http://127.0.0.1/local',
  scopeKey: 'usage:today',
  rangeLabel: '今天',
  hasPublishedData: true,
}

test('服务重启造成的连接中断不生成费用统计错误通知', async () => {
  const notifications = []
  const manager = createUsageStatisticsManager({
    notify: notification => notifications.push(notification),
  })
  await withFetch(async () => {
    throw new TypeError('fetch failed')
  }, async () => {
    const result = await manager.load(request)
    assert.equal(result.ok, false)
    assert.equal(result.failure.kind, 'service_unavailable')
  })
  assert.deepEqual(notifications, [])
})

test('无结构化错误的临时服务响应不生成费用统计通知', async () => {
  const notifications = []
  const manager = createUsageStatisticsManager({
    notify: notification => notifications.push(notification),
  })
  await withFetch(async () => new Response('', { status: 502 }), async () => {
    const result = await manager.load(request)
    assert.equal(result.ok, false)
    assert.equal(result.failure.kind, 'service_unavailable')
  })
  assert.deepEqual(notifications, [])
})

test('同一范围的真实数据故障只通知一次，恢复后可识别新故障', async () => {
  const notifications = []
  const manager = createUsageStatisticsManager({
    notify: notification => notifications.push(notification),
  })

  await withFetch(async url => (
    String(url).endsWith('/local')
      ? response({ ok: false, error: 'synthetic_data_failure' }, 500)
      : response({ ok: true, timeline: [] })
  ), async () => {
    assert.equal((await manager.load(request)).ok, false)
    assert.equal((await manager.load(request)).ok, false)
  })
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].errorCode, 'usage_statistics_failed')

  await withFetch(async url => (
    String(url).endsWith('/local')
      ? response({ ok: true, apps: [], timeline: [] })
      : response({ ok: true, timeline: [] })
  ), async () => {
    assert.equal((await manager.load(request)).ok, true)
  })

  await withFetch(async url => (
    String(url).endsWith('/local')
      ? response({ ok: false, error: 'synthetic_data_failure' }, 500)
      : response({ ok: true, timeline: [] })
  ), async () => {
    assert.equal((await manager.load(request)).ok, false)
  })
  assert.equal(notifications.length, 2)
})

test('模型识别错误与后台刷新错误仍进入统一通知入口', async () => {
  const notifications = []
  const manager = createUsageStatisticsManager({
    notify: notification => notifications.push(notification),
  })

  await withFetch(async url => (
    String(url).endsWith('/local')
      ? response({ ok: false, error: '模型识别失败：synthetic-model' }, 422)
      : response({ ok: true, timeline: [] })
  ), async () => {
    assert.equal((await manager.load(request)).failure.kind, 'model_error')
  })
  assert.equal(notifications.at(-1).errorCode, 'usage_model_unrecognized')

  await withFetch(async url => (
    String(url).endsWith('/local')
      ? response({
          ok: true,
          apps: [],
          timeline: [],
          cache: { refreshing: false, refreshFailed: true },
        })
      : response({ ok: true, timeline: [] })
  ), async () => {
    const result = await manager.load({ ...request, scopeKey: 'usage:7d', rangeLabel: '7 天' })
    assert.equal(result.ok, true)
    assert.equal(result.refreshFailed, true)
  })
  assert.equal(notifications.at(-1).errorCode, 'usage_background_refresh_failed')
})
