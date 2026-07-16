import axios from 'axios'

export interface VersionInfo {
  version: string
  name: string
  description: string
  publishedAt: string
  htmlUrl: string
  prerelease?: boolean
}

export interface OpenClawUpdateStatus {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  checkedAt: string
  lastSync: string | null
  source: string | null
  stale?: boolean
  error?: string
}

export async function getVersions(page = 1, pageSize = 10) {
  const resp = await axios.get('/api/system/versions', {
    timeout: 65000,
    params: { page, pageSize }
  })
  return resp.data as {
    versions: VersionInfo[]
    lastSync: string | null
    page?: number
    pageSize?: number
    total?: number
  }
}

export async function syncVersions() {
  const resp = await axios.post('/api/system/sync-versions', {}, { timeout: 65000 })
  return resp.data as { success: boolean; count: number; source: string }
}

export async function switchVersion(version: string) {
  const resp = await axios.post(
    '/api/system/switch-version',
    { version },
    { timeout: 180000 }
  )
  return resp.data as { success: boolean; message?: string; error?: string; restarted?: boolean; stdout?: string; stderr?: string }
}

export async function getCurrentVersion() {
  const resp = await axios.get('/api/system/version', { timeout: 10000 })
  return resp.data as { version: string }
}

export async function getOpenClawUpdateStatus() {
  const resp = await axios.get('/api/system/openclaw-update-status', { timeout: 65000 })
  return resp.data as OpenClawUpdateStatus
}
