import { after, afterEach, before, test } from 'node:test'
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
const screenshotPath = path.join(process.env.OPENCLAW_TEST_ARTIFACT_DIR || path.join(repo, 'backups'), 'stage2a-project-details-browser.png')
const today = new Date()
const yesterday = new Date(today)
yesterday.setDate(yesterday.getDate() - 1)
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

let root
let backend
let frontend
let backendPort
let frontendPort
let context
let page
let backendOutput = ''
let frontendOutput = ''
const consoleMessages = []
const healthRequests = []

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

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 3000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

async function waitForUrl(url, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* startup in progress */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${label} did not start; backend=${backendOutput.slice(-1500)}; frontend=${frontendOutput.slice(-1500)}`)
}

function usage(tokens, cost = tokens / 1000) {
  return { tokens, cost, input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function safeRecord(entries = []) {
  return Object.assign(Object.create(null), Object.fromEntries(entries))
}

const source = (app, id) => `local:${app}:${id}`

function localFixtures() {
  const items = {
    codex: [
      { id: 'a-one', name: 'A 会话一', project: '/tmp/项目 A', path: '/tmp/项目 A', usage: usage(100), lastActivityMs: Date.now() },
      { id: 'a-two', name: 'A 会话二', project: '/tmp/项目 A', path: '/tmp/项目 A', usage: usage(200), lastActivityMs: Date.now() - 3600000 },
      { id: 'project-b', name: 'B 会话', project: '/tmp/项目 B', path: '/tmp/项目 B', usage: usage(50), lastActivityMs: Date.now() - 7200000 },
      { id: '__proto__', name: '临时对话一', project: '', path: '', usage: usage(8), lastActivityMs: Date.now() - 10800000 },
      { id: 'constructor', name: '临时对话二', project: '', path: '', usage: usage(12), lastActivityMs: Date.now() - 14400000 },
    ],
    claude: [
      { id: 'claude-c', name: 'C 会话', project: '/tmp/项目 C', path: '/tmp/项目 C', usage: usage(70), lastActivityMs: Date.now() - 18000000 },
    ],
  }
  const rows = [
    { date: dateKey(today), id: source('codex', 'a-one'), model: 'shared-model', value: usage(100) },
    { date: dateKey(yesterday), id: source('codex', 'a-two'), model: 'constructor', value: usage(200) },
    { date: dateKey(today), id: source('codex', 'project-b'), model: 'shared-model', value: usage(50) },
    { date: dateKey(today), id: source('claude-code', 'claude-c'), model: 'prototype', value: usage(70) },
    { date: dateKey(today), id: source('codex', '__proto__'), model: '__proto__', value: usage(8) },
    { date: dateKey(today), id: source('codex', 'constructor'), model: 'prototype', value: usage(12) },
  ]
  const byDate = new Map()
  for (const row of rows) {
    const day = byDate.get(row.date) || {
      date: row.date,
      ...usage(0, 0),
      byModel: safeRecord(),
      byAgentByModel: safeRecord(),
    }
    for (const key of ['tokens', 'cost', 'input', 'output', 'cacheRead', 'cacheWrite']) day[key] += row.value[key]
    day.byModel[row.model] = day.byModel[row.model] || usage(0, 0)
    day.byAgentByModel[row.id] = day.byAgentByModel[row.id] || safeRecord()
    day.byAgentByModel[row.id][row.model] = row.value
    for (const key of ['tokens', 'cost', 'input', 'output', 'cacheRead', 'cacheWrite']) day.byModel[row.model][key] += row.value[key]
    byDate.set(row.date, day)
  }
  return {
    apps: [
      { id: 'codex', name: 'Codex', count: items.codex.length, items: items.codex },
      { id: 'claude-code', name: 'Claude Code', count: items.claude.length, items: items.claude },
    ],
    timeline: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

function openClawUsage() {
  return {
    ok: true,
    totalTokens: 30,
    totalCost: 0.03,
    totalInputTokens: 30,
    totalOutputTokens: 0,
    byAgent: { main: { ...usage(30, 0.03), sessionCount: 1 } },
    byModel: { 'legacy-model': usage(30, 0.03) },
    byAgentByModel: { main: { 'model-large': usage(200, 0.2), 'model-small': usage(100, 0.1) } },
    updatedAt: new Date().toISOString(),
  }
}

async function openProject(entry, name) {
  const locator = page.locator(`[data-project-entry="${entry}"][data-project-name="${name}"]`).first()
  await locator.scrollIntoViewIfNeeded()
  if (entry === 'monitor') await locator.locator('button').filter({ hasText: '查看' }).click()
  else await locator.click()
  if (entry === 'pulse' || entry === 'monitor') {
    await page.waitForSelector('.monitor-detail-dialog', { state: 'visible' })
    await page.locator('.monitor-detail-dialog button').filter({ hasText: '查看用量详情' }).click()
  }
  await page.waitForSelector('[data-testid="project-scope-banner"]', { state: 'visible' })
  await page.locator('.detail-range-quick .range-btn').filter({ hasText: /^全部$/ }).click()
  await page.waitForFunction(() => !document.querySelector('.token-detail-dialog .el-loading-mask'))
}

function parseTotal(text) {
  const raw = text.match(/\(([\d,]+)\)/)?.[1] || text.match(/[\d,.]+/)?.[0] || '0'
  return Number(raw.replaceAll(',', ''))
}

async function currentTotal() {
  return parseTotal(await page.locator('[data-testid="token-detail-total"]').innerText())
}

async function closeTokenDialog() {
  await page.locator('.token-detail-dialog button').filter({ hasText: /^关闭$/ }).click()
  await page.waitForSelector('.token-detail-dialog', { state: 'hidden' })
}

async function toggleSessionOption(name) {
  const option = page.locator('[role="option"]:visible').filter({ hasText: new RegExp(`^${name}$`) })
  if (await option.count() === 0) {
    await page.locator('.filter-bar .filter-select').first().click()
    await option.first().waitFor()
  }
  await page.waitForTimeout(200)
  await option.first().click({ force: true })
  await page.waitForTimeout(100)
}

before(async () => {
  const executablePath = resolveTestBrowserExecutable()
  assert.ok(executablePath, '真实 Chrome/Chromium 是阶段 2A 浏览器测试的必要条件')
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-stage2-project-details-'))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  backendPort = await freePort()
  frontendPort = await freePort()
  const sharedEnv = createIsolatedProcessEnv({
    isolationRoot: root,
    homeDir: home,
    overrides: {
      BACKEND_HOST: '127.0.0.1',
      BACKEND_PORT: String(backendPort),
      FRONTEND_PORT: String(frontendPort),
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
  await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, 'temporary backend')

  frontend = spawn(process.execPath, [path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort', '--force'], {
    cwd: repo,
    env: { ...sharedEnv, OPENCLAW_VITE_CACHE_DIR: path.join(root, 'vite-cache') },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  frontend.stdout.on('data', chunk => { frontendOutput += chunk })
  frontend.stderr.on('data', chunk => { frontendOutput += chunk })
  await waitForUrl(`http://127.0.0.1:${frontendPort}/`, 'temporary frontend')

  context = await chromium.launchPersistentContext(path.join(root, 'chrome-profile'), {
    headless: true,
    executablePath,
    viewport: { width: 1800, height: 1200 },
  })
  page = context.pages()[0] || await context.newPage()
  page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', error => consoleMessages.push(`pageerror: ${error.message}`))
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/health') healthRequests.push(Date.now())
  })

  const local = localFixtures()
  await page.route('**/*', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/gateway-api/')) {
      if (request.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'live', version: 'test' }) })
      }
      let tool = ''
      try { tool = JSON.parse(request.postData() || '{}').tool || '' } catch { /* invalid input is not used here */ }
      const body = tool === 'sessions_list'
        ? { sessions: [{ key: 'agent:main:stage2', name: '测试 Agent', status: 'idle', updatedAt: Date.now(), totalTokens: 30, contextTokens: 1000, model: 'legacy-model' }] }
        : tool === 'agents_list' ? { agents: [] } : { ok: true, result: {} }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    if (pathname === '/api/usage') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(openClawUsage()) })
    if (pathname === '/api/cost-timeline') return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        timeline: [{
          date: dateKey(today),
          tokens: 0,
          cost: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          byModel: {},
          byAgentByModel: {
            main: {
              'legacy-model': { tokens: 30, cost: 1, input: 20, output: 10, cacheRead: 0, cacheWrite: 0 },
            },
          },
        }],
      }),
    })
    if (pathname === '/api/local-ai-usage') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...local }) })
    if (pathname === '/api/local-ai-status') return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, statuses: [
        { app: 'codex', conversationId: 'a-one', project: '/tmp/项目 A', status: 'running', label: '正在干活', lastActivityMs: Date.now() },
        { app: 'codex', conversationId: 'a-two', project: '/tmp/项目 A', status: 'idle', label: '没干活', lastActivityMs: Date.now() - 3600000 },
      ] }),
    })
    if (pathname === '/api/agent-ui-status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, statuses: [] }) })
    return route.continue()
  })

  await page.goto(`http://127.0.0.1:${frontendPort}/`, { waitUntil: 'commit', timeout: 15000 })
  try {
    await page.waitForSelector('.dashboard', { timeout: 20000 })
  } catch (error) {
    throw new Error(`${error.message}; console=${consoleMessages.join(' | ') || 'none'}; body=${(await page.locator('body').innerText().catch(() => '')).slice(0, 1000)}`)
  }
  await page.waitForSelector('.agent-pulse-app-tab', { timeout: 10000 })
})

after(async () => {
  await context?.close().catch(() => {})
  await stop(frontend)
  await stop(backend)
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

afterEach(async () => {
  if (!page) return
  const tokenDialog = page.locator('.token-detail-dialog:visible')
  if (await tokenDialog.count() > 0) {
    await tokenDialog.locator('button').filter({ hasText: /^关闭$/ }).click({ force: true }).catch(() => {})
    await page.waitForTimeout(200)
  }
  for (let index = 0; index < 3; index += 1) {
    const overlays = page.locator('.el-overlay:visible')
    if (await overlays.count() === 0) break
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(150)
  }
})

test('工作台 uptime 来自隔离后端且健康检查不是一秒轮询', async () => {
  await page.waitForTimeout(11000)
  assert.equal(consoleMessages.some(message => message.includes('Gateway uptime not found')), false, consoleMessages.join('\n'))
  const healthGaps = healthRequests.slice(1).map((time, index) => time - healthRequests[index])
  const recurringHealthGaps = healthGaps.filter(gap => gap >= 1000)
  assert.ok(healthRequests.length <= 3, `11 秒内收到 ${healthRequests.length} 次 /api/health 请求`)
  assert.ok(recurringHealthGaps.every(gap => gap >= 8000), `健康请求间隔异常：${healthGaps.join(', ')}`)
  const runtimeText = await page.locator('.stat-pill.stat-uptime').innerText()
  assert.match(runtimeText, /< 1 分钟|1 分钟/)
})

test('旧总数小于模型明细合计时比例仍为 0 到 100 且接近 100', async () => {
  await page.locator('.agent-pulse-app-tab').filter({ hasText: 'OpenClaw' }).click()
  await page.locator('.agent-pulse-item').first().click()
  await page.waitForSelector('.monitor-detail-dialog', { state: 'visible' })
  await page.locator('.monitor-detail-dialog button').filter({ hasText: '打开工具专属详情' }).click()
  await page.waitForSelector('.model-breakdown-row', { state: 'visible' })
  const percentages = await page.locator('.model-pct-text').allInnerTexts()
  const values = percentages.map(text => Number(text.replace('%', '')))
  assert.ok(values.length >= 2)
  assert.ok(values.every(value => value >= 0 && value <= 100), percentages.join(', '))
  assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) <= 1)
  assert.equal(consoleMessages.some(message => /percentage.*valid value range/i.test(message)), false, consoleMessages.join('\n'))
  await page.keyboard.press('Escape')
})

test('项目 A 两个会话完整限定，单会话筛选与清空均不越界', async () => {
  await page.locator('.agent-pulse-app-tab').filter({ hasText: 'Codex' }).click()
  await openProject('pulse', '项目 A')
  const banner = await page.locator('[data-testid="project-scope-banner"]').innerText()
  assert.match(banner, /Codex · 项目 A/)
  assert.match(banner, /2 个会话/)
  assert.equal(await currentTotal(), 300)

  const sessionSelect = page.locator('.filter-bar .filter-select').first()
  await sessionSelect.click()
  await page.locator('[role="option"]:visible').first().waitFor()
  const options = await page.locator('[role="option"]:visible').allInnerTexts()
  assert.deepEqual(options.sort(), ['A 会话一', 'A 会话二'].sort())
  assert.equal(options.some(text => /a-one|a-two/.test(text)), false)
  await toggleSessionOption('A 会话一')
  assert.equal(await currentTotal(), 100)

  await toggleSessionOption('A 会话一')
  assert.equal(await currentTotal(), 300)
  assert.match(await page.locator('[data-testid="project-scope-banner"]').innerText(), /项目 A/)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await closeTokenDialog()
})

test('项目 B、Claude 项目 C和无路径对话组彼此隔离', async () => {
  await page.locator('.agent-pulse-app-tab').filter({ hasText: 'Codex' }).click()
  await openProject('pulse', '项目 B')
  assert.equal(await currentTotal(), 50)
  await closeTokenDialog()

  await openProject('pulse', '对话')
  assert.equal(await currentTotal(), 20)
  assert.match(await page.locator('[data-testid="project-scope-banner"]').innerText(), /2 个会话/)
  await closeTokenDialog()

  await page.locator('.agent-pulse-app-tab').filter({ hasText: 'Claude Code' }).click()
  await openProject('pulse', '项目 C')
  assert.equal(await currentTotal(), 70)
  await closeTokenDialog()
})

test('工作脉冲、贡献排行和监控明细打开同一项目范围', async () => {
  await page.locator('.agent-pulse-app-tab').filter({ hasText: 'Codex' }).click()
  await openProject('contribution', '项目 A')
  assert.equal(await currentTotal(), 300)
  await closeTokenDialog()

  await page.locator('.stat-pill.stat-total').click()
  await page.waitForSelector('.monitor-object-list', { state: 'visible' })
  await openProject('monitor', '项目 A')
  assert.equal(await currentTotal(), 300)
  await closeTokenDialog()
  await page.keyboard.press('Escape')
})

test('关闭项目明细后全平台总览不残留项目范围且保留键安全', async () => {
  await page.locator('.cockpit-link-btn').filter({ hasText: '看明细' }).click()
  await page.locator('.detail-range-quick .range-btn').filter({ hasText: /^全部$/ }).click()
  await page.waitForFunction(() => !document.querySelector('.token-detail-dialog .el-loading-mask'))
  assert.equal(await page.locator('[data-testid="project-scope-banner"]').count(), 0)
  assert.equal(await currentTotal(), 440)
  const result = await page.evaluate(() => ({
    objectPolluted: Object.hasOwn(Object.prototype, 'polluted'),
    functionPolluted: Object.hasOwn(Function.prototype, 'polluted'),
    hasNaN: document.body.innerText.includes('NaN'),
  }))
  assert.deepEqual(result, { objectPolluted: false, functionPolluted: false, hasNaN: false })
  await closeTokenDialog()
})
