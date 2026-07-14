import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  GPT56_BILLING_MODELS,
  mergeBillingConfigWithDefaults,
  mergePriceStatus,
} from './billing-config.mjs'

let tempRoot
let tempHome
let calculateUsageCostWithBilling
let observationPriceConfigured
let resolveBillingConfig
let serviceServer
const isolatedKeys = ['HOME', 'USERPROFILE', 'OPENCLAW_SKIP_DOTENV']
const originalEnvironment = new Map(isolatedKeys.map((key) => [key, process.env[key]]))

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-api-equivalent-cost-'))
  tempHome = path.join(tempRoot, 'home')
  fs.mkdirSync(tempHome, { recursive: true, mode: 0o700 })
  process.env.HOME = tempHome
  process.env.USERPROFILE = tempHome
  process.env.OPENCLAW_SKIP_DOTENV = '1'
  const serviceUrl = pathToFileURL(path.join(process.cwd(), 'scripts', 'unified-service.js')).href
  const service = await import(serviceUrl)
  calculateUsageCostWithBilling = service.calculateUsageCostWithBilling
  observationPriceConfigured = service.observationPriceConfigured
  resolveBillingConfig = service.resolveBillingConfig
  serviceServer = service.server
})

after(async () => {
  if (serviceServer?.listening) {
    await new Promise((resolve) => serviceServer.close(resolve))
  }
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function configWithGpt56(saved = null) {
  return mergeBillingConfigWithDefaults({
    version: 1,
    models: {
      ...GPT56_BILLING_MODELS,
      'codex-auto-review': { mode: 'free' },
    },
    fallback: { mode: 'use_default' },
  }, saved)
}

test('GPT-5.6 三档官方标准价格按输入、输出和缓存分别计算', () => {
  const billing = configWithGpt56()
  const usage = { tokens: 4_000_000, input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }
  assert.equal(calculateUsageCostWithBilling('gpt-5.6-sol', usage, 0, billing), 300.6)
  assert.equal(calculateUsageCostWithBilling('gpt-5.6-terra', usage, 0, billing), 150.3)
  assert.ok(Math.abs(calculateUsageCostWithBilling('gpt-5.6-luna', usage, 0, billing) - 60.12) < 1e-9)
})

test('GPT-5.6 带版本后缀的模型使用最长前缀价格', () => {
  const billing = configWithGpt56()
  const resolved = resolveBillingConfig('gpt-5.6-sol-2026-07-14', billing)
  assert.equal(resolved.inputPriceCNYPerMillion, 36)
  assert.equal(resolved.outputPriceCNYPerMillion, 216)
})

test('旧配置自动补入新模型且不覆盖用户自定义价格', () => {
  const billing = configWithGpt56({
    version: 1,
    models: {
      'gpt-5.5': { mode: 'per_token', inputPriceCNYPerMillion: 99 },
      'gpt-5.6-sol': { mode: 'per_token', inputPriceCNYPerMillion: 88 },
    },
    fallback: { mode: 'use_default', note: '用户自己的回退说明' },
  })
  assert.equal(billing.models['gpt-5.5'].inputPriceCNYPerMillion, 99)
  assert.equal(billing.models['gpt-5.6-sol'].inputPriceCNYPerMillion, 88)
  assert.equal(billing.models['gpt-5.6-sol'].outputPriceCNYPerMillion, 216)
  assert.equal(billing.models['gpt-5.6-luna'].inputPriceCNYPerMillion, 7.2)
  assert.equal(billing.fallback.note, '用户自己的回退说明')
})

test('未知模型明确保持价格未配置，免费模型仍被识别为已配置', () => {
  const billing = configWithGpt56()
  const usage = { tokens: 100, input: 100, output: 0, cacheRead: 0, cacheWrite: 0 }
  assert.equal(observationPriceConfigured('unknown', usage, billing), false)
  assert.equal(observationPriceConfigured('codex-auto-review', usage, billing), true)
  assert.equal(observationPriceConfigured('gpt-5.6-luna', usage, billing), true)
})

test('费用状态聚合区分完整、部分和全部未配置', () => {
  assert.equal(mergePriceStatus(undefined, 'configured'), 'configured')
  assert.equal(mergePriceStatus('configured', 'configured'), 'configured')
  assert.equal(mergePriceStatus('configured', 'unconfigured'), 'partial')
  assert.equal(mergePriceStatus('unconfigured', 'configured'), 'partial')
  assert.equal(mergePriceStatus('partial', 'configured'), 'partial')
})

test('隔离接口重新读取 Codex 历史日志并返回 API 等价费用状态', async () => {
  const sessionsDir = path.join(tempHome, '.codex', 'sessions', '2026', '07', '14')
  fs.mkdirSync(sessionsDir, { recursive: true })
  const timestamp = new Date().toISOString()
  const writeSession = (name, model, usage) => {
    const rows = [
      { timestamp, type: 'session_meta', payload: { id: name, cwd: tempHome, model } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: usage } } },
    ]
    fs.writeFileSync(path.join(sessionsDir, `${name}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
  }
  writeSession('priced-session', 'gpt-5.6-sol', {
    input_tokens: 2_000_000,
    output_tokens: 1_000_000,
    cached_input_tokens: 1_000_000,
    cache_write_tokens: 1_000_000,
    total_tokens: 5_000_000,
  })
  writeSession('unknown-session', 'unknown-model', {
    input_tokens: 100,
    output_tokens: 0,
    total_tokens: 100,
  })
  const delayedModelRows = [
    { timestamp, type: 'session_meta', payload: { id: 'delayed-model-session', cwd: tempHome } },
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 1_000_000,
            output_tokens: 0,
            total_tokens: 1_000_000,
          },
        },
      },
    },
    {
      timestamp,
      type: 'turn_context',
      payload: { model: 'gpt-5.6-sol' },
    },
  ]
  fs.writeFileSync(
    path.join(sessionsDir, 'delayed-model-session.jsonl'),
    `${delayedModelRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  )

  await new Promise((resolve, reject) => {
    serviceServer.once('error', reject)
    serviceServer.listen(0, '127.0.0.1', resolve)
  })
  const address = serviceServer.address()
  const localToken = fs.readFileSync(path.join(tempHome, '.openclaw', 'dashboard-local-token'), 'utf8').trim()
  const response = await fetch(`http://127.0.0.1:${address.port}/api/local-ai-usage?days=1`, {
    headers: { 'X-Dashboard-Token': localToken },
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  const codex = payload.apps.find((app) => app.id === 'codex')
  assert.ok(codex)
  assert.ok(Math.abs(codex.byModel['gpt-5.6-sol'].cost - 336.6) < 1e-9)
  assert.equal(codex.byModel['gpt-5.6-sol'].tokens, 6_000_000)
  assert.equal(codex.byModel['gpt-5.6-sol'].priceStatus, 'configured')
  assert.equal(codex.byModel['gpt-5.6-sol'].billingMode, 'per_token')
  assert.equal(codex.byModel['unknown-model'].priceStatus, 'unconfigured')
  assert.equal(codex.byModel.unknown, undefined)
  assert.equal(codex.usage.priceStatus, 'partial')
})
