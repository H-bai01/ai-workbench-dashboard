import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { mergeBillingConfigWithDefaults } from './billing-config.mjs'
import {
  BUILTIN_MODEL_PRICE_CATALOG,
  catalogToBillingModels,
  createModelPriceCatalogStore,
  createProviderCatalogAdapter,
  parseAnthropicPricingPage,
  parseOpenAiPricingPage,
  validateModelPriceCatalog,
} from './model-price-catalog.mjs'

const ANTHROPIC_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing'

function catalog(entries, updatedAt = '2026-07-27T00:00:00.000Z') {
  return {
    schemaVersion: 1,
    updatedAt,
    entries,
  }
}

function anthropicEntry(modelId, {
  input = 1,
  output = 5,
  cacheWrite = 1.25,
  cacheRead = 0.1,
  sourceUrl = ANTHROPIC_SOURCE,
} = {}) {
  return {
    provider: 'anthropic',
    modelId,
    currency: 'USD',
    exchangeRateCNY: 7.2,
    effectiveAt: '2026-07-27',
    sourceUrl,
    prices: {
      inputPerMillion: input,
      outputPerMillion: output,
      cacheWritePerMillion: cacheWrite,
      cacheReadPerMillion: cacheRead,
    },
  }
}

test('内置目录包含 claude-opus-5 的官方等价价格', () => {
  const models = catalogToBillingModels(BUILTIN_MODEL_PRICE_CATALOG)
  assert.deepEqual(
    {
      input: models['claude-opus-5'].inputPriceCNYPerMillion,
      output: models['claude-opus-5'].outputPriceCNYPerMillion,
      cacheWrite: models['claude-opus-5'].cacheWritePriceCNYPerMillion,
      cacheRead: models['claude-opus-5'].cacheReadPriceCNYPerMillion,
    },
    { input: 36, output: 180, cacheWrite: 45, cacheRead: 3.6 },
  )

  const oneMillionOfEach = 36 + 180 + 45 + 3.6
  assert.equal(oneMillionOfEach, 264.6)
})

test('Anthropic 只按官方 Claude API ID 字段解析新模型，不依赖系列名称枚举', () => {
  const models = `
    <table><tr><th>Feature</th><th>Claude Aurora 9</th><th>Claude Opus 5</th></tr>
    <tr><td>Claude API ID</td><td>claude-aurora-9-20260727</td><td>claude-opus-5</td></tr></table>
  `
  const pricing = `
    <table><tr><th>Model</th><th>Base Input Tokens</th><th>5m Cache Writes</th><th>1h Cache Writes</th><th>Cache Hits &amp; Refreshes</th><th>Output Tokens</th></tr>
    <tr><td>Claude Aurora 9</td><td>$7 / MTok</td><td>$8.75 / MTok</td><td>$14 / MTok</td><td>$0.70 / MTok</td><td>$35 / MTok</td></tr>
    <tr><td>Claude Opus 5</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr></table>
  `
  const parsed = parseAnthropicPricingPage(pricing, models, {
    effectiveAt: '2026-07-27',
    updatedAt: '2026-07-27T00:00:00.000Z',
  })
  assert.deepEqual(parsed.entries.map(item => item.modelId), ['claude-aurora-9-20260727', 'claude-opus-5'])
  assert.equal(parsed.entries[0].prices.inputPerMillion, 7)
})

test('OpenAI 官方表格按 Model 列解析任意合法模型 ID', () => {
  const page = `
    <table><tr><th></th><th>Short context</th></tr>
    <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Cache writes</th><th>Output</th></tr>
    <tr><td>nova-agent-2027</td><td>$5.00</td><td>$0.50</td><td>$6.25</td><td>$30.00</td></tr>
    <tr><td>gpt-5.6-terra</td><td>$2.50</td><td>$0.25</td><td>$3.125</td><td>$15.00</td></tr></table>
  `
  const parsed = parseOpenAiPricingPage(page, {
    effectiveAt: '2026-07-27',
    updatedAt: '2026-07-27T00:00:00.000Z',
  })
  assert.deepEqual(parsed.entries.map(item => item.modelId), ['nova-agent-2027', 'gpt-5.6-terra'])
  assert.deepEqual(parsed.entries[0].prices, {
    inputPerMillion: 5,
    outputPerMillion: 30,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  })
})

test('供应商独立更新：一方失败不阻断另一方，失败方旧目录继续保留', async () => {
  const openAiSource = 'https://developers.openai.com/api/docs/pricing'
  const oldOpenAi = {
    provider: 'openai', modelId: 'openai-retained-1', currency: 'USD', exchangeRateCNY: 7.2,
    effectiveAt: '2026-07-20', sourceUrl: openAiSource,
    prices: { inputPerMillion: 2, outputPerMillion: 8 },
  }
  const seed = catalog([oldOpenAi], '2026-07-20T00:00:00.000Z')
  seed.providerUpdatedAt = { openai: seed.updatedAt }
  const anthropic = createProviderCatalogAdapter({
    provider: 'anthropic', sourceUrl: ANTHROPIC_SOURCE,
    async fetchCatalog() { return catalog([anthropicEntry('claude-new-7')], '2026-07-27T00:00:00.000Z') },
  })
  const openai = createProviderCatalogAdapter({
    provider: 'openai', sourceUrl: openAiSource,
    async fetchCatalog() { throw new Error('temporary failure') },
  })
  const store = createModelPriceCatalogStore({ seedCatalog: seed, adapters: [anthropic, openai] })
  const result = await store.sync({ force: true })
  assert.deepEqual(result.failures, ['openai'])
  assert.equal(store.hasModel('claude-new-7'), true)
  assert.equal(store.hasModel('openai-retained-1'), true)
})

test('缺失模型触发一次共享同步并持久化验证后的目录', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-catalog-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const cachePath = path.join(root, 'private', 'catalog.json')
  let fetchCount = 0
  const adapter = createProviderCatalogAdapter({
    provider: 'anthropic',
    sourceUrl: ANTHROPIC_SOURCE,
    async fetchCatalog() {
      fetchCount += 1
      await new Promise(resolve => setTimeout(resolve, 20))
      return catalog([anthropicEntry('claude-future-6')])
    },
  })
  const store = createModelPriceCatalogStore({
    adapters: [adapter],
    cachePath,
    now: () => Date.parse('2026-07-27T12:00:00.000Z'),
  })

  const results = await Promise.all([
    store.ensureModels(['claude-future-6']),
    store.ensureModels(['claude-future-6']),
    store.sync({ force: true }),
  ])
  assert.equal(fetchCount, 1)
  assert.equal(results[0].resolved, true)
  assert.equal(store.hasModel('claude-future-6'), true)
  assert.equal(fs.statSync(cachePath).mode & 0o777, 0o600)

  const loadedFromCache = createModelPriceCatalogStore({
    adapters: [adapter],
    cachePath,
    now: () => Date.parse('2026-07-27T12:10:00.000Z'),
  })
  assert.equal(loadedFromCache.hasModel('claude-future-6'), true)
  await loadedFromCache.sync()
  assert.equal(fetchCount, 1)
})

test('无效官方响应不会覆盖上一份有效目录或内存结果', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-catalog-invalid-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const cachePath = path.join(root, 'catalog.json')
  let nextCatalog = catalog([anthropicEntry('claude-safe-6')])
  const adapter = createProviderCatalogAdapter({
    provider: 'anthropic',
    sourceUrl: ANTHROPIC_SOURCE,
    async fetchCatalog() {
      return nextCatalog
    },
  })
  const store = createModelPriceCatalogStore({ adapters: [adapter], cachePath })
  await store.sync({ force: true })
  const before = fs.readFileSync(cachePath, 'utf8')

  nextCatalog = catalog([anthropicEntry('claude-hostile-6', {
    input: -1,
    sourceUrl: 'https://example.com/pricing',
  })], '2026-07-27T01:00:00.000Z')
  await assert.rejects(() => store.sync({ force: true }))
  assert.equal(store.hasModel('claude-safe-6'), true)
  assert.equal(store.hasModel('claude-hostile-6'), false)
  assert.equal(fs.readFileSync(cachePath, 'utf8'), before)
})

test('目录拒绝重复冲突、非官方来源和非法价格', () => {
  assert.throws(() => validateModelPriceCatalog(catalog([
    anthropicEntry('claude-duplicate-6'),
    anthropicEntry('claude-duplicate-6', { input: 2 }),
  ])), /冲突模型/)
  assert.throws(() => validateModelPriceCatalog(catalog([
    anthropicEntry('claude-unofficial-6', { sourceUrl: 'https://example.com/pricing' }),
  ])), /官方域名/)
  assert.throws(() => validateModelPriceCatalog(catalog([
    anthropicEntry('claude-negative-6', { output: -1 }),
  ])), /字段无效/)
})

test('部署者自定义价格优先于自动目录，新增模型仍会补入', () => {
  const defaults = {
    version: 1,
    models: catalogToBillingModels(catalog([
      anthropicEntry('claude-opus-5', { input: 5, output: 25 }),
      anthropicEntry('claude-future-6'),
    ])),
  }
  const merged = mergeBillingConfigWithDefaults(defaults, {
    models: {
      'claude-opus-5': {
        inputPriceCNYPerMillion: 99,
        note: '部署者自定义',
      },
    },
  })
  assert.equal(merged.models['claude-opus-5'].inputPriceCNYPerMillion, 99)
  assert.equal(merged.models['claude-opus-5'].outputPriceCNYPerMillion, 180)
  assert.equal(merged.models['claude-future-6'].inputPriceCNYPerMillion, 7.2)
})
