const VERSION_PATTERN = /^(\d{4})\.(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/

export function parseOpenClawVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '')
  const match = VERSION_PATTERN.exec(text)
  if (!match) return null
  return {
    text,
    parts: [match[1], match[2], match[3], match[4] || '0'].map(Number),
    prerelease: match[5] || '',
  }
}

export function compareOpenClawVersions(left, right) {
  const a = parseOpenClawVersion(left)
  const b = parseOpenClawVersion(right)
  if (!a || !b) return 0
  for (let index = 0; index < a.parts.length; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true })
}

export function latestStableOpenClawVersion(versions) {
  return (Array.isArray(versions) ? versions : [])
    .filter(item => item && item.prerelease !== true && parseOpenClawVersion(item.version)?.prerelease === '')
    .sort((a, b) => compareOpenClawVersions(b.version, a.version))[0] || null
}

export function createOpenClawUpdateStatus(currentVersion, versions, extra = {}) {
  const current = parseOpenClawVersion(currentVersion)?.text || ''
  const latest = latestStableOpenClawVersion(versions)
  const latestVersion = parseOpenClawVersion(latest?.version)?.text || ''
  return {
    currentVersion: current,
    latestVersion,
    updateAvailable: Boolean(current && latestVersion && compareOpenClawVersions(latestVersion, current) > 0),
    latestRelease: latest,
    ...extra,
  }
}
