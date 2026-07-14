const USD_TO_CNY_RATE = 7.2

export const GPT56_BILLING_MODELS = Object.freeze({
  'gpt-5.6-sol': Object.freeze({
    mode: 'per_token',
    inputPriceCNYPerMillion: 5 * USD_TO_CNY_RATE,
    outputPriceCNYPerMillion: 30 * USD_TO_CNY_RATE,
    cacheReadPriceCNYPerMillion: 0.5 * USD_TO_CNY_RATE,
    cacheWritePriceCNYPerMillion: 6.25 * USD_TO_CNY_RATE,
    note: 'OpenAI GPT-5.6 Sol 官方 API 标准短上下文（$5/$30，缓存读 $0.5、5 分钟缓存写 $6.25 per M），汇率 7.2，2026-07 官网核对',
  }),
  'gpt-5.6-terra': Object.freeze({
    mode: 'per_token',
    inputPriceCNYPerMillion: 2.5 * USD_TO_CNY_RATE,
    outputPriceCNYPerMillion: 15 * USD_TO_CNY_RATE,
    cacheReadPriceCNYPerMillion: 0.25 * USD_TO_CNY_RATE,
    cacheWritePriceCNYPerMillion: 3.125 * USD_TO_CNY_RATE,
    note: 'OpenAI GPT-5.6 Terra 官方 API 标准短上下文（$2.5/$15，缓存读 $0.25、5 分钟缓存写 $3.125 per M），汇率 7.2，2026-07 官网核对',
  }),
  'gpt-5.6-luna': Object.freeze({
    mode: 'per_token',
    inputPriceCNYPerMillion: 1 * USD_TO_CNY_RATE,
    outputPriceCNYPerMillion: 6 * USD_TO_CNY_RATE,
    cacheReadPriceCNYPerMillion: 0.1 * USD_TO_CNY_RATE,
    cacheWritePriceCNYPerMillion: 1.25 * USD_TO_CNY_RATE,
    note: 'OpenAI GPT-5.6 Luna 官方 API 标准短上下文（$1/$6，缓存读 $0.1、5 分钟缓存写 $1.25 per M），汇率 7.2，2026-07 官网核对',
  }),
})

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (!value || typeof value !== 'object') return value
  const output = Object.create(null)
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(output, key, {
      value: cloneValue(child),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return output
}

function mergeRecord(defaultValue, savedValue) {
  const output = cloneValue(defaultValue && typeof defaultValue === 'object' ? defaultValue : {})
  if (!savedValue || typeof savedValue !== 'object' || Array.isArray(savedValue)) return output
  for (const [key, value] of Object.entries(savedValue)) {
    Object.defineProperty(output, key, {
      value: cloneValue(value),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return output
}

/**
 * 把新增的内置模型补入已有配置，同时保留部署者的全部自定义值。
 * 该函数只返回内存中的有效配置，不修改或保存原配置文件。
 */
export function mergeBillingConfigWithDefaults(defaults, saved) {
  const effective = mergeRecord(defaults, saved)
  const defaultModels = defaults?.models && typeof defaults.models === 'object' ? defaults.models : {}
  const savedModels = saved?.models && typeof saved.models === 'object' ? saved.models : {}
  const models = Object.create(null)

  for (const [modelId, defaultConfig] of Object.entries(defaultModels)) {
    Object.defineProperty(models, modelId, {
      value: mergeRecord(defaultConfig, savedModels[modelId]),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  for (const [modelId, savedConfig] of Object.entries(savedModels)) {
    if (Object.hasOwn(models, modelId)) continue
    Object.defineProperty(models, modelId, {
      value: cloneValue(savedConfig),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  effective.models = models
  effective.fallback = mergeRecord(defaults?.fallback, saved?.fallback)
  effective.globalAddons = mergeRecord(defaults?.globalAddons, saved?.globalAddons)
  return effective
}

export function mergePriceStatus(current, incoming) {
  if (!incoming) return current
  if (!current) return incoming
  if (current === incoming) return current
  return 'partial'
}
