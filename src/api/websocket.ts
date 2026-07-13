// Gateway credentials are injected by the local backend WebSocket relay.
function buildWsUrl(): string {
  const url = new URL('/gateway-ws', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export type WsMessage = Record<string, unknown>

export interface SessionStateEvent {
  key: string
  state: 'idle' | 'waiting' | 'processing' | string
  ts?: number
  queueDepth?: number
  reason?: string
}

type MessageHandler = (event: WsMessage) => void
type ErrorHandler = (error: Event | Error) => void
type ReconnectHandler = (attempt: number, maxRetries: number) => void
type SessionStateHandler = (event: SessionStateEvent) => void

interface WsOptions {
  heartbeatInterval?: number
  maxRetries?: number
  reconnectDelay?: number
  reconnectBackoff?: number
}

interface WsConnection {
  connect: () => void
  disconnect: () => void
  send: (data: string | Record<string, unknown>) => void
  request: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>
  onMessage: (handler: MessageHandler) => void
  onError: (handler: ErrorHandler) => void
  onReconnect: (handler: ReconnectHandler) => void
  onOpen: (handler: () => void) => void
  onClose: (handler: () => void) => void
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting'
}

const defaultOptions: Required<WsOptions> = {
  heartbeatInterval: 30000,
  maxRetries: 10,
  reconnectDelay: 3000,
  reconnectBackoff: 1.5,
}

class GatewayWebSocket {
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private handlers: {
    message: MessageHandler[]
    error: ErrorHandler[]
    reconnect: ReconnectHandler[]
    open: (() => void)[]
    close: (() => void)[]
    sessionState: SessionStateHandler[]
  } = {
    message: [],
    error: [],
    reconnect: [],
    open: [],
    close: [],
    sessionState: [],
  }
  private status: WsConnection['status'] = 'disconnected'
  private options: Required<WsOptions>
  private manualDisconnect = false
  private requestIdCounter = 0

  constructor(options: Partial<WsOptions> = {}) {
    this.options = { ...defaultOptions, ...options }
  }

  get is() {
    return this.status
  }

  private nextRequestId(): string {
    return `req-${++this.requestIdCounter}-${Date.now()}`
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 10000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // 未连接时自动尝试连接，最多等待 10s
      if (this.ws?.readyState !== WebSocket.OPEN) {
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          console.warn('[GatewayWS] WebSocket connecting...')
        } else {
          console.log('[GatewayWS] WebSocket not connected, connecting now...')
          this.connect()
        }

        // 等待连接就绪
        let waitCount = 0
        const waitInterval = setInterval(() => {
          waitCount++
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(waitInterval)
            this._doRequest(method, params, timeoutMs).then(resolve).catch(reject)
          } else if (waitCount >= 100) { // 10s = 100 * 100ms
            clearInterval(waitInterval)
            reject(new Error('[GatewayWS] Cannot send request — connection timeout (10s)'))
          }
        }, 100)
        return
      }

      this._doRequest(method, params, timeoutMs).then(resolve).catch(reject)
    })
  }

  private _doRequest(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error('[GatewayWS] Cannot send request — not connected'))
        return
      }

      const id = this.nextRequestId()
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`[GatewayWS] Request timeout: ${method}`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timeout })
      this.send({ type: 'req', id, method, params })
    })
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    this.status = 'connecting'
    this.manualDisconnect = false

    const url = buildWsUrl()

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.retryCount = 0
      }

      this.ws.onmessage = (event: MessageEvent) => {
        let data: WsMessage
        try {
          data = JSON.parse(event.data as string)
        } catch {
          data = { raw: event.data }
        }


        // Step 1: Handle connect.challenge from server
        if (data?.type === 'event' && data?.event === 'connect.challenge') {
          // Trusted same-process backend client — client.id 必须为 "gateway-client"
          // See: https://docs.openclaw.ai/gateway/protocol (Trusted same-process backend clients section)
          const connectReq = {
            type: 'req',
            id: `ws-${Date.now()}`,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 4,
              client: {
                id: 'gateway-client',  // mode=backend 时必须为常量 "gateway-client"
                version: '1.0.0',
                platform: 'web',
                mode: 'backend',  // Backend mode — 可省略 device auth
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.write', 'operator.admin'],
              auth: {},
            },
          }
          this.send(connectReq)
          return
        }

        // Step 2: Handle connect response (hello-ok)
        if (data?.type === 'res' && data?.ok === true && (data?.payload as Record<string, unknown>)?.type === 'hello-ok') {
          this.status = 'connected'
          this.startHeartbeat()
          const features = (data.payload as Record<string, unknown>).features as Record<string, unknown> | undefined
          if (features?.methods) {
            const methodCount = Array.isArray(features.methods) ? features.methods.length : 0
            console.log('[GatewayWS] Available methods received', { count: methodCount })
          }
          const auth = (data.payload as Record<string, unknown>).auth as Record<string, unknown> | undefined
          if (auth) {
            console.log('[GatewayWS] Authorization state received', { ok: true })
          }
          this.handlers.open.forEach((h) => h())
          return
        }

        // Handle pending request responses
        if (data?.type === 'res' && data?.id && this.pendingRequests.has(data.id as string)) {
          const pending = this.pendingRequests.get(data.id as string)!
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(data.id as string)
          if (data.ok === true) {
            pending.resolve(data)
          } else {
            pending.reject(new Error('[GatewayWS] Request failed'))
          }
          return
        }

        // Handle connect error
        if (data?.type === 'res' && data?.ok === false) {
          console.error('[GatewayWS] Handshake failed')
          this.ws?.close()
          return
        }

        // Ignore heartbeat
        if (data?.type === 'heartbeat' || data?.type === 'ping') {
          this.send({ type: 'pong' })
          return
        }

        // sessions.changed events (session metadata/state changes - automatically broadcast)
        // Format: { type: 'event', event: 'sessions.changed', payload: { sessions: [...] } }
        if (data?.type === 'event' && data?.event === 'sessions.changed') {
          // Notify handlers - agent.ts will handle the payload
          const payload = data?.payload as Record<string, unknown>
          if (payload?.sessions) {
            this.handlers.message.forEach((h) => h(data))
          }
        }

        // session.state events (diagnostic only - may not be pushed, see Issue #17057)
        // Format: { type: 'event', event: 'session.state', key, state, ts, ... }
        if (data?.type === 'event' && data?.event === 'session.state') {
          const key = data.key as string
          const state = data.state as string
          if (key && state) {
            this.handlers.sessionState.forEach((h) =>
              h({ key, state, ts: data.ts as number, queueDepth: data.queueDepth as number, reason: data.reason as string })
            )
          }
        }

        this.handlers.message.forEach((h) => h(data))
      }

      this.ws.onerror = (error: Event) => {
        console.error('[GatewayWS] Connection error')
        this.status = 'disconnected'
        this.handlers.error.forEach((h) => h(error))
      }

      this.ws.onclose = (_event: CloseEvent) => {
        this.status = 'disconnected'
        this.stopHeartbeat()
        this.handlers.close.forEach((h) => h())

        if (!this.manualDisconnect && this.retryCount < this.options.maxRetries) {
          this.attemptReconnect()
        }
      }
    } catch (error) {
      console.error('[GatewayWS] Failed to create connection')
      this.handlers.error.forEach((h) =>
        h(error instanceof Error ? error : new Error(String(error)))
      )
      if (!this.manualDisconnect && this.retryCount < this.options.maxRetries) {
        this.attemptReconnect()
      }
    }
  }

  disconnect(): void {
    this.manualDisconnect = true
    this.stopHeartbeat()
    this.clearReconnectTimer()

    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.status = 'disconnected'
    this.retryCount = 0
  }

  send(data: string | Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = typeof data === 'string' ? data : JSON.stringify(data)
      this.ws.send(msg)
    } else {
      console.warn('[GatewayWS] Cannot send — not connected')
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.message.push(handler)
  }

  onError(handler: ErrorHandler): void {
    this.handlers.error.push(handler)
  }

  onReconnect(handler: ReconnectHandler): void {
    this.handlers.reconnect.push(handler)
  }

  onOpen(handler: () => void): void {
    this.handlers.open.push(handler)
  }

  onClose(handler: () => void): void {
    this.handlers.close.push(handler)
  }

  onSessionState(handler: SessionStateHandler): void {
    this.handlers.sessionState.push(handler)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' })
    }, this.options.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private attemptReconnect(): void {
    this.retryCount++
    const delay = this.options.reconnectDelay * Math.pow(this.options.reconnectBackoff, this.retryCount - 1)
    this.status = 'reconnecting'

    this.handlers.reconnect.forEach((h) => h(this.retryCount, this.options.maxRetries))

    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

// Singleton instance
let wsInstance: GatewayWebSocket | null = null

export function useGatewayWebSocket(options?: Partial<WsOptions>): GatewayWebSocket {
  if (!wsInstance) {
    wsInstance = new GatewayWebSocket(options)
  }
  return wsInstance
}

export function destroyGatewayWebSocket(): void {
  if (wsInstance) {
    wsInstance.disconnect()
    wsInstance = null
  }
}

export default GatewayWebSocket
