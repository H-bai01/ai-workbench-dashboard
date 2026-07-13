import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REDACTED = '[REDACTED]'
const PRIVATE = '[PRIVATE]'
const PRIVATE_PATH = '[PRIVATE_PATH]'
const SENSITIVE_KEYS = new Set([
  'accesstoken', 'refreshtoken', 'clientsecret', 'apikey', 'privatekey',
  'token', 'secret', 'password', 'passwd', 'pwd', 'passphrase', 'credential', 'credentials',
  'authorization', 'auth', 'bottoken', 'appsecret', 'sessiontoken',
  'sessioncookie', 'cookie', 'encryptionkey', 'signingkey', 'bearer',
  'webhooksecret', 'secretaccesskey',
])
const TEXT_SENSITIVE_KEY = '(?:access[-_]?token|refresh[-_]?token|client[-_]?secret|bot[-_]?token|app[-_]?secret|session[-_]?token|webhook[-_]?secret|secret[-_]?access[-_]?key|api[-_]?key|private[-_]?key|token|secret|password|passwd|credentials?|authorization|auth)'
const PRIVATE_KEYS = new Set([
  'message', 'content', 'thinking', 'reasoning', 'toolresult', 'tooloutput', 'toolarguments',
  'requestbody', 'responsebody', 'body', 'prompt', 'input', 'output', 'response',
  'sessionid', 'conversationid', 'agentid',
])
const TEXT_PRIVATE_KEY = '(?:message|content|thinking|reasoning|tool[-_ ]?(?:result|output|arguments?)|request[-_ ]?body|response[-_ ]?body|body|prompt|input|output|session[-_ ]?id|conversation[-_ ]?id|agent[-_ ]?id)'

function isSensitiveKey(value) {
  const normalized = String(value || '').replace(/[-_]/g, '').toLowerCase()
  return SENSITIVE_KEYS.has(normalized)
    || /(?:token|secret|password|passwd|passphrase|credential|credentials|apikey|privatekey|accesskey|cookie|encryptionkey|signingkey|authorization|bearer)$/.test(normalized)
}

function isCollectableSecret(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text.length < 8) return false
  return !/^(?:true|false|null|none|enabled|disabled|default|unknown)$/i.test(text)
}

function normalizedKey(value) {
  return String(value || '').replace(/[-_\s]/g, '').toLowerCase()
}

function isPrivateDiagnosticKey(value) {
  return PRIVATE_KEYS.has(normalizedKey(value))
}

export function collectSensitiveValues(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const child of value) collectSensitiveValues(child, output)
    return output
  }
  if (!value || typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key) && isCollectableSecret(child)) output.add(child)
    if (child && typeof child === 'object') collectSensitiveValues(child, output)
  }
  return output
}

export function doctorCommand(platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: '',
      args: [],
      display: 'openclaw doctor --lint --json',
      readOnly: true,
      supported: false,
      reason: '当前 Windows 安装仅提供 .cmd 入口，安全模式不会通过 Shell 执行它',
    }
  }
  return {
    command: 'openclaw',
    args: ['doctor', '--lint', '--json'],
    display: 'openclaw doctor --lint --json（隔离目录）',
    readOnly: true,
    supported: true,
  }
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject)
  if (!value || typeof value !== 'object') return value
  const output = Object.create(null)
  for (const [key, child] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactObject(child)
  }
  return output
}

export function redactSensitiveText(value, secrets = []) {
  let text = String(value || '')
  for (const secret of secrets) {
    const token = String(secret || '')
    if (token.length >= 8) text = text.split(token).join(REDACTED)
  }
  const trimmed = text.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.stringify(redactObject(JSON.parse(trimmed)), null, 2) } catch { /* redact as text */ }
  }
  const assignment = new RegExp(`((?:"|')?${TEXT_SENSITIVE_KEY}(?:"|')?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\r\\n]+)`, 'gi')
  return text
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, REDACTED)
    .replace(/((?:authorization|auth)\s*[:=]\s*(?:bearer|basic|token)\s+)[^\r\n]+/gi, `$1${REDACTED}`)
    .replace(assignment, `$1${REDACTED}`)
}

function normalizeDiagnosticOptions(optionsOrSecrets) {
  if (Array.isArray(optionsOrSecrets)) {
    return { secrets: optionsOrSecrets, privateValues: [], homeDirs: [] }
  }
  const options = optionsOrSecrets && typeof optionsOrSecrets === 'object' ? optionsOrSecrets : {}
  return {
    secrets: Array.isArray(options.secrets) ? options.secrets : [],
    privateValues: Array.isArray(options.privateValues) ? options.privateValues : [],
    homeDirs: Array.isArray(options.homeDirs) ? options.homeDirs : [],
  }
}

function replaceExactPrivateValues(value, values, marker) {
  let output = String(value || '')
  const normalized = [...new Set(values
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length >= 3))]
    .sort((left, right) => right.length - left.length)
  for (const item of normalized) output = output.split(item).join(marker)
  return output
}

function redactHomePaths(value, homeDirs) {
  let output = String(value || '')
  const normalized = [...new Set(homeDirs
    .filter(item => typeof item === 'string')
    .map(item => item.trim().replace(/[\\/]+$/, ''))
    .filter(item => item.length >= 3))]
    .sort((left, right) => right.length - left.length)
  for (const homeDir of normalized) {
    const escaped = homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    output = output.replace(new RegExp(`${escaped}[^\\r\\n"'<>]*`, 'g'), PRIVATE_PATH)
  }
  return output
}

function redactDiagnosticObject(value, options) {
  if (Array.isArray(value)) return value.map(item => redactDiagnosticObject(item, options))
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactDiagnosticText(value, options) : value
  }
  const output = Object.create(null)
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) output[key] = REDACTED
    else if (isPrivateDiagnosticKey(key)) output[key] = PRIVATE
    else output[key] = redactDiagnosticObject(child, options)
  }
  return output
}

function redactDiagnosticText(value, options) {
  const raw = String(value || '')
  const trimmed = raw.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.stringify(redactDiagnosticObject(JSON.parse(trimmed), options), null, 2) } catch { /* redact as text */ }
  }

  let text = redactSensitiveText(raw, options.secrets)
  text = replaceExactPrivateValues(text, options.privateValues, PRIVATE)
  text = redactHomePaths(text, options.homeDirs)
  text = text
    .replace(/\/(?:Users|home)\/[^/\r\n"'<>]+(?:\/[^\r\n"'<>]*)?/g, PRIVATE_PATH)
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n"'<>]+(?:\\[^\r\n"'<>]*)?/g, PRIVATE_PATH)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[PRIVATE_ID]')
  const assignment = new RegExp(`((?:"|')?${TEXT_PRIVATE_KEY}(?:"|')?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\r\\n]+)`, 'gi')
  return text.replace(assignment, `$1${PRIVATE}`)
}

export function redactDiagnosticResult(result, optionsOrSecrets = []) {
  const options = normalizeDiagnosticOptions(optionsOrSecrets)
  return {
    stdout: redactDiagnosticText(result?.stdout, options),
    stderr: redactDiagnosticText(result?.stderr, options),
    error: redactDiagnosticText(result?.error, options),
  }
}

export function createReadOnlyDoctorSandbox({ configPath = '', tempRoot = os.tmpdir() } = {}) {
  const home = fs.mkdtempSync(path.join(tempRoot, 'openclaw-doctor-readonly-'))
  try {
    fs.chmodSync(home, 0o700)
    const stateDir = path.join(home, '.openclaw')
    fs.mkdirSync(stateDir, { mode: 0o700 })
    const isolatedConfig = path.join(stateDir, 'openclaw.json')
    if (configPath && fs.existsSync(configPath)) {
      const source = fs.lstatSync(configPath)
      if (!source.isFile() || source.isSymbolicLink()) throw new Error('诊断配置必须是普通文件')
      fs.copyFileSync(configPath, isolatedConfig, fs.constants.COPYFILE_EXCL)
      fs.chmodSync(isolatedConfig, 0o600)
    } else {
      fs.writeFileSync(isolatedConfig, '{}\n', { mode: 0o600 })
    }
    return {
      home,
      stateDir,
      configPath: isolatedConfig,
      env: {
        HOME: home,
        USERPROFILE: home,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_CONFIG_PATH: isolatedConfig,
        OPENCLAW_SKIP_DOTENV: '1',
        AI_WORKBENCH_HOME: path.join(home, 'ai-workbench'),
        AI_WORKBENCH_LOCAL_TOKEN_FILE: path.join(home, 'ai-workbench', 'secrets', 'dashboard-local-token'),
      },
      cleanup() { fs.rmSync(home, { recursive: true, force: true }) },
    }
  } catch (error) {
    fs.rmSync(home, { recursive: true, force: true })
    throw error
  }
}

export function directoryFingerprint(root) {
  const entries = []
  if (!fs.existsSync(root)) return entries
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      const relative = path.relative(root, full)
      const stat = fs.lstatSync(full)
      if (entry.isSymbolicLink()) entries.push({ path: relative, type: 'symlink', target: fs.readlinkSync(full) })
      else if (entry.isDirectory()) { entries.push({ path: relative, type: 'dir', mode: stat.mode & 0o777 }); visit(full) }
      else if (entry.isFile()) entries.push({
        path: relative,
        type: 'file',
        mode: stat.mode & 0o777,
        size: stat.size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
      })
    }
  }
  visit(root)
  return entries
}
