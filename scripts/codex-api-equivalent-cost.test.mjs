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
let calculateUsageCostBreakdownWithBilling
let observationPriceConfigured
let resolveBillingConfig
let serviceServer
const isolatedKeys = [
  'HOME',
  'USERPROFILE',
  'OPENCLAW_SKIP_DOTENV',
  'OPENCLAW_LOCAL_AI_USAGE_FRESH_MS',
  'OPENCLAW_LOCAL_AI_USAGE_RETENTION_MS',
]
const originalEnvironment = new Map(isolatedKeys.map((key) => [key, process.env[key]]))

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-api-equivalent-cost-'))
  tempHome = path.join(tempRoot, 'home')
  fs.mkdirSync(tempHome, { recursive: true, mode: 0o700 })
  process.env.HOME = tempHome
  process.env.USERPROFILE = tempHome
  process.env.OPENCLAW_SKIP_DOTENV = '1'
  process.env.OPENCLAW_LOCAL_AI_USAGE_FRESH_MS = '25'
  process.env.OPENCLAW_LOCAL_AI_USAGE_RETENTION_MS = '60000'
  const serviceUrl = pathToFileURL(path.join(process.cwd(), 'scripts', 'unified-service.js')).href
  const service = await import(serviceUrl)
  calculateUsageCostWithBilling = service.calculateUsageCostWithBilling
  calculateUsageCostBreakdownWithBilling = service.calculateUsageCostBreakdownWithBilling
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
      'gpt-5.3-codex': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 12.6,
        outputPriceCNYPerMillion: 100.8,
        cacheReadPriceCNYPerMillion: 1.26,
      },
      'codex-auto-review': { aliasFor: 'gpt-5.3-codex' },
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

test('费用明细按真实价格拆分并计算无缓存与长上下文费用', () => {
  const billing = configWithGpt56()
  const usage = { tokens: 4_000_000, input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }
  const detail = calculateUsageCostBreakdownWithBilling(
    'gpt-5.6-sol',
    usage,
    0,
    billing,
    Date.now(),
    { requestScoped: true },
  )
  assert.equal(detail.inputCost, 72)
  assert.equal(detail.outputCost, 324)
  assert.equal(detail.cacheReadCost, 7.2)
  assert.equal(detail.cacheWriteCost, 90)
  assert.equal(detail.totalCost, 493.2)
  assert.ok(Math.abs(detail.longContextCost - 192.6) < 1e-9)
  assert.equal(detail.noCacheCost, 540)
})

test('GPT-5.6 只对单次超过 272K 输入的请求应用长上下文价格', () => {
  const billing = configWithGpt56()
  const shortRequest = { tokens: 272_100, input: 72_000, output: 100, cacheRead: 200_000, cacheWrite: 0 }
  const longRequest = { tokens: 272_101, input: 72_001, output: 100, cacheRead: 200_000, cacheWrite: 0 }

  assert.equal(
    calculateUsageCostWithBilling('gpt-5.6-sol', shortRequest, 0, billing, Date.now(), { requestScoped: true }),
    (72_000 / 1_000_000) * 36 + (200_000 / 1_000_000) * 3.6 + (100 / 1_000_000) * 216,
  )
  assert.equal(
    calculateUsageCostWithBilling('gpt-5.6-sol', longRequest, 0, billing, Date.now(), { requestScoped: true }),
    (72_001 / 1_000_000) * 36 * 2 + (200_000 / 1_000_000) * 3.6 * 2 + (100 / 1_000_000) * 216 * 1.5,
  )
  assert.equal(
    calculateUsageCostWithBilling('gpt-5.6-sol', longRequest, 0, billing),
    (72_001 / 1_000_000) * 36 + (200_000 / 1_000_000) * 3.6 + (100 / 1_000_000) * 216,
  )
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

test('Codex 自动审查按 GPT-5.3-Codex 官方价格计费', () => {
  const billing = configWithGpt56()
  const usage = { tokens: 2_000_000, input: 1_000_000, output: 500_000, cacheRead: 500_000, cacheWrite: 0 }
  const autoReview = resolveBillingConfig('codex-auto-review', billing)
  const gpt53Codex = resolveBillingConfig('gpt-5.3-codex', billing)
  assert.deepEqual(autoReview, gpt53Codex)
  assert.ok(Math.abs(calculateUsageCostWithBilling('codex-auto-review', usage, 0, billing) - 63.63) < 1e-9)
})

test('未知模型明确保持价格未配置，自动审查模型仍被识别为已配置', () => {
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
    reasoning_output_tokens: 400_000,
    cached_input_tokens: 1_000_000,
    cache_write_tokens: 1_000_000,
    total_tokens: 5_000_000,
  })
  writeSession('gpt55-long-session', 'gpt-5.5', {
    input_tokens: 300_000,
    output_tokens: 100_000,
    reasoning_output_tokens: 40_000,
    cached_input_tokens: 200_000,
    total_tokens: 400_000,
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
  const autoReviewCumulative = {
    input_tokens: 100,
    output_tokens: 10,
    reasoning_output_tokens: 4,
    cached_input_tokens: 0,
    total_tokens: 110,
  }
  const unchangedUsageRows = [
    { timestamp, type: 'session_meta', payload: { id: 'unchanged-usage-session', cwd: tempHome, model: 'codex-auto-review' } },
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: autoReviewCumulative,
          total_token_usage: autoReviewCumulative,
        },
      },
    },
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            cached_input_tokens: 0,
            total_tokens: 50_000,
          },
          total_token_usage: autoReviewCumulative,
        },
      },
    },
  ]
  fs.writeFileSync(
    path.join(sessionsDir, 'unchanged-usage-session.jsonl'),
    `${unchangedUsageRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
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
  // priced-session 与 delayed-model-session 都超过 272K 输入：输入类 2x、输出 1.5x。
  // reasoning_output_tokens 已包含在 output_tokens 中，不得重复计费。
  assert.ok(Math.abs(codex.byModel['gpt-5.6-sol'].cost - 565.2) < 1e-9)
  assert.ok(Math.abs(codex.byModel['gpt-5.6-sol'].inputCost - 144) < 1e-9)
  assert.ok(Math.abs(codex.byModel['gpt-5.6-sol'].outputCost - 324) < 1e-9)
  assert.ok(Math.abs(codex.byModel['gpt-5.6-sol'].cacheReadCost - 7.2) < 1e-9)
  assert.ok(Math.abs(codex.byModel['gpt-5.6-sol'].cacheWriteCost - 90) < 1e-9)
  assert.ok(Math.abs(codex.byModel['gpt-5.6-sol'].longContextCost - 228.6) < 1e-9)
  assert.ok(Math.abs(codex.byModel['gpt-5.6-sol'].noCacheCost - 612) < 1e-9)
  assert.equal(codex.byModel['gpt-5.6-sol'].tokens, 6_000_000)
  assert.equal(codex.byModel['gpt-5.6-sol'].priceStatus, 'configured')
  assert.equal(codex.byModel['gpt-5.6-sol'].billingMode, 'per_token')
  assert.ok(Math.abs(codex.byModel['gpt-5.5'].cost - 41.04) < 1e-9)
  assert.equal(codex.byModel['gpt-5.5'].tokens, 400_000)
  assert.equal(codex.byModel['codex-auto-review'].tokens, 110)
  assert.equal(codex.byModel['codex-auto-review'].output, 10)
  assert.ok(Math.abs(codex.byModel['codex-auto-review'].cost - 0.002268) < 1e-12)
  assert.equal(codex.byModel['codex-auto-review'].billingMode, 'per_token')
  assert.equal(codex.byModel.unknown, undefined)
  assert.equal(codex.usage.priceStatus, 'configured')
})

test('存在无法识别的模型时接口直接报错', async () => {
  const sessionsDir = path.join(tempHome, '.codex', 'sessions', '2026', '07', '14')
  const unknownFile = path.join(sessionsDir, 'unknown-session.jsonl')
  const timestamp = new Date().toISOString()
  fs.writeFileSync(unknownFile, `${[
    { timestamp, type: 'session_meta', payload: { id: 'unknown-session', cwd: tempHome, model: 'unknown-model' } },
    {
      timestamp,
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 } } },
    },
  ].map((row) => JSON.stringify(row)).join('\n')}\n`)
  try {
    const address = serviceServer.address()
    const localToken = fs.readFileSync(path.join(tempHome, '.openclaw', 'dashboard-local-token'), 'utf8').trim()
    const today = new Date().toISOString().slice(0, 10)
    const response = await fetch(`http://127.0.0.1:${address.port}/api/local-ai-usage?start=${today}&end=${today}`, {
      headers: { 'X-Dashboard-Token': localToken },
    })
    assert.equal(response.status, 422)
    const payload = await response.json()
    assert.equal(payload.error, '模型识别失败：unknown-model')
  } finally {
    fs.rmSync(unknownFile, { force: true })
  }
})

test('本地用量扫描按范围缓存、复用进行中任务并并行读取两类客户端', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'unified-service.js'), 'utf8')
  assert.match(source, /const localAiUsageCache = new Map\(\)/)
  assert.match(source, /const localAiUsageInFlight = new Map\(\)/)
  assert.match(source, /let localAiUsageRefreshTail = Promise\.resolve\(\)/)
  assert.match(source, /let localAiUsageCacheGeneration = 0/)
  assert.match(source, /if \(localAiUsageInFlight\.has\(cacheKey\)\) return localAiUsageInFlight\.get\(cacheKey\)/)
  assert.match(source, /localAiUsageRefreshTail\s*\.catch\(\(\) => undefined\)\s*\.then/)
  assert.match(source, /state: 'stale',[\s\S]*refreshing: !refreshFailed/)
  assert.match(source, /const apps = await Promise\.all\(\[\s*collectCodexUsage\(range, billingConfig\),\s*collectClaudeCodeUsage\(range, billingConfig\),/)
  assert.match(source, /clearLocalAiUsageCache\(\)/)
  assert.match(source, /if \(generation === localAiUsageCacheGeneration\)/)
  assert.doesNotMatch(source, /cachedLocalAiUsageResult/)
  const summaryHandler = source.slice(
    source.indexOf("if (pathname === '/api/cost-summary'"),
    source.indexOf("if (pathname === '/api/cost-timeline'"),
  )
  assert.equal((summaryHandler.match(/await collectLocalAiUsage\(/g) || []).length, 1)
})

test('过期范围立即返回上一份完整结果并在后台替换缓存', async () => {
  const address = serviceServer.address()
  const localToken = fs.readFileSync(path.join(tempHome, '.openclaw', 'dashboard-local-token'), 'utf8').trim()
  const sessionsDir = path.join(tempHome, '.codex', 'sessions', '2026', '07', '14')
  const timestamp = new Date().toISOString()
  const rows = [
    { timestamp, type: 'session_meta', payload: { id: 'background-refresh-session', cwd: tempHome, model: 'gpt-5.6-sol' } },
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 500, output_tokens: 0, total_tokens: 500 } },
      },
    },
  ]
  fs.writeFileSync(
    path.join(sessionsDir, 'background-refresh-session.jsonl'),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  )
  await new Promise(resolve => setTimeout(resolve, 35))

  const fetchUsage = async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/local-ai-usage?days=1`, {
      headers: { 'X-Dashboard-Token': localToken },
    })
    assert.equal(response.status, 200)
    return response.json()
  }

  const stale = await fetchUsage()
  assert.equal(stale.cache.state, 'stale')
  assert.equal(stale.cache.refreshing, true)
  assert.equal(stale.apps.find((app) => app.id === 'codex').byModel['gpt-5.6-sol'].tokens, 6_000_000)

  const deadline = Date.now() + 2000
  let refreshed = stale
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
    refreshed = await fetchUsage()
    const tokens = refreshed.apps.find((app) => app.id === 'codex').byModel['gpt-5.6-sol'].tokens
    if (tokens === 6_000_500) break
  }
  assert.equal(refreshed.apps.find((app) => app.id === 'codex').byModel['gpt-5.6-sol'].tokens, 6_000_500)
})
