import assert from 'node:assert/strict'
import test from 'node:test'
import { handleSessionObservationRoute } from './routes/session-observation-routes.mjs'

function createHarness(overrides = {}) {
  const responses = []
  const calls = []
  const store = {
    capabilities: () => ({ codex: true }),
    indexSnapshot: () => [
      { source: 'codex', sessionId: 'older', lastActivityMs: 10 },
      { source: 'claude', sessionId: 'hidden', lastActivityMs: 30 },
      { source: 'codex', sessionId: 'newer', lastActivityMs: 20 },
    ],
    async listSessions(input) {
      calls.push({ kind: 'sessions', input })
      return { sessions: [{ sessionId: 's1', lastActivityMs: 42 }] }
    },
    async readEvents(input) {
      calls.push({ kind: 'events', input })
      return { events: [{ id: 'e1' }] }
    },
    ...overrides.store,
  }
  return {
    responses,
    calls,
    store,
    async request(pathname, search = '', method = 'GET') {
      const url = new URL(`http://localhost${pathname}${search}`)
      const handled = await handleSessionObservationRoute({
        req: { method },
        res: {},
        url,
        pathname,
        store,
        getSecrets: () => ['synthetic-secret'],
        readBillingConfig: () => ({ version: 1 }),
        enrichUsage: (_item, billing, timeMs) => ({ billedAt: timeMs, billingVersion: billing.version }),
        enrichEvent: (event, billing) => ({ ...event, billingVersion: billing.version }),
        sendJson: (_res, status, payload) => responses.push({ status, payload }),
      })
      return { handled, response: responses.at(-1) }
    },
  }
}

test('会话观测能力接口保持只读响应', async () => {
  const harness = createHarness()
  const result = await harness.request('/api/session-observation/capabilities')
  assert.equal(result.handled, true)
  assert.deepEqual(result.response, {
    status: 200,
    payload: { capabilities: { codex: true }, readOnly: true },
  })
})

test('索引按来源筛选并按最后活动时间排序', async () => {
  const harness = createHarness()
  const result = await harness.request('/api/session-observation/index', '?source=codex')
  assert.deepEqual(result.response.payload.sessions.map(item => item.sessionId), ['newer', 'older'])
  assert.deepEqual(result.response.payload.sources, ['codex'])
})

test('会话列表解析多个 ID 并统一补充计费数据', async () => {
  const harness = createHarness()
  const result = await harness.request(
    '/api/session-observation/sessions',
    '?source=codex&agentId=agent-a&sessionId=one&sessionIds=two,three',
  )
  assert.deepEqual(harness.calls[0].input.sessionIds, ['one', 'two', 'three'])
  assert.deepEqual(result.response.payload.sessions[0], {
    sessionId: 's1',
    lastActivityMs: 42,
    billedAt: 42,
    billingVersion: 1,
  })
})

test('事件列表保留分页、类型和错误筛选', async () => {
  const harness = createHarness()
  const result = await harness.request(
    '/api/session-observation/events',
    '?source=claude&sessionId=s1&cursor=next&limit=12&type=tool&types=error,text&errorsOnly=1',
  )
  assert.deepEqual(harness.calls[0].input.types, ['tool', 'error', 'text'])
  assert.equal(harness.calls[0].input.errorsOnly, true)
  assert.equal(harness.calls[0].input.limit, 12)
  assert.deepEqual(result.response.payload.events, [{ id: 'e1', billingVersion: 1 }])
})

test('未知路由不接管，非法查询参数关闭失败', async () => {
  const harness = createHarness()
  const unknown = await harness.request('/api/other')
  assert.equal(unknown.handled, false)
  const invalid = await harness.request('/api/session-observation/events', '?path=/private/file')
  assert.equal(invalid.handled, true)
  assert.equal(invalid.response.status, 400)
  assert.deepEqual(invalid.response.payload.events, [])
})
