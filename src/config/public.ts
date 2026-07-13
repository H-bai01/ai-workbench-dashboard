export interface DashboardPublicConfig {
  trustedHttpsOrigin: string
  shareRepoUrl: string
  electricityPerHour: number
}

export const dashboardPublicConfig: DashboardPublicConfig = {
  trustedHttpsOrigin: '',
  shareRepoUrl: '',
  electricityPerHour: 2,
}

export async function loadDashboardPublicConfig({
  fetchImpl = fetch,
  timeoutMs = 3000,
}: {
  fetchImpl?: typeof fetch
  timeoutMs?: number
} = {}): Promise<DashboardPublicConfig> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const response = await fetchImpl('/api/public-config', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return dashboardPublicConfig
    const value = await response.json()
    dashboardPublicConfig.trustedHttpsOrigin = typeof value?.trustedHttpsOrigin === 'string' ? value.trustedHttpsOrigin : ''
    dashboardPublicConfig.shareRepoUrl = typeof value?.shareRepoUrl === 'string' ? value.shareRepoUrl : ''
    const electricity = Number(value?.electricityPerHour)
    dashboardPublicConfig.electricityPerHour = Number.isFinite(electricity) && electricity >= 0 ? electricity : 2
  } catch { /* public settings are optional */ }
  finally { globalThis.clearTimeout(timeout) }
  return dashboardPublicConfig
}
