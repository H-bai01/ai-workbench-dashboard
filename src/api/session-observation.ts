import type {
  ObservedSession,
  ObservedSessionIndexEntry,
  ObservedSessionEvent,
  SessionCapability,
  SessionEventType,
  SessionObservationScope,
  SessionObservationSource,
} from '../types/session-observation'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `请求失败（${response.status}）`)
  return payload as T
}

export async function fetchSessionCapabilities(): Promise<SessionCapability[]> {
  const payload = await getJson<{ capabilities: SessionCapability[] }>('/api/session-observation/capabilities')
  return Array.isArray(payload.capabilities) ? payload.capabilities : []
}

export async function fetchObservedSessionIndex(source = ''): Promise<{
  sessions: ObservedSessionIndexEntry[]
  sources: string[]
  readOnly: true
}> {
  const params = new URLSearchParams()
  if (source) params.set('source', source)
  const suffix = params.size ? `?${params.toString()}` : ''
  return getJson(`/api/session-observation/index${suffix}`)
}

export async function fetchObservedSessions(scope: SessionObservationScope): Promise<{
  scopeId: string
  source: SessionObservationSource
  clientName: string
  projectPath: string
  agentId: string
  sessions: ObservedSession[]
}> {
  const params = new URLSearchParams({ source: scope.source })
  if (scope.agentId) params.set('agentId', scope.agentId)
  for (const sessionId of scope.sessionIds) params.append('sessionId', sessionId)
  return getJson(`/api/session-observation/sessions?${params.toString()}`)
}

export async function fetchObservedEvents(options: {
  source: SessionObservationSource
  sessionId: string
  cursor?: string | null
  limit?: number
  types?: SessionEventType[]
  errorsOnly?: boolean
}): Promise<{
  session: Pick<ObservedSession, 'source' | 'sessionId' | 'name' | 'projectPath' | 'model'>
  events: ObservedSessionEvent[]
  nextCursor: string | null
  hasMore: boolean
  responseLimited: boolean
  responseSizeLimited: boolean
  responseBytes: number
  maxResponseBytes: number
}> {
  const params = new URLSearchParams({
    source: options.source,
    sessionId: options.sessionId,
    limit: String(options.limit || 30),
  })
  if (options.cursor) params.set('cursor', options.cursor)
  for (const type of options.types || []) params.append('type', type)
  if (options.errorsOnly) params.set('errorsOnly', '1')
  return getJson(`/api/session-observation/events?${params.toString()}`)
}
