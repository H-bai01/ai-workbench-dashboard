import http from 'node:http'
import https from 'node:https'

const BRIDGE_PATH = '/__dashboard_bridge__.js'
const FORWARDED_REQUEST_HEADERS = new Set([
  'accept', 'accept-language', 'if-modified-since', 'if-none-match', 'range', 'user-agent',
])
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'set-cookie',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length',
])

function bridgeScript(websocketPath) {
  return `try{localStorage.removeItem('gateway-token');sessionStorage.removeItem('gateway-token')}catch{}\nwindow.__OPENCLAW_CONTROL_UI_BASE_PATH__='/gateway-api';\nwindow.__OPENCLAW_NATIVE_CONTROL_AUTH__={gatewayUrl:(location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+${JSON.stringify(websocketPath)}};\n`
}

function injectBridge(html, mountPath) {
  const tag = `<script src="${mountPath}${BRIDGE_PATH}"></script>`
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : `${tag}${html}`
}

function upstreamPath(reqUrl, mountPath) {
  const parsed = new URL(reqUrl || '/', 'http://localhost')
  let pathname = parsed.pathname.slice(mountPath.length) || '/'
  if (!pathname.startsWith('/')) pathname = `/${pathname}`
  return `${pathname}${parsed.search}`
}

function copyResponseHeaders(source, res, mountPath) {
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue
    if (name.toLowerCase() === 'location' && typeof value === 'string' && value.startsWith('/')) {
      res.setHeader(name, `${mountPath}${value}`)
    } else {
      res.setHeader(name, value)
    }
  }
}

export function proxyGatewayControlRequest(req, res, {
  gatewayUrl,
  gatewayToken,
  mountPath = '/gateway-api',
  websocketPath = '/gateway-ws',
  timeoutMs = 10000,
  maxHtmlBytes = 2 * 1024 * 1024,
  maxRequestBytes = 1024 * 1024,
} = {}) {
  const requestUrl = new URL(req.url || '/', 'http://localhost')
  const localPath = requestUrl.pathname.slice(mountPath.length) || '/'
  const method = String(req.method || '').toUpperCase()
  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD, POST' })
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
    return
  }
  if (localPath === BRIDGE_PATH) {
    if (method === 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD' })
      res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
      return
    }
    const body = bridgeScript(websocketPath)
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    })
    if (req.method !== 'HEAD') res.end(body)
    else res.end()
    return
  }
  if (method === 'POST' && localPath !== '/tools/invoke') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD' })
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
    return
  }
  if (!gatewayToken) {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: false, error: 'gateway credential is not configured' }))
    return
  }

  const forward = (requestBody = null) => {
    const target = new URL(gatewayUrl)
    const client = target.protocol === 'https:' ? https : http
    const headers = { 'accept-encoding': 'identity', Authorization: `Bearer ${gatewayToken}` }
    for (const [name, value] of Object.entries(req.headers || {})) {
      if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase()) && value !== undefined) headers[name] = value
    }
    if (requestBody) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(requestBody.length)
    }
    const upstream = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method,
      path: upstreamPath(req.url, mountPath),
      headers,
      timeout: timeoutMs,
    }, (upstreamRes) => {
      const contentType = String(upstreamRes.headers['content-type'] || '')
      if (method === 'POST' || !contentType.includes('text/html')) {
        copyResponseHeaders(upstreamRes.headers, res, mountPath)
        if (method === 'POST') res.setHeader('Cache-Control', 'no-store')
        res.writeHead(upstreamRes.statusCode || 502)
        if (method === 'HEAD') { upstreamRes.resume(); res.end(); return }
        upstreamRes.pipe(res)
        return
      }

      const chunks = []
      let total = 0
      upstreamRes.on('data', chunk => {
        total += chunk.length
        if (total > maxHtmlBytes) {
          upstream.destroy(new Error('gateway html response too large'))
          return
        }
        chunks.push(chunk)
      })
      upstreamRes.on('end', () => {
        const body = Buffer.from(injectBridge(Buffer.concat(chunks).toString('utf8'), mountPath), 'utf8')
        copyResponseHeaders(upstreamRes.headers, res, mountPath)
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Length', body.length)
        res.writeHead(upstreamRes.statusCode || 200)
        if (method !== 'HEAD') res.end(body)
        else res.end()
      })
    })
    upstream.on('timeout', () => upstream.destroy(new Error('gateway request timeout')))
    upstream.on('error', () => {
      if (res.headersSent) { res.destroy(); return }
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: false, error: 'gateway unavailable' }))
    })
    upstream.end(requestBody || undefined)
  }

  if (method !== 'POST') {
    forward()
    return
  }

  const contentType = String(req.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    res.writeHead(415, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'application/json required' }))
    return
  }
  const chunks = []
  let total = 0
  let tooLarge = false
  req.on('data', chunk => {
    total += chunk.length
    if (total > maxRequestBytes) {
      tooLarge = true
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (tooLarge) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'request body too large' }))
      return
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required')
      forward(Buffer.from(JSON.stringify(parsed), 'utf8'))
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'invalid JSON body' }))
    }
  })
}

export { BRIDGE_PATH, bridgeScript, injectBridge }
