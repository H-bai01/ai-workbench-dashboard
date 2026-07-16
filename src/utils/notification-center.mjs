export const NOTIFICATION_STORAGE_KEY = 'ai_workbench_dashboard_notifications_v1'
export const NOTIFICATION_MAX_ITEMS = 50
export const NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const ALLOWED_TYPES = new Set(['error', 'aborted', 'info'])
const ALLOWED_RETRY_ACTIONS = new Set(['refresh-token-usage', 'prewarm-token-usage'])

function safeText(value, maxLength = 2000) {
  let text = ''
  try {
    text = typeof value === 'string' ? value : String(value ?? '')
  } catch {
    return ''
  }

  return text
    .replace(/\b(?:npm_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,})\b/g, '[已脱敏]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[已脱敏]')
    .replace(/\b[A-Za-z0-9_-]*(?:token|secret|password|passwd|credential|private[_-]?key)[A-Za-z0-9_-]*\s*[:=]\s*[^\s,;]+/gi, '[已脱敏]')
    .replace(/(?:\/Users|\/home|\/var\/folders|\/private\/var\/folders|\/tmp)\/[^\s"'<>]+/g, '[本机路径]')
    .replace(/[A-Za-z]:\\(?:Users|Temp)\\[^\s"'<>]+/g, '[本机路径]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength)
}

function safeTimestamp(value, now) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 60_000) return now
  return Math.trunc(timestamp)
}

function safeStatus(value) {
  const status = Number(value)
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
}

export function sanitizeNotificationText(value, maxLength = 2000) {
  return safeText(value, maxLength)
}

export function normalizeNotification(value, { now = Date.now(), createId = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const type = ALLOWED_TYPES.has(value.type) ? value.type : 'info'
  const timestamp = safeTimestamp(value.timestamp, now)
  const id = safeText(value.id, 120) || (createId ? `${timestamp}-${Math.random().toString(36).slice(2, 8)}` : '')
  if (!id) return null

  const notification = {
    id,
    type,
    agentId: safeText(value.agentId, 160),
    agentName: safeText(value.agentName, 160) || '系统通知',
    message: safeText(value.message, 600) || '暂无通知摘要',
    timestamp,
    read: value.read === true,
  }

  const optionalText = {
    source: 160,
    detail: 3000,
    errorCode: 120,
    impact: 600,
    currentResult: 600,
    timeRange: 160,
  }
  for (const [key, maxLength] of Object.entries(optionalText)) {
    const text = safeText(value[key], maxLength)
    if (text) notification[key] = text
  }

  const httpStatus = safeStatus(value.httpStatus)
  if (httpStatus !== undefined) notification.httpStatus = httpStatus
  if (ALLOWED_RETRY_ACTIONS.has(value.retryAction)) notification.retryAction = value.retryAction
  return notification
}

export function loadPersistedNotifications(storage, now = Date.now()) {
  if (!storage || typeof storage.getItem !== 'function') return []
  try {
    const raw = storage.getItem(NOTIFICATION_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const oldestAllowed = now - NOTIFICATION_TTL_MS
    return parsed
      .map(item => normalizeNotification(item, { now, createId: false }))
      .filter(item => item && item.timestamp >= oldestAllowed)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, NOTIFICATION_MAX_ITEMS)
  } catch {
    return []
  }
}

export function persistNotifications(storage, notifications, now = Date.now()) {
  if (!storage || typeof storage.setItem !== 'function') return false
  try {
    const oldestAllowed = now - NOTIFICATION_TTL_MS
    const safeItems = (Array.isArray(notifications) ? notifications : [])
      .map(item => normalizeNotification(item, { now, createId: false }))
      .filter(item => item && item.timestamp >= oldestAllowed)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, NOTIFICATION_MAX_ITEMS)
    storage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(safeItems))
    return true
  } catch {
    return false
  }
}

export function clearPersistedNotifications(storage) {
  if (!storage || typeof storage.removeItem !== 'function') return false
  try {
    storage.removeItem(NOTIFICATION_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
