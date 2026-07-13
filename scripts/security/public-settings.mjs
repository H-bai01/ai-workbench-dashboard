export function normalizeGithubProxy(value) {
  const input = String(value || '').trim()
  if (!input) return ''
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

export function publicElectricityPerHour(value, fallback = 2) {
  if (typeof value === 'string' && !value.trim()) return fallback
  if (value === undefined || value === null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
