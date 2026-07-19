import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'
import { resolveTestBrowserExecutable } from './test-browser-executable.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const artifactDir = process.env.OPENCLAW_TEST_ARTIFACT_DIR || path.join(repo, 'backups')
const screenshotPath = path.join(artifactDir, 'stage3a-session-observation-browser.png')
const openClawScreenshotPath = path.join(artifactDir, 'stage3a-openclaw-dialog-browser.png')
const externalRequests = []
const consoleMessages = []
let root
let backend
let frontend
let context
let page
let backendOutput = ''
let frontendOutput = ''
let backendPort
let frontendPort
let sessionId
let projectPath

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

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
}

function usage(tokens, cost = tokens / 1000) {
  return { tokens, cost, input: Math.round(tokens * 0.7), output: Math.round(tokens * 0.3), cacheRead: 0, cacheWrite: 0 }
}

function safeRecord(entries = []) {
  return Object.assign(Object.create(null), Object.fromEntries(entries))
}

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function localFixture() {
  const sourceId = `local:codex:${sessionId}`
  const itemUsage = usage(130, 0.13)
  const day = localDateKey()
  return {
    apps: [{
      id: 'codex',
      name: 'Codex',
      count: 1,
      items: [{
        id: sessionId,
        name: '阶段3A浏览器会话',
        project: projectPath,
        path: projectPath,
        usage: itemUsage,
        lastActivityMs: Date.now(),
      }],
    }, { id: 'claude-code', name: 'Claude Code', count: 0, items: [] }],
    timeline: [{
      date: day,
      ...itemUsage,
      byModel: safeRecord([['**proto**', itemUsage]]),
      byAgentByModel: safeRecord([[sourceId, safeRecord([['**proto**', itemUsage]])]]),
    }],
  }
}

function openClawUsage() {
  return {
    ok: true,
    totalTokens: 10,
    totalCost: 0.01,
    totalInputTokens: 7,
    totalOutputTokens: 3,
    byAgent: { main: { ...usage(10, 0.01), sessionCount: 1 } },
    byModel: { test: usage(10, 0.01) },
    byAgentByModel: { main: { test: usage(10, 0.01) } },
    updatedAt: new Date().toISOString(),
  }
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 4000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

async function waitForUrl(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${label} did not start; backend=${backendOutput.slice(-1200)}; frontend=${frontendOutput.slice(-1200)}`)
}

before(async () => {
  const executablePath = resolveTestBrowserExecutable()
  assert.ok(executablePath, '真实 Chrome/Chromium 是阶段3A浏览器测试的必要条件')
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-stage3a-browser-'))
  const home = path.join(root, 'home')
  projectPath = path.join(root, 'projects', '项目执行记录')
  const openClawWorkspace = path.join(root, 'projects', 'openclaw-agent')
  fs.mkdirSync(projectPath, { recursive: true })
  fs.mkdirSync(openClawWorkspace, { recursive: true })
  fs.writeFileSync(path.join(projectPath, 'output.txt'), 'browser artifact')
  fs.writeFileSync(path.join(openClawWorkspace, 'agent-output.txt'), 'openclaw browser artifact')
  sessionId = '55555555-5555-4555-8555-555555555555'
  const syntheticSecret = 'stage3a-browser-secret-should-never-render'
  const rows = [{
    type: 'session_meta',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    payload: { id: sessionId, cwd: projectPath, model: '**proto**' },
  }, {
    type: 'event_msg',
    timestamp: new Date(Date.now() - 59_000).toISOString(),
    payload: { type: 'task_started', turn_id: 'turn-browser' },
  }]
  for (let index = 0; index < 38; index += 1) {
    rows.push({
      type: 'event_msg',
      timestamp: new Date(Date.now() - 58_000 + index * 500).toISOString(),
      payload: {
        type: index % 2 ? 'agent_message' : 'user_message',
        message: index === 37
          ? `<img src="http://127.0.0.1:65534/should-not-load"> <script>window.stage3Xss=1</script> ${syntheticSecret}`
          : `浏览器分页事件 ${index}`,
      },
    })
  }
  rows.push(
    { type: 'event_msg', timestamp: new Date(Date.now() - 12_000).toISOString(), payload: { type: 'reasoning', summary: [{ text: '真实 Codex 思考摘要' }] } },
    { type: 'response_item', timestamp: new Date(Date.now() - 11_000).toISOString(), payload: { type: 'function_call', call_id: 'browser-call', name: 'write_file', arguments: { path: 'output.txt', token: syntheticSecret } } },
    { type: 'response_item', timestamp: new Date(Date.now() - 10_000).toISOString(), payload: { type: 'function_call_output', call_id: 'browser-call', output: `finished ${syntheticSecret}` } },
    { type: 'event_msg', timestamp: new Date(Date.now() - 9_500).toISOString(), payload: { type: 'patch_apply_end', call_id: 'browser-error', success: false, status: 'failed', stderr: 'structured fixture error' } },
    { type: 'event_msg', timestamp: new Date(Date.now() - 9_000).toISOString(), payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 130, input_tokens: 91, output_tokens: 39 } } } },
    { type: 'event_msg', timestamp: new Date(Date.now() - 8_000).toISOString(), payload: { type: 'task_complete', turn_id: 'turn-browser' } },
  )
  writeJsonl(path.join(home, '.codex', 'sessions', '2026', '07', '12', `rollout-${sessionId}.jsonl`), rows)

  const openClawRows = [
    { type: 'session', id: 'openclaw-browser-main', cwd: openClawWorkspace, timestamp: new Date(Date.now() - 90_000).toISOString() },
    { type: 'session.started', runId: 'openclaw-browser-run', timestamp: new Date(Date.now() - 89_000).toISOString() },
  ]
  for (let index = 0; index < 42; index += 1) {
    openClawRows.push({
      type: 'message',
      id: `openclaw-browser-${index}`,
      timestamp: new Date(Date.now() - 88_000 + index * 1_000).toISOString(),
      message: index % 2 === 0
        ? { role: 'user', content: index === 0 ? 'OpenClaw 分页会话' : `OpenClaw 用户事件 ${index}` }
        : { role: 'assistant', model: 'openclaw-test-model', content: `OpenClaw 回复 ${index}`, stopReason: 'stop' },
    })
  }
  openClawRows.push(
    {
      type: 'message',
      id: 'openclaw-browser-tool-call',
      timestamp: new Date(Date.now() - 40_000).toISOString(),
      message: {
        role: 'assistant',
        model: 'openclaw-test-model',
        content: [
          { type: 'thinking', thinking: 'OpenClaw 真实记录思考' },
          { type: 'toolCall', id: 'openclaw-browser-call', name: 'write_file', arguments: { path: 'agent-output.txt' } },
        ],
      },
    },
    {
      type: 'message',
      id: 'openclaw-browser-tool-result',
      timestamp: new Date(Date.now() - 39_000).toISOString(),
      message: { role: 'toolResult', toolCallId: 'openclaw-browser-call', toolName: 'write_file', isError: false, content: 'saved' },
    },
    { type: 'session.ended', runId: 'openclaw-browser-run', timestamp: new Date(Date.now() - 38_000).toISOString() },
  )
  writeJsonl(path.join(home, '.openclaw', 'agents', 'main', 'sessions', 'openclaw-browser-main.jsonl'), openClawRows)
  writeJsonl(path.join(home, '.openclaw', 'agents', 'main', 'sessions', 'openclaw-browser-second.jsonl'), [
    { type: 'session', id: 'openclaw-browser-second', cwd: openClawWorkspace, timestamp: new Date(Date.now() - 37_000).toISOString() },
    { type: 'message', id: 'openclaw-second-user', timestamp: new Date(Date.now() - 36_000).toISOString(), message: { role: 'user', content: 'OpenClaw 第二会话' } },
    { type: 'message', id: 'openclaw-second-answer', timestamp: new Date(Date.now() - 35_000).toISOString(), message: { role: 'assistant', model: 'openclaw-test-model', content: '第二会话回复', stopReason: 'stop' } },
  ])
  fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true })
  fs.writeFileSync(path.join(home, '.openclaw', 'openclaw.json'), JSON.stringify({
    gateway: { auth: { token: syntheticSecret } },
    agents: { list: [{ id: 'main', name: '测试 Agent', workspace: openClawWorkspace, model: 'openclaw-test-model' }] },
  }), { mode: 0o600 })

  backendPort = await freePort()
  frontendPort = await freePort()
  const sharedEnv = createIsolatedProcessEnv({
    isolationRoot: root,
    homeDir: home,
    overrides: {
      BACKEND_HOST: '127.0.0.1',
      BACKEND_PORT: String(backendPort),
      FRONTEND_HOST: '127.0.0.1',
      FRONTEND_PORT: String(frontendPort),
      OPENCLAW_DASHBOARD_DATA_ROOT: path.join(root, 'dashboard-data'),
    },
  })
  backend = spawn(process.execPath, ['scripts/unified-service.js'], {
    cwd: repo,
    env: sharedEnv,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stdout.on('data', chunk => { backendOutput += chunk })
  backend.stderr.on('data', chunk => { backendOutput += chunk })
  await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, 'Stage3A backend')

  frontend = spawn(process.execPath, [path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort', '--force'], {
    cwd: repo,
    env: { ...sharedEnv, OPENCLAW_VITE_CACHE_DIR: path.join(root, 'vite-cache') },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  frontend.stdout.on('data', chunk => { frontendOutput += chunk })
  frontend.stderr.on('data', chunk => { frontendOutput += chunk })
  await waitForUrl(`http://127.0.0.1:${frontendPort}/`, 'Stage3A frontend')

  context = await chromium.launchPersistentContext(path.join(root, 'chrome-profile'), {
    headless: true,
    executablePath,
    viewport: { width: 1800, height: 1200 },
  })
  page = context.pages()[0] || await context.newPage()
  page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', error => consoleMessages.push(`pageerror: ${error.message}`))
  page.on('request', (request) => {
    const target = new URL(request.url())
    if (target.port === '65534') externalRequests.push(request.url())
  })

  const local = localFixture()
  await page.route('**/*', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/gateway-api/')) {
      if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'live', version: 'test' }) })
      let tool = ''
      try { tool = JSON.parse(request.postData() || '{}').tool || '' } catch { /* fixture only */ }
      const body = tool === 'sessions_list'
        ? { sessions: [{ key: 'agent:main:stage3', name: '测试 Agent', status: 'idle', updatedAt: Date.now(), totalTokens: 10, contextTokens: 1000, model: 'test' }] }
        : { agents: [] }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    if (pathname === '/api/usage') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(openClawUsage()) })
    if (pathname === '/api/cost-timeline') {
      const todayUsage = usage(10, 0.01)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          timeline: [{
            date: localDateKey(),
            ...todayUsage,
            byModel: { test: todayUsage },
            byAgentByModel: { main: { test: todayUsage } },
          }],
        }),
      })
    }
    if (pathname === '/api/local-ai-usage') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...local }) })
    if (pathname === '/api/local-ai-status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, statuses: [{ app: 'codex', conversationId: sessionId, project: projectPath, status: 'idle', label: '没干活', lastActivityMs: Date.now() }] }) })
    if (pathname === '/api/agent-ui-status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, statuses: [] }) })
    return route.continue()
  })

  await page.goto(`http://127.0.0.1:${frontendPort}/`, { waitUntil: 'commit', timeout: 15_000 })
  await page.waitForSelector('.dashboard', { timeout: 20_000 })
  await page.waitForSelector('.agent-pulse-app-tab', { timeout: 10_000 })
})

after(async () => {
  await context?.close().catch(() => {})
  await stop(frontend)
  await stop(backend)
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

test('真实 Chrome 从项目专属明细进入统一只读执行记录并分页筛选', async () => {
  await page.locator('.agent-pulse-app-tab').filter({ hasText: 'Codex' }).click()
  const project = page.locator('[data-project-entry="pulse"][data-project-name="项目执行记录"]').first()
  await project.scrollIntoViewIfNeeded()
  await project.click()
  await page.waitForSelector('.monitor-detail-dialog', { state: 'visible' })
  await page.locator('.monitor-detail-dialog button').filter({ hasText: '查看用量详情' }).click()
  await page.waitForSelector('[data-testid="project-scope-banner"]', { state: 'visible' })
  await page.locator('[data-testid="project-scope-banner"] button').filter({ hasText: '查看执行记录' }).click()
  await page.waitForSelector('.session-execution-dialog', { state: 'visible' })
  assert.match(await page.locator('.session-execution-dialog').innerText(), /统一只读会话时间线/)
  assert.match(await page.locator('.session-row-title').first().innerText(), /阶段3A浏览器会话|浏览器分页事件/)
  const initialCount = await page.locator('.event-item').count()
  assert.ok(initialCount > 0 && initialCount <= 30)
  await page.locator('.load-earlier').click()
  await page.waitForFunction(count => document.querySelectorAll('.session-execution-dialog .event-item').length > count, initialCount)
  const expandedCount = await page.locator('.event-item').count()
  assert.ok(expandedCount > initialCount)

  await page.locator('.event-filter button').filter({ hasText: '只看思考' }).click()
  await page.waitForSelector('.event-thinking', { state: 'visible' })
  await page.locator('.event-filter button').filter({ hasText: '只看思考' }).waitFor({ state: 'visible' })
  assert.equal(await page.locator('.event-item').count(), 1)
  assert.match(await page.locator('.event-thinking').innerText(), /真实 Codex 思考摘要/)

  await page.locator('.event-filter button').filter({ hasText: '只看工具' }).click()
  await page.waitForSelector('.event-tool_call', { state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('.session-execution-dialog .event-filter button:disabled'))
  const toolText = await page.locator('.event-panel').innerText()
  assert.match(toolText, /write_file/)
  assert.match(toolText, /已完成/)
  assert.equal(await page.locator('.load-earlier').count(), 0)

  await page.locator('.event-filter button').filter({ hasText: '只看结果' }).click()
  await page.waitForFunction(() => !document.querySelector('.session-execution-dialog .event-filter button:disabled'))
  assert.match(await page.locator('.event-panel').innerText(), /output\.txt/)
  await page.screenshot({ path: screenshotPath, fullPage: true })

  await page.locator('.event-filter button').filter({ hasText: '只看错误' }).click()
  await page.waitForFunction(() => !document.querySelector('.session-execution-dialog .event-filter button:disabled'))
  const errorText = await page.locator('.event-panel').innerText()
  assert.match(errorText, /补丁应用失败/)
  assert.equal(errorText.includes('function_call_output'), false)
})

test('真实 Chrome 不执行不可信内容、不自动联网且不泄漏凭据或污染原型', async () => {
  await page.locator('.event-filter button').filter({ hasText: '全部' }).click()
  while (await page.locator('.load-earlier').count()) {
    const button = page.locator('.load-earlier')
    if (!(await button.isVisible())) break
    await button.click()
    await page.waitForTimeout(100)
  }
  const pageState = await page.evaluate(() => ({
    xss: Boolean(window.stage3Xss),
    objectPolluted: Object.hasOwn(Object.prototype, 'polluted'),
    functionPolluted: Object.hasOwn(Function.prototype, 'polluted'),
    hasNaN: document.body.innerText.includes('NaN'),
    body: document.body.innerText,
  }))
  assert.equal(pageState.xss, false)
  assert.equal(pageState.objectPolluted, false)
  assert.equal(pageState.functionPolluted, false)
  assert.equal(pageState.hasNaN, false)
  assert.equal(pageState.body.includes('stage3a-browser-secret-should-never-render'), false)
  assert.equal(externalRequests.length, 0)
  assert.equal(consoleMessages.some(message => /pageerror|unhandled|percentage.*valid/i.test(message)), false, consoleMessages.join('\n'))
})

test('OpenClaw 执行记录等待 Agent 抽屉真实关闭且重复操作不残留遮罩', async () => {
  const codexExecutionClose = page.locator('.session-execution-dialog .el-dialog__headerbtn')
  if (await codexExecutionClose.isVisible()) {
    await codexExecutionClose.click()
    await page.waitForSelector('.session-execution-dialog', { state: 'hidden' })
  }
  const tokenDetailClose = page.locator('.token-detail-dialog .el-dialog__headerbtn')
  if (await tokenDetailClose.isVisible()) {
    await tokenDetailClose.click()
    await page.waitForSelector('.token-detail-dialog', { state: 'hidden' })
  }
  const monitorDetailClose = page.locator('.monitor-detail-dialog .el-dialog__headerbtn')
  if (await monitorDetailClose.isVisible()) {
    await monitorDetailClose.click()
    await page.waitForSelector('.monitor-detail-dialog', { state: 'hidden' })
  }

  await page.locator('.agent-pulse-app-tab').filter({ hasText: 'OpenClaw' }).click()
  const agentEntry = page.locator('.agent-pulse-item').filter({ hasText: '测试 Agent' })
  assert.equal(await agentEntry.count(), 1)

  const openAndExercise = async (round) => {
    await agentEntry.click()
    await page.waitForSelector('.monitor-detail-dialog', { state: 'visible' })
    await page.locator('.monitor-detail-dialog button').filter({ hasText: '打开工具专属详情' }).click()
    await page.waitForSelector('.el-drawer', { state: 'visible' })
    assert.equal(await page.locator('.session-execution-dialog:visible').count(), 0)

    await page.evaluate(() => {
      window.__stage3LayerHistory = []
      window.__stage3LayerObserver?.disconnect()
      const capture = () => {
        const drawer = document.querySelector('.el-drawer')
        const execution = document.querySelector('.session-execution-dialog')
        const visible = element => Boolean(element && element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== 'hidden')
        window.__stage3LayerHistory.push({ drawer: visible(drawer), execution: visible(execution) })
      }
      capture()
      window.__stage3LayerObserver = new MutationObserver(capture)
      window.__stage3LayerObserver.observe(document.body, { attributes: true, childList: true, subtree: true })
    })

    const executionEntry = page.locator('.el-drawer').getByRole('button', { name: '执行记录', exact: true })
    assert.equal(await executionEntry.count(), 1)
    await executionEntry.click()
    await page.waitForSelector('.el-drawer', { state: 'hidden' })
    await page.waitForSelector('.session-execution-dialog', { state: 'visible' })

    const layers = await page.evaluate(() => {
      window.__stage3LayerObserver?.disconnect()
      return window.__stage3LayerHistory || []
    })
    assert.equal(layers.some(state => state.drawer && state.execution), false)
    assert.equal(await page.locator('.el-drawer:visible').count(), 0)
    assert.equal(await page.locator('.session-execution-dialog:visible').count(), 1)
    assert.equal(await page.locator('.el-overlay:visible').count(), 1)
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.el-drawer')?.contains(document.activeElement))), false)

    const secondSession = page.locator('.session-row').filter({ hasText: 'OpenClaw 第二会话' })
    assert.equal(await secondSession.count(), 1)
    await secondSession.click()
    await page.waitForFunction(() => document.querySelector('.event-session-title strong')?.textContent?.includes('OpenClaw 第二会话'))

    const pagedSession = page.locator('.session-row').filter({ hasText: 'OpenClaw 分页会话' })
    assert.equal(await pagedSession.count(), 1)
    await pagedSession.click()
    await page.waitForFunction(() => document.querySelector('.event-session-title strong')?.textContent?.includes('OpenClaw 分页会话'))
    await page.waitForSelector('.session-execution-dialog .event-item', { state: 'visible' })
    const initialCount = await page.locator('.session-execution-dialog .event-item').count()
    assert.ok(initialCount > 0 && initialCount <= 30)
    const loadEarlier = page.locator('.session-execution-dialog .load-earlier')
    assert.equal(await loadEarlier.count(), 1)
    await loadEarlier.click()
    await page.waitForFunction(count => document.querySelectorAll('.session-execution-dialog .event-item').length > count, initialCount)
    assert.ok(await page.locator('.session-execution-dialog .event-item').count() > initialCount)

    const thinkingFilter = page.locator('.session-execution-dialog .event-filter button').filter({ hasText: '只看思考' })
    await thinkingFilter.click()
    await page.waitForSelector('.session-execution-dialog .event-thinking', { state: 'visible' })
    const toolFilter = page.locator('.session-execution-dialog .event-filter button').filter({ hasText: '只看工具' })
    await toolFilter.click()
    await page.waitForSelector('.session-execution-dialog .event-tool_call', { state: 'visible' })
    assert.match(await page.locator('.session-execution-dialog .event-panel').innerText(), /已完成/)

    if (round === 1) await page.screenshot({ path: openClawScreenshotPath, fullPage: true })
    const closeExecution = page.locator('.session-execution-dialog .el-dialog__headerbtn')
    await closeExecution.click()
    await page.waitForSelector('.session-execution-dialog', { state: 'hidden' })
    assert.equal(await page.locator('.el-drawer:visible').count(), 0)
    assert.equal(await page.locator('.el-overlay:visible').count(), 0)

    await page.locator('.agent-pulse-app-tab').filter({ hasText: 'Codex' }).click()
    await page.locator('.agent-pulse-app-tab').filter({ hasText: 'OpenClaw' }).click()
  }

  await openAndExercise(1)
  await openAndExercise(2)

  await agentEntry.click()
  await page.waitForSelector('.monitor-detail-dialog', { state: 'visible' })
  await page.locator('.monitor-detail-dialog button').filter({ hasText: '打开工具专属详情' }).click()
  await page.waitForSelector('.el-drawer', { state: 'visible' })
  const drawerClose = page.locator('.el-drawer .el-drawer__close-btn')
  assert.equal(await drawerClose.count(), 1)
  await drawerClose.click()
  await page.waitForSelector('.el-drawer', { state: 'hidden' })
  assert.equal(await page.locator('.session-execution-dialog:visible').count(), 0)
  assert.equal(await page.locator('.el-overlay:visible').count(), 0)
})
