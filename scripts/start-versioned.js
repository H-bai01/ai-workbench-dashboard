import { spawn } from 'child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import { installPrivacyConsole, installProcessErrorPrivacy } from '../src/utils/log-privacy.mjs'

installPrivacyConsole(console, { scope: 'launcher' })
installProcessErrorPrivacy(process, console, { scope: 'launcher' })

const require = createRequire(import.meta.url)

function resolvePackageBin(packageName, ...segments) {
  return path.join(path.dirname(require.resolve(`${packageName}/package.json`)), ...segments)
}

const PROFILES = {
  v2: { label: '2.0', frontendPort: 31021, backendPort: 31022 },
}

function parseProfile() {
  const arg = process.argv.slice(2).find((item) => item.startsWith('--profile='))
  const direct = process.argv.slice(2).find((item) => !item.startsWith('--'))
  return (arg?.split('=')[1] || direct || 'v2').toLowerCase()
}

const profileName = parseProfile()
const selectedProfile = PROFILES[profileName]
const httpsEnabled = process.argv.includes('--https') || process.env.OPENCLAW_HTTPS === '1'

if (!selectedProfile) {
  console.error(`未知启动配置：${profileName}`)
  console.error(`可用配置：${Object.keys(PROFILES).join(', ')}`)
  process.exit(1)
}

function parsePort(value, fallback, label) {
  const port = Number.parseInt(String(value || fallback), 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label}端口无效`)
  return port
}

function assertLoopbackHost(value, label) {
  const host = String(value || '127.0.0.1').trim().toLowerCase()
  if (host !== '127.0.0.1') throw new Error(`${label}当前仅支持监听 127.0.0.1`)
  return host
}

function assertPortAvailable(host, port, label) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once('error', (error) => {
      const detail = error?.code === 'EADDRINUSE' ? '端口已被占用；不会结束现有进程' : (error?.message || error)
      reject(new Error(`${label} ${host}:${port} 不可用：${detail}`))
    })
    probe.listen(port, host, () => probe.close(resolve))
  })
}

const profile = {
  ...selectedProfile,
  frontendPort: parsePort(process.env.FRONTEND_PORT, selectedProfile.frontendPort, '前端'),
  backendPort: parsePort(process.env.BACKEND_PORT, selectedProfile.backendPort, '后端'),
}
const frontendHost = assertLoopbackHost(process.env.FRONTEND_HOST, '前端')
const backendHost = assertLoopbackHost(process.env.BACKEND_HOST, '后端')
if (profile.frontendPort === profile.backendPort) throw new Error('前端与后端不能使用同一个端口')
await assertPortAvailable(backendHost, profile.backendPort, '后端')
await assertPortAvailable(frontendHost, profile.frontendPort, '前端')

const backendEnv = {
  ...process.env,
  FRONTEND_PORT: String(profile.frontendPort),
  BACKEND_PORT: String(profile.backendPort),
  BACKEND_HOST: backendHost,
  OPENCLAW_HTTPS: httpsEnabled ? '1' : '',
  OPENCLAW_DASHBOARD_PROFILE: profile.label,
}

const frontendEnv = Object.fromEntries([
  'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'NODE_PATH',
  'FRONTEND_HOST', 'OPENCLAW_HTTPS_FRONTEND_PORT', 'OPENCLAW_DASHBOARD_TRUSTED_ORIGINS',
  'OPENCLAW_SKIP_DOTENV', 'OPENCLAW_VITE_CACHE_DIR',
].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]))
Object.assign(frontendEnv, {
  FRONTEND_PORT: String(profile.frontendPort),
  BACKEND_PORT: String(profile.backendPort),
  OPENCLAW_HTTPS: httpsEnabled ? '1' : '',
  OPENCLAW_DASHBOARD_PROFILE: profile.label,
  FRONTEND_HOST: frontendHost,
})

console.log('='.repeat(56))
console.log(`AI 工作台总控 ${profile.label}`)
const scheme = httpsEnabled ? 'https' : 'http'
console.log(`前端：${scheme}://127.0.0.1:${profile.frontendPort}`)
if (httpsEnabled) {
  console.log('提示：首次打开 HTTPS 本地证书时，浏览器会提示不受信任，手动继续后即可授权麦克风。')
}
console.log(`后端：http://127.0.0.1:${profile.backendPort}`)
console.log('='.repeat(56))

const children = []
let shuttingDown = false

function start(role, command, args, childEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  children.push(child)
  child.stdout.on('data', (chunk) => {
    console.info(`[Launcher] ${role} output`, chunk.toString('utf8'), { count: chunk.length })
  })
  child.stderr.on('data', (chunk) => {
    console.warn(`[Launcher] ${role} diagnostic`, chunk.toString('utf8'), { count: chunk.length })
  })
  child.on('error', (error) => {
    if (shuttingDown) return
    console.error(`[Launcher] ${role} startup failed`, error)
    stopAll()
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`[Launcher] ${role} exited`, { code: code ?? 0, signal: Boolean(signal) })
    stopAll()
    process.exit(code && code !== 0 ? code : 1)
  })
  return child
}

function stopAll() {
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
}

process.on('SIGINT', () => {
  stopAll()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopAll()
  process.exit(0)
})

const viteBin = resolvePackageBin('vite', 'bin', 'vite.js')
const backendNodeArgs = process.versions.node.startsWith('22.') ? ['--experimental-sqlite'] : []
start('backend', process.execPath, [...backendNodeArgs, 'scripts/unified-service.js'], backendEnv)
start('frontend', process.execPath, [viteBin, '--host', frontendHost, '--port', String(profile.frontendPort), '--strictPort'], frontendEnv)
