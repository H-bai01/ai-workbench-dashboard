const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000

function safeMessage(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAbortError(error) {
  return error?.name === 'AbortError'
}

async function readJsonResponse(response) {
  try {
    const body = await response.json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

function responseFailure(response, body) {
  const bodyError = safeMessage(body?.error, '')
  if (bodyError) {
    return {
      kind: bodyError.startsWith('模型识别失败：') ? 'model_error' : 'data_error',
      message: bodyError,
      httpStatus: response.status,
    }
  }
  if (!response.ok || !body) {
    return {
      kind: 'service_unavailable',
      message: '统计服务暂时不可用',
      httpStatus: response.status,
    }
  }
  return null
}

export function createUsageStatisticsManager({
  notify,
  now = () => Date.now(),
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
} = {}) {
  const activeFailures = new Map()

  function notificationFor(failure, request) {
    const modelFailure = failure.kind === 'model_error'
    const backgroundFailure = failure.kind === 'background_refresh_error'
    const errorCode = modelFailure
      ? 'usage_model_unrecognized'
      : backgroundFailure
        ? 'usage_background_refresh_failed'
        : 'usage_statistics_failed'
    const message = modelFailure
      ? failure.message
      : backgroundFailure
        ? '后台更新失败，当前数据未更新'
        : '费用统计加载失败'

    return {
      type: 'error',
      agentId: 'usage-statistics',
      agentName: '费用统计',
      message,
      source: 'Token 与费用统计',
      detail: modelFailure ? failure.message : backgroundFailure
        ? '后台刷新没有生成新的完整统计结果。'
        : '统计服务返回了无法完成计算的数据错误。',
      errorCode,
      httpStatus: failure.httpStatus,
      impact: `${request.rangeLabel || '当前'}范围的数据未更新。`,
      currentResult: request.hasPublishedData
        ? '页面继续显示上一份已经完成的统计结果。'
        : '当前还没有可以显示的完整统计结果。',
      timeRange: request.rangeLabel,
      retryAction: request.prewarm ? 'prewarm-token-usage' : 'refresh-token-usage',
    }
  }

  function reportFailure(failure, request) {
    if (failure.kind === 'service_unavailable' || failure.kind === 'aborted') return
    const scopeKey = request.scopeKey || 'usage'
    const fingerprint = `${failure.kind}:${failure.message}`
    if (activeFailures.get(scopeKey) === fingerprint) return
    activeFailures.set(scopeKey, fingerprint)
    notify?.(notificationFor(failure, request), { dedupeWindowMs, now: now() })
  }

  async function load(request) {
    let responses
    try {
      responses = await Promise.all([
        fetch(request.timelineUrl, { signal: request.signal }),
        fetch(request.localUsageUrl, { signal: request.signal }),
      ])
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: isAbortError(error) ? 'aborted' : 'service_unavailable',
          message: '统计服务暂时不可用',
        },
      }
    }

    const [timelineResponse, localUsageResponse] = responses
    const [timelineData, localUsageData] = await Promise.all([
      readJsonResponse(timelineResponse),
      readJsonResponse(localUsageResponse),
    ])
    const failure = responseFailure(timelineResponse, timelineData)
      || responseFailure(localUsageResponse, localUsageData)
    if (failure) {
      reportFailure(failure, request)
      return { ok: false, failure }
    }

    const scopeKey = request.scopeKey || 'usage'
    activeFailures.delete(scopeKey)

    if (localUsageData?.cache?.refreshFailed === true) {
      const backgroundFailure = {
        kind: 'background_refresh_error',
        message: '后台刷新没有生成新的完整统计结果。',
      }
      reportFailure(backgroundFailure, request)
      return {
        ok: true,
        timelineData,
        localUsageData,
        refreshFailed: true,
      }
    }

    return {
      ok: true,
      timelineData,
      localUsageData,
      refreshFailed: false,
    }
  }

  function reset(scopeKey) {
    if (scopeKey) activeFailures.delete(scopeKey)
    else activeFailures.clear()
  }

  return { load, reset }
}
