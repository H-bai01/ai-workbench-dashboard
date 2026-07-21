import { requestJson } from './http'

export interface DashboardHealth {
  status: string
  port: number
  uptimeMs: number
  startedAt: string
  timestamp: string
}

export async function getDashboardHealth(): Promise<DashboardHealth> {
  return requestJson<DashboardHealth>('/api/health', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
}
