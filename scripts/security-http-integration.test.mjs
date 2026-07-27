import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { directoryFingerprint } from './security/diagnostics.mjs'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'
import { GIF_1X1, JPEG_1X1, PNG_1X1, WEBP_1X1 } from './fixtures/raster-images.mjs'

const repo = path.resolve(import.meta.dirname, '..')
let tmpRoot
let backend
let frontend
let mockGateway
let mockGatewayWss
let backendPort
let frontendPort
let gatewayPort
let token
let gatewaySecret
let structuredSecret
let nestedSecrets
let home
let openclawDir
let workspace
let outside
let sibling
let configFile
let memoryFile
let externalProjectsRoot
let projectAttackMarker
const gatewayConnects = []
const gatewayHttpAuth = []
const gatewayHttpBodies = []

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
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }))
    })
    req.once('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function sameOriginJson(body) {
  return {
    method: 'POST',
    headers: {
      origin: `http://127.0.0.1:${frontendPort}`,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }
}

async function waitForHttp(port, requestPath, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const result = await request(port, requestPath)
      if (result.status && result.status < 500) return result
    } catch { /* process is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`temporary service did not start on ${port}`)
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 3000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

function closeServer(server) {
  if (!server) return Promise.resolve()
  return new Promise(resolve => server.close(() => resolve()))
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-security-http-fix1-'))
  backendPort = await freePort()
  frontendPort = await freePort()
  gatewayPort = await freePort()
  home = path.join(tmpRoot, 'home')
  openclawDir = path.join(home, '.openclaw')
  workspace = path.join(tmpRoot, 'workspace with spaces', '测试项目')
  outside = path.join(tmpRoot, 'outside')
  sibling = `${workspace}-copy`
  fs.mkdirSync(openclawDir, { recursive: true })
  fs.mkdirSync(workspace, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.mkdirSync(sibling, { recursive: true })

  token = 'b'.repeat(64)
  gatewaySecret = 'synthetic-gateway-secret-fix1'
  structuredSecret = 'synthetic-structured-api-key'
  nestedSecrets = [
    'synthetic-nested-access-token',
    'synthetic-nested-refresh-token',
    'synthetic-nested-client-secret',
    'synthetic-nested-cookie-value',
    'synthetic-nested-signing-key',
  ]
  fs.writeFileSync(path.join(openclawDir, 'dashboard-local-token'), token, { mode: 0o600 })
  memoryFile = path.join(workspace, 'MEMORY.md')
  fs.writeFileSync(memoryFile, '## 临时测试\n- 不应被诊断修改\n')
  fs.writeFileSync(path.join(workspace, 'SOUL.md'), '# 临时 SOUL\n')
  fs.mkdirSync(path.join(workspace, 'avatars'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'avatars', 'custom.png'), PNG_1X1)
  configFile = path.join(openclawDir, 'openclaw.json')
  fs.writeFileSync(configFile, JSON.stringify({
    gateway: { auth: { token: gatewaySecret } },
    providers: { synthetic: { apiKey: structuredSecret } },
    credentials: {
      primary: {
        accessToken: nestedSecrets[0],
        refresh_token: nestedSecrets[1],
        auth: { clientSecret: nestedSecrets[2], sessionCookie: nestedSecrets[3] },
      },
      signing: { signing_key: nestedSecrets[4], enabled: true, retries: 3 },
    },
    agents: {
      defaults: { workspace },
      list: [
        { id: 'test-agent', workspace, identity: { name: '任意助手', avatar: 'avatars/custom.png' } },
        { id: 'empty-agent', workspace, identity: { name: '' } },
      ],
    },
    skills: { entries: { 'safe-skill': { enabled: true } } },
  }, null, 2), { mode: 0o600 })

  const skillDir = path.join(openclawDir, 'skills', 'safe-skill')
  const refsDir = path.join(skillDir, 'references')
  fs.mkdirSync(refsDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Safe skill\n')
  const outsideSecret = path.join(outside, 'reference-secret.md')
  fs.writeFileSync(outsideSecret, `secret=${gatewaySecret}\n`)
  fs.symlinkSync(outsideSecret, path.join(refsDir, 'escape.md'))
  const testSessionsDir = path.join(openclawDir, 'agents', 'test-agent', 'sessions')
  fs.mkdirSync(testSessionsDir, { recursive: true })
  const sessionFixtureBaseMs = Date.now()
  const prototypeSession = path.join(testSessionsDir, 'prototype-keys.jsonl')
  fs.writeFileSync(prototypeSession, [
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: '__proto__' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'constructor' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'prototype' }] } },
  ].map(value => JSON.stringify(value)).join('\n'))
  // Linux runners may assign identical mtimes to files created in the same tick.
  // Keep this non-redaction fixture deterministically older than redaction-sample.jsonl.
  fs.utimesSync(prototypeSession, new Date(sessionFixtureBaseMs - 2000), new Date(sessionFixtureBaseMs - 2000))
  const nowIso = new Date().toISOString()
  const redactionSession = path.join(testSessionsDir, 'redaction-sample.jsonl')
  fs.writeFileSync(redactionSession, [
    { type: 'message', timestamp: nowIso, message: { role: 'user', content: [{ type: 'text', text: `redaction-marker user ${gatewaySecret} ${nestedSecrets[0]}` }] } },
    { type: 'message', timestamp: nowIso, message: { role: 'assistant', content: [
      { type: 'thinking', thinking: `redaction-marker thinking ${structuredSecret}` },
      { type: 'toolCall', name: 'fixture-tool', id: 'fixture-call', arguments: { credential: token, note: '正常工具参数' } },
      { type: 'text', text: '正常助手内容 token 统计不应被删除' },
    ] } },
    { type: 'message', timestamp: nowIso, message: { role: 'toolResult', toolName: 'fixture-tool', toolCallId: 'fixture-call', content: [{ type: 'text', text: `redaction-marker result ${gatewaySecret} ${token} ${nestedSecrets.slice(1).join(' ')}` }] } },
  ].map(value => JSON.stringify(value)).join('\n'))
  fs.utimesSync(redactionSession, new Date(sessionFixtureBaseMs - 1000), new Date(sessionFixtureBaseMs - 1000))
  const projectDir = path.join(workspace, 'admin', 'projects', 'redaction-project')
  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'README.md'), `# redaction-marker\n${gatewaySecret}\n${token}\n${structuredSecret}\n${nestedSecrets.join('\n')}\n`)
  fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify({
    name: 'redaction-marker project',
    phase: 'active',
    files: { readme: 'README.md' },
  }))

  projectAttackMarker = 'synthetic-project-boundary-marker'
  externalProjectsRoot = path.join(tmpRoot, 'explicit-external-projects')
  const explicitProject = path.join(externalProjectsRoot, 'explicit-project')
  fs.mkdirSync(explicitProject, { recursive: true })
  fs.writeFileSync(path.join(explicitProject, 'README.md'), '# explicit project\n')
  fs.writeFileSync(path.join(explicitProject, 'state.json'), JSON.stringify({
    name: 'Explicit project',
    files: { readme: 'README.md' },
  }))

  const linkedOutsideProject = path.join(outside, 'linked-project-target')
  fs.mkdirSync(linkedOutsideProject)
  fs.writeFileSync(path.join(linkedOutsideProject, 'README.md'), projectAttackMarker)
  fs.writeFileSync(path.join(linkedOutsideProject, 'state.json'), JSON.stringify({ name: projectAttackMarker, files: { readme: 'README.md' } }))
  fs.symlinkSync(linkedOutsideProject, path.join(workspace, 'admin', 'projects', 'linked-project'))

  const linkedStateProject = path.join(workspace, 'admin', 'projects', 'linked-state-project')
  fs.mkdirSync(linkedStateProject)
  const outsideState = path.join(outside, 'linked-state.json')
  fs.writeFileSync(outsideState, JSON.stringify({ name: projectAttackMarker, files: { readme: 'README.md' } }))
  fs.symlinkSync(outsideState, path.join(linkedStateProject, 'state.json'))

  const linkedOutputProject = path.join(workspace, 'admin', 'projects', 'linked-output-project')
  fs.mkdirSync(linkedOutputProject)
  fs.writeFileSync(path.join(linkedOutputProject, 'state.json'), JSON.stringify({ name: 'Linked output project', files: { readme: 'README.md' } }))
  const outsideOutput = path.join(outside, 'linked-output.md')
  fs.writeFileSync(outsideOutput, projectAttackMarker)
  fs.symlinkSync(outsideOutput, path.join(linkedOutputProject, 'README.md'))

  const reservedKeys = ['__proto__', 'constructor', 'prototype']
  reservedKeys.forEach((key, index) => {
    const sessionsDir = path.join(openclawDir, 'agents', key, 'sessions')
    fs.mkdirSync(sessionsDir, { recursive: true })
    const uuid = `00000000-0000-4000-8000-00000000000${index}`
    fs.writeFileSync(path.join(sessionsDir, `${uuid}.jsonl`), JSON.stringify({
      type: 'message',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        model: key,
        usage: { totalTokens: 10 + index, inputTokens: 7 + index, outputTokens: 3 },
        content: [{ type: 'text', text: 'safe' }],
      },
    }))
  })

  const codexSessions = path.join(home, '.codex', 'sessions', '2026', '07', '11')
  fs.mkdirSync(codexSessions, { recursive: true })
  reservedKeys.forEach((key, index) => {
    const uuid = `10000000-0000-4000-8000-00000000000${index}`
    const file = path.join(codexSessions, `rollout-${uuid}.jsonl`)
    fs.writeFileSync(file, [
      { type: 'session_meta', timestamp: new Date().toISOString(), payload: { id: key, cwd: workspace, model: key } },
      { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'user_message', message: `safe ${key}` } },
      { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'token_count', info: { last_token_usage: { total_token_usage: 20 + index, input_tokens: 12, output_tokens: 8 + index } } } },
    ].map(value => JSON.stringify(value)).join('\n'))
  })

  mockGateway = http.createServer((req, res) => {
    gatewayHttpAuth.push(req.headers.authorization || '')
    if (req.method === 'POST' && req.url === '/tools/invoke') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        gatewayHttpBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, result: { details: { sessions: [] } } }))
      })
      return
    }
    if (req.url === '/assets/app.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' })
      res.end('window.mockGatewayAsset=true')
      return
    }
    if (req.url === '/favicon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
      res.end('<svg xmlns="http://www.w3.org/2000/svg"/>')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self' ws: wss:",
    })
    res.end('<!doctype html><html><head><title>Mock OpenClaw Control</title><script type="module" src="./assets/app.js"></script></head><body>control</body></html>')
  })
  mockGatewayWss = new WebSocketServer({ server: mockGateway, path: '/ws' })
  mockGatewayWss.on('connection', (socket, req) => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'mock-nonce' } }))
    socket.on('message', data => {
      const message = JSON.parse(data.toString())
      gatewayConnects.push({ message, authorization: req.headers.authorization || '' })
      const min = Number(message?.params?.minProtocol)
      const max = Number(message?.params?.maxProtocol)
      if (min <= 4 && max >= 4 && message?.params?.auth?.token === gatewaySecret) {
        socket.send(JSON.stringify({ type: 'res', id: message.id, ok: true, payload: { type: 'hello-ok', protocol: 4 } }))
      } else {
        socket.send(JSON.stringify({ type: 'res', id: message.id, ok: false, error: { message: 'protocol or auth mismatch' } }))
      }
    })
  })
  await new Promise((resolve, reject) => {
    mockGateway.once('error', reject)
    mockGateway.listen(gatewayPort, '127.0.0.1', resolve)
  })

  const mockBin = path.join(tmpRoot, 'mock-bin')
  fs.mkdirSync(mockBin)
  fs.writeFileSync(path.join(mockBin, 'openclaw'), `#!/bin/sh\nprintf '%s\\n' 'reset-marker ${gatewaySecret} ${token} ${structuredSecret} ${nestedSecrets.join(' ')}'\n`, { mode: 0o755 })

  const backendEnv = createIsolatedProcessEnv({
    isolationRoot: tmpRoot,
    homeDir: home,
    overrides: {
      PATH: `${mockBin}${path.delimiter}${process.env.PATH || ''}`,
      BACKEND_HOST: '127.0.0.1',
      BACKEND_PORT: String(backendPort),
      FRONTEND_HOST: '127.0.0.1',
      FRONTEND_PORT: String(frontendPort),
      OPENCLAW_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
      OPENCLAW_GATEWAY_TOKEN: gatewaySecret,
      OPENCLAW_DASHBOARD_FILE_ROOTS: workspace,
      OPENCLAW_DASHBOARD_PROJECTS_DIR: externalProjectsRoot,
      OPENCLAW_DASHBOARD_DATA_ROOT: path.join(tmpRoot, 'dashboard-data'),
      OPENCLAW_PUBLIC_ELECTRICITY_PER_HOUR: '0',
      OPENCLAW_PUBLIC_SHARE_REPO_URL: 'https://repo.example/project?credential=synthetic',
      OPENCLAW_DASHBOARD_TRUSTED_ORIGINS: 'https://trusted.example,https://user:pass@bad.example,https://bad.example/path',
    },
  })
  const backendNodeArgs = process.versions.node.startsWith('22.') ? ['--experimental-sqlite'] : []
  backend = spawn(process.execPath, [...backendNodeArgs, 'scripts/unified-service.js'], {
    cwd: repo,
    env: backendEnv,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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
  await waitForHttp(frontendPort, '/api/health')
})

after(async () => {
  await stop(frontend)
  await stop(backend)
  for (const client of mockGatewayWss?.clients || []) client.terminate()
  mockGatewayWss?.close()
  await closeServer(mockGateway)
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('同源代理注入本地 token，合法功能不再误报 401', async () => {
  assert.equal((await request(frontendPort, '/api/usage')).status, 200)
  assert.equal((await request(frontendPort, '/api/memory-tree')).status, 200)
  assert.equal((await request(frontendPort, '/api/personality')).status, 200)
  assert.equal((await request(frontendPort, '/api/cognitive/analyze?text=test')).status, 200)
  const publicConfig = await request(frontendPort, '/api/public-config')
  assert.equal(publicConfig.status, 200)
  assert.equal(publicConfig.body.includes(gatewaySecret), false)
  assert.deepEqual(JSON.parse(publicConfig.body), {
    trustedHttpsOrigin: 'https://trusted.example',
    shareRepoUrl: '',
    electricityPerHour: 0,
  })

  const fileRoots = await request(frontendPort, '/api/file-manager/tree')
  assert.equal(fileRoots.status, 200, fileRoots.body)
  const readFile = await request(frontendPort, '/api/file-manager/read', sameOriginJson({ path: memoryFile }))
  assert.equal(readFile.status, 200, `${fileRoots.body}\n${readFile.body}`)
  assert.match(readFile.body, /临时测试/)
})

test('核心监控、搜索和项目产出响应统一精确遮蔽已知秘密', async () => {
  const indexed = await request(frontendPort, '/api/search/index', sameOriginJson({}))
  assert.equal(indexed.status, 200)
  const indexedPayload = JSON.parse(indexed.body)
  assert.ok(indexedPayload.totalInDb > 0, `合成会话未进入隔离搜索索引: ${indexed.body}`)
  const paths = [
    '/api/agent-full-history?agentId=test-agent&limit=100',
    '/api/session-detail?agentId=test-agent&sessionId=redaction-sample',
    '/api/agent-daily-summary?agentId=test-agent&days=1',
    '/api/agent-live-activity?agent=test-agent',
    '/api/search?q=redaction-marker',
    '/api/projects/file?id=redaction-project&key=readme',
  ]
  for (const requestPath of paths) {
    const response = await request(frontendPort, requestPath)
    assert.equal(response.status, 200, requestPath)
    for (const [label, secret] of [['gateway', gatewaySecret], ['dashboard', token], ['structured', structuredSecret], ...nestedSecrets.map((secret, index) => [`nested-${index}`, secret])]) {
      assert.equal(response.body.includes(secret), false, `${requestPath} exposed the synthetic ${label} secret`)
    }
    assert.match(response.body, /\[REDACTED\]/, requestPath)
  }
  const history = await request(frontendPort, '/api/agent-full-history?agentId=test-agent&limit=100')
  assert.match(history.body, /正常助手内容 token 统计不应被删除/)

  const reset = await request(frontendPort, '/reset', sameOriginJson({ agentId: 'test-agent' }))
  assert.equal(reset.status, 200)
  assert.match(reset.body, /reset-marker/)
  for (const secret of [gatewaySecret, token, structuredSecret, ...nestedSecrets]) {
    assert.equal(reset.body.includes(secret), false, '/reset exposed a synthetic secret')
  }
  assert.match(reset.body, /\[REDACTED\]/)
})

test('项目列表、状态、产出和重命名始终受原始授权根约束', async () => {
  const list = await request(frontendPort, '/api/projects/list')
  assert.equal(list.status, 200)
  const listedIds = JSON.parse(list.body).projects.map(project => project.id)
  assert.ok(listedIds.includes('redaction-project'))
  assert.ok(listedIds.includes('explicit-project'))
  assert.ok(listedIds.includes('linked-output-project'))
  assert.equal(listedIds.includes('linked-project'), false)
  assert.equal(listedIds.includes('linked-state-project'), false)

  const explicitFile = await request(frontendPort, '/api/projects/file?id=explicit-project&key=readme')
  assert.equal(explicitFile.status, 200)
  assert.match(explicitFile.body, /explicit project/)

  const probes = [
    '/api/projects/state?id=linked-project',
    '/api/projects/file?id=linked-project&key=readme',
    '/api/projects/state?id=linked-state-project',
    '/api/projects/file?id=linked-state-project&key=readme',
    '/api/projects/file?id=linked-output-project&key=readme',
  ]
  for (const requestPath of probes) {
    const response = await request(frontendPort, requestPath)
    assert.notEqual(response.status, 200, requestPath)
    assert.equal(response.body.includes(projectAttackMarker), false, requestPath)
  }

  for (const id of ['linked-project', 'linked-state-project']) {
    const rename = await request(frontendPort, '/api/projects/rename', sameOriginJson({ id, displayName: 'blocked' }))
    assert.notEqual(rename.status, 200)
    assert.equal(rename.body.includes(projectAttackMarker), false)
  }
  assert.equal(fs.existsSync(path.join(externalProjectsRoot, 'display-names.json')), false)
})

test('HTTP 边界拒绝缺失 token、恶意来源/Host、跨站表单与非 JSON 写请求', async () => {
  assert.equal((await request(backendPort, '/api/usage')).status, 401)
  assert.equal((await request(backendPort, '/api/usage', {
    headers: { 'x-dashboard-token': token, origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
  })).status, 403)
  assert.equal((await request(frontendPort, '/api/usage', { headers: { host: 'evil.example' } })).status, 403)
  assert.equal((await request(frontendPort, '/api/file-manager/write', {
    method: 'POST',
    headers: {
      origin: `http://127.0.0.1:${frontendPort}`,
      'sec-fetch-site': 'cross-site',
      'content-type': 'text/plain',
    },
    body: '{}',
  })).status, 403)
  assert.equal((await request(frontendPort, '/api/file-manager/write', {
    method: 'POST',
    headers: {
      origin: `http://127.0.0.1:${frontendPort}`,
      'sec-fetch-site': 'same-origin',
      'content-type': 'text/plain',
    },
    body: '{}',
  })).status, 415)
})

test('OpenClaw doctor 已封存且不会修改被监控目录', async () => {
  const configBefore = hash(configFile)
  const workspaceBefore = directoryFingerprint(workspace)
  const result = await request(frontendPort, '/api/system/doctor')
  assert.equal(result.status, 503)
  const payload = JSON.parse(result.body)
  assert.equal(payload.unavailable, true)
  assert.match(payload.error, /暂时停用/)
  assert.equal(hash(configFile), configBefore)
  assert.deepEqual(directoryFingerprint(workspace), workspaceBefore)
  assert.equal(result.body.includes(gatewaySecret), false)
})

test('文件管理允许工作目录操作并拒绝越界与符号链接', async () => {
  const untouched = path.join(workspace, 'managed-file.md')
  fs.writeFileSync(untouched, 'unchanged')
  const outsideFile = path.join(outside, 'outside.txt')
  fs.writeFileSync(outsideFile, 'outside-unchanged')
  const fileLink = path.join(workspace, 'file-link.md')
  const dirLink = path.join(workspace, 'dir-link')
  const dangling = path.join(workspace, 'dangling-link')
  fs.symlinkSync(outsideFile, fileLink)
  fs.symlinkSync(outside, dirLink)
  fs.symlinkSync(path.join(outside, 'missing-target'), dangling)

  const rejected = [
    `${workspace}/../outside/outside.txt`,
    fileLink,
    path.join(dirLink, 'outside.txt'),
    path.join(dangling, 'child.md'),
    path.join(sibling, 'sibling.md'),
  ]
  for (const candidate of rejected) {
    const response = await request(frontendPort, '/api/file-manager/read', sameOriginJson({ path: candidate }))
    assert.equal(response.status, 400, candidate)
  }

  for (const candidate of [fileLink, path.join(dangling, 'child.md')]) {
    const response = await request(frontendPort, '/api/file-manager/write', sameOriginJson({ path: candidate, content: 'blocked' }))
    assert.equal(response.status, 400, candidate)
  }

  const write = await request(frontendPort, '/api/file-manager/write', sameOriginJson({ path: untouched, content: '# safe\n' }))
  assert.equal(write.status, 200, write.body)
  assert.equal(fs.readFileSync(untouched, 'utf8'), '# safe\n')
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside-unchanged')

  const ordinaryNamedFile = path.join(workspace, 'credentials.json')
  fs.writeFileSync(ordinaryNamedFile, '{"mode":"local"}')
  const ordinaryRead = await request(frontendPort, '/api/file-manager/read', sameOriginJson({ path: ordinaryNamedFile }))
  assert.equal(ordinaryRead.status, 200)
  const directoryRead = await request(frontendPort, '/api/file-manager/read', sameOriginJson({ path: workspace }))
  assert.equal(directoryRead.status, 200)
  const describedEntry = JSON.parse(directoryRead.body).entries.find(entry => entry.name === path.basename(ordinaryNamedFile))
  assert.equal(describedEntry.desc, '结构化配置或数据文件')
  assert.match(ordinaryRead.body, /local/)

  const tree = await request(frontendPort, '/api/file-manager/tree')
  assert.equal(tree.status, 200)
  assert.equal(tree.body.includes(gatewaySecret), false)
  const treePayload = JSON.parse(tree.body)
  const sharedRoot = treePayload.roots.find(root => root.path.endsWith('/workspace with spaces/测试项目'))
  assert.equal(sharedRoot.source, 'ai')
  assert.deepEqual(
    [...new Set(sharedRoot.sources.map(source => source.toolName))].sort(),
    ['Codex', 'OpenClaw'],
  )

  const renamed = path.join(workspace, 'managed-renamed.md')
  const rename = await request(frontendPort, '/api/file-manager/rename', sameOriginJson({ path: untouched, name: path.basename(renamed) }))
  assert.equal(rename.status, 200)
  assert.equal(fs.readFileSync(renamed, 'utf8'), '# safe\n')
  const remove = await request(frontendPort, '/api/file-manager/delete', sameOriginJson({ path: renamed }))
  assert.equal(remove.status, 200)
  assert.equal(fs.existsSync(renamed), false)

  assert.notEqual((await request(frontendPort, '/api/file-manager/backups?path=x')).status, 200)
  assert.notEqual((await request(frontendPort, '/api/file-manager/restore', sameOriginJson({}))).status, 200)
})

test('上传、头像与 dist 备份接口继续使用受控路径边界', async () => {
  const configuredResponse = await request(frontendPort, '/api/agents-configured')
  assert.equal(configuredResponse.status, 200)
  const configuredAgents = JSON.parse(configuredResponse.body).agents
  const configuredCustom = configuredAgents.find(agent => agent.id === 'test-agent')
  const configuredFallback = configuredAgents.find(agent => agent.id === 'empty-agent')
  assert.equal(configuredCustom.name, '任意助手')
  assert.match(configuredCustom.avatar, /^\/api\/agent-avatar\/test-agent\?v=/)
  assert.equal(configuredFallback.name, 'empty-agent')
  assert.equal(configuredFallback.avatar, '/avatars/default.svg')
  const configuredAvatar = await request(frontendPort, '/api/agent-avatar/test-agent')
  assert.equal(configuredAvatar.status, 200)
  assert.equal(configuredAvatar.headers['content-type'], 'image/png')

  const uploadSecret = path.join(outside, 'upload-secret.png')
  fs.writeFileSync(uploadSecret, gatewaySecret)
  const validImages = [
    ['image/png', '.png', PNG_1X1],
    ['image/jpeg', '.jpg', JPEG_1X1],
    ['image/webp', '.webp', WEBP_1X1],
    ['image/gif', '.gif', GIF_1X1],
  ]
  for (const [mediaType, extension, image] of validImages) {
    const upload = await request(frontendPort, '/api/upload-image', sameOriginJson({
      agentId: 'test-agent', mediaType, data: image.toString('base64'),
    }))
    assert.equal(upload.status, 200, mediaType)
    const uploadUrl = JSON.parse(upload.body).url
    assert.match(uploadUrl, new RegExp(`\\${extension}$`))
    const savedUpload = path.join(tmpRoot, 'dashboard-data', uploadUrl.replace(/^\//, ''))
    assert.deepEqual(fs.readFileSync(savedUpload), image)
    const served = await request(frontendPort, uploadUrl)
    assert.equal(served.status, 200)
    assert.equal(served.headers['content-type'], mediaType)
    assert.equal(served.headers['x-content-type-options'], 'nosniff')
    assert.equal(served.headers['referrer-policy'], 'no-referrer')
    assert.match(served.headers['content-security-policy'], /default-src 'none'/)
    assert.match(served.headers['content-security-policy'], /sandbox/)
  }

  const uploadRoot = path.join(tmpRoot, 'dashboard-data', 'uploads')
  const countUploads = () => fs.readdirSync(uploadRoot, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length
  const beforeRejected = countUploads()
  for (const [mediaType, data] of [
    ['image/png', ''],
    ['image/png', '%%%%'],
    ['image/png', Buffer.from('random text').toString('base64')],
    ['image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')],
    ['image/png', validImages[1][2].toString('base64')],
  ]) {
    const rejected = await request(frontendPort, '/api/upload-image', sameOriginJson({ agentId: 'test-agent', mediaType, data }))
    assert.equal(rejected.status, 400)
  }
  assert.equal(countUploads(), beforeRejected)

  const traversal = await request(frontendPort, '/uploads/%2e%2e%2f%2e%2e%2foutside%2fupload-secret.png')
  assert.notEqual(traversal.status, 200)
  assert.equal(traversal.body.includes(gatewaySecret), false)
  const uploadLink = path.join(tmpRoot, 'dashboard-data', 'uploads', 'linked-secret.png')
  fs.symlinkSync(uploadSecret, uploadLink)
  const linkedUpload = await request(frontendPort, '/uploads/linked-secret.png')
  assert.notEqual(linkedUpload.status, 200)
  assert.equal(linkedUpload.body.includes(gatewaySecret), false)

  const dashboardDataRoot = path.join(tmpRoot, 'dashboard-data')
  fs.rmSync(dashboardDataRoot, { recursive: true, force: true })
  fs.symlinkSync(outside, dashboardDataRoot)
  const linkedUploadRoot = await request(frontendPort, '/api/upload-image', sameOriginJson({
    agentId: 'test-agent',
    mediaType: 'image/png',
    data: validImages[0][2].toString('base64'),
  }))
  assert.notEqual(linkedUploadRoot.status, 200)
  assert.equal(linkedUploadRoot.body.includes(gatewaySecret), false)
  fs.rmSync(dashboardDataRoot, { force: true })
  fs.mkdirSync(dashboardDataRoot, { mode: 0o700 })

  const avatarSecret = path.join(outside, 'avatar-secret.png')
  const avatarLink = path.join(workspace, 'avatar-link.png')
  fs.writeFileSync(avatarSecret, gatewaySecret)
  fs.symlinkSync(avatarSecret, avatarLink)
  const originalConfig = fs.readFileSync(configFile, 'utf8')
  try {
    const config = JSON.parse(originalConfig)
    config.agents.list[0].identity.avatar = 'avatar-link.png'
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 })
    const avatar = await request(frontendPort, '/api/agent-avatar/test-agent')
    assert.equal(avatar.status, 200)
    assert.match(avatar.headers['content-type'] || '', /image\/svg\+xml/)
    assert.equal(avatar.headers['x-content-type-options'], 'nosniff')
    assert.equal(avatar.headers['referrer-policy'], 'no-referrer')
    assert.match(avatar.headers['content-security-policy'] || '', /script-src 'none'/)
    assert.equal(avatar.body.includes(gatewaySecret), false)

    const maliciousSvg = path.join(workspace, 'malicious-avatar.svg')
    fs.writeFileSync(maliciousSvg, `<svg xmlns="http://www.w3.org/2000/svg"><script>localStorage.setItem('svg-pwned','1')</script><image href="http://127.0.0.1:9/leak?${gatewaySecret}"/></svg>`)
    config.agents.list[0].identity.avatar = 'malicious-avatar.svg'
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 })
    const svgAvatar = await request(frontendPort, '/api/agent-avatar/test-agent')
    assert.equal(svgAvatar.status, 200)
    assert.match(svgAvatar.headers['content-type'] || '', /image\/svg\+xml/)
    assert.equal(svgAvatar.headers['x-content-type-options'], 'nosniff')
    assert.equal(svgAvatar.body.includes('svg-pwned'), false)
    assert.equal(svgAvatar.body.includes(gatewaySecret), false)
  } finally {
    fs.writeFileSync(configFile, originalConfig, { mode: 0o600 })
  }

  const backupsRoot = path.join(openclawDir, 'dashboard-backups')
  fs.mkdirSync(backupsRoot, { recursive: true })
  const validBackupId = `v-test_${Date.now()}`
  fs.mkdirSync(path.join(backupsRoot, validBackupId))
  fs.writeFileSync(path.join(backupsRoot, validBackupId, 'index.html'), '<p>safe</p>')
  const list = await request(frontendPort, '/api/system/dist-backups')
  assert.equal(list.status, 200)
  const listed = JSON.parse(list.body).backups.find(item => item.id === validBackupId)
  assert.equal(listed?.id, validBackupId)
  assert.equal(Object.hasOwn(listed || {}, 'path'), false)

  const legacyAbsolute = await request(frontendPort, '/api/system/dist-rollback', sameOriginJson({ backupPath: outside }))
  assert.equal(legacyAbsolute.status, 400)

  const linkedBackupId = `v-linked_${Date.now() + 1}`
  fs.symlinkSync(outside, path.join(backupsRoot, linkedBackupId))
  const linkedRollback = await request(frontendPort, '/api/system/dist-rollback', sameOriginJson({ backupId: linkedBackupId }))
  assert.notEqual(linkedRollback.status, 200)
  assert.equal(linkedRollback.body.includes(gatewaySecret), false)

  const nestedLinkBackupId = `v-nested_${Date.now() + 2}`
  const nestedLinkBackup = path.join(backupsRoot, nestedLinkBackupId)
  const restoreOutside = path.join(outside, 'restore-secret.md')
  fs.writeFileSync(restoreOutside, `secret=${gatewaySecret}`)
  fs.mkdirSync(nestedLinkBackup)
  fs.symlinkSync(restoreOutside, path.join(nestedLinkBackup, 'index.html'))
  const distBefore = directoryFingerprint(path.join(repo, 'dist'))
  const nestedRollback = await request(frontendPort, '/api/system/dist-rollback', sameOriginJson({ backupId: nestedLinkBackupId }))
  assert.notEqual(nestedRollback.status, 200)
  assert.deepEqual(directoryFingerprint(path.join(repo, 'dist')), distBefore)

  fs.rmSync(backupsRoot, { recursive: true, force: true })
  fs.symlinkSync(outside, backupsRoot)
  const linkedRootList = await request(frontendPort, '/api/system/dist-backups')
  assert.notEqual(linkedRootList.status, 200)
  assert.equal(linkedRootList.body.includes(gatewaySecret), false)
})

test('记忆与人格接口拒绝工作空间中的符号链接逃逸', async () => {
  const originalMemory = fs.readFileSync(memoryFile)
  const soulFile = path.join(workspace, 'SOUL.md')
  const originalSoul = fs.readFileSync(soulFile)
  const outsideMemory = path.join(outside, 'outside-memory.md')
  const outsideSoul = path.join(outside, 'outside-soul.md')
  fs.writeFileSync(outsideMemory, `## ${gatewaySecret}\n`)
  fs.writeFileSync(outsideSoul, `# ${gatewaySecret}\n`)

  try {
    fs.rmSync(memoryFile)
    fs.symlinkSync(outsideMemory, memoryFile)
    const memory = await request(frontendPort, '/api/memory-tree')
    assert.equal(memory.status, 400)
    assert.equal(memory.body.includes(gatewaySecret), false)

    fs.rmSync(soulFile)
    fs.symlinkSync(outsideSoul, soulFile)
    const personality = await request(frontendPort, '/api/personality')
    assert.equal(personality.status, 200)
    assert.equal(personality.body.includes(gatewaySecret), false)
  } finally {
    fs.rmSync(memoryFile, { force: true })
    fs.writeFileSync(memoryFile, originalMemory, { mode: 0o600 })
    fs.rmSync(soulFile, { force: true })
    fs.writeFileSync(soulFile, originalSoul, { mode: 0o600 })
  }
})

test('语音样本上传、读取和删除不能越过本地语音目录', async () => {
  const audioBase64 = Buffer.alloc(2048, 1).toString('base64')
  const upload = await request(frontendPort, '/api/voice/samples', sameOriginJson({
    audioBase64,
    mimeType: 'audio/webm',
    filename: '../../unsafe.webm',
  }))
  assert.equal(upload.status, 200)
  const uploaded = JSON.parse(upload.body)
  assert.match(uploaded.url, /^\/api\/voice\/samples\//)
  assert.equal(Object.hasOwn(uploaded, 'samplePath'), false)
  assert.equal((await request(frontendPort, uploaded.url)).status, 200)

  const voiceSamples = path.join(openclawDir, 'dashboard-voice', 'samples')
  const outsideAudio = path.join(outside, 'outside-audio.webm')
  fs.writeFileSync(outsideAudio, gatewaySecret)
  fs.symlinkSync(outsideAudio, path.join(voiceSamples, 'linked.webm'))
  const linkedRead = await request(frontendPort, '/api/voice/samples/linked.webm')
  assert.notEqual(linkedRead.status, 200)
  assert.equal(linkedRead.body.includes(gatewaySecret), false)

  const pending = await request(frontendPort, '/api/voice/pending', sameOriginJson({
    audioBase64,
    mimeType: 'audio/webm',
    filename: 'pending.webm',
    agentId: 'test-agent',
  }))
  assert.equal(pending.status, 200)
  assert.equal(Object.hasOwn(JSON.parse(pending.body), 'samplePath'), false)

  const profilesFile = path.join(openclawDir, 'dashboard-voice', 'voices.json')
  fs.writeFileSync(profilesFile, JSON.stringify({
    voices: [{ voiceId: 'outside-voice', name: 'Outside', provider: 'local-reference', samplePath: outsideAudio }],
  }), { mode: 0o600 })
  const outsideBefore = fs.readFileSync(outsideAudio, 'utf8')
  const deleteOutside = await request(frontendPort, '/api/voice/delete', sameOriginJson({ voiceId: 'outside-voice' }))
  assert.notEqual(deleteOutside.status, 200)
  assert.equal(fs.readFileSync(outsideAudio, 'utf8'), outsideBefore)

  const voiceRoot = path.join(openclawDir, 'dashboard-voice')
  fs.rmSync(voiceRoot, { recursive: true, force: true })
  fs.symlinkSync(outside, voiceRoot)
  const linkedRoot = await request(frontendPort, '/api/voice/voices')
  assert.notEqual(linkedRoot.status, 200)
  assert.equal(linkedRoot.body.includes(gatewaySecret), false)
})

test('用量、Local AI 与时间线对保留键完整计数且不污染原型', async () => {
  const reservedKeys = ['__proto__', 'constructor', 'prototype']
  const prototypeBefore = Object.getOwnPropertyNames(Object.prototype).sort()

  const usageResponse = await request(frontendPort, '/api/usage')
  assert.equal(usageResponse.status, 200)
  const usage = JSON.parse(usageResponse.body)
  for (const key of reservedKeys) {
    assert.equal(Object.hasOwn(usage.byAgent, key), true, `missing agent ${key}`)
    assert.equal(Number.isFinite(usage.byAgent[key].tokens), true)
    assert.equal(Object.hasOwn(usage.byModel, key), true, `missing model ${key}`)
    assert.equal(Number.isFinite(usage.byModel[key].tokens), true)
  }

  const localResponse = await request(frontendPort, '/api/local-ai-usage?days=all')
  assert.equal(localResponse.status, 422)
  const localError = JSON.parse(localResponse.body)
  assert.match(localError.error, /^模型识别失败：/)
  for (const key of reservedKeys) {
    assert.match(localError.error, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  const timelineResponse = await request(frontendPort, '/api/cost-timeline?days=30')
  assert.equal(timelineResponse.status, 422)
  const timelineError = JSON.parse(timelineResponse.body)
  assert.match(timelineError.error, /^模型识别失败：/)
  for (const key of reservedKeys) {
    assert.match(timelineError.error, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), prototypeBefore)
  assert.equal(Object.prototype.polluted, undefined)
})

test('技能文档链接逃逸、保留属性名和 CLI 选项注入在真实接口关闭失败', async () => {
  const readme = await request(frontendPort, '/api/system/skill-readme?name=safe-skill')
  assert.equal(readme.status, 200)
  assert.match(readme.body, /Safe skill/)

  const reference = await request(frontendPort, '/api/system/skill-reference?name=safe-skill&ref=escape')
  assert.equal(reference.status, 200)
  assert.equal(reference.body.includes(gatewaySecret), false)
  assert.match(reference.body, /error/)

  const managedSkills = path.join(openclawDir, 'skills')
  const linkedSkillOutside = path.join(outside, 'linked-skill')
  fs.mkdirSync(linkedSkillOutside)
  fs.writeFileSync(path.join(linkedSkillOutside, 'SKILL.md'), `# ${gatewaySecret}`)
  fs.symlinkSync(linkedSkillOutside, path.join(managedSkills, 'linked-skill'))
  const linkedSkill = await request(frontendPort, '/api/system/skill-readme?name=linked-skill')
  assert.equal(linkedSkill.status, 200)
  assert.equal(linkedSkill.body.includes(gatewaySecret), false)
  assert.match(linkedSkill.body, /error|content":""/)

  const refsLinkedSkill = path.join(managedSkills, 'refs-linked-skill')
  fs.mkdirSync(refsLinkedSkill)
  fs.writeFileSync(path.join(refsLinkedSkill, 'SKILL.md'), '# safe')
  fs.symlinkSync(outside, path.join(refsLinkedSkill, 'references'))
  const linkedReferences = await request(frontendPort, '/api/system/skill-reference?name=refs-linked-skill&ref=reference-secret')
  assert.equal(linkedReferences.status, 200)
  assert.equal(linkedReferences.body.includes(gatewaySecret), false)
  assert.match(linkedReferences.body, /error/)

  fs.symlinkSync(path.join(outside, 'missing-skill'), path.join(managedSkills, 'dangling-skill'))
  const danglingSkill = await request(frontendPort, '/api/system/skill-readme?name=dangling-skill')
  assert.equal(danglingSkill.status, 200)
  assert.equal(danglingSkill.body.includes(gatewaySecret), false)

  const before = hash(configFile)
  const pollution = await request(frontendPort, '/api/system/skills/toggle', sameOriginJson({ name: '__proto__', enabled: false }))
  assert.equal(pollution.status, 200)
  assert.equal(JSON.parse(pollution.body).success, false)
  assert.equal(Object.prototype.enabled, undefined)
  assert.equal(hash(configFile), before)

  const usage = await request(frontendPort, '/api/skill-usage?days=30')
  assert.equal(usage.status, 200)
  const usagePayload = JSON.parse(usage.body)
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    assert.equal(usagePayload.ranked.some(item => item.name === name && item.total === 1), true)
  }
  assert.equal(Object.prototype.enabled, undefined)

  const optionInjection = await request(frontendPort, '/api/system/skills/install', sameOriginJson({ name: '--help' }))
  assert.equal(optionInjection.status, 200)
  assert.equal(JSON.parse(optionInjection.body).success, false)

  const cronOptionInjection = await request(frontendPort, '/api/cron/trigger', sameOriginJson({ id: '--help' }))
  assert.equal(cronOptionInjection.status, 400)
  const cronScheduleInjection = await request(frontendPort, '/api/cron/create', sameOriginJson({
    name: 'safe-name',
    agentId: 'test-agent',
    scheduleType: 'cron',
    scheduleValue: '--help',
    message: 'safe-message',
  }))
  assert.equal(cronScheduleInjection.status, 400)
})

test('Vite → 后端 → 模拟 Gateway 的 HTTP/WS 全链路成功且浏览器帧无密钥', async () => {
  const control = await request(frontendPort, '/gateway-api/')
  assert.equal(control.status, 200)
  assert.match(control.body, /__dashboard_bridge__\.js/)
  assert.equal(control.body.includes(gatewaySecret), false)
  assert.equal((await request(frontendPort, '/gateway-api/assets/app.js')).status, 200)
  assert.equal((await request(frontendPort, '/gateway-api/chat?session=main')).status, 200)
  assert.equal((await request(frontendPort, '/gateway-api/assets/app.js', { method: 'HEAD' })).status, 200)
  const invokeBody = { tool: 'sessions_list', action: 'json', args: { limit: 10 } }
  const invoke = await request(frontendPort, '/gateway-api/tools/invoke', sameOriginJson(invokeBody))
  assert.equal(invoke.status, 200)
  assert.deepEqual(gatewayHttpBodies.at(-1), invokeBody)
  assert.equal((await request(frontendPort, '/gateway-api/health', sameOriginJson({ unsafe: true }))).status, 405)

  const sentFrame = JSON.stringify({
    type: 'req',
    id: 'browser-connect',
    method: 'connect',
    params: { minProtocol: 3, maxProtocol: 4, client: { id: 'gateway-client', mode: 'backend' }, auth: {} },
  })
  assert.equal(sentFrame.includes(gatewaySecret), false)
  const response = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${frontendPort}/gateway-ws`, {
      origin: `http://127.0.0.1:${frontendPort}`,
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    socket.once('error', reject)
    socket.on('message', data => {
      const message = JSON.parse(data.toString())
      if (message.event === 'connect.challenge') socket.send(sentFrame)
      else if (message.type === 'res') { socket.close(); resolve(message) }
    })
  })
  assert.equal(response.ok, true)
  const latest = gatewayConnects.at(-1)
  assert.equal(latest.message.params.auth.token, gatewaySecret)
  assert.equal(latest.message.params.maxProtocol, 4)
  assert.equal(latest.authorization, `Bearer ${gatewaySecret}`)
  assert.ok(gatewayHttpAuth.every(value => value === `Bearer ${gatewaySecret}`))
})

test('自动修复接口已停用，不能靠 confirmed:true 触发真实操作', async () => {
  const response = await request(frontendPort, '/api/system/auto-fix', sameOriginJson({ action: 'restart-gateway', confirmed: true }))
  assert.equal(response.status, 503)
  assert.match(response.body, /暂时停用/)
})
