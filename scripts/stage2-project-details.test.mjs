import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clampPercentage, modelTokenPercentages } from '../src/utils/percentage.mjs'
import { formatUptime } from '../src/utils/uptime.mjs'
import {
  createProjectTokenScope,
  filterTimelineBySourceIds,
  normalizeProjectPath,
  projectFolderName,
} from '../src/utils/project-token-scope.mjs'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

function requestJson(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: requestPath }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) }
        catch (error) { reject(error) }
      })
    })
    req.once('error', reject)
  })
}

async function waitForHealth(port) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(port, '/api/health')
      if (response.status === 200) return response.data
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('isolated backend did not become healthy')
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 3000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

test('工作台健康接口返回稳定 startedAt 与递增 uptimeMs', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-stage2-health-'))
  const port = await freePort()
  const child = spawn(process.execPath, ['scripts/unified-service.js'], {
    cwd: repo,
    env: createIsolatedProcessEnv({
      isolationRoot: home,
      homeDir: home,
      overrides: {
        BACKEND_HOST: '127.0.0.1',
        BACKEND_PORT: String(port),
        FRONTEND_PORT: String(await freePort()),
      },
    }),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    await stop(child)
    fs.rmSync(home, { recursive: true, force: true })
  })

  const first = await waitForHealth(port)
  await new Promise(resolve => setTimeout(resolve, 120))
  const second = (await requestJson(port, '/api/health')).data
  assert.equal(first.startedAt, second.startedAt)
  assert.ok(Number.isFinite(first.uptimeMs) && first.uptimeMs >= 0)
  assert.ok(second.uptimeMs >= first.uptimeMs + 80)
  assert.ok(Math.abs((Date.now() - Date.parse(second.startedAt)) - second.uptimeMs) < 500)
})

test('工作台运行时间按分钟、小时、天、星期、月和年逐级显示', () => {
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  assert.equal(formatUptime(30_000), '< 1 分钟')
  assert.equal(formatUptime(32 * minute), '32分钟')
  assert.equal(formatUptime(hour + 5 * minute), '1小时5分钟')
  assert.equal(formatUptime(day + 2 * hour + 3 * minute), '1天2小时3分钟')
  assert.equal(formatUptime(9 * day + 3 * hour + 4 * minute), '1星期2天3小时')
  assert.equal(formatUptime(47 * day), '1月2星期3天')
  assert.equal(formatUptime((365 + 60 + 21 + 4) * day), '1年2月3星期')
})

test('健康轮询不再从一秒 Agent状态轮询读取 Gateway uptime', () => {
  const source = fs.readFileSync(path.join(repo, 'src/stores/agent.ts'), 'utf8')
  assert.equal(source.includes('Gateway uptime not found'), false)
  assert.equal(source.includes('fetchGatewayUptime'), false)
  assert.match(source, /startStorePoll\(fetchAgents, currentAgentStatusPollInterval\)/)
  assert.match(source, /startStorePoll\(fetchHealth, \(\) => isPageHidden\(\)/)
  assert.match(source, /createSerialPoller/)
})

test('模型占比使用模型明细合计并始终限制在 0 到 100', () => {
  const rows = modelTokenPercentages([
    { model: 'model-a', tokens: 200 },
    { model: 'model-b', tokens: 80 },
    { model: 'model-c', tokens: 20 },
  ])
  assert.deepEqual(rows.map(row => row.pct), [67, 27, 7])
  assert.ok(rows.every(row => row.pct >= 0 && row.pct <= 100))
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.pct, 0) - 100) <= 1)
  assert.equal(clampPercentage(203), 100)
  assert.equal(clampPercentage(Number.NaN), 0)
})

test('项目范围规范化路径、保留会话标题并安全去重', () => {
  const scope = createProjectTokenScope({
    appId: 'codex',
    appName: 'Codex',
    projectPath: '/workspace/项目 A/',
    sources: [
      { id: 'local:codex:**proto**', name: '修复登录', lastActivityMs: 20, status: 'idle', label: '没干活' },
      { id: 'local:codex:constructor', name: '增加报表', lastActivityMs: 30, status: 'running', label: '正在干活' },
      { id: 'local:codex:constructor', name: '重复项', lastActivityMs: 1, status: 'idle', label: '没干活' },
    ],
  })
  assert.equal(normalizeProjectPath('C:\\work\\项目 A\\'), 'C:/work/项目 A')
  assert.equal(projectFolderName(scope.projectPath), '项目 A')
  assert.equal(scope.sources.length, 2)
  assert.deepEqual(scope.sources.map(source => source.name), ['增加报表', '修复登录'])
  assert.equal(Object.prototype.polluted, undefined)
})

test('项目与单会话范围重算所有 Token、成本和模型明细', () => {
  const usage = (tokens, cost) => ({
    tokens,
    cost,
    input: tokens / 2,
    output: tokens / 2,
    cacheRead: 0,
    cacheWrite: 0,
    inputCost: cost * 0.2,
    outputCost: cost * 0.3,
    cacheReadCost: cost * 0.5,
    cacheWriteCost: 0,
    longContextCost: cost * 0.1,
    noCacheCost: cost * 2,
  })
  const timeline = [{
    date: '2026-07-11',
    ...usage(999, 99),
    byModel: { ignored: usage(999, 99) },
    byAgentByModel: {
      'local:codex:a-1': { shared: usage(100, 1), '**proto**': usage(10, 0.1) },
      'local:codex:a-2': { shared: usage(200, 2), constructor: usage(20, 0.2) },
      'local:codex:b-1': { shared: usage(700, 7) },
      'local:claude-code:c-1': { prototype: usage(900, 9) },
    },
  }]

  const projectA = filterTimelineBySourceIds(timeline, new Set(['local:codex:a-1', 'local:codex:a-2']))[0]
  assert.equal(projectA.tokens, 330)
  assert.ok(Math.abs(projectA.cost - 3.3) < 1e-9)
  assert.equal(projectA.byModel.shared.tokens, 300)
  assert.equal(projectA.byModel['**proto**'].tokens, 10)
  assert.equal(projectA.byModel.constructor.tokens, 20)
  assert.ok(Math.abs(projectA.inputCost - 0.66) < 1e-9)
  assert.ok(Math.abs(projectA.outputCost - 0.99) < 1e-9)
  assert.ok(Math.abs(projectA.cacheReadCost - 1.65) < 1e-9)
  assert.ok(Math.abs(projectA.longContextCost - 0.33) < 1e-9)
  assert.ok(Math.abs(projectA.noCacheCost - 6.6) < 1e-9)
  assert.ok(Math.abs(projectA.byModel.shared.inputCost - 0.6) < 1e-9)
  assert.deepEqual(Object.keys(projectA.byAgentByModel).sort(), ['local:codex:a-1', 'local:codex:a-2'])

  const oneConversation = filterTimelineBySourceIds(timeline, ['local:codex:a-2'])[0]
  assert.equal(oneConversation.tokens, 220)
  assert.deepEqual(Object.keys(oneConversation.byAgentByModel), ['local:codex:a-2'])
  assert.equal(Number.isNaN(oneConversation.tokens), false)
  assert.equal(Object.prototype.polluted, undefined)
})

test('无项目路径的对话组能够形成独立范围', () => {
  const scope = createProjectTokenScope({
    appId: 'codex',
    appName: 'Codex',
    projectPath: '',
    sources: [
      { id: 'local:codex:prototype', name: '临时问答一', lastActivityMs: 2 },
      { id: 'local:codex:constructor', name: '临时问答二', lastActivityMs: 1 },
    ],
  })
  assert.equal(scope.projectName, '对话')
  assert.equal(scope.projectPath, '')
  assert.equal(scope.sources.length, 2)
})
