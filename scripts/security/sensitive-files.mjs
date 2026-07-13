import path from 'node:path'

const EXACT_NAMES = new Set([
  '.npmrc', '.netrc', '.envrc', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa', 'id_xmss',
  'openclaw.json', 'openclaw.json.last-good', 'dashboard-local-token', 'dashboard-gateway-token',
  'auth-profiles.json', 'auth-state.json', 'credentials.json', 'device.json', 'paired.json',
  'models.json', 'sessions.json',
])
const ROTATABLE_SENSITIVE_NAMES = [
  'openclaw.json', 'auth-profiles.json', 'auth-state.json', 'credentials.json',
  'device.json', 'paired.json', 'models.json', 'sessions.json',
  'dashboard-local-token', 'dashboard-gateway-token',
]
const SENSITIVE_NAME = /(?:^|[._-])(?:api[-_]?key|credential|credentials|secret|secrets|token|tokens|device-auth|auth-token)(?:[._-]|$)/i
const PRIVATE_KEY_NAME = /(?:^|[._-])(?:private[-_]?key|client[-_]?key|server[-_]?key)(?:[._-]|$)|\.(?:pem|key|p12|pfx)(?:[._-].*)?$/i
const GENERIC_BACKUP_NAME = /(?:^|[._-])(?:backup|backups|migrated?|migration|rotated?|archive)(?:[._-]|$)|\.(?:bak|old|orig)(?:[._-].*)?$/i

function isRotatedSensitiveName(basename) {
  return ROTATABLE_SENSITIVE_NAMES.some((name) => (
    basename === name
    || basename.startsWith(`${name}.`)
    || basename.startsWith(`${name}-backup`)
    || basename.startsWith(`${name}_backup`)
  ))
}

function containsSensitiveOpenClawAncestor(segments) {
  const openclawIndex = segments.lastIndexOf('.openclaw')
  if (openclawIndex < 0) return false
  const relative = segments.slice(openclawIndex + 1)
  if (['browser', 'logs', 'memory', 'state', 'service-env', 'identity', 'devices'].includes(relative[0])) return true
  if (relative[0] !== 'agents' || relative.length < 3) return false
  return relative[2] === 'agent' || relative[2] === 'sessions'
}

export function sensitiveFileReason(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  const basename = path.posix.basename(normalized).toLowerCase()
  const segments = normalized.toLowerCase().split('/').filter(Boolean)
  if (containsSensitiveOpenClawAncestor(segments)) return 'OpenClaw Agent 私有配置或会话目录禁止通过浏览器访问'
  if (EXACT_NAMES.has(basename)) return '文件包含身份或访问凭据'
  if (isRotatedSensitiveName(basename)) return '文件是敏感配置的备份、轮转或迁移副本'
  if (GENERIC_BACKUP_NAME.test(basename)) return '备份、迁移或轮转文件禁止通过通用文件接口读取'
  if (basename === '.env' || basename.startsWith('.env.')) return '环境配置可能包含密钥'
  if (/^search-index\.db(?:[._-].*)?$/i.test(basename)) return '搜索数据库及旁路文件禁止通过浏览器访问'
  if (PRIVATE_KEY_NAME.test(basename)) return '私钥或证书密钥文件禁止通过浏览器访问'
  if (SENSITIVE_NAME.test(basename)) return '文件名表明其可能包含凭据'
  if (/\.log(?:[._-].*)?$|\.jsonl(?:[._-].*)?$|\.jsonl\.gz$/i.test(basename)) return '日志或会话记录可能包含敏感内容'
  if (segments.includes('credentials') || segments.includes('device-auth')) return '目录包含身份凭据'
  if (segments.includes('.openclaw') && /\.(?:json|ya?ml|toml|ini|conf|config)$/i.test(basename)) {
    return 'OpenClaw 配置文件可能包含凭据'
  }
  return ''
}

export function assertNonSensitiveFilePath(filePath) {
  const reason = sensitiveFileReason(filePath)
  if (reason) throw new Error(`敏感文件禁止通过工作台读取或修改：${reason}`)
  return filePath
}
