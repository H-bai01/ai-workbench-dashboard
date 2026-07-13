import { execFile, execFileSync } from 'node:child_process'
import path from 'node:path'

const SAFE_ENV_PATH_SUFFIX = ['/opt/homebrew/bin', '/usr/local/bin']
const SAFE_BASE_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'SHELL', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'NODE_PATH',
])
const SENSITIVE_ENV_NAME = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|CREDENTIAL|AUTH)/i
const RESERVED_PROPERTY_NAMES = new Set(['__proto__', 'prototype', 'constructor'])

export function commandEnvironment(baseEnv = process.env, {
  extra = {},
  allowSensitiveKeys = [],
} = {}) {
  const result = {}
  const allowedSensitive = new Set(allowSensitiveKeys)
  for (const key of SAFE_BASE_ENV_KEYS) {
    if (baseEnv?.[key] !== undefined) result[key] = String(baseEnv[key])
  }
  for (const [key, value] of Object.entries(extra || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value === undefined || value === null) continue
    if (SENSITIVE_ENV_NAME.test(key) && !allowedSensitive.has(key)) continue
    result[key] = String(value)
  }
  const parts = String(result.PATH || '').split(path.delimiter).filter(Boolean)
  if (process.platform !== 'win32') {
    for (const suffix of SAFE_ENV_PATH_SUFFIX) if (!parts.includes(suffix)) parts.push(suffix)
  }
  result.PATH = parts.join(path.delimiter)
  return result
}

export function assertSafeCliIdentifier(value, label = 'identifier', { maxLength = 128 } = {}) {
  const text = String(value || '').trim()
  if (!text || text.length > maxLength || text.startsWith('-') || /[\0\r\n]/.test(text)) {
    throw new Error(`${label} 格式无效`)
  }
  if (!/^[\p{L}\p{N}_.:@/+ -]+$/u.test(text) || text.includes('..')) {
    throw new Error(`${label} 包含非法字符`)
  }
  return text
}

export function assertSkillId(value) {
  const text = String(value || '').trim()
  const lower = text.toLowerCase()
  if (!text || text.length > 100 || text.startsWith('-') || path.isAbsolute(text) || text.includes('\\')) {
    throw new Error('技能 ID 格式无效')
  }
  if (text === '.' || text === '..' || text.startsWith('./') || text.startsWith('../')) throw new Error('技能 ID 不能是路径')
  if (RESERVED_PROPERTY_NAMES.has(lower)) throw new Error('技能 ID 使用了保留名称')
  const canonical = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
  if (!canonical.test(text)) throw new Error('技能 ID 不是规范包名或技能 ID')
  for (const segment of text.replace(/^@/, '').split('/')) {
    if (RESERVED_PROPERTY_NAMES.has(segment.toLowerCase())) throw new Error('技能 ID 使用了保留名称')
  }
  return text
}

export function assertSafeArgumentValue(value, label = 'value', {
  maxLength = 4096,
  allowNewlines = false,
  allowLeadingDash = false,
} = {}) {
  const text = String(value ?? '')
  const forbidden = allowNewlines ? /\0/ : /[\0\r\n]/
  if (!text.trim() || text.length > maxLength || forbidden.test(text) || (!allowLeadingDash && text.trimStart().startsWith('-'))) {
    throw new Error(`${label} 格式无效`)
  }
  return text
}

export function assertAgentId(value) {
  const text = String(value || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text)) throw new Error('Agent ID 格式无效')
  return text
}

export function assertCronId(value) {
  const text = String(value || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text)) throw new Error('Cron ID 格式无效')
  return text
}

export function assertVersion(value) {
  const text = String(value || '').trim()
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(text)) throw new Error('版本号格式无效')
  return text.replace(/^v/, '')
}

export function optionValue(name, value) {
  if (!/^--[a-z][a-z0-9-]*$/.test(name)) throw new Error('CLI 选项名无效')
  const text = String(value ?? '')
  if (/\0/.test(text)) throw new Error('CLI 选项值无效')
  return `${name}=${text}`
}

export function parseCommandTemplate(value, replacements = {}) {
  let parsed
  try {
    parsed = JSON.parse(String(value || ''))
  } catch {
    throw new Error('自定义命令必须是 JSON 参数数组')
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 64) {
    throw new Error('自定义命令必须是非空 JSON 参数数组')
  }
  const rendered = parsed.map((part) => {
    if (typeof part !== 'string' || /[\0\r\n]/.test(part)) throw new Error('自定义命令参数格式无效')
    let result = part
    for (const [key, replacement] of Object.entries(replacements)) result = result.replaceAll(key, String(replacement ?? ''))
    return result
  })
  const command = rendered.shift()
  if (!command || command.startsWith('-')) throw new Error('自定义命令程序名无效')
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)) throw new Error('当前 Windows 命令入口无法在关闭 Shell 的条件下安全执行')
  return { command, args: rendered }
}

export function runFileCommand(command, args = [], timeoutMs = 30000, options = {}) {
  if (!command || typeof command !== 'string' || !Array.isArray(args)) {
    return Promise.resolve({ success: false, error: 'invalid command' })
  }
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)) {
    return Promise.resolve({ success: false, error: '当前 Windows 命令入口无法在关闭 Shell 的条件下安全执行' })
  }
  const env = commandEnvironment(options.baseEnv || process.env, {
    extra: options.env,
    allowSensitiveKeys: options.allowSensitiveEnvKeys,
  })
  return new Promise((resolve) => {
    let settled = false
    const child = execFile(command, args.map(arg => String(arg)), {
      shell: false,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      encoding: 'buffer',
      env,
      cwd: options.cwd,
    }, (error, stdout, stderr) => {
      if (settled) return
      settled = true
      const decode = options.decode || ((value) => Buffer.from(value || '').toString('utf8'))
      const stdoutText = decode(stdout)
      const stderrText = decode(stderr)
      if (error) resolve({ success: false, error: error.killed ? `命令超时（${timeoutMs / 1000}秒）` : error.message, stdout: stdoutText, stderr: stderrText })
      else resolve({ success: true, stdout: stdoutText, stderr: stderrText })
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      resolve({ success: false, error: error.message, stdout: '', stderr: '' })
    })
  })
}

export function commandExists(command, { platform = process.platform, env = process.env } = {}) {
  if (!command || /[\0\r\n]/.test(command)) return false
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)) return false
  const finder = platform === 'win32' ? 'where.exe' : 'which'
  try {
    execFileSync(finder, [command], { shell: false, stdio: 'ignore', env: commandEnvironment(env) })
    return true
  } catch {
    return false
  }
}

export function openClawControlCapability(platform = process.platform) {
  if (platform === 'win32') {
    return { supported: false, error: 'Windows 的安全 OpenClaw 控制入口尚未接入，消息未发送' }
  }
  return { supported: true, error: '' }
}
