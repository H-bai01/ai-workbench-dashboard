import axios from 'axios'

// Gateway credentials are injected by the local server-side proxy.
const GATEWAY_BASE_URL = '/gateway-api'

const gatewayApi = axios.create({
  baseURL: GATEWAY_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Response interceptor
gatewayApi.interceptors.response.use(
  (response) => {
    const data = response.data
    // Handle tools/invoke response: { ok: true, result }
    if (data?.ok === true && data?.result !== undefined) {
      const result = data.result
      // If result.details exists, use details (structured data)
      if (result?.details) {
        return result.details
      }
      // If result.content exists with text field, parse JSON
      if (result?.content && Array.isArray(result.content)) {
        const textItem = result.content.find((c: Record<string, unknown>) => c.type === 'text')
        if (textItem?.text) {
          try {
            return JSON.parse(textItem.text)
          } catch {
            // ignore
          }
        }
      }
      return result
    }
    return data
  },
  (error) => {
    const status = error.response?.status
    const data = error.response?.data
    const message = data?.error?.message || data?.message || error.message || 'Gateway API Error'
    if (status === 401) {
      console.warn('[Gateway] Unauthorized — token may be expired')
    } else if (status === 403) {
      console.warn('[Gateway] Forbidden — insufficient permissions')
    } else if (status && status >= 500) {
      console.error('[Gateway] Server error', { status })
    }
    return Promise.reject(new Error(message))
  }
)

/**
 * Invoke a gateway tool via /tools/invoke
 */
export async function invokeTool(tool: string, args: Record<string, unknown> = {}, sessionKey?: string): Promise<unknown> {
  const body: Record<string, unknown> = {
    tool,
    action: 'json',
    args,
  }
  if (sessionKey) {
    body.sessionKey = sessionKey
  }
  return gatewayApi.post('/tools/invoke', body)
}

/**
 * Get sessions list (Agent 列表和状态)
 * Uses: POST /tools/invoke with tool=sessions_list
 */
export async function sessionsList(args: { activeMinutes?: number; messageLimit?: number; limit?: number } = {}): Promise<unknown> {
  return invokeTool('sessions_list', args)
}

/**
 * Get session history (会话详情)
 * Uses: POST /tools/invoke with tool=sessions_history
 */
export async function sessionsHistory(sessionKey: string, args: { limit?: number; includeTools?: boolean } = {}): Promise<unknown> {
  return invokeTool('sessions_history', { sessionKey, ...args })
}

/**
 * Get agent definitions (name, id, etc.)
 * Uses: POST /tools/invoke with tool=agents_list
 */
export async function agentsList(): Promise<unknown> {
  return invokeTool('agents_list', {})
}

/**
 * Get session status (会话状态)
 * Uses: POST /tools/invoke with tool=session_status
 */
export async function sessionStatus(sessionKey: string): Promise<unknown> {
  return invokeTool('session_status', { sessionKey })
}

/**
 * Send message to session (发送消息到会话)
 * Uses: POST /tools/invoke with tool=sessions_send
 */
export async function sessionsSend(
  sessionKey: string,
  message: string,
  timeoutSeconds: number = 0,
): Promise<unknown> {
  return invokeTool('sessions_send', { sessionKey, message, timeoutSeconds })
}

/**
 * Get session history (会话历史记录)
 * Uses: POST /tools/invoke with tool=sessions_history
 */
export async function getSessionHistory(sessionKey: string, limit: number = 50, includeTools: boolean = false): Promise<unknown> {
  return invokeTool('sessions_history', { sessionKey, limit, includeTools })
}

/**
 * Gateway health check
 * Maps to: GET /health
 */
export async function health(): Promise<unknown> {
  return gatewayApi.get('/health')
}

/**
 * 获取 GPU 显存使用占比（REC-091 / REC-096）
 * 开发环境：通过 Vite proxy (/api/gpu-vram → backendPort)
 * 生产环境：直接调用后端地址
 * 返回: { usedPct: number, usedMb: number, totalMb: number }
 */
export async function getGpuVramUsage(): Promise<{ usedPct: number; usedMb: number; totalMb: number } | null> {
  try {
    const resp = await axios.get('/api/gpu-vram', { timeout: 10000 })
    const data = resp.data as { usedPct: number | null; usedMb?: number; totalMb?: number }
    if (data?.usedPct != null) {
      return {
        usedPct: data.usedPct,
        usedMb: data.usedMb || 0,
        totalMb: data.totalMb || 0,
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 结构化工具限制错误
 */
export class ToolRestrictedError extends Error {
  code = 'TOOLS_RESTRICTED'
  tool: string
  steps: string[]

  constructor(tool: string, steps: string[]) {
    super(`工具 "${tool}" 不可用 — Gateway 安全策略限制`)
    this.name = 'ToolRestrictedError'
    this.tool = tool
    this.steps = steps
  }
}

/**
 * Reset session (重置会话)
 * 通过后端 POST /reset API（REC-005 修复：替代 WebSocket chat.send，避免 operator.write 权限问题）
 * 后端 API 格式：POST /reset，Body: { "agentId": "frontend" }
 */
export async function resetSession(agentId: string): Promise<unknown> {
  try {
    const resp = await axios.post('/reset', { agentId }, { timeout: 10000 })
    return resp.data
  } catch (e: any) {
    console.error('[Gateway] session reset failed')
    throw new Error(`重置失败: ${e.message}`)
  }
}

/**
 * 删除会话（REC-125）
 * 通过 Gateway WebSocket RPC 串行调用 sessions.abort + sessions.delete
 * 前端直连 WS，复用 websocket.ts 基础设施
 */
export async function deleteSession(key: string): Promise<{
  success: boolean
  error?: string
  abortResult?: object
  deleteResult?: object
}> {
  // 1. 前端 key 格式校验（F-23）
  if (!/^[a-zA-Z0-9_:.-]+$/.test(key)) {
    return { success: false, error: '会话 key 格式无效' }
  }
  // 2. 禁止删除 cron 会话（F-14）
  if (key.includes(':cron:')) {
    return { success: false, error: '不能删除定时任务会话' }
  }

  const { useGatewayWebSocket } = await import('./websocket')
  const ws = useGatewayWebSocket()

  // abortResult 提升作用域，供 catch 块判断 F-24 中间状态
  let abortResult: object | undefined

  // 整体 30s 超时包装
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('请求超时，请重试')), 30000)
  })

  const work = (async () => {
    try {
      // 3. 先 abort（终止运行中任务，F-10）
      try {
        abortResult = await ws.request('sessions.abort', { key }) as object
      } catch {
        // abort 失败不影响后续 delete 尝试（空闲会话 abort 可能报错）
        console.warn('[Gateway] session abort cleanup failed')
      }

      // 4. 再 delete（永久删除会话，F-11）
      const deleteResult = await ws.request('sessions.delete', { key }) as object
      return { success: true, abortResult, deleteResult }
    } catch (e: any) {
      const errMsg = e?.message || String(e)
      // 5. 权限错误特殊处理（F-25）
      if (errMsg.includes('403') || errMsg.includes('permission') || errMsg.includes('forbidden') || errMsg.includes('unauthorized')) {
        return { success: false, error: '权限不足，无法删除会话（需要 operator.admin 权限）' }
      }
      // 6. abort 成功但 delete 失败的中间状态（F-24）
      if (abortResult) {
        return { success: false, error: '会话已终止但删除失败，请刷新列表查看' }
      }
      return { success: false, error: errMsg || '删除失败' }
    }
  })()

  return Promise.race([work, timeoutPromise]).catch((e) => {
    if (e instanceof Error && e.message.includes('超时')) {
      return { success: false, error: e.message }
    }
    return { success: false, error: String(e) }
  })
}

export default gatewayApi
