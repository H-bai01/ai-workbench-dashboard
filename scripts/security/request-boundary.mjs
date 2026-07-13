const DEFAULT_ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'OPTIONS'])
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function csvValues(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeHostname(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    return new URL(`http://${text}`).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return ''
  }
}

export function normalizeTrustedOrigin(value) {
  try {
    const raw = String(value || '')
    if (!raw || raw !== raw.trim() || !/^https?:\/\/[^/?#]+\/?$/i.test(raw)) return ''
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return ''
    return url.origin
  } catch {
    return ''
  }
}

function header(req, name) {
  const headers = req?.headers || {}
  const normalizedName = String(name).toLowerCase()
  const value = headers[normalizedName] || (normalizedName === 'host' ? headers[':authority'] : '')
  return Array.isArray(value) ? value[0] : String(value || '')
}

export function createLocalRequestPolicy(env = process.env) {
  const frontendPort = String(env.FRONTEND_PORT || '31021')
  const httpsPort = String(env.OPENCLAW_HTTPS_FRONTEND_PORT || '31023')
  const origins = new Set([
    `http://127.0.0.1:${frontendPort}`,
    `http://localhost:${frontendPort}`,
    `https://127.0.0.1:${frontendPort}`,
    `https://localhost:${frontendPort}`,
    `https://127.0.0.1:${httpsPort}`,
    `https://localhost:${httpsPort}`,
  ])

  for (const candidate of csvValues(env.OPENCLAW_DASHBOARD_TRUSTED_ORIGINS)) {
    const origin = normalizeTrustedOrigin(candidate)
    if (origin) origins.add(origin)
  }

  const hosts = new Set(LOOPBACK_HOSTS)
  for (const origin of origins) hosts.add(new URL(origin).hostname.toLowerCase())
  return { allowedOrigins: origins, allowedHosts: hosts }
}

export function validateRequestContext(req, {
  allowedOrigins,
  allowedHosts,
  allowedMethods = DEFAULT_ALLOWED_METHODS,
  websocket = false,
} = {}) {
  const hostname = normalizeHostname(header(req, 'host'))
  if (!hostname || !allowedHosts?.has(hostname)) {
    return { ok: false, status: 403, code: 'invalid_host', error: 'forbidden: untrusted host' }
  }

  const method = String(req?.method || '').toUpperCase()
  const methods = allowedMethods instanceof Set ? allowedMethods : new Set(allowedMethods || [])
  if (!methods.has(method)) {
    return { ok: false, status: 405, code: 'invalid_method', error: 'method not allowed' }
  }

  const fetchSite = header(req, 'sec-fetch-site').toLowerCase()
  if (fetchSite === 'cross-site') {
    return { ok: false, status: 403, code: 'cross_site', error: 'forbidden: cross-site request' }
  }

  const originHeader = header(req, 'origin')
  if (originHeader) {
    const origin = normalizeTrustedOrigin(originHeader)
    if (!origin || !allowedOrigins?.has(origin)) {
      return { ok: false, status: 403, code: 'invalid_origin', error: 'forbidden: untrusted origin' }
    }
  }

  if (websocket) {
    if (method !== 'GET' || header(req, 'upgrade').toLowerCase() !== 'websocket') {
      return { ok: false, status: 400, code: 'invalid_websocket', error: 'invalid websocket upgrade' }
    }
    if (!originHeader) {
      return { ok: false, status: 403, code: 'missing_origin', error: 'forbidden: websocket origin required' }
    }
  }

  if (method === 'OPTIONS') {
    const requestedMethod = header(req, 'access-control-request-method').toUpperCase()
    if (requestedMethod && !methods.has(requestedMethod)) {
      return { ok: false, status: 405, code: 'invalid_preflight_method', error: 'preflight method not allowed' }
    }
  }

  return { ok: true, status: 200, origin: originHeader ? normalizeTrustedOrigin(originHeader) : '' }
}

export function validateJsonWriteRequest(req) {
  const method = String(req?.method || '').toUpperCase()
  if (!WRITE_METHODS.has(method)) return { ok: true, status: 200 }
  const contentType = header(req, 'content-type').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    return {
      ok: false,
      status: 415,
      code: 'json_required',
      error: 'unsupported media type: application/json required',
    }
  }
  return { ok: true, status: 200 }
}

export function validateLocalToken(req, expectedToken) {
  const provided = header(req, 'x-dashboard-token')
  if (!expectedToken || provided !== expectedToken) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      error: 'unauthorized: missing or invalid local token',
    }
  }
  return { ok: true, status: 200 }
}

export function applyTrustedCorsHeaders(req, res, allowedOrigins) {
  const origin = normalizeTrustedOrigin(header(req, 'origin'))
  if (!origin || !allowedOrigins?.has(origin)) return
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Vary', 'Origin')
}

export function sendBoundaryError(res, decision) {
  res.writeHead(decision.status || 403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ ok: false, error: decision.error || 'request rejected', code: decision.code || 'rejected' }))
}

export function isProtectedLocalPath(urlValue) {
  let pathname = ''
  try {
    pathname = new URL(String(urlValue || '/'), 'http://localhost').pathname
  } catch {
    return false
  }
  return pathname === '/reset'
    || pathname === '/gateway-api'
    || pathname.startsWith('/gateway-api/')
    || pathname === '/gateway-ws'
    || pathname === '/api'
    || pathname.startsWith('/api/')
    || pathname === '/uploads'
    || pathname.startsWith('/uploads/')
}

export function isLoopbackHostname(value) {
  return LOOPBACK_HOSTS.has(normalizeHostname(value))
}
