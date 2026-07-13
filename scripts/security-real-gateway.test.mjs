import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import WebSocket from 'ws'
import { gatewayWebSocketUrl, readGatewayCredentials } from './security/gateway-credentials.mjs'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'
import { resolveTestBrowserExecutable } from './test-browser-executable.mjs'

const repo = path.resolve(import.meta.dirname, '..')

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

function request(port, requestPath, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.once('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function waitForHttp(port, requestPath) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    try {
      const status = await request(port, requestPath)
      if (status && status < 500) return
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('temporary service did not start')
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 3000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

async function directHello(credentials) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(gatewayWebSocketUrl(credentials.gatewayUrl), {
      headers: { Authorization: `Bearer ${credentials.token}` },
      handshakeTimeout: 8000,
    })
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('real Gateway handshake timeout')) }, 12000)
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString())
      if (message.type === 'event' && message.event === 'connect.challenge') {
        socket.send(JSON.stringify({
          type: 'req',
          id: 'real-readonly-handshake',
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 4,
            client: { id: 'gateway-client', version: '1.0.0', platform: 'node', mode: 'backend' },
            role: 'operator',
            scopes: ['operator.read'],
            auth: { token: credentials.token },
          },
        }))
      } else if (message.type === 'res' && message.id === 'real-readonly-handshake') {
        clearTimeout(timer)
        socket.close()
        if (message.ok && message.payload?.type === 'hello-ok') resolve()
        else reject(new Error('real Gateway rejected protocol 3..4'))
      }
    })
    socket.once('error', reject)
  })
}

test('真实 Gateway hello-ok、原生控制台、会话深链和浏览器无密钥', { timeout: 60000 }, async () => {
  const credentials = readGatewayCredentials()
  assert.ok(credentials.token, 'real Gateway credential is not configured')
  await directHello(credentials)

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-real-gateway-smoke-'))
  const home = path.join(tmpRoot, 'home')
  const openclawDir = path.join(home, '.openclaw')
  const dashboardLocalToken = 'd'.repeat(64)
  fs.mkdirSync(openclawDir, { recursive: true })
  fs.writeFileSync(path.join(openclawDir, 'dashboard-local-token'), dashboardLocalToken, { mode: 0o600 })
  const backendPort = await freePort()
  const frontendPort = await freePort()
  const backendEnv = createIsolatedProcessEnv({
    isolationRoot: tmpRoot,
    homeDir: home,
    overrides: {
      BACKEND_HOST: '127.0.0.1',
      BACKEND_PORT: String(backendPort),
      FRONTEND_PORT: String(frontendPort),
      OPENCLAW_GATEWAY_URL: credentials.gatewayUrl,
      OPENCLAW_GATEWAY_TOKEN: credentials.token,
    },
  })
  const backend = spawn(process.execPath, ['scripts/unified-service.js'], {
    cwd: repo,
    env: backendEnv,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let frontend
  let browser
  try {
    await waitForHttp(backendPort, '/api/health')
    const viteBin = path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js')
    const frontendEnv = createIsolatedProcessEnv({
      isolationRoot: tmpRoot,
      homeDir: home,
      overrides: {
        BACKEND_PORT: String(backendPort),
        FRONTEND_PORT: String(frontendPort),
        OPENCLAW_VITE_CACHE_DIR: path.join(tmpRoot, 'vite-cache'),
      },
    })
    delete frontendEnv.OPENCLAW_GATEWAY_TOKEN
    delete frontendEnv.VITE_GATEWAY_TOKEN
    frontend = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
      cwd: repo,
      env: frontendEnv,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitForHttp(frontendPort, '/')

    const executablePath = resolveTestBrowserExecutable()
    assert.ok(executablePath, 'A controlled Chrome/Chromium executable is required')
    browser = await chromium.launch({ headless: true, executablePath })
    const context = await browser.newContext()
    const resourceFailures = []
    const requestUrls = []
    const requestMetadata = []
    const dashboardFrames = []
    const browserFrames = []
    const frameSummaries = []
    const websocketUrls = []
    const cdpTraffic = []
    const completeHeaderReads = []
    const pageErrors = []
    const recordRequest = req => {
      requestUrls.push(req.url())
      completeHeaderReads.push(req.allHeaders().then(headers => {
        requestMetadata.push(JSON.stringify({ headers, postData: req.postData() || '' }))
      }).catch(error => {
        requestMetadata.push(JSON.stringify({ headerReadClosed: String(error?.message || error).includes('has been closed') }))
      }))
    }
    const attachCdpTrafficCapture = async (targetPage) => {
      const cdp = await context.newCDPSession(targetPage)
      await cdp.send('Network.enable')
      cdp.on('Network.requestWillBeSent', event => cdpTraffic.push(JSON.stringify({
        type: 'request',
        url: event.request?.url,
        method: event.request?.method,
        headers: event.request?.headers,
        postData: event.request?.postData || '',
      })))
      cdp.on('Network.requestWillBeSentExtraInfo', event => cdpTraffic.push(JSON.stringify({
        type: 'request-extra',
        headers: event.headers,
      })))
      cdp.on('Network.responseReceivedExtraInfo', event => cdpTraffic.push(JSON.stringify({
        type: 'response-extra',
        headers: event.headers,
      })))
      cdp.on('Network.webSocketCreated', event => cdpTraffic.push(JSON.stringify({ type: 'websocket', url: event.url })))
      cdp.on('Network.webSocketFrameSent', event => cdpTraffic.push(JSON.stringify({
        type: 'websocket-sent',
        payload: event.response?.payloadData || '',
      })))
      cdp.on('Network.webSocketFrameReceived', event => cdpTraffic.push(JSON.stringify({
        type: 'websocket-received',
        payload: event.response?.payloadData || '',
      })))
    }

    const dashboardPage = await context.newPage()
    await attachCdpTrafficCapture(dashboardPage)
    dashboardPage.on('request', recordRequest)
    dashboardPage.on('pageerror', error => pageErrors.push(String(error?.message || error).slice(0, 200)))
    dashboardPage.on('websocket', socket => {
      socket.on('framesent', event => dashboardFrames.push(String(event.payload)))
      socket.on('framereceived', event => dashboardFrames.push(String(event.payload)))
    })
    await dashboardPage.goto(`http://127.0.0.1:${frontendPort}/`, { waitUntil: 'domcontentloaded' })
    assert.match(await dashboardPage.title(), /AI 工作台总控/)
    const readOnlyStatus = await dashboardPage.evaluate(async () => {
      const response = await fetch('/gateway-api/tools/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'sessions_list', action: 'json', args: { limit: 1 } }),
      })
      return response.status
    })
    assert.equal(readOnlyStatus, 200, 'read-only Gateway tools/invoke did not pass through the secure relay')
    const dashboardHtml = await dashboardPage.content()
    const dashboardStorage = await dashboardPage.evaluate(() => JSON.stringify({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }))

    const page = await context.newPage()
    await attachCdpTrafficCapture(page)
    let resolveHello
    const hello = new Promise(resolve => { resolveHello = resolve })
    page.on('request', recordRequest)
    page.on('pageerror', error => pageErrors.push(String(error?.message || error).slice(0, 200)))
    page.on('response', response => {
      if (response.url().includes('/gateway-api/') && response.status() === 404) resourceFailures.push(response.url())
    })
    page.on('websocket', socket => {
      websocketUrls.push(socket.url())
      if (!socket.url().includes('/gateway-ws')) return
      socket.on('framesent', event => {
        const payload = String(event.payload)
        browserFrames.push(payload)
        try {
          const message = JSON.parse(payload)
          frameSummaries.push(JSON.stringify({
            direction: 'sent',
            type: message?.type,
            method: message?.method,
            id: message?.id,
            minProtocol: message?.params?.minProtocol,
            maxProtocol: message?.params?.maxProtocol,
            clientId: message?.params?.client?.id,
            clientMode: message?.params?.client?.mode,
          }))
        } catch { /* binary or non-JSON frame */ }
      })
      socket.on('framereceived', event => {
        const payload = String(event.payload)
        browserFrames.push(payload)
        try {
          const message = JSON.parse(payload)
          frameSummaries.push(JSON.stringify({
            direction: 'received',
            type: message?.type,
            event: message?.event,
            id: message?.id,
            ok: message?.ok,
            payloadType: message?.payload?.type,
            error: String(message?.error?.message || message?.error || '').slice(0, 120),
          }))
          if (message?.ok === true && message?.payload?.type === 'hello-ok') resolveHello()
        } catch { /* binary or non-JSON frame */ }
      })
    })

    const deepLink = `http://127.0.0.1:${frontendPort}/gateway-api/chat?session=main`
    await page.goto(deepLink, { waitUntil: 'domcontentloaded' })
    await Promise.race([
      hello,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        `native control UI did not receive hello-ok; websocket paths=${websocketUrls.map(value => new URL(value).pathname).join(',') || 'none'}; frames=${frameSummaries.join('|') || 'none'}; pageErrors=${pageErrors.join('|') || 'none'}`,
      )), 20000)),
    ])
    assert.equal(await page.title(), 'OpenClaw Control')
    assert.equal(new URL(page.url()).pathname, '/gateway-api/chat')
    assert.equal(new URL(page.url()).searchParams.get('session'), 'main')
    assert.deepEqual(resourceFailures, [])
    const storage = await page.evaluate(() => JSON.stringify({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }))
    const html = await page.content()
    dashboardPage.off('request', recordRequest)
    page.off('request', recordRequest)
    await Promise.all(completeHeaderReads)
    const browserVisibleValues = [
      page.url(), storage, dashboardStorage, dashboardHtml, html,
      ...requestUrls, ...requestMetadata, ...cdpTraffic, ...websocketUrls,
      ...dashboardFrames, ...browserFrames,
    ]
    for (const forbiddenSecret of [credentials.token, dashboardLocalToken]) {
      for (const value of browserVisibleValues) {
        assert.equal(String(value).includes(forbiddenSecret), false, 'browser-visible data exposed a protected credential')
      }
    }
    assert.ok(requestUrls.some(url => url.includes('/gateway-api/assets/')), 'native control assets were not loaded')
    assert.ok(browserFrames.some(frame => frame.includes('hello-ok')), 'native control UI did not receive hello-ok')
    await dashboardPage.close()
    await context.close()
  } finally {
    await browser?.close().catch(() => {})
    await stop(frontend)
    await stop(backend)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})
