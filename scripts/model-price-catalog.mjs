import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

export const MODEL_CATALOG_SCHEMA_VERSION = 1
export const MODEL_CATALOG_REFRESH_MS = 24 * 60 * 60 * 1000
export const MODEL_CATALOG_FETCH_TIMEOUT_MS = 15_000
export const DEFAULT_USD_TO_CNY_RATE = 7.2

const execFileAsync = promisify(execFile)
const PROVIDERS = Object.freeze(['anthropic', 'openai'])
const OFFICIAL_PROVIDER_HOSTS = Object.freeze({
  anthropic: Object.freeze(['platform.claude.com']),
  openai: Object.freeze(['developers.openai.com']),
})
const ANTHROPIC_MODELS_URL = 'https://platform.claude.com/docs/en/about-claude/models/overview'
const ANTHROPIC_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'
const OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing'

function entry(provider, modelId, input, output, cacheWrite, cacheRead, effectiveAt, sourceUrl) {
  return {
    provider,
    modelId,
    currency: 'USD',
    exchangeRateCNY: DEFAULT_USD_TO_CNY_RATE,
    effectiveAt,
    sourceUrl,
    prices: {
      inputPerMillion: input,
      outputPerMillion: output,
      ...(cacheWrite === undefined ? {} : { cacheWritePerMillion: cacheWrite }),
      ...(cacheRead === undefined ? {} : { cacheReadPerMillion: cacheRead }),
    },
  }
}

// 现有已审核模型继续由 unified-service 的 BILLING_DEFAULTS 提供；这里只补入
// 已从官方固定价格页核实、但旧配置尚未包含的模型。
export const BUILTIN_MODEL_PRICE_CATALOG = Object.freeze({
  schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
  updatedAt: '2026-07-24T00:00:00.000Z',
  providerUpdatedAt: Object.freeze({ anthropic: '2026-07-24T00:00:00.000Z' }),
  entries: Object.freeze([
    entry('anthropic', 'claude-opus-5', 5, 25, 6.25, 0.5, '2026-07-24', ANTHROPIC_PRICING_URL),
  ]),
})

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function assertFiniteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`模型目录字段无效：${label}`)
  }
}

function officialUrl(provider, rawUrl) {
  let url
  try { url = new URL(String(rawUrl || '')) } catch { throw new Error('模型目录来源地址无效') }
  if (url.protocol !== 'https:') throw new Error('模型目录来源必须使用 HTTPS')
  if (!(OFFICIAL_PROVIDER_HOSTS[provider] || []).includes(url.hostname.toLowerCase())) {
    throw new Error(`模型目录来源不是 ${provider} 官方域名`)
  }
  return url.toString()
}

function validateProviderUpdatedAt(value) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型目录供应商更新时间无效')
  const result = {}
  for (const [provider, timestamp] of Object.entries(value)) {
    if (!PROVIDERS.includes(provider) || !Number.isFinite(Date.parse(String(timestamp)))) {
      throw new Error('模型目录供应商更新时间无效')
    }
    result[provider] = String(timestamp)
  }
  return result
}

export function validateModelPriceCatalog(rawCatalog, { provider } = {}) {
  if (!rawCatalog || typeof rawCatalog !== 'object' || Array.isArray(rawCatalog)) throw new Error('模型目录必须是对象')
  if (rawCatalog.schemaVersion !== MODEL_CATALOG_SCHEMA_VERSION) throw new Error('模型目录版本不受支持')
  if (!Array.isArray(rawCatalog.entries)) throw new Error('模型目录缺少 entries')

  const seen = new Map()
  const entries = rawCatalog.entries.map((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) throw new Error(`模型目录第 ${index + 1} 项无效`)
    const normalizedProvider = String(rawEntry.provider || '').trim().toLowerCase()
    const modelId = String(rawEntry.modelId || '').trim()
    if (!PROVIDERS.includes(normalizedProvider)) throw new Error(`模型目录 provider 无效：${normalizedProvider || 'empty'}`)
    if (provider && normalizedProvider !== provider) throw new Error('模型目录混入其他 provider')
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/.test(modelId)) throw new Error(`模型 ID 无效：${modelId || 'empty'}`)
    if (String(rawEntry.currency || '').toUpperCase() !== 'USD') throw new Error(`模型目录币种无效：${modelId}`)
    assertFiniteNonNegative(rawEntry.exchangeRateCNY, `${modelId}.exchangeRateCNY`)
    if (rawEntry.exchangeRateCNY === 0) throw new Error(`模型目录汇率无效：${modelId}`)
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(String(rawEntry.effectiveAt || ''))) throw new Error(`模型目录生效日期无效：${modelId}`)
    const sourceUrl = officialUrl(normalizedProvider, rawEntry.sourceUrl)
    const prices = rawEntry.prices
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) throw new Error(`模型目录价格缺失：${modelId}`)
    assertFiniteNonNegative(prices.inputPerMillion, `${modelId}.inputPerMillion`)
    assertFiniteNonNegative(prices.outputPerMillion, `${modelId}.outputPerMillion`)
    if (prices.cacheReadPerMillion !== undefined) assertFiniteNonNegative(prices.cacheReadPerMillion, `${modelId}.cacheReadPerMillion`)
    if (prices.cacheWritePerMillion !== undefined) assertFiniteNonNegative(prices.cacheWritePerMillion, `${modelId}.cacheWritePerMillion`)

    const normalized = {
      provider: normalizedProvider,
      modelId,
      currency: 'USD',
      exchangeRateCNY: rawEntry.exchangeRateCNY,
      effectiveAt: rawEntry.effectiveAt,
      sourceUrl,
      prices: {
        inputPerMillion: prices.inputPerMillion,
        outputPerMillion: prices.outputPerMillion,
        ...(prices.cacheReadPerMillion === undefined ? {} : { cacheReadPerMillion: prices.cacheReadPerMillion }),
        ...(prices.cacheWritePerMillion === undefined ? {} : { cacheWritePerMillion: prices.cacheWritePerMillion }),
      },
    }
    const key = modelId.toLowerCase()
    if (seen.has(key)) {
      if (JSON.stringify(seen.get(key)) !== JSON.stringify(normalized)) throw new Error(`模型目录存在冲突模型：${modelId}`)
      throw new Error(`模型目录存在重复模型：${modelId}`)
    }
    seen.set(key, normalized)
    return normalized
  })

  const updatedAt = String(rawCatalog.updatedAt || '')
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('模型目录更新时间无效')
  return {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    updatedAt,
    providerUpdatedAt: validateProviderUpdatedAt(rawCatalog.providerUpdatedAt),
    entries,
  }
}

function newerEntry(current, incoming) {
  if (!current) return incoming
  return Date.parse(incoming.effectiveAt) > Date.parse(current.effectiveAt) ? incoming : current
}

export function mergeModelPriceCatalogs(...catalogs) {
  const byModel = new Map()
  const providerUpdatedAt = {}
  let latestUpdatedAt = 0
  for (const candidate of catalogs.filter(Boolean)) {
    const catalog = validateModelPriceCatalog(candidate)
    latestUpdatedAt = Math.max(latestUpdatedAt, Date.parse(catalog.updatedAt))
    for (const [provider, timestamp] of Object.entries(catalog.providerUpdatedAt)) {
      if (!providerUpdatedAt[provider] || Date.parse(timestamp) > Date.parse(providerUpdatedAt[provider])) providerUpdatedAt[provider] = timestamp
    }
    for (const item of catalog.entries) {
      const key = item.modelId.toLowerCase()
      const current = byModel.get(key)
      if (current && current.provider !== item.provider) throw new Error(`模型目录 provider 冲突：${item.modelId}`)
      byModel.set(key, newerEntry(current, item))
    }
  }
  return {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    updatedAt: new Date(latestUpdatedAt || Date.now()).toISOString(),
    providerUpdatedAt,
    entries: [...byModel.values()].sort((a, b) => a.modelId.localeCompare(b.modelId)),
  }
}

export function catalogToBillingModels(rawCatalog) {
  const models = Object.create(null)
  for (const item of validateModelPriceCatalog(rawCatalog).entries) {
    const rate = item.exchangeRateCNY
    models[item.modelId] = {
      mode: 'per_token',
      inputPriceCNYPerMillion: item.prices.inputPerMillion * rate,
      outputPriceCNYPerMillion: item.prices.outputPerMillion * rate,
      ...(item.prices.cacheReadPerMillion === undefined ? {} : { cacheReadPriceCNYPerMillion: item.prices.cacheReadPerMillion * rate }),
      ...(item.prices.cacheWritePerMillion === undefined ? {} : { cacheWritePriceCNYPerMillion: item.prices.cacheWritePerMillion * rate }),
      note: `${item.provider} 官方价格，来源 ${item.sourceUrl}，生效日期 ${item.effectiveAt}，USD/CNY ${rate}`,
    }
  }
  return models
}

export function createProviderCatalogAdapter({ provider, sourceUrl, fetchCatalog }) {
  const normalizedProvider = String(provider || '').trim().toLowerCase()
  if (!PROVIDERS.includes(normalizedProvider)) throw new Error('provider adapter 无效')
  officialUrl(normalizedProvider, sourceUrl)
  if (typeof fetchCatalog !== 'function') throw new Error('provider adapter 缺少 fetchCatalog')
  return Object.freeze({
    provider: normalizedProvider,
    sourceUrl,
    async fetch({ fetchImpl, signal }) {
      const catalog = validateModelPriceCatalog(await fetchCatalog({ fetchImpl, signal, sourceUrl }), { provider: normalizedProvider })
      if (!catalog.providerUpdatedAt[normalizedProvider]) {
        catalog.providerUpdatedAt[normalizedProvider] = catalog.updatedAt
      }
      return catalog
    },
  })
}

function decodeText(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&dollar;|&#36;/gi, '$')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function extractHtmlTables(html) {
  return [...String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(tableMatch =>
    [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(rowMatch =>
      [...rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(cell => decodeText(cell[1])),
    ).filter(row => row.length),
  ).filter(table => table.length)
}

function usdPrice(cell) {
  const match = decodeText(cell).match(/\$\s*([0-9]+(?:\.[0-9]+)?)/)
  return match ? Number(match[1]) : undefined
}

function normalizedLabel(value) {
  return decodeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function validModelId(value) {
  const candidate = decodeText(value).trim()
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/.test(candidate) ? candidate : ''
}

export function parseAnthropicPricingPage(pricingHtml, modelsHtml, {
  sourceUrl = ANTHROPIC_PRICING_URL,
  effectiveAt = new Date().toISOString().slice(0, 10),
  updatedAt = new Date().toISOString(),
} = {}) {
  const modelIdsByLabel = new Map()
  for (const table of extractHtmlTables(modelsHtml)) {
    const headers = table[0] || []
    const apiIdRow = table.find(row => normalizedLabel(row[0]) === 'claudeapiid')
    if (!apiIdRow) continue
    for (let index = 1; index < Math.min(headers.length, apiIdRow.length); index += 1) {
      const modelId = validModelId(apiIdRow[index])
      if (modelId) modelIdsByLabel.set(normalizedLabel(headers[index]), modelId)
    }
  }

  const entriesByModel = new Map()
  for (const table of extractHtmlTables(pricingHtml)) {
    const header = (table[0] || []).map(normalizedLabel)
    const modelIndex = header.findIndex(value => value === 'model')
    const inputIndex = header.findIndex(value => value.includes('baseinput'))
    const cacheWriteIndex = header.findIndex(value => value.includes('5mcachewrite'))
    const cacheReadIndex = header.findIndex(value => value.includes('cachehits'))
    const outputIndex = header.findIndex(value => value.includes('outputtoken'))
    if ([modelIndex, inputIndex, cacheWriteIndex, cacheReadIndex, outputIndex].some(index => index < 0)) continue
    for (const row of table.slice(1)) {
      const rowLabel = normalizedLabel(row[modelIndex])
      const mapped = [...modelIdsByLabel.entries()].find(([label]) => rowLabel.startsWith(label))
      const modelId = mapped?.[1] || ''
      const input = usdPrice(row[inputIndex])
      const output = usdPrice(row[outputIndex])
      const cacheWrite = usdPrice(row[cacheWriteIndex])
      const cacheRead = usdPrice(row[cacheReadIndex])
      if (!modelId || [input, output, cacheWrite, cacheRead].some(value => value === undefined)) continue
      if (!entriesByModel.has(modelId.toLowerCase())) {
        entriesByModel.set(modelId.toLowerCase(), entry('anthropic', modelId, input, output, cacheWrite, cacheRead, effectiveAt, sourceUrl))
      }
    }
  }
  return validateModelPriceCatalog({
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    updatedAt,
    providerUpdatedAt: { anthropic: updatedAt },
    entries: [...entriesByModel.values()],
  }, { provider: 'anthropic' })
}

export function parseOpenAiPricingPage(html, {
  sourceUrl = OPENAI_PRICING_URL,
  effectiveAt = new Date().toISOString().slice(0, 10),
  updatedAt = new Date().toISOString(),
} = {}) {
  const entriesByModel = new Map()
  for (const table of extractHtmlTables(html)) {
    const candidateHeaders = table.slice(0, 2)
    let header = candidateHeaders[0]?.map(normalizedLabel) || []
    let dataStart = 1
    if (!header.includes('model') && candidateHeaders[1]?.map(normalizedLabel).includes('model')) {
      header = candidateHeaders[1].map(normalizedLabel)
      dataStart = 2
    }
    const modelIndex = header.findIndex(value => value === 'model')
    const inputIndex = header.findIndex(value => value === 'input')
    const cacheReadIndex = header.findIndex(value => value === 'cachedinput')
    const cacheWriteIndex = header.findIndex(value => value === 'cachewrites')
    const outputIndex = header.findIndex(value => value === 'output' || value === 'outputcost')
    if (modelIndex < 0 || inputIndex < 0 || outputIndex < 0) continue
    for (const row of table.slice(dataStart)) {
      const modelId = validModelId(row[modelIndex])
      const input = usdPrice(row[inputIndex])
      const output = usdPrice(row[outputIndex])
      if (!modelId || input === undefined || output === undefined) continue
      const cacheRead = cacheReadIndex < 0 ? undefined : usdPrice(row[cacheReadIndex])
      const cacheWrite = cacheWriteIndex < 0 ? undefined : usdPrice(row[cacheWriteIndex])
      if (!entriesByModel.has(modelId.toLowerCase())) {
        entriesByModel.set(modelId.toLowerCase(), entry('openai', modelId, input, output, cacheWrite, cacheRead, effectiveAt, sourceUrl))
      }
    }
  }
  return validateModelPriceCatalog({
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    updatedAt,
    providerUpdatedAt: { openai: updatedAt },
    entries: [...entriesByModel.values()],
  }, { provider: 'openai' })
}

async function readWithFetch(fetchImpl, provider, sourceUrl, signal) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable')
  const response = await fetchImpl(sourceUrl, { signal, headers: { accept: 'text/html' } })
  if (!response?.ok) throw new Error('official source unavailable')
  officialUrl(provider, response.url || sourceUrl)
  return response.text()
}

async function readWithCurl(provider, sourceUrl, signal) {
  const { stdout } = await execFileAsync('curl', [
    '--fail', '--silent', '--show-error', '--location', '--max-time', '12',
    '--user-agent', 'AI-Workbench-Dashboard/2.12', '--write-out', '\n%{url_effective}', sourceUrl,
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, signal })
  const lastBreak = stdout.lastIndexOf('\n')
  if (lastBreak < 0) throw new Error('official source response invalid')
  officialUrl(provider, stdout.slice(lastBreak + 1).trim())
  return stdout.slice(0, lastBreak)
}

async function officialDocuments(provider, sourceUrls, fetchImpl, signal) {
  const readers = [readWithFetch, (_fetch, p, url, s) => readWithCurl(p, url, s)]
  const failures = []
  for (const reader of readers) {
    try {
      const documents = []
      for (const sourceUrl of sourceUrls) documents.push(await reader(fetchImpl, provider, sourceUrl, signal))
      return documents
    } catch (error) { failures.push(error) }
  }
  throw new AggregateError(failures, `${provider} 官方模型目录同步失败`)
}

export function createAnthropicOfficialCatalogAdapter() {
  return createProviderCatalogAdapter({
    provider: 'anthropic',
    sourceUrl: ANTHROPIC_PRICING_URL,
    async fetchCatalog({ fetchImpl, signal }) {
      const [pricing, models] = await officialDocuments('anthropic', [ANTHROPIC_PRICING_URL, ANTHROPIC_MODELS_URL], fetchImpl, signal)
      const catalog = parseAnthropicPricingPage(pricing, models)
      if (!catalog.entries.length) throw new Error('Anthropic 官方模型目录没有可用条目')
      return catalog
    },
  })
}

export function createOpenAiOfficialCatalogAdapter() {
  return createProviderCatalogAdapter({
    provider: 'openai',
    sourceUrl: OPENAI_PRICING_URL,
    async fetchCatalog({ fetchImpl, signal }) {
      const [pricing] = await officialDocuments('openai', [OPENAI_PRICING_URL], fetchImpl, signal)
      const catalog = parseOpenAiPricingPage(pricing)
      if (!catalog.entries.length) throw new Error('OpenAI 官方模型目录没有可用条目')
      return catalog
    },
  })
}

function readCache(cachePath) {
  try {
    const stat = fs.lstatSync(cachePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('模型目录缓存文件不安全')
    return validateModelPriceCatalog(JSON.parse(fs.readFileSync(cachePath, 'utf8')))
  } catch { return null }
}

function writeCacheAtomic(cachePath, catalog) {
  const parent = path.dirname(cachePath)
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
  const parentStat = fs.lstatSync(parent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('模型目录缓存目录不安全')
  try {
    const existing = fs.lstatSync(cachePath)
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('模型目录缓存文件不安全')
  } catch (error) { if (error?.code !== 'ENOENT') throw error }
  const temporary = path.join(parent, `.${path.basename(cachePath)}.${process.pid}.${Date.now()}.tmp`)
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try { fs.renameSync(temporary, cachePath) } catch (error) { try { fs.unlinkSync(temporary) } catch {}; throw error }
}

function catalogForProvider(catalog, provider) {
  const timestamp = catalog?.providerUpdatedAt?.[provider] || catalog?.updatedAt
  return {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    updatedAt: timestamp || new Date(0).toISOString(),
    providerUpdatedAt: timestamp ? { [provider]: timestamp } : {},
    entries: (catalog?.entries || []).filter(item => item.provider === provider),
  }
}

export function createModelPriceCatalogStore({
  seedCatalog = BUILTIN_MODEL_PRICE_CATALOG,
  adapters = [],
  cachePath,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  refreshMs = MODEL_CATALOG_REFRESH_MS,
  timeoutMs = MODEL_CATALOG_FETCH_TIMEOUT_MS,
} = {}) {
  const seed = validateModelPriceCatalog(seedCatalog)
  let remoteCatalog = cachePath ? readCache(cachePath) : null
  let effectiveCatalog = mergeModelPriceCatalogs(seed, remoteCatalog)
  let inFlight = null
  const hasModel = modelId => effectiveCatalog.entries.some(item => item.modelId.toLowerCase() === String(modelId || '').trim().toLowerCase())

  const sync = async ({ force = false } = {}) => {
    if (inFlight) return inFlight
    const dueAdapters = adapters.filter(adapter => {
      if (force) return true
      const last = remoteCatalog?.providerUpdatedAt?.[adapter.provider]
      return !last || now() - Date.parse(last) >= refreshMs
    })
    if (!dueAdapters.length) return { updated: false, catalog: clone(effectiveCatalog), failures: [] }

    inFlight = (async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      timer.unref?.()
      try {
        const settled = await Promise.allSettled(dueAdapters.map(adapter => adapter.fetch({ fetchImpl, signal: controller.signal })))
        const failures = []
        const successful = []
        settled.forEach((result, index) => {
          if (result.status === 'fulfilled') successful.push({ provider: dueAdapters[index].provider, catalog: result.value })
          else failures.push({ provider: dueAdapters[index].provider, error: result.reason })
        })
        if (!successful.length) throw new AggregateError(failures.map(item => item.error), '官方模型目录同步失败')

        const providerCatalogs = PROVIDERS.map(provider => {
          const replacement = successful.find(item => item.provider === provider)?.catalog
          return replacement || catalogForProvider(remoteCatalog, provider)
        }).filter(catalog => catalog.entries.length || Object.keys(catalog.providerUpdatedAt).length)
        const nextRemote = mergeModelPriceCatalogs(...providerCatalogs)
        const nextEffective = mergeModelPriceCatalogs(seed, nextRemote)
        if (cachePath) writeCacheAtomic(cachePath, nextRemote)
        remoteCatalog = nextRemote
        effectiveCatalog = nextEffective
        return { updated: true, catalog: clone(effectiveCatalog), failures: failures.map(item => item.provider) }
      } finally { clearTimeout(timer) }
    })()
    try { return await inFlight } finally { inFlight = null }
  }

  return {
    getCatalog: () => clone(effectiveCatalog),
    getBillingModels: () => catalogToBillingModels(effectiveCatalog),
    hasModel,
    sync,
    async ensureModels(modelIds) {
      const missing = [...new Set((modelIds || []).map(value => String(value || '').trim()).filter(Boolean))].filter(modelId => !hasModel(modelId))
      if (!missing.length) return { updated: false, resolved: true, catalog: clone(effectiveCatalog) }
      const result = await sync({ force: true })
      return { ...result, resolved: missing.every(hasModel) }
    },
  }
}
