import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'
import { resolveTestBrowserExecutable } from './test-browser-executable.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const syntheticSecret = `synthetic-vite-secret-${Date.now()}-do-not-expose`
let tmpRoot
let frontend
let frontendPort
let backendPort
let hangingBackend
let outDir

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: requestPath }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).once('error', reject)
  })
}

async function waitForVite() {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    try {
      const response = await request(frontendPort, '/')
      if (response.status === 200) return
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('temporary Vite did not start')
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 3000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

function filesUnder(root) {
  const files = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else files.push(full)
    }
  }
  visit(root)
  return files
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-vite-secret-test-'))
  const home = path.join(tmpRoot, 'home')
  const openclawDir = path.join(home, '.openclaw')
  fs.mkdirSync(openclawDir, { recursive: true })
  fs.writeFileSync(path.join(openclawDir, 'dashboard-local-token'), 'c'.repeat(64), { mode: 0o600 })
  frontendPort = await freePort()
  backendPort = await freePort()
  outDir = path.join(tmpRoot, 'dist')
  const viteBin = path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js')
  const env = createIsolatedProcessEnv({
    isolationRoot: tmpRoot,
    homeDir: home,
    overrides: {
      FRONTEND_PORT: String(frontendPort),
      BACKEND_PORT: String(backendPort),
      OPENCLAW_VITE_CACHE_DIR: path.join(tmpRoot, 'vite-cache'),
      VITE_GATEWAY_TOKEN: syntheticSecret,
    },
  })
  const build = spawnSync(process.execPath, [viteBin, 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: repo,
    env,
    shell: false,
    stdio: 'pipe',
    maxBuffer: 20 * 1024 * 1024,
  })
  assert.equal(build.status, 0, 'temporary production build failed')
  hangingBackend = http.createServer((_req, _res) => {
    // Deliberately never reply: the browser must use its finite public-config timeout.
  })
  await new Promise((resolve, reject) => {
    hangingBackend.once('error', reject)
    hangingBackend.listen(backendPort, '127.0.0.1', resolve)
  })
  frontend = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
    cwd: repo,
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForVite()
})

after(async () => {
  await stop(frontend)
  hangingBackend?.closeAllConnections?.()
  await new Promise(resolve => hangingBackend?.close(() => resolve()) || resolve())
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('合成 VITE Gateway 密钥不出现在生产构建', () => {
  for (const file of filesUnder(outDir)) {
    assert.equal(fs.readFileSync(file).includes(Buffer.from(syntheticSecret)), false, 'production output exposed synthetic secret')
  }
})

test('合成 VITE Gateway 密钥不出现在 Vite 实际返回的 Vue/TS 转换模块', async () => {
  const initial = filesUnder(path.join(repo, 'src'))
    .filter(file => /\.(?:ts|vue|mjs)$/.test(file))
    .map(file => `/${path.relative(repo, file).split(path.sep).join('/')}`)
  initial.push('/@vite/client')
  const queue = [...new Set(initial)]
  const visited = new Set()
  while (queue.length > 0 && visited.size < 1500) {
    const modulePath = queue.shift()
    if (visited.has(modulePath)) continue
    visited.add(modulePath)
    const response = await request(frontendPort, modulePath)
    if (response.status !== 200) continue
    assert.equal(response.body.includes(syntheticSecret), false, 'Vite transformed module exposed synthetic secret')
    for (const match of response.body.matchAll(/["'](\/src\/[^"']+|\/@vite\/client)["']/g)) {
      if (!visited.has(match[1])) queue.push(match[1])
    }
  }
  assert.ok(visited.size > initial.length, 'Vue submodules were not inspected')
})

test('公开配置端点挂起时旧浏览器凭据先清理，超时后页面仍挂载', async () => {
  const transformedMain = await request(frontendPort, '/src/main.ts')
  assert.equal(transformedMain.status, 200)
  const clearAt = transformedMain.body.indexOf('clearLegacyGatewayCredential()')
  const loadAt = transformedMain.body.indexOf('await loadDashboardPublicConfig()')
  assert.ok(clearAt >= 0 && loadAt > clearAt, 'legacy credential cleanup must happen before the first async request')

  const profile = path.join(tmpRoot, 'browser-profile')
  const executablePath = resolveTestBrowserExecutable()
  assert.ok(executablePath, 'a system Chrome/Chromium executable is required for the browser boundary test')
  const context = await chromium.launchPersistentContext(profile, { headless: true, executablePath })
  try {
    const page = context.pages()[0] || await context.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('gateway-token', 'legacy-local-secret')
      sessionStorage.setItem('gateway-token', 'legacy-session-secret')
    })
    await page.goto(`http://127.0.0.1:${frontendPort}/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForSelector('.dashboard', { timeout: 10000 })
    const stored = await page.evaluate(() => ({
      local: localStorage.getItem('gateway-token'),
      session: sessionStorage.getItem('gateway-token'),
    }))
    assert.deepEqual(stored, { local: null, session: null })
  } finally {
    await context.close()
  }
})
