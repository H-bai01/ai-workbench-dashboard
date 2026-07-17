import type { NotificationInput } from './notification-center.mjs'

export interface UsageStatisticsLoadRequest {
  timelineUrl: string
  localUsageUrl: string
  signal?: AbortSignal
  scopeKey?: string
  rangeLabel?: string
  hasPublishedData?: boolean
  prewarm?: boolean
}

export interface UsageStatisticsLoadResult {
  ok: boolean
  timelineData?: Record<string, unknown>
  localUsageData?: Record<string, unknown>
  refreshFailed?: boolean
  failure?: {
    kind: 'aborted' | 'service_unavailable' | 'model_error' | 'data_error' | 'background_refresh_error'
    message: string
    httpStatus?: number
  }
}

export function createUsageStatisticsManager(options?: {
  notify?: (notification: NotificationInput, options: { dedupeWindowMs: number; now: number }) => void
  now?: () => number
  dedupeWindowMs?: number
}): {
  load(request: UsageStatisticsLoadRequest): Promise<UsageStatisticsLoadResult>
  reset(scopeKey?: string): void
}
