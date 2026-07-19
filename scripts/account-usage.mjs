import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const CODEX_TIMEOUT_MS = 15_000
const CLAUDE_MAX_FILE_BYTES = 4 * 1024 * 1024

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeInteger(value) {
  const number = finiteNumber(value)
  return number === null ? null : Math.max(0, Math.round(number))
}

function percentage(value) {
  const number = finiteNumber(value)
  return number === null ? null : Math.min(100, Math.max(0, number))
}

function existingExecutable(candidate) {
  if (!candidate || !path.isAbsolute(candidate)) return null
  try {
    const resolved = fs.realpathSync(candidate)
    const stat = fs.statSync(resolved)
    if (!stat.isFile()) return null
    fs.accessSync(resolved, fs.constants.X_OK)
    return resolved
  } catch {
    return null
  }
}

export function resolveCodexExecutable({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
} = {}) {
  const candidates = []
  if (env.AI_WORKBENCH_CODEX_EXECUTABLE) {
    candidates.push(String(env.AI_WORKBENCH_CODEX_EXECUTABLE).trim())
  }
  if (platform === 'darwin') {
    candidates.push('/Applications/ChatGPT.app/Contents/Resources/codex')
  }
  if (platform === 'win32') {
    const localAppData = String(env.LOCALAPPDATA || '').trim()
    if (localAppData) candidates.push(path.join(localAppData, 'Programs', 'Codex', 'codex.exe'))
  }
  candidates.push(path.join(homeDir, '.local', 'bin', platform === 'win32' ? 'codex.exe' : 'codex'))
  for (const entry of String(env.PATH || '').split(path.delimiter)) {
    if (!entry) continue
    candidates.push(path.resolve(entry, platform === 'win32' ? 'codex.exe' : 'codex'))
  }
  for (const candidate of candidates) {
    const executable = existingExecutable(candidate)
    if (executable) return executable
  }
  return null
}

function codexChildEnvironment(env) {
  const allowed = [
    'HOME',
    'USERPROFILE',
    'PATH',
    'TMPDIR',
    'TEMP',
    'TMP',
    'CODEX_HOME',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'LANG',
    'LC_ALL',
  ]
  const output = Object.create(null)
  for (const key of allowed) {
    if (typeof env[key] === 'string' && env[key]) output[key] = env[key]
  }
  return output
}

function codexRequest(child, pending, id, method, params) {
  const request = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  return request
}

function codexNotification(child, method) {
  child.stdin.write(`${JSON.stringify({ method })}\n`)
}

function safeKill(child) {
  try {
    child.kill('SIGTERM')
  } catch {
    // Process already exited.
  }
}

export async function readCodexAccountUsage({
  env = process.env,
  executable = resolveCodexExecutable({ env }),
  spawnImpl = spawn,
  timeoutMs = CODEX_TIMEOUT_MS,
} = {}) {
  if (!executable) {
    return {
      id: 'codex',
      name: 'Codex',
      availability: 'not_installed',
      exactTokenUsage: true,
      accountScope: 'cross_device',
    }
  }

  const child = spawnImpl(executable, ['app-server', '--stdio'], {
    env: codexChildEnvironment(env),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const pending = new Map()
  let stdoutBuffer = ''

  child.stderr.on('data', () => {})
  child.on('error', () => {
    for (const waiter of pending.values()) waiter.reject(new Error('codex_account_spawn_failed'))
    pending.clear()
  })
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8')
    while (true) {
      const lineEnd = stdoutBuffer.indexOf('\n')
      if (lineEnd < 0) break
      const line = stdoutBuffer.slice(0, lineEnd).trim()
      stdoutBuffer = stdoutBuffer.slice(lineEnd + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        const waiter = pending.get(message.id)
        if (!waiter) continue
        pending.delete(message.id)
        if (message.error) waiter.reject(new Error('codex_account_request_failed'))
        else waiter.resolve(message.result)
      } catch {
        // App-server can emit non-protocol diagnostics; never expose them.
      }
    }
  })

  const timer = setTimeout(() => {
    for (const waiter of pending.values()) waiter.reject(new Error('codex_account_timeout'))
    pending.clear()
    safeKill(child)
  }, timeoutMs)
  timer.unref?.()

  try {
    await codexRequest(child, pending, 1, 'initialize', {
      clientInfo: { name: 'ai-workbench-dashboard', version: '2.11.0' },
      capabilities: { experimentalApi: true },
    })
    codexNotification(child, 'initialized')
    const [usage, rateLimitResult] = await Promise.allSettled([
      codexRequest(child, pending, 2, 'account/usage/read', null),
      codexRequest(child, pending, 3, 'account/rateLimits/read', null),
    ])
    if (usage.status !== 'fulfilled') throw usage.reason
    const rateLimits = rateLimitResult.status === 'fulfilled' ? rateLimitResult.value : null
    return normalizeCodexAccountUsage(usage.value, rateLimits)
  } catch {
    return {
      id: 'codex',
      name: 'Codex',
      availability: 'unavailable',
      exactTokenUsage: true,
      accountScope: 'cross_device',
    }
  } finally {
    clearTimeout(timer)
    for (const waiter of pending.values()) waiter.reject(new Error('codex_account_closed'))
    pending.clear()
    try {
      child.stdin.end()
    } catch {
      // Process already exited.
    }
    safeKill(child)
  }
}

function normalizeRateLimitWindow(window, fallbackLabel) {
  if (!window || typeof window !== 'object') return null
  const usedPercent = percentage(window.usedPercent)
  if (usedPercent === null) return null
  const durationMinutes = nonNegativeInteger(window.windowDurationMins)
  const resetsAtSeconds = nonNegativeInteger(window.resetsAt)
  return {
    label: durationMinutes
      ? (durationMinutes < 24 * 60 ? `${Math.round(durationMinutes / 60)} 小时额度` : `${Math.round(durationMinutes / 1440)} 天额度`)
      : fallbackLabel,
    usedPercent,
    durationMinutes,
    resetsAt: resetsAtSeconds ? new Date(resetsAtSeconds * 1000).toISOString() : null,
  }
}

export function normalizeCodexAccountUsage(usage, rateLimitResponse) {
  const summary = usage?.summary && typeof usage.summary === 'object' ? usage.summary : {}
  const dailyBuckets = Array.isArray(usage?.dailyUsageBuckets)
    ? usage.dailyUsageBuckets.flatMap((bucket) => {
      const tokens = nonNegativeInteger(bucket?.tokens)
      const date = typeof bucket?.startDate === 'string' ? bucket.startDate : ''
      return date && tokens !== null ? [{ date, tokens }] : []
    })
    : []
  const rateSnapshot = rateLimitResponse?.rateLimits && typeof rateLimitResponse.rateLimits === 'object'
    ? rateLimitResponse.rateLimits
    : null
  const quotaWindows = [
    normalizeRateLimitWindow(rateSnapshot?.primary, '主要额度'),
    normalizeRateLimitWindow(rateSnapshot?.secondary, '次要额度'),
  ].filter(Boolean)
  return {
    id: 'codex',
    name: 'Codex',
    availability: 'ready',
    exactTokenUsage: true,
    accountScope: 'cross_device',
    planType: typeof rateSnapshot?.planType === 'string' ? rateSnapshot.planType : null,
    lifetimeTokens: nonNegativeInteger(summary.lifetimeTokens),
    peakDailyTokens: nonNegativeInteger(summary.peakDailyTokens),
    dailyUsageBuckets: dailyBuckets,
    quotaWindows,
    updatedAt: new Date().toISOString(),
  }
}

export function claudeUsageHistoryCandidates({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
} = {}) {
  if (env.AI_WORKBENCH_CLAUDE_USAGE_FILE) {
    return [path.resolve(String(env.AI_WORKBENCH_CLAUDE_USAGE_FILE))]
  }
  if (platform === 'darwin') {
    return [path.join(homeDir, 'Library', 'Application Support', 'Claude', 'plan-usage-history.json')]
  }
  if (platform === 'win32') {
    const appData = String(env.APPDATA || '').trim()
    return appData ? [path.join(appData, 'Claude', 'plan-usage-history.json')] : []
  }
  const configHome = String(env.XDG_CONFIG_HOME || '').trim() || path.join(homeDir, '.config')
  return [
    path.join(configHome, 'Claude', 'plan-usage-history.json'),
    path.join(configHome, 'claude', 'plan-usage-history.json'),
  ]
}

function safeClaudeUsageFile(candidate) {
  if (!candidate || !path.isAbsolute(candidate)) return null
  try {
    const lstat = fs.lstatSync(candidate)
    if (!lstat.isFile() || lstat.isSymbolicLink() || lstat.size > CLAUDE_MAX_FILE_BYTES) return null
    if (typeof process.getuid === 'function' && lstat.uid !== process.getuid()) return null
    return candidate
  } catch {
    return null
  }
}

export function normalizeClaudeUsageHistory(value) {
  const samples = Array.isArray(value?.samples) ? value.samples : []
  const rows = samples.flatMap((sample) => {
    const timestamp = nonNegativeInteger(sample?.t)
    const current = percentage(sample?.u?.fh)
    const weekly = percentage(sample?.u?.sd)
    return timestamp && (current !== null || weekly !== null)
      ? [{ timestamp, current, weekly }]
      : []
  }).sort((a, b) => b.timestamp - a.timestamp)
  const latest = rows[0]
  if (!latest) return null
  return {
    id: 'claude',
    name: 'Claude',
    availability: 'ready',
    exactTokenUsage: false,
    accountScope: 'cross_device',
    quotaWindows: [
      latest.current === null ? null : { label: '当前额度', usedPercent: latest.current },
      latest.weekly === null ? null : { label: '7 天额度', usedPercent: latest.weekly },
    ].filter(Boolean),
    updatedAt: new Date(latest.timestamp).toISOString(),
  }
}

export function readClaudeAccountUsage({
  env = process.env,
  candidates = claudeUsageHistoryCandidates({ env }),
} = {}) {
  for (const candidate of candidates) {
    const file = safeClaudeUsageFile(candidate)
    if (!file) continue
    try {
      const normalized = normalizeClaudeUsageHistory(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (normalized) return normalized
    } catch {
      // Try the next platform candidate.
    }
  }
  return {
    id: 'claude',
    name: 'Claude',
    availability: 'unavailable',
    exactTokenUsage: false,
    accountScope: 'cross_device',
  }
}

let accountUsageCache = null
let accountUsageInFlight = null

export async function collectAccountUsage({
  forceRefresh = false,
  cacheTtlMs = 60_000,
  now = Date.now(),
  codexReader = readCodexAccountUsage,
  claudeReader = readClaudeAccountUsage,
} = {}) {
  if (!forceRefresh && accountUsageCache && accountUsageCache.expiresAt > now) {
    return { ...accountUsageCache.value, cached: true }
  }
  if (!forceRefresh && accountUsageInFlight) return accountUsageInFlight

  const task = (async () => {
    const [codexResult, claudeResult] = await Promise.allSettled([
      codexReader(),
      Promise.resolve().then(() => claudeReader()),
    ])
    const providers = [
      codexResult.status === 'fulfilled' ? codexResult.value : {
        id: 'codex',
        name: 'Codex',
        availability: 'unavailable',
        exactTokenUsage: true,
        accountScope: 'cross_device',
      },
      claudeResult.status === 'fulfilled' ? claudeResult.value : {
        id: 'claude',
        name: 'Claude',
        availability: 'unavailable',
        exactTokenUsage: false,
        accountScope: 'cross_device',
      },
    ]
    const value = {
      ok: true,
      providers,
      updatedAt: new Date(now).toISOString(),
      cached: false,
    }
    accountUsageCache = { value, expiresAt: now + cacheTtlMs }
    return value
  })()
  accountUsageInFlight = task
  try {
    return await task
  } finally {
    if (accountUsageInFlight === task) accountUsageInFlight = null
  }
}

export function clearAccountUsageCache() {
  accountUsageCache = null
  accountUsageInFlight = null
}
