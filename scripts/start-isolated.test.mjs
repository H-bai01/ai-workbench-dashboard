import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const temporaryRoots = []
after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true })
})

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

function request(host, port, requestPath, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: requestPath, timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('timeout', () => req.destroy(new Error('request timeout')))
    req.once('error', reject)
  })
}

async function waitForHttp(port, requestPath, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await request('127.0.0.1', port, requestPath)
      if (response.status === 200) return response
    } catch { /* startup in progress */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`recommended startup did not serve ${requestPath}`)
}

async function waitForClosed(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { await request('127.0.0.1', port, '/api/health', 250) } catch { return }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`port ${port} still has a listener after shutdown`)
}

function nonLoopbackIpv4() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return ''
}

function stopProcessGroup(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      resolve()
    }, 8000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  })
}

function waitForExit(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode)
    const timer = setTimeout(() => reject(new Error('temporary launcher did not exit')), timeoutMs)
    child.once('exit', code => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

function createDirectoryLink(target, link) {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

function runDashboardTokenConsumer(env, { expectedToken = '', markerFile = '' } = {}) {
  const moduleUrl = pathToFileURL(path.join(repo, 'scripts', 'dashboard-token.mjs')).href
  const code = `
    import fs from 'node:fs';
    import { getOrCreateLocalToken } from ${JSON.stringify(moduleUrl)};
    const token = getOrCreateLocalToken();
    if (process.env.EXPECTED_SYNTHETIC_TOKEN && token === process.env.EXPECTED_SYNTHETIC_TOKEN) {
      fs.writeFileSync(process.env.SYNTHETIC_CONSUMER_MARKER, 'read');
    }
  `
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: repo,
      env: {
        ...env,
        EXPECTED_SYNTHETIC_TOKEN: expectedToken,
        SYNTHETIC_CONSUMER_MARKER: markerFile,
      },
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (codeValue) => {
      if (codeValue === 0) resolve()
      else reject(new Error(`dashboard token consumer failed (${codeValue}): ${stderr}`))
    })
  })
}

async function assertUnsafeEnvironmentRejected({ createEnvironment, externalTokenFile, markerFile = '' }) {
  let env
  let rejection
  try { env = createEnvironment() } catch (error) { rejection = error }
  if (env) await runDashboardTokenConsumer(env)
  assert.equal(fs.existsSync(externalTokenFile), false, '真实 dashboard-token 消费发生了隔离根外写入')
  if (markerFile) assert.equal(fs.existsSync(markerFile), false, '真实 dashboard-token 消费读取了隔离根外 token')
  assert.ok(rejection, '不安全的测试环境必须在启动真实消费者前被拒绝')
}

test('隔离环境助手拒绝物理符号链接逃逸并允许安全不存在尾部', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-physical-boundary-'))
  temporaryRoots.push(root)

  assert.throws(() => createIsolatedProcessEnv({
    isolationRoot: path.join(root, 'missing-anchor'),
    homeDir: root,
  }), /isolationRoot|预先创建|物理/)
  const linkedAnchorTarget = path.join(root, 'linked-anchor-target')
  const linkedAnchor = path.join(root, 'linked-anchor')
  fs.mkdirSync(linkedAnchorTarget, { mode: 0o700 })
  createDirectoryLink(linkedAnchorTarget, linkedAnchor)
  assert.throws(() => createIsolatedProcessEnv({
    isolationRoot: linkedAnchor,
    homeDir: linkedAnchorTarget,
  }), /isolationRoot|符号链接|物理/)
  if (process.platform !== 'win32') {
    const openAnchor = path.join(root, 'open-anchor')
    fs.mkdirSync(openAnchor, { mode: 0o700 })
    fs.chmodSync(openAnchor, 0o755)
    assert.throws(() => createIsolatedProcessEnv({
      isolationRoot: openAnchor,
      homeDir: openAnchor,
    }), /0700|isolationRoot|物理/)
  }

  const defaultHome = path.join(root, 'default-home')
  const defaultOutside = path.join(root, 'default-outside')
  fs.mkdirSync(defaultHome, { recursive: true })
  fs.mkdirSync(defaultOutside, { recursive: true })
  createDirectoryLink(defaultOutside, path.join(defaultHome, '.ai-workbench-test'))
  assert.throws(() => createIsolatedProcessEnv({ isolationRoot: root, homeDir: defaultHome }), /物理|HOME|符号链接/)

  const explicitHome = path.join(root, 'explicit-home')
  const explicitOutside = path.join(root, 'explicit-outside')
  const explicitParent = path.join(explicitHome, 'config')
  fs.mkdirSync(explicitParent, { recursive: true })
  fs.mkdirSync(explicitOutside, { recursive: true })
  const explicitRoot = path.join(explicitParent, 'workbench')
  createDirectoryLink(explicitOutside, explicitRoot)
  assert.throws(() => createIsolatedProcessEnv({
    isolationRoot: root,
    homeDir: explicitHome,
    workbenchRoot: explicitRoot,
  }), /物理|HOME|符号链接/)

  const tokenHome = path.join(root, 'token-home')
  const tokenRoot = path.join(tokenHome, 'workbench')
  const tokenOutside = path.join(root, 'token-outside')
  fs.mkdirSync(tokenRoot, { recursive: true })
  fs.mkdirSync(tokenOutside, { recursive: true })
  createDirectoryLink(tokenOutside, path.join(tokenRoot, 'secrets'))
  assert.throws(() => createIsolatedProcessEnv({
    isolationRoot: root,
    homeDir: tokenHome,
    workbenchRoot: tokenRoot,
    localTokenFile: path.join(tokenRoot, 'secrets', 'dashboard-local-token'),
  }), /物理|HOME|符号链接/)

  const safeHome = path.join(root, 'safe-home')
  fs.mkdirSync(safeHome, { recursive: true })
  const safeRoot = path.join(safeHome, '未来 配置', 'workbench')
  const safeToken = path.join(safeRoot, 'secrets', 'dashboard-local-token')
  const externalSentinel = path.join(root, 'must-not-create-external')
  const externalToken = path.join(root, 'must-not-write-external-token')
  const env = createIsolatedProcessEnv({
    baseEnv: {
      ...process.env,
      AI_WORKBENCH_HOME: externalSentinel,
      AI_WORKBENCH_LOCAL_TOKEN_FILE: externalToken,
    },
    isolationRoot: root,
    homeDir: safeHome,
    workbenchRoot: safeRoot,
    localTokenFile: safeToken,
  })
  assert.equal(env.AI_WORKBENCH_HOME, safeRoot)
  assert.equal(env.AI_WORKBENCH_LOCAL_TOKEN_FILE, safeToken)
  assert.equal(fs.existsSync(safeRoot), false)
  assert.equal(fs.existsSync(safeToken), false)
  assert.equal(fs.existsSync(externalSentinel), false)
  assert.equal(fs.existsSync(externalToken), false)
})

test('隔离锚阻止 HOME 与稳定数据根外链、getter 换链和特殊 token 文件', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-anchor-boundary-'))
  temporaryRoots.push(root)

  const directAnchor = path.join(root, 'direct-anchor')
  const directOutside = path.join(root, 'direct-outside')
  const directHome = path.join(directAnchor, 'home')
  fs.mkdirSync(directAnchor, { mode: 0o700 })
  fs.mkdirSync(directOutside, { mode: 0o700 })
  createDirectoryLink(directOutside, directHome)
  await assertUnsafeEnvironmentRejected({
    createEnvironment: () => createIsolatedProcessEnv({ isolationRoot: directAnchor, homeDir: directHome }),
    externalTokenFile: path.join(directOutside, '.openclaw', 'dashboard-local-token'),
  })

  const parentAnchor = path.join(root, 'parent-anchor')
  const parentOutside = path.join(root, 'parent-outside')
  const linkedParent = path.join(parentAnchor, 'linked-parent')
  const missingHome = path.join(linkedParent, 'missing-home')
  fs.mkdirSync(parentAnchor, { mode: 0o700 })
  fs.mkdirSync(parentOutside, { mode: 0o700 })
  createDirectoryLink(parentOutside, linkedParent)
  await assertUnsafeEnvironmentRejected({
    createEnvironment: () => createIsolatedProcessEnv({ isolationRoot: parentAnchor, homeDir: missingHome }),
    externalTokenFile: path.join(parentOutside, 'missing-home', '.openclaw', 'dashboard-local-token'),
  })

  const dataAnchor = path.join(root, 'data-anchor')
  const dataHome = path.join(dataAnchor, 'home')
  const dataOutside = path.join(root, 'data-outside')
  const dataToken = 'a'.repeat(64)
  const readMarker = path.join(root, 'external-read.marker')
  fs.mkdirSync(dataHome, { recursive: true, mode: 0o700 })
  fs.mkdirSync(dataOutside, { mode: 0o700 })
  fs.writeFileSync(path.join(dataOutside, 'dashboard-local-token'), dataToken, { mode: 0o600 })
  createDirectoryLink(dataOutside, path.join(dataHome, '.openclaw'))
  let dataEnv
  let dataRejection
  try { dataEnv = createIsolatedProcessEnv({ isolationRoot: dataAnchor, homeDir: dataHome }) } catch (error) { dataRejection = error }
  if (dataEnv) await runDashboardTokenConsumer(dataEnv, { expectedToken: dataToken, markerFile: readMarker })
  assert.equal(fs.existsSync(readMarker), false, '真实 dashboard-token 消费读取了 .openclaw 外链 token')
  assert.ok(dataRejection, '.openclaw 外链必须在真实消费者启动前被拒绝')

  const getterAnchor = path.join(root, 'getter-anchor')
  const getterHome = path.join(getterAnchor, 'home')
  const getterOutside = path.join(root, 'getter-outside')
  fs.mkdirSync(getterHome, { recursive: true, mode: 0o700 })
  fs.mkdirSync(getterOutside, { mode: 0o700 })
  const hostileBaseEnv = { ...process.env }
  Object.defineProperty(hostileBaseEnv, 'SYNTHETIC_SWAP_HOME', {
    enumerable: true,
    get() {
      fs.rmSync(getterHome, { recursive: true, force: true })
      createDirectoryLink(getterOutside, getterHome)
      return 'swapped'
    },
  })
  await assertUnsafeEnvironmentRejected({
    createEnvironment: () => createIsolatedProcessEnv({
      baseEnv: hostileBaseEnv,
      isolationRoot: getterAnchor,
      homeDir: getterHome,
    }),
    externalTokenFile: path.join(getterOutside, '.openclaw', 'dashboard-local-token'),
  })

  const overrideAnchor = path.join(root, 'override-anchor')
  const overrideHome = path.join(overrideAnchor, 'home')
  const overrideOutside = path.join(root, 'override-outside')
  fs.mkdirSync(overrideHome, { recursive: true, mode: 0o700 })
  fs.mkdirSync(overrideOutside, { mode: 0o700 })
  const hostileOverrides = {}
  Object.defineProperty(hostileOverrides, 'SYNTHETIC_SWAP_HOME', {
    enumerable: true,
    get() {
      fs.rmSync(overrideHome, { recursive: true, force: true })
      createDirectoryLink(overrideOutside, overrideHome)
      return 'swapped'
    },
  })
  await assertUnsafeEnvironmentRejected({
    createEnvironment: () => createIsolatedProcessEnv({
      isolationRoot: overrideAnchor,
      homeDir: overrideHome,
      overrides: hostileOverrides,
    }),
    externalTokenFile: path.join(overrideOutside, '.openclaw', 'dashboard-local-token'),
  })

  for (const dataRootName of ['.codex', '.claude']) {
    const clientAnchor = path.join(root, `${dataRootName.slice(1)}-anchor`)
    const clientHome = path.join(clientAnchor, 'home')
    const clientOutside = path.join(root, `${dataRootName.slice(1)}-outside`)
    fs.mkdirSync(clientHome, { recursive: true, mode: 0o700 })
    fs.mkdirSync(clientOutside, { mode: 0o700 })
    createDirectoryLink(clientOutside, path.join(clientHome, dataRootName))
    assert.throws(() => createIsolatedProcessEnv({
      isolationRoot: clientAnchor,
      homeDir: clientHome,
    }), /稳定测试数据根|符号链接|物理/)
  }

  if (process.platform !== 'win32') {
    const fifoAnchor = path.join(root, 'fifo-anchor')
    const fifoHome = path.join(fifoAnchor, 'home')
    const fifoRoot = path.join(fifoHome, '.ai-workbench-test')
    const fifoParent = path.join(fifoRoot, 'secrets')
    const fifoToken = path.join(fifoParent, 'dashboard-local-token')
    fs.mkdirSync(fifoParent, { recursive: true, mode: 0o700 })
    const fifo = spawnSync('/usr/bin/mkfifo', [fifoToken], { shell: false })
    assert.equal(fifo.status, 0, fifo.stderr?.toString() || 'mkfifo failed')
    assert.throws(() => createIsolatedProcessEnv({
      isolationRoot: fifoAnchor,
      homeDir: fifoHome,
      workbenchRoot: fifoRoot,
      localTokenFile: fifoToken,
    }), /普通文件|token|物理|类型/)

    const hardLinkToken = path.join(fifoParent, 'hardlink-token')
    const hardLinkAlias = path.join(fifoParent, 'hardlink-alias')
    fs.writeFileSync(hardLinkToken, 'b'.repeat(64), { mode: 0o600 })
    fs.linkSync(hardLinkToken, hardLinkAlias)
    assert.throws(() => createIsolatedProcessEnv({
      isolationRoot: fifoAnchor,
      homeDir: fifoHome,
      workbenchRoot: fifoRoot,
      localTokenFile: hardLinkToken,
    }), /硬链接|token|物理/)
  } else {
    t.diagnostic('FIFO and hard-link checks are covered on POSIX')
  }
})

test('推荐入口在隔离 HOME 同时提供前后端、只监听回环且退出后无残留', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-start-isolated-'))
  temporaryRoots.push(root)
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const frontendPort = await freePort()
  const backendPort = await freePort()
  const sentinelContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-parent-sentinel-'))
  temporaryRoots.push(sentinelContainer)
  const sentinelRoot = path.join(sentinelContainer, 'must-not-create-workbench')
  const sentinelToken = path.join(sentinelContainer, 'must-not-write-token')
  const env = createIsolatedProcessEnv({
    baseEnv: {
      ...process.env,
      AI_WORKBENCH_HOME: sentinelRoot,
      AI_WORKBENCH_LOCAL_TOKEN_FILE: sentinelToken,
    },
    isolationRoot: root,
    homeDir: home,
    overrides: {
      PATH: process.env.PATH || '',
      TMPDIR: root,
      LANG: process.env.LANG || 'C.UTF-8',
      FRONTEND_HOST: '127.0.0.1',
      BACKEND_HOST: '127.0.0.1',
      FRONTEND_PORT: String(frontendPort),
      BACKEND_PORT: String(backendPort),
      OPENCLAW_VITE_CACHE_DIR: path.join(root, 'vite-cache'),
      OPENCLAW_DASHBOARD_DATA_ROOT: path.join(root, 'dashboard-data'),
      npm_config_cache: path.join(root, 'npm-cache'),
      npm_config_registry: 'https://registry.npmjs.org',
    },
  })
  const child = spawn('npm', ['run', 'start:v2'], {
    cwd: repo,
    env,
    shell: false,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', chunk => { logs = `${logs}${chunk}`.slice(-12000) })
  child.stderr.on('data', chunk => { logs = `${logs}${chunk}`.slice(-12000) })
  try {
    const homePage = await waitForHttp(frontendPort, '/')
    assert.match(homePage.body, /id="app"/)
    assert.equal((await waitForHttp(frontendPort, '/api/health')).status, 200)
    assert.equal((await waitForHttp(backendPort, '/api/health')).status, 200)
    const externalAddress = nonLoopbackIpv4()
    if (externalAddress) {
      await assert.rejects(request(externalAddress, frontendPort, '/', 500))
      await assert.rejects(request(externalAddress, backendPort, '/api/health', 500))
    }
  } catch (error) {
    throw new Error(`${error.message}\nstartup output:\n${logs}`)
  } finally {
    await stopProcessGroup(child)
  }
  await waitForClosed(frontendPort)
  await waitForClosed(backendPort)
  assert.equal(fs.existsSync(sentinelRoot), false)
  assert.equal(fs.existsSync(sentinelToken), false)
})

test('已封存的 HTTPS 包装器返回非零且不结束未知进程', async () => {
  const backend = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  const occupied = http.createServer((_req, res) => {
    res.writeHead(200)
    res.end('unknown-https-listener')
  })
  await new Promise((resolve, reject) => {
    backend.once('error', reject)
    backend.listen(0, '127.0.0.1', resolve)
  })
  await new Promise((resolve, reject) => {
    occupied.once('error', reject)
    occupied.listen(0, '127.0.0.1', resolve)
  })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-https-conflict-'))
  temporaryRoots.push(root)
  const child = spawn(process.execPath, ['scripts/start-https-frontend.js'], {
    cwd: repo,
    env: createIsolatedProcessEnv({
      isolationRoot: root,
      homeDir: root,
      overrides: {
        FRONTEND_PORT: String(occupied.address().port),
        BACKEND_PORT: String(backend.address().port),
        OPENCLAW_VITE_CACHE_DIR: path.join(root, 'vite-cache'),
      },
    }),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const code = await waitForExit(child)
  assert.notEqual(code, 0)
  assert.equal((await request('127.0.0.1', occupied.address().port, '/')).body, 'unknown-https-listener')
  await new Promise(resolve => occupied.close(resolve))
  await new Promise(resolve => backend.close(resolve))
})

test('已封存的 HTTPS 包装器不认领任何已有后端', async () => {
  const unknownBackend = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ service: 'not-dashboard' }))
  })
  await new Promise((resolve, reject) => {
    unknownBackend.once('error', reject)
    unknownBackend.listen(0, '127.0.0.1', resolve)
  })
  const frontendPort = await freePort()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-https-existing-backend-'))
  temporaryRoots.push(root)
  const child = spawn(process.execPath, ['scripts/start-https-frontend.js'], {
    cwd: repo,
    env: createIsolatedProcessEnv({
      isolationRoot: root,
      homeDir: root,
      overrides: {
        FRONTEND_PORT: String(frontendPort),
        BACKEND_PORT: String(unknownBackend.address().port),
      },
    }),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.notEqual(await waitForExit(child), 0)
  await assert.rejects(request('127.0.0.1', frontendPort, '/', 300))
  await new Promise(resolve => unknownBackend.close(resolve))
})

test('桌面启动器不凭普通健康响应认领端口且不会打开页面', async () => {
  const backend = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  const unknownFrontend = http.createServer((_req, res) => {
    res.writeHead(200)
    res.end('unknown-service')
  })
  await new Promise((resolve, reject) => {
    backend.once('error', reject)
    backend.listen(0, '127.0.0.1', resolve)
  })
  await new Promise((resolve, reject) => {
    unknownFrontend.once('error', reject)
    unknownFrontend.listen(0, '127.0.0.1', resolve)
  })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-desktop-launcher-'))
  temporaryRoots.push(root)
  const bin = path.join(root, 'bin')
  const openMarker = path.join(root, 'open-called')
  fs.mkdirSync(bin)
  for (const [name, body] of [
    ['osascript', '#!/bin/sh\nexit 0\n'],
    ['open', `#!/bin/sh\nprintf called > '${openMarker}'\n`],
  ]) {
    const file = path.join(bin, name)
    fs.writeFileSync(file, body, { mode: 0o755 })
  }
  const child = spawn('/bin/bash', ['scripts/launch-dashboard.sh'], {
    cwd: repo,
    env: createIsolatedProcessEnv({
      isolationRoot: root,
      homeDir: root,
      overrides: {
        PATH: `${bin}:${process.env.PATH || ''}`,
        FRONTEND_PORT: String(unknownFrontend.address().port),
        BACKEND_PORT: String(backend.address().port),
      },
    }),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.notEqual(await waitForExit(child), 0)
  assert.equal(fs.existsSync(openMarker), false)
  assert.equal((await request('127.0.0.1', unknownFrontend.address().port, '/')).body, 'unknown-service')
  await new Promise(resolve => unknownFrontend.close(resolve))
  await new Promise(resolve => backend.close(resolve))
})

test('端口冲突时清楚退出且不会结束占用端口的未知进程', async () => {
  const occupied = http.createServer((_req, res) => { res.writeHead(200); res.end('still-alive') })
  await new Promise((resolve, reject) => {
    occupied.once('error', reject)
    occupied.listen(0, '127.0.0.1', resolve)
  })
  const frontendPort = occupied.address().port
  const backendPort = await freePort()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-port-conflict-'))
  temporaryRoots.push(root)
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/start-versioned.js', '--profile=v2'], {
      cwd: repo,
      env: createIsolatedProcessEnv({
        baseEnv: { PATH: process.env.PATH || '' },
        isolationRoot: root,
        homeDir: root,
        overrides: {
          FRONTEND_PORT: String(frontendPort),
          BACKEND_PORT: String(backendPort),
        },
      }),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.once('exit', code => resolve({ code, output }))
  })
  assert.notEqual(result.code, 0)
  assert.match(result.output, /端口已被占用|不可用/)
  assert.equal((await request('127.0.0.1', frontendPort, '/')).body, 'still-alive')
  await new Promise(resolve => occupied.close(resolve))
})

test('公开启动说明与包装器统一使用安全入口，锁文件只使用 npm 官方源', () => {
  const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8')
  const unixStart = fs.readFileSync(path.join(repo, 'start.sh'), 'utf8')
  const windowsStart = fs.readFileSync(path.join(repo, 'start.bat'), 'utf8')
  const macosLifecycle = fs.readFileSync(path.join(repo, 'scripts', 'macos', 'common.sh'), 'utf8')
  const sharePanel = fs.readFileSync(path.join(repo, 'src', 'components', 'ChangelogPanel.vue'), 'utf8')
  assert.match(readme, /npm run start:v2/)
  assert.equal(readme.includes('npm run dev'), false)
  assert.match(unixStart, /start_dashboard/)
  assert.match(macosLifecycle, /<string>start:v2<\/string>/)
  assert.match(windowsStart, /npm run start:v2/)
  assert.equal(sharePanel.includes('<你的用户名>'), false)
  assert.match(sharePanel, /尚未配置公开仓库地址/)
  assert.equal(sharePanel.includes('npm run dev'), false)
  for (const source of [unixStart, windowsStart]) {
    assert.equal(/kill\s+-9|taskkill|Stop-Process/i.test(source), false)
  }
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8'))
  const hosts = new Set()
  for (const entry of Object.values(lock.packages || {})) {
    if (!entry?.resolved) continue
    hosts.add(new URL(entry.resolved).hostname)
  }
  assert.deepEqual([...hosts], ['registry.npmjs.org'])
})
