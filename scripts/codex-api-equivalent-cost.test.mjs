import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
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
let buildLocalAiUsageResult
let collectLocalAiUsage
let setLocalAiUsageWorkerFactoryForTests
let localAiUsageWorkerStateForTests
let clearLocalAiUsageCacheForTests
let serviceServer
const isolatedKeys = [
  'HOME',
  'USERPROFILE',
  'OPENCLAW_SKIP_DOTENV',
  'OPENCLAW_LOCAL_AI_USAGE_FRESH_MS',
  'OPENCLAW_LOCAL_AI_USAGE_RETENTION_MS',
  'OPENCLAW_DASHBOARD_DATA_ROOT',
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
  process.env.OPENCLAW_DASHBOARD_DATA_ROOT = path.join(tempRoot, 'dashboard-data')
  const serviceUrl = pathToFileURL(path.join(process.cwd(), 'scripts', 'unified-service.js')).href
  const service = await import(serviceUrl)
  calculateUsageCostWithBilling = service.calculateUsageCostWithBilling
  calculateUsageCostBreakdownWithBilling = service.calculateUsageCostBreakdownWithBilling
  observationPriceConfigured = service.observationPriceConfigured
  resolveBillingConfig = service.resolveBillingConfig
  buildLocalAiUsageResult = service.buildLocalAiUsageResult
  collectLocalAiUsage = service.collectLocalAiUsage
  setLocalAiUsageWorkerFactoryForTests = service.setLocalAiUsageWorkerFactoryForTests
  localAiUsageWorkerStateForTests = service.localAiUsageWorkerStateForTests
  clearLocalAiUsageCacheForTests = service.clearLocalAiUsageCacheForTests
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
    const now = new Date()
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/local-ai-usage?start=${today}&end=${today}&refresh=1`, {
      headers: { 'X-Dashboard-Token': localToken },
    })
    assert.equal(response.status, 422)
    const payload = await response.json()
    assert.equal(payload.error, '模型识别失败：unknown-model')
  } finally {
    fs.rmSync(unknownFile, { force: true })
  }
})

test('运行中同步到新模型后，同一次扫描会用新目录重新计算成功', async () => {
  const sessionsDir = path.join(tempHome, '.codex', 'sessions', '2026', '07', '14')
  const runtimeFile = path.join(sessionsDir, 'runtime-catalog-model.jsonl')
  const timestamp = new Date().toISOString()
  fs.writeFileSync(runtimeFile, `${[
    { timestamp, type: 'session_meta', payload: { id: 'runtime-catalog-model', cwd: tempHome, model: 'runtime-model-2027' } },
    { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1_000_000, output_tokens: 500_000, total_tokens: 1_500_000 } } } },
  ].map(row => JSON.stringify(row)).join('\n')}\n`)
  let refreshCount = 0
  try {
    const result = await buildLocalAiUsageResult({
      startMs: Date.now() - 86_400_000,
      endMs: Date.now() + 1_000,
      all: false,
      granularity: 'day',
    }, configWithGpt56(), {
      forceRefresh: true,
      async refreshBillingConfig(modelIds) {
        refreshCount += 1
        assert.ok(modelIds.includes('runtime-model-2027'))
        return mergeBillingConfigWithDefaults(configWithGpt56(), {
          models: {
            'runtime-model-2027': {
              mode: 'per_token',
              inputPriceCNYPerMillion: 10,
              outputPriceCNYPerMillion: 20,
            },
            'gpt-5.5': {
              mode: 'per_token',
              inputPriceCNYPerMillion: 36,
              outputPriceCNYPerMillion: 216,
              cacheReadPriceCNYPerMillion: 3.6,
            },
          },
        })
      },
    })
    const codex = result.apps.find(app => app.id === 'codex')
    assert.equal(refreshCount, 1)
    assert.equal(codex.byModel['runtime-model-2027'].priceStatus, 'configured')
    assert.equal(codex.byModel['runtime-model-2027'].cost, 20)
  } finally {
    fs.rmSync(runtimeFile, { force: true })
  }
})

test('价格变化只重算账本快照，不重新读取原始记录', async () => {
  const timeMs = Date.now() - 1_000
  const ledgerSnapshot = {
    refreshedAt: timeMs,
    faults: [],
    providers: [{
      providerId: 'codex',
      name: 'Codex',
      itemLabel: '项目',
      files: {
        '/synthetic/session.jsonl': {
          sessionId: 'pricing-only',
          title: '账本标题优先',
          path: '/synthetic/session.jsonl',
          project: '/synthetic/project',
          firstActivityMs: timeMs,
          mtimeMs: timeMs,
          observations: [{
            timeMs,
            model: 'pricing-only-model',
            usage: {
              tokens: 1_500_000,
              input: 1_000_000,
              output: 500_000,
              cacheRead: 0,
              cacheWrite: 0,
            },
          }],
        },
      },
    }],
  }
  const config = price => mergeBillingConfigWithDefaults(configWithGpt56(), {
    models: {
      'pricing-only-model': {
        mode: 'per_token',
        inputPriceCNYPerMillion: price,
        outputPriceCNYPerMillion: price * 2,
      },
    },
  })
  const range = {
    startMs: timeMs - 1_000,
    endMs: timeMs + 1_000,
    granularity: 'day',
  }
  const first = await buildLocalAiUsageResult(range, config(10), { ledgerSnapshot })
  const second = await buildLocalAiUsageResult(range, config(20), { ledgerSnapshot })
  assert.equal(first.totals.tokens, second.totals.tokens)
  assert.equal(first.apps.find(app => app.id === 'codex').items[0].name, '账本标题优先')
  assert.equal(first.totals.cost, 20)
  assert.equal(second.totals.cost, 40)
})

test('本地用量通过统一增量账本复用扫描并隔离两类客户端', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'unified-service.js'), 'utf8')
  assert.match(source, /const localAiUsageCache = new Map\(\)/)
  assert.match(source, /const localAiUsageInFlight = new Map\(\)/)
  assert.match(source, /let localAiUsageCacheGeneration = 0/)
  assert.match(source, /if \(localAiUsageInFlight\.has\(cacheKey\)\) return localAiUsageInFlight\.get\(cacheKey\)/)
  assert.match(source, /state: 'stale',[\s\S]*refreshing: !refreshFailed/)
  assert.match(source, /refreshLocalAiUsageLedgerInWorker\(\{/)
  assert.match(source, /LOCAL_AI_USAGE_LEDGER_WORKER_URL/)
  const workerSource = fs.readFileSync(path.join(import.meta.dirname, 'local-ai-usage-ledger-worker.mjs'), 'utf8')
  assert.match(workerSource, /createLocalAiUsageLedgerStore\(\{/)
  assert.match(source, /collectProviderUsageFromLedger\(provider, range, billingConfig\)/)
  assert.match(source, /ledgerSnapshot/)
  assert.match(source, /clearLocalAiUsageCache\(\)/)
  assert.match(source, /if \(generation === localAiUsageCacheGeneration\)/)
  assert.match(source, /scheduleLocalAiUsageRefresh\([\s\S]*\{ deferStart: true \},[\s\S]*\)/)
  assert.doesNotMatch(source, /collectJsonlFiles|forEachJsonlObject/)
  const summaryHandler = source.slice(
    source.indexOf("if (pathname === '/api/cost-summary'"),
    source.indexOf("if (pathname === '/api/cost-timeline'"),
  )
  assert.equal((summaryHandler.match(/await collectLocalAiUsage\(/g) || []).length, 1)
})

test('过期缓存先返回并把同步重刷新延后到下一事件循环，同范围请求保持单飞', async () => {
  const range = {
    startMs: Date.now() - 1_000,
    endMs: Date.now() + 1_000,
    all: false,
    granularity: 'day',
    key: `deferred-heavy-refresh-${Date.now()}`,
  }
  const result = (tokens) => ({
    range: {
      startMs: range.startMs,
      endMs: range.endMs,
      all: false,
      granularity: 'day',
    },
    apps: [],
    timeline: [],
    totals: { tokens },
    updatedAt: new Date().toISOString(),
    ledger: { refreshedAt: Date.now(), faults: [] },
  })

  await collectLocalAiUsage(
    range,
    configWithGpt56(),
    {},
    { refreshBuilder: async () => result(1) },
  )
  await new Promise(resolve => setTimeout(resolve, 35))

  let refreshStarts = 0
  const heavyRefresh = async () => {
    refreshStarts += 1
    const until = Date.now() + 200
    while (Date.now() < until) {
      // 模拟账本发现和校验在首次异步让出前发生的同步重负载。
    }
    return result(2)
  }

  const startedAt = Date.now()
  const [first, second] = await Promise.all([
    collectLocalAiUsage(range, configWithGpt56(), {}, { refreshBuilder: heavyRefresh }),
    collectLocalAiUsage(range, configWithGpt56(), {}, { refreshBuilder: heavyRefresh }),
  ])
  const returnedInMs = Date.now() - startedAt

  assert.equal(first.cache.state, 'stale')
  assert.equal(second.cache.state, 'stale')
  assert.equal(first.cache.refreshing, true)
  assert.equal(second.cache.refreshing, true)
  assert.equal(first.totals.tokens, 1)
  assert.equal(second.totals.tokens, 1)
  assert.equal(refreshStarts, 0)
  assert.ok(returnedInMs < 100, `过期缓存返回耗时 ${returnedInMs}ms，应早于同步重刷新`)

  const deadline = Date.now() + 2_000
  let refreshed
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
    refreshed = await collectLocalAiUsage(
      range,
      configWithGpt56(),
      {},
      { refreshBuilder: heavyRefresh },
    )
    if (refreshed.totals.tokens === 2) break
  }
  assert.equal(refreshStarts, 1)
  assert.equal(refreshed?.totals.tokens, 2)
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

function fixtureLedgerSnapshot(tokens = 0) {
  const timeMs = Date.now()
  const files = tokens > 0
    ? {
        '/synthetic/codex.jsonl': {
          path: '/synthetic/codex.jsonl',
          sessionId: `synthetic-${tokens}`,
          title: '合成用量',
          project: '/synthetic',
          firstActivityMs: timeMs,
          mtimeMs: timeMs,
          observations: [{
            timeMs,
            model: 'gpt-5.6-sol',
            usage: { tokens, input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
          }],
        },
      }
    : {}
  return {
    providers: [
      { providerId: 'codex', name: 'Codex', itemLabel: '项目', files },
      { providerId: 'claude-code', name: 'Claude Code', itemLabel: '项目', files: {} },
    ],
    faults: [],
    refreshedAt: timeMs,
    attemptedAt: timeMs,
  }
}

function fixtureWorkerFactory({ mode = 'success', delayMs = 0, snapshot, onCreate } = {}) {
  return () => {
    onCreate?.()
    return new Worker(`
      const { parentPort, workerData } = require('node:worker_threads')
      const until = Date.now() + workerData.delayMs
      while (Date.now() < until) {}
      if (workerData.mode === 'throw') {
        throw new Error('/Users/private/ledger.jsonl synthetic-secret-body')
      }
      if (workerData.mode === 'exit') process.exit(9)
      parentPort.postMessage({ ok: true, snapshot: workerData.snapshot })
    `, {
      eval: true,
      workerData: { mode, delayMs, snapshot: snapshot || fixtureLedgerSnapshot() },
    })
  }
}

async function waitForWorkerState(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = localAiUsageWorkerStateForTests()
    if (predicate(state)) return state
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('本地用量工作线程未在期限内进入目标状态')
}

test('后台账本刷新在工作线程运行时，健康检查和过期用量 HTTP 保持 100ms 级响应', async () => {
  const address = serviceServer.address()
  const localToken = fs.readFileSync(path.join(tempHome, '.openclaw', 'dashboard-local-token'), 'utf8').trim()
  let workerStarts = 0
  setLocalAiUsageWorkerFactoryForTests(fixtureWorkerFactory({
    delayMs: 400,
    snapshot: fixtureLedgerSnapshot(7_000_000),
    onCreate: () => { workerStarts += 1 },
  }))
  await new Promise(resolve => setTimeout(resolve, 35))
  try {
    const usageUrl = `http://127.0.0.1:${address.port}/api/local-ai-usage?days=1`
    const headers = { 'X-Dashboard-Token': localToken }
    const firstStartedAt = Date.now()
    const first = await fetch(usageUrl, { headers })
    const firstElapsed = Date.now() - firstStartedAt
    assert.equal(first.status, 200)
    assert.equal((await first.json()).cache.state, 'stale')
    assert.ok(firstElapsed < 150, `过期用量响应耗时 ${firstElapsed}ms`)

    await waitForWorkerState(state => state.activeWorkers === 1 && state.refreshing)
    const probeStartedAt = Date.now()
    const [health, second] = await Promise.all([
      fetch(`http://127.0.0.1:${address.port}/api/health`),
      fetch(usageUrl, { headers }),
    ])
    const probeElapsed = Date.now() - probeStartedAt
    assert.equal(health.status, 200)
    assert.equal(second.status, 200)
    assert.equal((await second.json()).cache.state, 'stale')
    assert.ok(probeElapsed < 150, `工作线程运行期间 HTTP 响应耗时 ${probeElapsed}ms`)
    assert.equal(workerStarts, 1)
    await waitForWorkerState(state => state.activeWorkers === 0 && !state.refreshing)
  } finally {
    setLocalAiUsageWorkerFactoryForTests(null)
  }
})

test('工作线程抛错不泄漏路径或正文，并进入现有刷新失败冷却', async () => {
  const address = serviceServer.address()
  const localToken = fs.readFileSync(path.join(tempHome, '.openclaw', 'dashboard-local-token'), 'utf8').trim()
  let workerStarts = 0
  setLocalAiUsageWorkerFactoryForTests(fixtureWorkerFactory({
    mode: 'throw',
    delayMs: 50,
    onCreate: () => { workerStarts += 1 },
  }))
  await new Promise(resolve => setTimeout(resolve, 35))
  try {
    const usageUrl = `http://127.0.0.1:${address.port}/api/local-ai-usage?days=1`
    const headers = { 'X-Dashboard-Token': localToken }
    const stale = await fetch(usageUrl, { headers })
    assert.equal(stale.status, 200)
    await waitForWorkerState(state => state.activeWorkers === 0 && !state.refreshing)

    const cooled = await fetch(usageUrl, { headers })
    assert.equal(cooled.status, 200)
    const bodyText = await cooled.text()
    const payload = JSON.parse(bodyText)
    assert.equal(payload.cache.refreshFailed, true)
    assert.equal(payload.cache.failureId, 'local-ai-ledger:worker')
    assert.doesNotMatch(bodyText, /Users\/private|synthetic-secret-body|ledger\.jsonl/)
    assert.equal(workerStarts, 1)
  } finally {
    setLocalAiUsageWorkerFactoryForTests(null)
  }
})

test('清空范围缓存后旧工作线程不得回填，完成后无工作线程残留', async () => {
  const range = {
    startMs: Date.now() - 1_000,
    endMs: Date.now() + 1_000,
    all: false,
    granularity: 'day',
    key: `worker-generation-${Date.now()}`,
  }
  let workerStarts = 0
  const countStart = () => { workerStarts += 1 }
  setLocalAiUsageWorkerFactoryForTests(fixtureWorkerFactory({
    snapshot: fixtureLedgerSnapshot(1_000),
    onCreate: countStart,
  }))
  try {
    const initial = await collectLocalAiUsage(range, configWithGpt56(), { forceRefresh: true })
    assert.equal(initial.totals.tokens, 1_000)
    await new Promise(resolve => setTimeout(resolve, 35))

    setLocalAiUsageWorkerFactoryForTests(fixtureWorkerFactory({
      delayMs: 250,
      snapshot: fixtureLedgerSnapshot(2_000),
      onCreate: countStart,
    }))
    const stale = await collectLocalAiUsage(range, configWithGpt56(), { forceRefresh: true })
    assert.equal(stale.cache.state, 'stale')
    await waitForWorkerState(state => state.activeWorkers === 1 && state.refreshing)

    clearLocalAiUsageCacheForTests()
    setLocalAiUsageWorkerFactoryForTests(fixtureWorkerFactory({
      snapshot: fixtureLedgerSnapshot(3_000),
      onCreate: countStart,
    }))
    const current = await collectLocalAiUsage(range, configWithGpt56(), { forceRefresh: true })
    assert.equal(current.totals.tokens, 3_000)
    assert.equal(workerStarts, 3)
    await waitForWorkerState(state => state.activeWorkers === 0 && !state.refreshing)
    assert.deepEqual(localAiUsageWorkerStateForTests(), { activeWorkers: 0, refreshing: false })
  } finally {
    setLocalAiUsageWorkerFactoryForTests(null)
  }
})
