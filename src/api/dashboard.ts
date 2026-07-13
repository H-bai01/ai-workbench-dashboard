export interface DashboardHealth {
  status: string
  port: number
  uptimeMs: number
  startedAt: string
  timestamp: string
}

export async function getDashboardHealth(): Promise<DashboardHealth> {
  const response = await fetch('/api/health', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Dashboard health request failed: ${response.status}`)
  return response.json() as Promise<DashboardHealth>
}
