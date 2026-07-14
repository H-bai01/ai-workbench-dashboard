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
import { PNG_1X1 } from './fixtures/raster-images.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const reservedKeys = ['__proto__', 'constructor', 'prototype']
let root
let frontend
let frontendPort
let context
let page
let browserErrors
let failedResponses
let imageRequests
let tracker
let trackerPort
let trackerRequests
let localUsageRequestStarted = false
let releaseInitialLocalUsage
let initialLocalUsageGate

let configuredAgents

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

async function waitForFrontend(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${frontendPort}/`)
      if (response.ok) return
    } catch { /* startup in progress */ }
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

function usage(tokens) {
  return { tokens, cost: tokens / 100, input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function timelineFixture() {
  const byModel = Object.create(null)
  const byAgentByModel = Object.create(null)
  reservedKeys.forEach((key, index) => {
    byModel[key] = usage(10 + index)
    byAgentByModel[key] = Object.assign(Object.create(null), { [key]: usage(10 + index) })
  })
  byModel['generic-model'] = usage(5)
  byAgentByModel['external-agent'] = Object.assign(Object.create(null), { 'generic-model': usage(5) })
  return [{ date: '2026-07-11', ...usage(38), byModel, byAgentByModel }]
}

before(async () => {
  const executablePath = resolveTestBrowserExecutable()
  assert.ok(executablePath, '真实 Chrome/Chromium 是动态键安全测试的必要条件')
  initialLocalUsageGate = new Promise(resolve => { releaseInitialLocalUsage = resolve })
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-browser-dynamic-keys-'))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { mode: 0o700 })
  trackerRequests = []
  tracker = http.createServer((request, response) => {
    trackerRequests.push(request.url || '/')
    response.writeHead(200, { 'Content-Type': 'image/png' })
    response.end(PNG_1X1)
  })
  await new Promise((resolve, reject) => {
    tracker.once('error', reject)
    tracker.listen(0, '127.0.0.1', resolve)
  })
  trackerPort = tracker.address().port
  configuredAgents = [
    { id: 'custom-agent', name: '研发助手', avatar: '/api/agent-avatar/custom-agent?v=fixture', emoji: '' },
    { id: 'fallback-agent', name: '协作助手', avatar: '', emoji: '' },
    { id: 'external-agent', name: '外部头像助手', avatar: `http://127.0.0.1:${trackerPort}/avatar.png`, emoji: '' },
    { id: 'double-segment-agent', name: '重复分隔头像', avatar: '/avatars//trap.png', emoji: '' },
    { id: 'encoded-separator-agent', name: '编码分隔头像', avatar: '/avatars/%2Ftrap.png', emoji: '' },
    { id: 'double-encoded-agent', name: '重复编码头像', avatar: '/avatars/%252e%252e/trap.png', emoji: '' },
    { id: 'empty-api-agent', name: '空头像标识', avatar: '/api/agent-avatar/', emoji: '' },
  ]
  frontendPort = await freePort()
  const viteBin = path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js')
  frontend = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
    cwd: repo,
    env: createIsolatedProcessEnv({
      isolationRoot: root,
      homeDir: home,
      overrides: {
        FRONTEND_PORT: String(frontendPort),
        BACKEND_PORT: String(await freePort()),
        OPENCLAW_VITE_CACHE_DIR: path.join(root, 'vite-cache'),
      },
    }),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForFrontend()

  context = await chromium.launchPersistentContext(path.join(root, 'chrome-profile'), {
    headless: true,
    executablePath,
  })
  page = context.pages()[0] || await context.newPage()
  browserErrors = []
  failedResponses = []
  imageRequests = []
  page.on('pageerror', error => browserErrors.push(`pageerror: ${error.stack || error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('request', request => {
    if (request.resourceType() === 'image') imageRequests.push(request.url())
  })
  page.on('response', response => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`)
  })
  const localTimeline = timelineFixture()
  await page.route('**/gateway-api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/gateway-api/health') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'live' }) })
      return
    }
    if (url.pathname === '/gateway-api/tools/invoke') {
      const requestBody = route.request().postDataJSON()
      const details = requestBody?.tool === 'sessions_list'
        ? { sessions: [] }
        : requestBody?.tool === 'agents_list'
          ? { agents: configuredAgents }
          : {}
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { details } }),
      })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  })
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/agent-avatar/custom-agent') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 })
      return
    }
    let body = { ok: true }
    if (url.pathname === '/api/public-config') body = { ok: true, config: {} }
    else if (url.pathname === '/api/health') body = { ok: true, uptimeMs: 1000, startedAt: new Date(Date.now() - 1000).toISOString() }
    else if (url.pathname === '/api/agents-configured') body = { ok: true, agents: configuredAgents }
    else if (url.pathname === '/api/search/status') body = { ok: true, indexed: true }
    else if (url.pathname === '/api/search') {
      const query = String(url.searchParams.get('q') || '').toLowerCase()
      body = {
        ok: true,
        results: {
          agents: configuredAgents
            .filter(agent => `${agent.id} ${agent.name}`.toLowerCase().includes(query))
            .map(agent => ({ id: agent.id, name: agent.name, model: 'generic-model' })),
          messages: [],
          docs: [],
        },
      }
    }
    else if (url.pathname === '/api/memory-tree') body = { ok: true, nodes: [], file: '' }
    else if (url.pathname === '/api/personality') body = { ok: true, agents: [] }
    else if (url.pathname === '/api/quick-message-config') {
      body = {
        ok: true,
        agents: configuredAgents,
        config: { enabledAgentIds: configuredAgents.map(agent => agent.id), templates: ['请汇报当前状态'] },
        defaults: { templates: ['请汇报当前状态'] },
      }
    } else if (url.pathname === '/api/cron/list') {
      body = {
        ok: true,
        jobs: [{
          id: 'generic-job',
          name: '每日检查',
          agentId: 'custom-agent',
          enabled: true,
          schedule: { kind: 'cron', expr: '0 9 * * *' },
          payload: { message: '检查当前状态' },
        }, {
          id: 'external-avatar-job',
          name: '外部头像检查',
          agentId: 'external-agent',
          enabled: true,
          schedule: { kind: 'cron', expr: '30 9 * * *' },
          payload: { message: '检查头像回退' },
        }],
      }
    } else if (url.pathname === '/api/projects/list') {
      body = {
        ok: true,
        projects: [{
          id: 'generic-project',
          name: 'generic-project',
          displayName: '通用项目',
          phase: 'in_progress',
          responsible_agent: 'custom-agent',
          blocked_reason: null,
          retry_count: 0,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          file_mtime: Date.now(),
          raw: {},
        }],
      }
    } else if (url.pathname === '/api/usage') {
      body = {
        ok: true,
        agents: reservedKeys.map((id, index) => ({ id, name: id, ...usage(10 + index) })),
        timeline: localTimeline,
        ...usage(33),
      }
    } else if (url.pathname === '/api/local-ai-usage') {
      localUsageRequestStarted = true
      await initialLocalUsageGate
      body = {
        ok: true,
        apps: [
          { id: 'codex', name: 'Codex', items: reservedKeys.map((id, index) => ({ id, name: id, project: `/tmp/codex/${id}`, ...usage(20 + index) })) },
          { id: 'claude-code', name: 'Claude Code', items: reservedKeys.map((id, index) => ({ id, name: id, project: `/tmp/claude/${id}`, ...usage(30 + index) })) },
        ],
        timeline: localTimeline,
      }
    } else if (url.pathname === '/api/cost-timeline') body = { ok: true, timeline: localTimeline }
    else if (url.pathname === '/api/agent-ui-status' || url.pathname === '/api/agent-running-status') body = { ok: true, agents: [] }
    else if (url.pathname === '/api/local-ai-status') body = { ok: true, statuses: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto(`http://127.0.0.1:${frontendPort}/`, { waitUntil: 'domcontentloaded' })
  try {
    await page.waitForSelector('.dashboard', { timeout: 15000 })
  } catch (error) {
    throw new Error(`${error.message}; browser=${browserErrors.join(' | ') || 'none'}; body=${(await page.locator('body').innerText().catch(() => '')).slice(0, 500)}`)
  }
})

after(async () => {
  await context?.close().catch(() => {})
  await stop(frontend)
  await new Promise(resolve => tracker?.close(() => resolve()) || resolve())
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

test('首页等待 OpenClaw 与本地用量都完成后才发布完整统计快照', async () => {
  const snapshotMask = page.locator('.cockpit-section > .el-loading-mask')
  try {
    const deadline = Date.now() + 5000
    while (!localUsageRequestStarted && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(localUsageRequestStarted, true)
    await snapshotMask.waitFor({ state: 'visible' })
    assert.match(await snapshotMask.innerText(), /正在汇总完整统计/)
    assert.match(await page.locator('.token-kpi-row').innerText(), /—/)
  } finally {
    releaseInitialLocalUsage()
  }

  await snapshotMask.waitFor({ state: 'hidden' })
  const kpiText = await page.locator('.token-kpi-row').innerText()
  assert.doesNotMatch(kpiText, /—/)
  assert.match(kpiText, /当前 Token/)
})

test('真实 Chrome 同时处理三种来源的保留键而不污染原型或重复累计', async () => {
  const result = await page.evaluate(async (keys) => {
    const objectBefore = Object.getOwnPropertyDescriptors(Object.prototype)
    const functionBefore = Object.getOwnPropertyDescriptors(Function.prototype)
    const sameDescriptors = (before, target) => {
      const after = Object.getOwnPropertyDescriptors(target)
      const beforeKeys = Reflect.ownKeys(before)
      const afterKeys = Reflect.ownKeys(after)
      return beforeKeys.length === afterKeys.length && beforeKeys.every((key) => {
        if (!Object.hasOwn(after, key)) return false
        const left = before[key]
        const right = after[key]
        return left.value === right.value
          && left.get === right.get
          && left.set === right.set
          && left.writable === right.writable
          && left.enumerable === right.enumerable
          && left.configurable === right.configurable
      })
    }
    const [{ mergeUsageTimelines }, { createSafeRecord }] = await Promise.all([
      import('/src/utils/usageTimeline.ts'),
      import('/src/utils/safe-record.mjs'),
    ])
    const [openclaw, local] = await Promise.all([
      fetch('/api/usage').then(response => response.json()),
      fetch('/api/local-ai-usage?days=all').then(response => response.json()),
    ])
    const makeTimeline = () => {
      const byModel = createSafeRecord()
      const byAgentByModel = createSafeRecord()
      for (const [index, key] of keys.entries()) {
        byModel[key] = { tokens: 10 + index, cost: 0, input: 10 + index, output: 0, cacheRead: 0, cacheWrite: 0 }
        const sourceModels = createSafeRecord()
        sourceModels[key] = { ...byModel[key] }
        byAgentByModel[key] = sourceModels
      }
      return [{ date: '2026-07-11', tokens: 33, cost: 0, input: 33, output: 0, cacheRead: 0, cacheWrite: 0, byModel, byAgentByModel }]
    }
    const first = mergeUsageTimelines(makeTimeline())
    const second = mergeUsageTimelines(makeTimeline())
    const day = first[0]
    return {
      loadedApps: local.apps.map(app => app.id),
      loadedOpenClawKeys: openclaw.agents.map(agent => agent.id),
      modelKeys: Object.keys(day.byModel).sort(),
      sourceKeys: Object.keys(day.byAgentByModel).sort(),
      modelTokens: Object.entries(day.byModel).map(([key, value]) => [key, value.tokens]).sort(([left], [right]) => left.localeCompare(right)),
      total: day.tokens,
      repeatedTotal: second[0].tokens,
      allFinite: Object.values(day.byModel).every(value => Number.isFinite(value.tokens) && Number.isFinite(value.cost)),
      objectPrototypeUnchanged: sameDescriptors(objectBefore, Object.prototype),
      functionPrototypeUnchanged: sameDescriptors(functionBefore, Function.prototype),
      bodyContainsNaN: document.body.innerText.includes('NaN'),
    }
  }, reservedKeys)
  assert.deepEqual(result.loadedApps.sort(), ['claude-code', 'codex'])
  assert.deepEqual(result.loadedOpenClawKeys.sort(), [...reservedKeys].sort())
  assert.deepEqual(result.modelKeys, [...reservedKeys].sort())
  assert.deepEqual(result.sourceKeys, [...reservedKeys].sort())
  assert.deepEqual(result.modelTokens, [['__proto__', 10], ['constructor', 11], ['prototype', 12]].sort(([left], [right]) => left.localeCompare(right)))
  assert.equal(result.total, 33)
  assert.equal(result.repeatedTotal, 33)
  assert.equal(result.allFinite, true)
  assert.equal(result.objectPrototypeUnchanged, true)
  assert.equal(result.functionPrototypeUnchanged, true)
  assert.equal(result.bodyContainsNaN, false)
})

test('隔离页面保留项目聚合且状态桶自洽，封存入口给出明确提示', async () => {
  await page.waitForTimeout(800)
  const bodyText = await page.locator('body').innerText()
  assert.match(bodyText, /OpenClaw/)
  assert.match(bodyText, /Codex/)
  assert.match(bodyText, /Claude Code/)
  assert.match(bodyText, /\d+\s*个项目/)

  const summary = await page.locator('.task-board-summary').innerText()
  const values = Object.fromEntries(
    [...summary.matchAll(/(总计|运行|空闲|已终止|错误)\s*(\d+)/g)].map(match => [match[1], Number(match[2])]),
  )
  assert.equal(values['总计'], values['运行'] + values['空闲'] + values['已终止'] + values['错误'])

  await page.locator('button.action-btn').filter({ hasText: '文件管理' }).click()
  await page.waitForSelector('.el-message', { state: 'visible' })
  assert.match(await page.locator('.el-message').last().innerText(), /文件管理暂时停用/)

  await page.locator('button.top-indicator').filter({ hasText: '网关' }).click()
  await page.waitForTimeout(100)
  assert.match(await page.locator('.el-message').last().innerText(), /诊断功能暂时停用/)
})

test('任意 Agent 名称、缺省头像和本地自定义头像在主要入口正常显示', async () => {
  await page.locator('.agent-pulse-item').filter({ hasText: '研发助手' }).waitFor({ state: 'visible' })
  browserErrors.length = 0
  const externalPulseAvatar = page.locator('.agent-pulse-item').filter({ hasText: '外部头像助手' }).locator('img.agent-pulse-avatar')
  assert.equal(await externalPulseAvatar.getAttribute('src'), '/avatars/default.svg')
  for (const name of ['重复分隔头像', '编码分隔头像', '重复编码头像', '空头像标识']) {
    const avatar = page.locator('.agent-pulse-item').filter({ hasText: name }).locator('img.agent-pulse-avatar')
    assert.equal(await avatar.getAttribute('src'), '/avatars/default.svg', name)
  }
  await page.locator('.agent-pulse-item').filter({ hasText: '研发助手' }).click()
  await page.locator('.el-drawer').waitFor({ state: 'visible' })
  assert.match(await page.locator('.el-drawer').innerText(), /研发助手/)
  assert.match(await page.locator('.drawer-avatar-img').getAttribute('src'), /\/api\/agent-avatar\/custom-agent\?v=fixture$/)
  await page.locator('.el-drawer textarea').fill('@')
  await page.locator('.mention-dropdown').waitFor({ state: 'visible' })
  const externalMention = page.locator('.mention-item').filter({ hasText: '外部头像助手' })
  assert.equal(await externalMention.locator('img').getAttribute('src'), '/avatars/default.svg')
  await page.locator('.el-drawer__close-btn').click()
  await page.locator('.el-drawer').waitFor({ state: 'hidden' })

  await page.locator('.qmf-trigger').click()
  await page.locator('.qmf-panel').waitFor({ state: 'visible' })
  assert.deepEqual((await page.locator('.qmf-agent-name').allInnerTexts()).sort(), configuredAgents.map(agent => agent.name).sort())
  const quickAvatars = await page.locator('.qmf-agent-avatar').evaluateAll(images => images.map(image => image.getAttribute('src')))
  assert.ok(quickAvatars.some(src => src === '/api/agent-avatar/custom-agent?v=fixture'))
  assert.ok(quickAvatars.some(src => src === '/avatars/default.svg'))
  await page.locator('.qmf-close').click()

  await page.locator('button.action-btn').filter({ hasText: '定时任务' }).click()
  await page.locator('.cron-center-dialog').waitFor({ state: 'visible' })
  assert.match(await page.locator('.cc-agent-chip').first().innerText(), /研发助手/)
  const externalCron = page.locator('.cc-agent-chip').filter({ hasText: '外部头像助手' })
  assert.equal(await externalCron.locator('img').getAttribute('src'), '/avatars/default.svg')
  await page.locator('.cron-center-dialog .el-dialog__headerbtn').click()
  await page.locator('.cron-center-dialog').waitFor({ state: 'hidden' })

  await page.locator('button.action-btn').filter({ hasText: 'OpenClaw 项目' }).click()
  await page.locator('.project-board-dialog').waitFor({ state: 'visible' })
  assert.match(await page.locator('.pb-card-agent').last().innerText(), /研发助手/)
  await page.locator('.project-board-dialog .el-dialog__headerbtn').click()
  await page.locator('.project-board-dialog').waitFor({ state: 'hidden' })

  await page.locator('.cockpit-link-btn').filter({ hasText: '看明细' }).click()
  await page.locator('.token-detail-dialog').waitFor({ state: 'visible' })
  await page.locator('.token-detail-dialog .detail-range-quick .range-btn').filter({ hasText: /^全部$/ }).click()
  const externalTokenRow = page.locator('.token-detail-dialog .el-table__row').filter({ hasText: '外部头像助手' })
  await externalTokenRow.waitFor({ state: 'visible' })
  assert.equal(await externalTokenRow.locator('img.agent-avatar-img').getAttribute('src'), '/avatars/default.svg')
  await page.locator('.token-detail-dialog .el-dialog__headerbtn').click()
  await page.locator('.token-detail-dialog').waitFor({ state: 'hidden' })

  await page.locator('.top-indicator-search').click()
  await page.locator('.palette-panel').waitFor({ state: 'visible' })
  await page.locator('.palette-input').fill('研发助手')
  const customPaletteAgent = page.locator('.palette-item').filter({ hasText: '研发助手' })
  await customPaletteAgent.waitFor({ state: 'visible' })
  assert.equal(await customPaletteAgent.locator('img.palette-agent-avatar').getAttribute('src'), '/api/agent-avatar/custom-agent?v=fixture')
  await page.locator('.palette-input').fill('外部头像助手')
  const externalPaletteAgent = page.locator('.palette-item').filter({ hasText: '外部头像助手' })
  await externalPaletteAgent.waitFor({ state: 'visible' })
  assert.equal(await externalPaletteAgent.locator('img.palette-agent-avatar').getAttribute('src'), '/avatars/default.svg')
  await page.locator('.palette-esc').click()
  await page.locator('.palette-panel').waitFor({ state: 'hidden' })

  const guessedAvatarRequests = imageRequests.filter(url => /\/avatars\/(?:custom-agent|fallback-agent)\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(url))
  const imageFailures = failedResponses.filter(item => /\.(?:png|jpe?g|webp|gif|svg)(?:\?|$)/i.test(item))
  const malformedAvatarRequests = imageRequests.filter((value) => {
    const url = new URL(value)
    return url.pathname === '/api/agent-avatar/'
      || url.pathname.includes('/avatars//')
      || /\/avatars\/%(?:2f|252e)/i.test(url.pathname)
  })
  assert.deepEqual(guessedAvatarRequests, [])
  assert.deepEqual(imageFailures, [])
  assert.deepEqual(malformedAvatarRequests, [])
  assert.deepEqual(trackerRequests, [])
  assert.equal(imageRequests.some(url => url.includes(`127.0.0.1:${trackerPort}`)), false)
  assert.deepEqual(browserErrors, [])
})

test('版本面板不加载已移除的运行现场截图', async () => {
  const section = page.locator('.inline-changelog-section')
  await section.waitFor({ state: 'visible' })
  if (await section.evaluate(element => element.classList.contains('collapsed'))) {
    await section.locator('.module-card-toggle').click()
  }
  await section.locator('.cl-panel').waitFor({ state: 'visible' })

  assert.equal(await section.locator('.cl-feature-shot img').count(), 0)
  assert.deepEqual(imageRequests.filter(url => new URL(url).pathname.startsWith('/changelog/')), [])
  assert.deepEqual(failedResponses.filter(item => /\/changelog\//.test(item)), [])
})

test('真实浏览器console与未处理异常不暴露合成消息、工具结果、路径或标识', async () => {
  const privateValues = {
    secret: 'synthetic-browser-secret-4b3',
    home: '/Users/sample-user/private-browser-workspace',
    message: 'synthetic browser message body',
    thinking: 'synthetic browser reasoning summary',
    tool: 'synthetic browser tool result',
    session: 'synthetic-browser-session-identifier',
    proxySecret: 'SYNTHETIC_BROWSER_PROXY_SECRET_4B3',
  }
  const captured = []
  const capture = message => captured.push(`${message.type()}:${message.text()}`)
  page.on('console', capture)
  try {
    const result = await page.evaluate((values) => {
      let prototypeTrapCalls = 0
      let getterCalls = 0
      const hostileProxy = new Proxy(Object.create(null), {
        getPrototypeOf() {
          prototypeTrapCalls += 1
          throw new Error(values.proxySecret)
        },
      })
      const throwingGetter = Object.create(null)
      Object.defineProperty(throwingGetter, 'message', {
        get() {
          getterCalls += 1
          throw new Error(values.proxySecret)
        },
      })
      const cyclic = Object.create(null)
      cyclic.self = cyclic
      const reserved = Object.create(null)
      Object.defineProperty(reserved, '__proto__', { enumerable: true, value: hostileProxy })
      Object.defineProperty(reserved, 'constructor', { enumerable: true, value: throwingGetter })
      Object.defineProperty(reserved, 'prototype', { enumerable: true, value: cyclic })

      console.info('[Health] ready', { status: 200, count: 3, ok: true })
      console.log('session update', { sessionId: values.session, message: values.message })
      console.warn('thinking update', values.thinking)
      console.error('tool result', new Error(`${values.tool} ${values.secret} ${values.home}`))
      let hostileConsoleSafe = true
      try {
        console.log(hostileProxy, throwingGetter, cyclic, reserved)
      } catch {
        hostileConsoleSafe = false
      }

      const runtimeError = new ErrorEvent('error', {
        cancelable: true,
        error: new Error(`${values.message} ${values.home}`),
        message: values.message,
      })
      window.dispatchEvent(runtimeError)

      const rejection = new Event('unhandledrejection', { cancelable: true })
      Object.defineProperty(rejection, 'reason', {
        value: new Error(`${values.tool} ${values.secret} ${values.session}`),
      })
      window.dispatchEvent(rejection)
      const hostileRejection = new Event('unhandledrejection', { cancelable: true })
      Object.defineProperty(hostileRejection, 'reason', { value: hostileProxy })
      window.dispatchEvent(hostileRejection)
      return {
        runtimePrevented: runtimeError.defaultPrevented,
        rejectionPrevented: rejection.defaultPrevented,
        hostileRejectionPrevented: hostileRejection.defaultPrevented,
        hostileConsoleSafe,
        prototypeTrapCalls,
        getterCalls,
      }
    }, privateValues)
    await page.waitForTimeout(100)
    assert.equal(result.runtimePrevented, true)
    assert.equal(result.rejectionPrevented, true)
    assert.equal(result.hostileRejectionPrevented, true)
    assert.equal(result.hostileConsoleSafe, true)
    assert.equal(result.prototypeTrapCalls, 0)
    assert.equal(result.getterCalls, 0)
    const output = captured.join('\n')
    for (const value of Object.values(privateValues)) assert.equal(output.includes(value), false, value)
    assert.match(output, /scope=browser/)
    assert.match(output, /event=health/)
    assert.match(output, /status=200/)
    assert.match(output, /count=3/)
    assert.match(output, /event=runtime_error/)
    assert.match(output, /event=unhandled_rejection/)
  } finally {
    page.off('console', capture)
  }
})
