export type SessionObservationSource = string

export type SessionEventType =
  | 'user_message'
  | 'assistant_message'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'lifecycle_start'
  | 'lifecycle_complete'
  | 'lifecycle_error'
  | 'lifecycle_aborted'
  | 'artifact'
  | 'usage'
  | 'unknown'

export interface SessionObservationScope {
  source: SessionObservationSource
  displayName: string
  agentId?: string
  sessionIds: string[]
}

export interface ObservedUsage {
  tokens: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface ObservedArtifact {
  id: string
  name: string
  type: string
  relativePath: string
  exists: boolean
  size: number
  updatedAt: string
  sourceTool: string
  previewAvailable: boolean
}

export interface ObservedSession {
  source: SessionObservationSource
  clientName: string
  sessionId: string
  name: string
  projectKey: string
  projectPath: string
  agentId: string
  model: string
  updatedAt: string
  lastActivityMs: number
  status: string
  label: string
  usage: ObservedUsage
  byModel: Array<{ model: string; usage: ObservedUsage; priceConfigured: boolean }>
  priceStatus: 'configured' | 'partial' | 'unconfigured'
  thinkingAvailability: string
}

export type ObservedSessionIndexEntry = Pick<
  ObservedSession,
  | 'source'
  | 'clientName'
  | 'sessionId'
  | 'name'
  | 'projectKey'
  | 'projectPath'
  | 'agentId'
  | 'model'
  | 'updatedAt'
  | 'lastActivityMs'
>

export interface ObservedSessionEvent {
  id: string
  source: SessionObservationSource
  sessionId: string
  sequence: number
  timestamp: string
  at: number
  type: SessionEventType
  label: string
  model: string
  content: string
  contentTruncated: boolean
  thinkingKind: '' | 'recorded' | 'summary'
  toolCallId: string
  toolName: string
  toolState: '' | 'completed' | 'error' | 'waiting' | 'matched' | 'orphan'
  argumentsSummary: string
  argumentsTruncated: boolean
  resultSummary: string
  resultTruncated: boolean
  isError: boolean
  usage: ObservedUsage | null
  priceConfigured?: boolean
  artifacts: ObservedArtifact[]
}

export interface SessionCapability {
  source: SessionObservationSource
  clientName: string
  userMessages: boolean
  assistantMessages: boolean
  thinking: string
  toolCalls: boolean
  toolResults: boolean
  lifecycle: boolean
  tokenAndModel: boolean
  artifacts: string
  control: boolean
}
