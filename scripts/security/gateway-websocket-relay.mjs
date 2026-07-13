import WebSocket, { WebSocketServer } from 'ws'
import { gatewayWebSocketUrl } from './gateway-credentials.mjs'
import { validateRequestContext } from './request-boundary.mjs'

function injectGatewayCredential(payload, token) {
  let message
  try {
    message = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload))
  } catch {
    return payload
  }
  if (message?.type === 'req' && message?.method === 'connect') {
    const original = message.params || {}
    const minProtocol = Number(original.minProtocol)
    const maxProtocol = Number(original.maxProtocol)
    message.params = {
      ...original,
      minProtocol: Number.isFinite(minProtocol) ? Math.max(3, minProtocol) : 3,
      maxProtocol: Number.isFinite(maxProtocol) ? Math.min(4, maxProtocol) : 4,
      client: {
        id: 'gateway-client',
        version: String(original?.client?.version || '1.0.0'),
        platform: 'web',
        mode: 'backend',
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write', 'operator.admin'],
      auth: { token },
    }
    delete message.params.device
    return JSON.stringify(message)
  }
  return payload
}

function rejectUpgrade(socket, status, message) {
  const body = JSON.stringify({ ok: false, error: message })
  socket.write(`HTTP/1.1 ${status} Rejected\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
  socket.destroy()
}

function payloadBytes(value) {
  if (Buffer.isBuffer(value)) return value.length
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  return Buffer.byteLength(String(value))
}

export function attachGatewayWebSocketRelay(server, {
  route = '/gateway-ws',
  gatewayUrl,
  gatewayToken,
  localToken,
  requestPolicy,
  WebSocketImpl = WebSocket,
  maxMessageBytes = 1024 * 1024,
  maxQueueMessages = 64,
  maxQueueBytes = 2 * 1024 * 1024,
  maxConnections = 8,
  upstreamHandshakeTimeoutMs = 8000,
} = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes, clientTracking: true })

  server.on('upgrade', (req, socket, head) => {
    let pathname = ''
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname } catch { /* reject below */ }
    if (pathname !== route) {
      rejectUpgrade(socket, 404, 'websocket route not found')
      return
    }

    const decision = validateRequestContext(req, { ...requestPolicy, allowedMethods: new Set(['GET']), websocket: true })
    if (!decision.ok) {
      rejectUpgrade(socket, decision.status || 403, decision.error)
      return
    }
    if (!localToken || req.headers['x-dashboard-token'] !== localToken) {
      rejectUpgrade(socket, 401, 'unauthorized: missing or invalid local token')
      return
    }
    if (!gatewayToken) {
      rejectUpgrade(socket, 503, 'gateway credential is not configured')
      return
    }
    if (wss.clients.size >= maxConnections) {
      rejectUpgrade(socket, 429, 'too many websocket connections')
      return
    }

    wss.handleUpgrade(req, socket, head, (browserSocket) => {
      const gatewayOrigin = new URL(gatewayUrl).origin
      const upstream = new WebSocketImpl(gatewayWebSocketUrl(gatewayUrl), {
        // The browser Origin was already checked above. The upstream Gateway
        // must see its own loopback origin, never an arbitrary browser value.
        headers: { Authorization: `Bearer ${gatewayToken}`, Origin: gatewayOrigin },
        maxPayload: maxMessageBytes,
        handshakeTimeout: upstreamHandshakeTimeoutMs,
      })
      const pending = []
      let pendingBytes = 0
      const handshakeTimer = setTimeout(() => {
        if (upstream.readyState === WebSocketImpl.CONNECTING) {
          browserSocket.close(1013, 'gateway handshake timeout')
          upstream.terminate?.()
        }
      }, upstreamHandshakeTimeoutMs)

      browserSocket.on('error', () => {
        clearTimeout(handshakeTimer)
        if (upstream.readyState === WebSocketImpl.OPEN || upstream.readyState === WebSocketImpl.CONNECTING) {
          upstream.terminate?.()
        }
      })

      browserSocket.on('message', (data, isBinary) => {
        const bytes = payloadBytes(data)
        if (bytes > maxMessageBytes) {
          browserSocket.close(1009, 'message too large')
          return
        }
        const safePayload = isBinary ? data : injectGatewayCredential(data, gatewayToken)
        if (upstream.readyState === WebSocketImpl.OPEN) upstream.send(safePayload, { binary: isBinary })
        else if (upstream.readyState === WebSocketImpl.CONNECTING) {
          const safeBytes = payloadBytes(safePayload)
          if (pending.length >= maxQueueMessages || pendingBytes + safeBytes > maxQueueBytes) {
            browserSocket.close(1013, 'gateway queue limit exceeded')
            upstream.terminate?.()
            return
          }
          pending.push([safePayload, isBinary, safeBytes])
          pendingBytes += safeBytes
        }
      })
      upstream.on('open', () => {
        clearTimeout(handshakeTimer)
        for (const [payload, isBinary] of pending.splice(0)) upstream.send(payload, { binary: isBinary })
        pendingBytes = 0
      })
      upstream.on('message', (data, isBinary) => {
        if (payloadBytes(data) > maxMessageBytes) {
          browserSocket.close(1009, 'upstream message too large')
          upstream.close(1009)
          return
        }
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(data, { binary: isBinary })
      })
      upstream.on('error', () => {
        clearTimeout(handshakeTimer)
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, 'gateway unavailable')
      })
      browserSocket.on('close', () => {
        clearTimeout(handshakeTimer)
        if (upstream.readyState === WebSocketImpl.OPEN || upstream.readyState === WebSocketImpl.CONNECTING) upstream.close()
      })
      upstream.on('close', () => {
        clearTimeout(handshakeTimer)
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close()
      })
    })
  })

  return wss
}

export { injectGatewayCredential }
