const INDEX_QUERY_KEYS = new Set(['source'])
const SESSION_QUERY_KEYS = new Set(['source', 'agentId', 'sessionId', 'sessionIds'])
const EVENT_QUERY_KEYS = new Set(['source', 'sessionId', 'cursor', 'limit', 'type', 'types', 'errorsOnly'])

function assertAllowedQuery(searchParams, allowedKeys) {
  if ([...searchParams.keys()].some(key => !allowedKeys.has(key))) {
    throw new Error('请求包含不支持的查询参数')
  }
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : '操作失败'
}

export async function handleSessionObservationRoute({
  req,
  res,
  url,
  pathname,
  store,
  getSecrets,
  readBillingConfig,
  enrichUsage,
  enrichEvent,
  sendJson,
}) {
  if (pathname === '/api/session-observation/capabilities' && req.method === 'GET') {
    sendJson(res, 200, { capabilities: store.capabilities(), readOnly: true })
    return true
  }

  if (pathname === '/api/session-observation/index' && req.method === 'GET') {
    try {
      assertAllowedQuery(url.searchParams, INDEX_QUERY_KEYS)
      const source = String(url.searchParams.get('source') || '').trim()
      const sessions = store.indexSnapshot(getSecrets())
        .filter(session => !source || session.source === source)
        .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
      sendJson(res, 200, {
        sessions,
        sources: [...new Set(sessions.map(session => session.source))],
        readOnly: true,
      })
    } catch (error) {
      sendJson(res, 400, { error: errorMessage(error), sessions: [], readOnly: true })
    }
    return true
  }

  if (pathname === '/api/session-observation/sessions' && req.method === 'GET') {
    try {
      assertAllowedQuery(url.searchParams, SESSION_QUERY_KEYS)
      const sessionIds = [
        ...url.searchParams.getAll('sessionId'),
        ...String(url.searchParams.get('sessionIds') || '').split(','),
      ].map(value => value.trim()).filter(Boolean)
      const result = await store.listSessions({
        source: String(url.searchParams.get('source') || ''),
        agentId: String(url.searchParams.get('agentId') || ''),
        sessionIds,
        secrets: getSecrets(),
      })
      const billingConfig = readBillingConfig()
      sendJson(res, 200, {
        ...result,
        sessions: result.sessions.map(session => ({
          ...session,
          ...enrichUsage(session, billingConfig, session.lastActivityMs),
        })),
        readOnly: true,
      })
    } catch (error) {
      sendJson(res, 400, { error: errorMessage(error), sessions: [], readOnly: true })
    }
    return true
  }

  if (pathname === '/api/session-observation/events' && req.method === 'GET') {
    try {
      assertAllowedQuery(url.searchParams, EVENT_QUERY_KEYS)
      const rawErrorsOnly = String(url.searchParams.get('errorsOnly') || '')
      if (rawErrorsOnly && !['0', '1'].includes(rawErrorsOnly)) throw new Error('错误筛选参数无效')
      const types = [
        ...url.searchParams.getAll('type'),
        ...String(url.searchParams.get('types') || '').split(','),
      ].map(value => value.trim()).filter(Boolean)
      const result = await store.readEvents({
        source: String(url.searchParams.get('source') || ''),
        sessionId: String(url.searchParams.get('sessionId') || ''),
        cursor: String(url.searchParams.get('cursor') || '') || undefined,
        limit: Number(url.searchParams.get('limit') || 30),
        types,
        errorsOnly: rawErrorsOnly === '1',
        secrets: getSecrets(),
      })
      const billingConfig = readBillingConfig()
      sendJson(res, 200, {
        ...result,
        events: result.events.map(event => enrichEvent(event, billingConfig)),
        readOnly: true,
      })
    } catch (error) {
      sendJson(res, 400, { error: errorMessage(error), events: [], readOnly: true })
    }
    return true
  }

  return false
}
