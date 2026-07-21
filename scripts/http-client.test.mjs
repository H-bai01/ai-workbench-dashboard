import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiRequestError, fetchJson, requestJson } from '../src/api/http.ts'

async function withFetch(fakeFetch, task) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = fakeFetch
  try {
    await task()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('统一 JSON 请求返回状态和解析后的数据', async () => {
  await withFetch(async () => new Response(JSON.stringify({ value: 7 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }), async () => {
    const result = await fetchJson('/api/test')
    assert.deepEqual(result, { ok: true, status: 200, data: { value: 7 } })
  })
})

test('需要成功的请求在 HTTP 失败时只暴露安全错误', async () => {
  await withFetch(async () => new Response(JSON.stringify({ error: 'synthetic-private-detail' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  }), async () => {
    await assert.rejects(
      requestJson('/api/test'),
      (error) => error instanceof ApiRequestError
        && error.code === 'request_failed'
        && error.status === 503
        && !error.message.includes('synthetic-private-detail'),
    )
  })
})

test('网络与格式错误不暴露原始异常内容', async () => {
  await withFetch(async () => { throw new Error('synthetic-user-path') }, async () => {
    await assert.rejects(
      fetchJson('/api/test'),
      (error) => error instanceof ApiRequestError
        && error.code === 'network_error'
        && !error.message.includes('synthetic-user-path'),
    )
  })

  await withFetch(async () => ({
    ok: true,
    status: 200,
    async json() { throw new Error('synthetic-secret-value') },
  }), async () => {
    await assert.rejects(
      fetchJson('/api/test'),
      (error) => error instanceof ApiRequestError
        && error.code === 'invalid_response'
        && !error.message.includes('synthetic-secret-value'),
    )
  })
})
