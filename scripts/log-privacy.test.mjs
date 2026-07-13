import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import {
  formatPrivacyLog,
  installBrowserErrorPrivacy,
  installPrivacyConsole,
  installProcessErrorPrivacy,
} from '../src/utils/log-privacy.mjs'
import { redactDiagnosticResult } from './security/diagnostics.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const synthetic = {
  secret: 'synthetic-gateway-secret-4b3',
  home: '/Users/sample-user/private-workspace',
  message: 'synthetic private message body',
  thinking: 'synthetic private reasoning summary',
  tool: 'synthetic private tool result',
  session: 'synthetic-session-4b3-identifier',
}
const forbiddenValues = Object.values(synthetic)

function assertPrivateValuesAbsent(value) {
  const text = String(value)
  for (const privateValue of forbiddenValues) assert.equal(text.includes(privateValue), false, privateValue)
}

function recordingConsole() {
  const output = []
  const target = Object.create(null)
  for (const method of [
    'log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'dirxml', 'table',
    'group', 'groupCollapsed', 'time', 'timeLog', 'timeEnd', 'count', 'countReset', 'assert',
  ]) target[method] = (...args) => output.push(`${method}:${args.join(' ')}`)
  return { target, output }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

async function waitForHttp(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) return
    } catch { /* startup in progress */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('isolated Vite runner did not start')
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('isolated Vite runner did not exit')), timeoutMs)
    child.once('exit', code => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

test('日志格式只保留事件类别、结果、状态码和数量', () => {
  const output = formatPrivacyLog({
    scope: 'backend',
    level: 'error',
    args: [
      `Gateway health timeout ${synthetic.secret} ${synthetic.home}`,
      { status: 503, count: 4, ok: false, body: synthetic.message, sessionId: synthetic.session },
    ],
  })
  assertPrivateValuesAbsent(output)
  assert.match(output, /scope=backend/)
  assert.match(output, /level=error/)
  assert.match(output, /event=health/)
  assert.match(output, /outcome=failure/)
  assert.match(output, /status=503/)
  assert.match(output, /count=4/)
  assert.match(output, /error=timeout/)
})

test('浏览器、后端与启动器 console 不输出正文、路径、标识或完整错误', () => {
  for (const scope of ['browser', 'backend', 'launcher']) {
    const { target, output } = recordingConsole()
    const restore = installPrivacyConsole(target, { scope })
    target.log('session update', { sessionId: synthetic.session, message: synthetic.message, count: 3 })
    target.warn('tool warning', { result: synthetic.tool })
    target.error(new Error(`timeout ${synthetic.secret} ${synthetic.home} ${synthetic.thinking}`))
    target.trace(synthetic.message)
    target.assert(false, synthetic.tool)
    restore()
    assertPrivateValuesAbsent(output.join('\n'))
    assert.ok(output.length >= 5)
    assert.ok(output.every(line => line.includes(`[privacy] scope=${scope}`)))
  }
})

test('恶意Proxy、抛错getter、循环对象和保留键不能使格式化器抛错或泄漏', () => {
  const trapSecret = 'SYNTHETIC_PROXY_SECRET_4B3'
  let prototypeTrapCalls = 0
  let getterCalls = 0
  const hostileProxy = new Proxy(Object.create(null), {
    getPrototypeOf() {
      prototypeTrapCalls += 1
      throw new Error(trapSecret)
    },
    getOwnPropertyDescriptor() {
      throw new Error(trapSecret)
    },
  })
  const throwingGetter = Object.create(null)
  Object.defineProperty(throwingGetter, 'message', {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error(trapSecret)
    },
  })
  const cyclic = Object.create(null)
  cyclic.self = cyclic
  const reserved = Object.create(null)
  const reservedDescriptors = Object.create(null)
  reservedDescriptors.__proto__ = { enumerable: true, value: hostileProxy }
  reservedDescriptors.constructor = { enumerable: true, value: throwingGetter }
  reservedDescriptors.prototype = { enumerable: true, value: cyclic }
  Object.defineProperties(reserved, reservedDescriptors)

  const values = [hostileProxy, throwingGetter, cyclic, reserved]
  for (const value of values) {
    let output = ''
    assert.doesNotThrow(() => {
      output = formatPrivacyLog({ scope: 'backend', level: 'error', args: [value] })
    })
    assert.equal(output.includes(trapSecret), false)
  }
  assert.equal(prototypeTrapCalls, 0)
  assert.equal(getterCalls, 0)

  const hostileOptions = new Proxy(Object.create(null), {
    getOwnPropertyDescriptor() { throw new Error(trapSecret) },
  })
  assert.doesNotThrow(() => formatPrivacyLog(hostileOptions))
  assert.equal(formatPrivacyLog(hostileOptions).includes(trapSecret), false)

  const { target, output } = recordingConsole()
  installPrivacyConsole(target, { scope: 'browser' })
  for (const value of values) assert.doesNotThrow(() => target.log(value))
  assert.equal(output.join('\n').includes(trapSecret), false)
  assert.equal(getterCalls, 0)
})

test('浏览器未处理异常和拒绝被转成安全错误类别', () => {
  class FakeWindow {
    handlers = new Map()
    addEventListener(type, handler) { this.handlers.set(type, handler) }
    removeEventListener(type) { this.handlers.delete(type) }
    dispatch(type, event) { this.handlers.get(type)?.(event) }
  }
  const fakeWindow = new FakeWindow()
  const { target, output } = recordingConsole()
  installPrivacyConsole(target, { scope: 'browser' })
  const remove = installBrowserErrorPrivacy(fakeWindow, target, { scope: 'browser' })
  let prevented = 0
  let reasonReads = 0
  fakeWindow.dispatch('error', {
    preventDefault() { prevented += 1 },
  })
  const rejectionEvent = {
    preventDefault() { prevented += 1 },
  }
  Object.defineProperty(rejectionEvent, 'reason', {
    get() {
      reasonReads += 1
      throw new Error(`SYNTHETIC_PROXY_SECRET_4B3 ${synthetic.secret}`)
    },
  })
  fakeWindow.dispatch('unhandledrejection', rejectionEvent)
  remove()
  assert.equal(prevented, 2)
  assert.equal(reasonReads, 0)
  assertPrivateValuesAbsent(output.join('\n'))
  assert.match(output.join('\n'), /event=runtime_error/)
  assert.match(output.join('\n'), /event=unhandled_rejection/)
})

test('进程级未处理失败不把异常正文写入stderr', async () => {
  const fakeProcess = new EventEmitter()
  fakeProcess.exitCode = 0
  fakeProcess.exit = code => { fakeProcess.exitCode = code }
  const { target, output } = recordingConsole()
  installPrivacyConsole(target, { scope: 'launcher' })
  const remove = installProcessErrorPrivacy(fakeProcess, target, { scope: 'launcher' })
  fakeProcess.emit('uncaughtException', new Error(`${synthetic.secret} ${synthetic.home} ${synthetic.message}`))
  await new Promise(resolve => setTimeout(resolve, 5))
  remove()
  assert.equal(fakeProcess.exitCode, 1)
  assertPrivateValuesAbsent(output.join('\n'))
  assert.match(output.join('\n'), /event=uncaught_exception/)
})

test('真实启动器拒绝非法配置时不回显参数、环境路径或密钥', () => {
  const profile = `${synthetic.secret}-${synthetic.session}`
  const result = spawnSync(process.execPath, ['scripts/start-versioned.js', `--profile=${profile}`], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: synthetic.home,
      USERPROFILE: synthetic.home,
    },
    encoding: 'utf8',
    shell: false,
  })
  assert.notEqual(result.status, 0)
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  assertPrivateValuesAbsent(output)
  assert.match(output, /scope=launcher/)
  assert.match(output, /event=startup|event=general/)
})

test('dev、build与preview在Vite配置早期失败时只输出安全类别并保留非零退出', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-vite-runner-'))
  const home = path.join(root, 'synthetic-home-marker')
  fs.mkdirSync(home, { mode: 0o700 })
  fs.writeFileSync(path.join(home, '.openclaw'), 'not-a-directory\n', { mode: 0o600 })
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
    for (const scriptName of ['dev', 'build', 'preview']) {
      assert.match(pkg.scripts[scriptName], /scripts\/safe-vite-runner\.mjs/)
      const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const result = spawnSync(npmCommand, ['run', scriptName], {
        cwd: repo,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          OPENCLAW_SKIP_DOTENV: '1',
          AI_WORKBENCH_HOME: path.join(home, 'workbench'),
          AI_WORKBENCH_LOCAL_TOKEN_FILE: path.join(home, 'workbench', 'local-token'),
          npm_config_cache: path.join(root, 'npm-cache'),
          npm_config_update_notifier: 'false',
        },
        encoding: 'utf8',
        shell: false,
        timeout: 60000,
      })
      assert.notEqual(result.status, 0, scriptName)
      const output = `${result.stdout || ''}\n${result.stderr || ''}`
      for (const forbidden of [root, home, repo, '.openclaw', 'ENOTDIR', 'dashboard-local-token']) {
        assert.equal(output.includes(forbidden), false, `${scriptName}: ${forbidden}`)
      }
      assert.match(output, /scope=vite_runner/)
      assert.equal(/\n\s+at\s/.test(output), false)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('安全Vite开发入口可长期运行并在SIGTERM后无残留退出', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-vite-dev-'))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { mode: 0o700 })
  const port = await freePort()
  const backendPort = await freePort()
  const child = spawn(process.execPath, [
    'scripts/safe-vite-runner.mjs', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      FRONTEND_PORT: String(port),
      BACKEND_PORT: String(backendPort),
      OPENCLAW_SKIP_DOTENV: '1',
      OPENCLAW_VITE_CACHE_DIR: path.join(root, 'vite-cache'),
      AI_WORKBENCH_HOME: path.join(home, 'workbench'),
      AI_WORKBENCH_LOCAL_TOKEN_FILE: path.join(home, 'workbench', 'local-token'),
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  try {
    await waitForHttp(port)
    child.kill('SIGTERM')
    assert.equal(await waitForExit(child), 0)
    assert.equal(output.includes(root), false)
    assert.equal(output.includes(repo), false)
    assert.match(output, /scope=vite_runner/)
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`))
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('诊断JSON、普通文本和错误同时脱密、脱私且保留状态与数量', () => {
  const result = redactDiagnosticResult({
    stdout: JSON.stringify({
      status: 'failed',
      count: 2,
      credentials: { apiKey: synthetic.secret },
      nested: {
        sessionId: synthetic.session,
        message: synthetic.message,
        thinking: synthetic.thinking,
        toolResult: synthetic.tool,
        file: `${synthetic.home}/result.json`,
      },
    }),
    stderr: `message=${synthetic.message}\ntool_result=${synthetic.tool}\nsession-id=${synthetic.session}\npath=${synthetic.home}/trace.log`,
    error: `authorization=Bearer ${synthetic.secret}\nreasoning=${synthetic.thinking}`,
  }, {
    secrets: [synthetic.secret],
    privateValues: [synthetic.session, synthetic.message, synthetic.thinking, synthetic.tool],
    homeDirs: [synthetic.home],
  })
  const output = JSON.stringify(result)
  assertPrivateValuesAbsent(output)
  assert.match(result.stdout, /"status": "failed"/)
  assert.match(result.stdout, /"count": 2/)
  assert.match(output, /\[REDACTED\]/)
  assert.match(output, /\[PRIVATE\]/)
  assert.match(output, /\[PRIVATE_PATH\]/)
})

test('运行时接线覆盖浏览器、后端、启动器与Vite，危险直出已移除', () => {
  const main = fs.readFileSync(path.join(repo, 'src/main.ts'), 'utf8')
  const backend = fs.readFileSync(path.join(repo, 'scripts/unified-service.js'), 'utf8')
  const launcher = fs.readFileSync(path.join(repo, 'scripts/start-versioned.js'), 'utf8')
  const vite = fs.readFileSync(path.join(repo, 'vite.config.ts'), 'utf8')
  const websocket = fs.readFileSync(path.join(repo, 'src/api/websocket.ts'), 'utf8')
  const agentStore = fs.readFileSync(path.join(repo, 'src/stores/agent.ts'), 'utf8')

  const browserBootstrap = fs.readFileSync(path.join(repo, 'src/log-privacy-bootstrap.ts'), 'utf8')
  assert.equal(main.trimStart().startsWith("import './log-privacy-bootstrap'"), true)
  assert.match(browserBootstrap, /installPrivacyConsole\(console, \{ scope: 'browser' \}\)/)
  assert.match(browserBootstrap, /installBrowserErrorPrivacy\(window, console/)
  assert.match(backend, /IS_DIRECT_EXECUTION[\s\S]+installPrivacyConsole\(console, \{ scope: 'backend' \}\)/)
  assert.match(launcher, /installPrivacyConsole\(console, \{ scope: 'launcher' \}\)/)
  assert.match(launcher, /stdio: \['ignore', 'pipe', 'pipe'\]/)
  assert.equal(launcher.includes("stdio: 'inherit'"), false)
  assert.match(vite, /customLogger: viteLogger/)
  const viteRunner = fs.readFileSync(path.join(repo, 'scripts/safe-vite-runner.mjs'), 'utf8')
  assert.match(viteRunner, /stdio: \['ignore', 'pipe', 'pipe'\]/)
  assert.equal(/console\.(?:log|warn|error)\([^\n]*certDir/.test(vite), false)
  assert.equal(websocket.includes('JSON.stringify(data, null, 2)'), false)
  assert.equal(websocket.includes('Request failed: ${JSON.stringify(data)}'), false)
  assert.equal(/console\.[a-z]+\([^\n]*(?:features\.methods|\bauth\b)/.test(websocket), false)
  assert.equal(/console\.[a-z]+\([^\n]*(?:msg\.content|part\.content|sessionKey|result\.filePath|lastMessageCount\.value\s*[,}])/i.test(agentStore), false)
  assert.equal(fs.existsSync(path.join(repo, 'src/utils/api-examples.ts')), false)
})
