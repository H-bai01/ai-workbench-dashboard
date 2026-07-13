const PRIVACY_CONSOLE_STATE = Symbol.for('ai-workbench.privacy-console')
const FORMAT_FALLBACK = '[privacy] scope=runtime level=error event=log_format error=failure detail=操作失败'

const CONSOLE_METHODS = [
  'log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'dirxml', 'table',
  'group', 'groupCollapsed', 'timeLog', 'timeEnd', 'count',
]

const EVENT_RULES = [
  ['health', /\bhealth\b|健康/i],
  ['gateway', /gateway|websocket|\bws\b|网关/i],
  ['agent', /\bagent\b|代理/i],
  ['session', /session|conversation|会话/i],
  ['skill', /skill|clawhub|技能/i],
  ['cron', /cron|定时/i],
  ['search', /search|index|fts|搜索|索引/i],
  ['upload', /upload|image|avatar|上传|头像/i],
  ['voice', /voice|audio|speech|语音/i],
  ['billing', /billing|cost|usage|token|费用|用量|计费/i],
  ['version', /version|release|rollback|版本|回退/i],
  ['file', /file|path|dist|backup|restore|文件|备份|恢复/i],
  ['startup', /start|listen|server|service|vite|pwa|启动|端口|服务/i],
]

const ERROR_RULES = [
  ['timeout', /timeout|timed out|超时/i],
  ['authentication', /unauthori[sz]ed|authentication|invalid token|鉴权|认证/i],
  ['permission', /forbidden|permission|eacces|eperm|权限/i],
  ['not_found', /not[ _-]?found|enoent|不存在|未找到/i],
  ['conflict', /eaddrinuse|already exists|conflict|端口已被占用|冲突/i],
  ['validation', /invalid|validation|malformed|不合法|无效/i],
  ['parse', /parse|syntax|json|解析/i],
  ['network', /network|econn|enotfound|socket|网络|连接/i],
  ['aborted', /abort|cancel|terminated|中止|取消|终止/i],
]

const ERROR_DETAILS = {
  timeout: '操作超时',
  authentication: '认证失败',
  permission: '权限不足',
  not_found: '资源未找到',
  conflict: '端口已被占用',
  validation: '输入无效',
  parse: '数据解析失败',
  network: '网络连接失败',
  aborted: '操作已终止',
  failure: '操作失败',
  warning: '操作警告',
}

function normalizeLabel(value, fallback) {
  try {
    if (typeof value !== 'string') return fallback
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
    return normalized.slice(0, 40) || fallback
  } catch {
    return fallback
  }
}

function ownDataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function safeArgumentList(args) {
  try {
    return Array.isArray(args) ? args : [args]
  } catch {
    return []
  }
}

function collectHints(args) {
  const hints = []
  for (const value of safeArgumentList(args)) {
    try {
      if (typeof value === 'string') {
        hints.push(value.slice(0, 400))
        continue
      }
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue
      for (const key of ['code', 'name', 'message']) {
        const candidate = ownDataValue(value, key)
        if (typeof candidate === 'string') hints.push(candidate.slice(0, key === 'message' ? 400 : 120))
      }
    } catch {
      // Untrusted log arguments never get to affect logging control flow.
    }
  }
  return hints.join(' ')
}

function firstSafeNumber(args, keys) {
  for (const value of safeArgumentList(args)) {
    for (const key of keys) {
      const candidate = ownDataValue(value, key)
      if (Number.isSafeInteger(candidate) && candidate >= 0) return candidate
    }
  }
  return undefined
}

function firstSafeBoolean(args, keys) {
  for (const value of safeArgumentList(args)) {
    for (const key of keys) {
      const candidate = ownDataValue(value, key)
      if (typeof candidate === 'boolean') return candidate
    }
  }
  return undefined
}

export function classifyPrivacyEvent(args, fallback = 'general') {
  try {
    const hints = collectHints(args)
    return EVENT_RULES.find(([, pattern]) => pattern.test(hints))?.[0] || normalizeLabel(fallback, 'general')
  } catch {
    return 'general'
  }
}

export function classifyPrivacyError(args, level = 'error') {
  try {
    const hints = collectHints(args)
    const category = ERROR_RULES.find(([, pattern]) => pattern.test(hints))?.[0]
    if (category) return category
    if (level === 'warn') return 'warning'
    return level === 'error' ? 'failure' : ''
  } catch {
    return level === 'warn' ? 'warning' : level === 'error' ? 'failure' : ''
  }
}

export function formatPrivacyLog(options = {}) {
  try {
    const scope = ownDataValue(options, 'scope')
    const level = ownDataValue(options, 'level')
    const event = ownDataValue(options, 'event')
    const args = ownDataValue(options, 'args')
    const safeScope = normalizeLabel(scope, 'runtime')
    const safeLevel = typeof level === 'string' && ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info'
    const safeEvent = typeof event === 'string' && event ? normalizeLabel(event, 'general') : classifyPrivacyEvent(args)
    const status = firstSafeNumber(args, ['status', 'statusCode'])
    const count = firstSafeNumber(args, ['count', 'total'])
    const ok = firstSafeBoolean(args, ['ok', 'success'])
    const error = classifyPrivacyError(args, safeLevel)
    const fields = [`scope=${safeScope}`, `level=${safeLevel}`, `event=${safeEvent}`]
    if (ok !== undefined) fields.push(`outcome=${ok ? 'success' : 'failure'}`)
    if (status !== undefined && status >= 100 && status <= 599) fields.push(`status=${status}`)
    if (count !== undefined) fields.push(`count=${count}`)
    if (error) fields.push(`error=${error}`, `detail=${ERROR_DETAILS[error] || ERROR_DETAILS.failure}`)
    return `[privacy] ${fields.join(' ')}`
  } catch {
    return FORMAT_FALLBACK
  }
}

function originalConsoleMethod(consoleTarget, method) {
  const state = consoleTarget?.[PRIVACY_CONSOLE_STATE]
  if (state?.originals?.[method]) return state.originals[method]
  const candidate = consoleTarget?.[method]
  return typeof candidate === 'function' ? candidate.bind(consoleTarget) : () => {}
}

export function installPrivacyConsole(consoleTarget = console, { scope = 'runtime' } = {}) {
  if (!consoleTarget || consoleTarget[PRIVACY_CONSOLE_STATE]) {
    return consoleTarget?.[PRIVACY_CONSOLE_STATE]?.restore || (() => {})
  }
  const originals = Object.create(null)
  for (const method of CONSOLE_METHODS) {
    if (typeof consoleTarget[method] === 'function') originals[method] = consoleTarget[method].bind(consoleTarget)
  }
  const fallback = originals.log || (() => {})
  const state = { originals, restore: () => {} }
  Object.defineProperty(consoleTarget, PRIVACY_CONSOLE_STATE, { configurable: true, value: state })

  for (const method of CONSOLE_METHODS) {
    if (!originals[method]) continue
    const level = method === 'error' ? 'error' : method === 'warn' ? 'warn' : method === 'debug' ? 'debug' : 'info'
    const sink = method === 'trace' ? (originals.debug || fallback) : originals[method]
    consoleTarget[method] = (...args) => sink(formatPrivacyLog({ scope, level, args }))
  }
  if (typeof consoleTarget.assert === 'function') {
    originals.assert = consoleTarget.assert.bind(consoleTarget)
    consoleTarget.assert = (condition, ...args) => {
      if (!condition) (originals.error || fallback)(formatPrivacyLog({ scope, level: 'error', event: 'assertion', args }))
    }
  }
  if (typeof consoleTarget.countReset === 'function') {
    originals.countReset = consoleTarget.countReset.bind(consoleTarget)
    consoleTarget.countReset = () => {}
  }
  if (typeof consoleTarget.time === 'function') {
    originals.time = consoleTarget.time.bind(consoleTarget)
    consoleTarget.time = () => {}
  }

  state.restore = () => {
    for (const [method, original] of Object.entries(originals)) consoleTarget[method] = original
    delete consoleTarget[PRIVACY_CONSOLE_STATE]
  }
  return state.restore
}

export function installBrowserErrorPrivacy(windowTarget = window, consoleTarget = console, { scope = 'browser' } = {}) {
  if (!windowTarget?.addEventListener) return () => {}
  const sink = originalConsoleMethod(consoleTarget, 'error')
  const onError = (event) => {
    try { event?.preventDefault?.() } catch { /* hostile events are still contained */ }
    sink(formatPrivacyLog({ scope, level: 'error', event: 'runtime_error', args: [] }))
  }
  const onRejection = (event) => {
    try { event?.preventDefault?.() } catch { /* hostile events are still contained */ }
    sink(formatPrivacyLog({ scope, level: 'error', event: 'unhandled_rejection', args: [] }))
  }
  windowTarget.addEventListener('error', onError, true)
  windowTarget.addEventListener('unhandledrejection', onRejection)
  return () => {
    windowTarget.removeEventListener('error', onError, true)
    windowTarget.removeEventListener('unhandledrejection', onRejection)
  }
}

export function installProcessErrorPrivacy(processTarget = process, consoleTarget = console, { scope = 'runtime' } = {}) {
  if (!processTarget?.on) return () => {}
  const sink = originalConsoleMethod(consoleTarget, 'error')
  let handling = false
  const fail = (event, error) => {
    if (handling) return
    handling = true
    sink(formatPrivacyLog({ scope, level: 'error', event, args: [error] }))
    processTarget.exitCode = 1
    if (typeof processTarget.exit === 'function') setTimeout(() => processTarget.exit(1), 0)
  }
  const onException = error => fail('uncaught_exception', error)
  const onRejection = error => fail('unhandled_rejection', error)
  processTarget.on('uncaughtException', onException)
  processTarget.on('unhandledRejection', onRejection)
  return () => {
    processTarget.off?.('uncaughtException', onException)
    processTarget.off?.('unhandledRejection', onRejection)
  }
}
