import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

function expandHome(value, homeDir) {
  const text = String(value || '').trim()
  if (text === '~') return homeDir
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(homeDir, text.slice(2))
  return text
}

function isLoopbackAddress(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  if (net.isIP(host) === 4) return host.startsWith('127.')
  return false
}

export function normalizeGatewayUrl(value) {
  const raw = String(value || 'http://127.0.0.1:18789').trim()
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('OPENCLAW_GATEWAY_URL 格式无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Gateway 只允许 http 或 https 协议')
  if (!isLoopbackAddress(url.hostname)) throw new Error('本机模式只允许连接回环地址的 Gateway')
  if (url.username || url.password) throw new Error('Gateway URL 不得包含凭据')
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function assertSecureSecretFile(filePath, {
  platform = process.platform,
  expectedUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  const absolute = path.resolve(filePath)
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink()) throw new Error('密钥文件不能是符号链接')
  if (!stat.isFile()) throw new Error('密钥路径必须是普通文件')
  if (platform !== 'win32') {
    if (expectedUid !== null && Number.isInteger(stat.uid) && stat.uid !== expectedUid) {
      throw new Error('密钥文件不属于当前用户')
    }
    if ((stat.mode & 0o777) !== 0o600) throw new Error('密钥文件权限必须为 0600')
  }
  return absolute
}

function readSecureTrimmedFile(filePath, options) {
  const safePath = assertSecureSecretFile(filePath, options)
  return fs.readFileSync(safePath, 'utf8').trim()
}

export function readGatewayCredentials({
  env = process.env,
  homeDir = os.homedir(),
  platform = process.platform,
  expectedUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  const gatewayUrl = normalizeGatewayUrl(env.OPENCLAW_GATEWAY_URL)
  const fromEnvironment = String(env.OPENCLAW_GATEWAY_TOKEN || '').trim()
  if (fromEnvironment) return { gatewayUrl, token: fromEnvironment, source: 'environment' }

  const configuredFile = expandHome(env.OPENCLAW_GATEWAY_TOKEN_FILE, homeDir)
  const tokenFile = configuredFile || path.join(homeDir, '.openclaw', 'dashboard-gateway-token')
  try {
    const fromFile = readSecureTrimmedFile(tokenFile, { platform, expectedUid })
    if (fromFile) return { gatewayUrl, token: fromFile, source: 'token-file', tokenFile }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const configPath = expandHome(env.OPENCLAW_CONFIG_PATH, homeDir)
    || path.join(homeDir, '.openclaw', 'openclaw.json')
  try {
    const configText = readSecureTrimmedFile(configPath, { platform, expectedUid })
    const config = JSON.parse(configText)
    const token = String(config?.gateway?.auth?.token || '').trim()
    if (token) return { gatewayUrl, token, source: 'openclaw-config', configPath }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  return { gatewayUrl, token: '', source: 'missing', tokenFile }
}

export function gatewayWebSocketUrl(gatewayUrl) {
  const url = new URL(normalizeGatewayUrl(gatewayUrl))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  url.search = ''
  url.hash = ''
  return url.toString()
}
