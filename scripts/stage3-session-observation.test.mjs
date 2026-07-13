import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  createSessionObservationStore,
  readObservedEventPage,
  scanSessionIndex,
  sessionCapabilityMatrix,
} from './session-observation.mjs'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const roots = []

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

function createRoot(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `openclaw-stage3a-${name}-`))
  roots.push(root)
  return root
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${rows.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n')}\n`)
  return file
}

test('默认 Stage3A 测试使用一次性 HOME 且不包含真实会话验收', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
  const runner = fs.readFileSync(path.join(repo, 'scripts', 'run-stage3a-isolated.mjs'), 'utf8')
  assert.equal(pkg.scripts['test:stage3a'], 'node scripts/run-stage3a-isolated.mjs')
  assert.doesNotMatch(runner, /stage3-session-observation-real/)
  assert.match(runner, /mkdtempSync/)
  assert.match(runner, /createIsolatedProcessEnv\(\{ isolationRoot: root, homeDir: home \}\)/)
})

function runNodeChild(code, args = [], timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], {
      cwd: repo,
      env: { ...process.env, OPENCLAW_SKIP_DOTENV: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`分页子进程超过 ${timeoutMs}ms；stderr=${stderr.slice(-500)}`))
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('exit', (codeValue) => {
      clearTimeout(timer)
      if (codeValue === 0) resolve(stdout)
      else reject(new Error(`分页子进程退出 ${codeValue}；stderr=${stderr.slice(-500)}`))
    })
  })
}

function fixtureEnvironment() {
  const root = createRoot('fixtures')
  const home = path.join(root, 'home')
  const openclawDir = path.join(home, '.openclaw')
  const projectA = path.join(root, 'workspace-a', 'same-name')
  const projectB = path.join(root, 'workspace-b', 'same-name')
  const outside = path.join(root, 'outside')
  fs.mkdirSync(projectA, { recursive: true })
  fs.mkdirSync(projectB, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(projectA, 'result.txt'), 'safe artifact')
  fs.writeFileSync(path.join(outside, 'private.txt'), 'outside marker')
  fs.symlinkSync(path.join(outside, 'private.txt'), path.join(projectA, 'linked.txt'))

  const secret = 'synthetic-stage3-gateway-secret-123456'
  const dashboardSecret = 'synthetic-stage3-dashboard-secret-654321'
  const now = Date.now()
  const stamp = offset => new Date(now + offset).toISOString()

  writeJsonl(path.join(openclawDir, 'agents', 'main', 'sessions', 'openclaw-one.jsonl'), [
    { type: 'session', id: 'openclaw-one', cwd: projectA, timestamp: stamp(-9000) },
    { type: 'session.started', runId: 'run-1', timestamp: stamp(-8000) },
    { type: 'message', id: 'oc-user', timestamp: stamp(-7000), message: { role: 'user', content: [{ type: 'text', text: `请处理 ${secret}` }] } },
    { type: 'message', id: 'oc-assistant', timestamp: stamp(-6000), message: { role: 'assistant', model: 'oc-model', stopReason: 'tool_use', usage: { input: 30, output: 20 }, content: [
      { type: 'thinking', thinking: '真实记录的思考' },
      { type: 'text', text: '正常回复里出现 error、失败、已终止，不代表状态错误' },
      { type: 'toolCall', id: 'oc-call-1', name: 'write_file', arguments: { path: 'result.txt', token: secret } },
      { type: 'toolCall', id: 'oc-call-wait', name: 'read_file', arguments: { path: 'linked.txt' } },
    ] } },
    { type: 'message', id: 'oc-result', timestamp: stamp(-5000), message: { role: 'toolResult', toolCallId: 'oc-call-1', toolName: 'write_file', isError: false, content: [{ type: 'text', text: `done ${dashboardSecret}` }] } },
    { type: 'message', id: 'oc-orphan', timestamp: stamp(-4000), message: { role: 'toolResult', toolCallId: 'oc-orphan-id', toolName: 'read_file', isError: false, content: 'orphan result' } },
    { type: 'message', id: 'oc-final', timestamp: stamp(-3500), message: { role: 'assistant', model: 'oc-model', stopReason: 'stop', content: [{ type: 'text', text: 'OpenClaw final answer' }] } },
    '{malformed jsonl',
    { type: 'session.ended', runId: 'run-1', timestamp: stamp(-3000) },
  ])

  const codexDir = path.join(home, '.codex', 'sessions', '2026', '07', '12')
  const codexA = '11111111-1111-4111-8111-111111111111'
  const codexB = '22222222-2222-4222-8222-222222222222'
  writeJsonl(path.join(codexDir, `rollout-${codexA}.jsonl`), [
    { type: 'session_meta', timestamp: stamp(-8000), payload: { id: codexA, cwd: projectA, model: '**proto**' } },
    { type: 'event_msg', timestamp: stamp(-7000), payload: { type: 'task_started', turn_id: 'turn-a' } },
    { type: 'event_msg', timestamp: stamp(-6000), payload: { type: 'user_message', message: 'Codex project A question' } },
    { type: 'event_msg', timestamp: stamp(-5000), payload: { type: 'reasoning', summary: [{ text: 'Codex官方推理摘要' }] } },
    { type: 'event_msg', timestamp: stamp(-4500), payload: { type: 'agent_reasoning', text: 'Codex官方状态摘要' } },
    { type: 'response_item', timestamp: stamp(-4000), payload: { type: 'function_call', call_id: 'cx-call-1', name: 'write_file', arguments: { path: 'result.txt', apiKey: secret } } },
    { type: 'response_item', timestamp: stamp(-3000), payload: { type: 'function_call_output', call_id: 'cx-call-1', output: `created ${secret}` } },
    { type: 'response_item', timestamp: stamp(-2500), payload: { type: 'function_call_output', call_id: 'cx-orphan', output: 'orphan' } },
    { type: 'event_msg', timestamp: stamp(-2000), payload: { type: 'agent_message', message: 'Codex answer' } },
    { type: 'event_msg', timestamp: stamp(-1500), payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 100, input_tokens: 75, cached_input_tokens: 25, output_tokens: 25 } } } },
    { type: 'event_msg', timestamp: stamp(-1000), payload: { type: 'task_complete', turn_id: 'turn-a' } },
  ])
  writeJsonl(path.join(codexDir, `rollout-${codexB}.jsonl`), [
    { type: 'session_meta', timestamp: stamp(-5000), payload: { id: codexB, cwd: projectB, model: 'constructor' } },
    { type: 'event_msg', timestamp: stamp(-4000), payload: { type: 'user_message', message: 'Codex project B question' } },
    { type: 'event_msg', timestamp: stamp(-3500), payload: { type: 'stream_error', message: 'structured stream failure' } },
    { type: 'event_msg', timestamp: stamp(-3000), payload: { type: 'turn_aborted' } },
  ])

  const claudeId = '33333333-3333-4333-8333-333333333333'
  writeJsonl(path.join(home, '.claude', 'projects', 'project-a', `${claudeId}.jsonl`), [
    { type: 'custom-title', sessionId: claudeId, cwd: projectA, customTitle: 'Claude controlled fixture', timestamp: stamp(-6000) },
    { type: 'user', uuid: 'cl-user', sessionId: claudeId, cwd: projectA, timestamp: stamp(-5000), message: { role: 'user', content: [{ type: 'text', text: 'Claude question' }] } },
    { type: 'assistant', uuid: 'cl-assistant', sessionId: claudeId, cwd: projectA, timestamp: stamp(-4000), message: { role: 'assistant', model: 'prototype', usage: { input_tokens: 12, output_tokens: 5 }, content: [
      { type: 'thinking', thinking: 'Claude客户端记录的思考' },
      { type: 'text', text: 'Claude answer' },
      { type: 'tool_use', id: 'cl-call-1', name: 'Write', input: { file_path: 'result.txt' } },
    ] } },
    { type: 'user', uuid: 'cl-tool', sessionId: claudeId, cwd: projectA, timestamp: stamp(-3000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'cl-call-1', is_error: true, content: 'structured failure' }] } },
    { type: 'assistant', uuid: 'cl-final', sessionId: claudeId, cwd: projectA, timestamp: stamp(-2000), message: { role: 'assistant', model: 'prototype', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Claude final answer' }] } },
  ])

  const symlinkTarget = path.join(outside, 'rollout-44444444-4444-4444-8444-444444444444.jsonl')
  writeJsonl(symlinkTarget, [{ type: 'session_meta', payload: { id: '44444444-4444-4444-8444-444444444444', cwd: outside } }])
  fs.symlinkSync(symlinkTarget, path.join(codexDir, path.basename(symlinkTarget)))

  return { root, home, openclawDir, projectA, projectB, outside, secret, dashboardSecret, codexA, codexB, claudeId }
}

test('能力矩阵明确三种客户端的真实只读能力和降级项', () => {
  const matrix = sessionCapabilityMatrix()
  assert.deepEqual(matrix.map(row => row.source), ['openclaw', 'codex', 'claude-code'])
  assert.equal(matrix.find(row => row.source === 'codex').thinking, 'summary-only')
  assert.ok(matrix.every(row => row.control === false))
})

test('索引按来源、项目真实路径和会话 ID 隔离并拒绝符号链接会话', () => {
  const fixture = fixtureEnvironment()
  const index = scanSessionIndex({
    homeDir: fixture.home,
    openclawDir: fixture.openclawDir,
    openclawAgents: [{ id: 'main', workspace: fixture.projectA }],
  })
  assert.equal(index.length, 4)
  const a = index.find(row => row.sessionId === fixture.codexA)
  const b = index.find(row => row.sessionId === fixture.codexB)
  assert.equal(path.basename(a.projectPath), path.basename(b.projectPath))
  assert.notEqual(a.projectKey, b.projectKey)
  assert.equal(index.some(row => row.sessionId.startsWith('44444444')), false)
})

test('OpenClaw 只认结构化状态，工具按调用 ID 配对且产出不越界', async () => {
  const fixture = fixtureEnvironment()
  const store = createSessionObservationStore({
    homeDir: fixture.home,
    openclawDir: fixture.openclawDir,
    getOpenClawAgents: () => [{ id: 'main', workspace: fixture.projectA }],
  })
  const listing = await store.listSessions({ source: 'openclaw', agentId: 'main', secrets: [fixture.secret, fixture.dashboardSecret] })
  assert.equal(listing.sessions.length, 1)
  assert.equal(listing.sessions[0].status, 'idle')
  assert.equal(listing.sessions[0].usage.tokens, 50)
  const page = await store.readEvents({ source: 'openclaw', sessionId: 'openclaw-one', limit: 50, secrets: [fixture.secret, fixture.dashboardSecret] })
  const call = page.events.find(event => event.toolCallId === 'oc-call-1' && event.type === 'tool_call')
  const waiting = page.events.find(event => event.toolCallId === 'oc-call-wait')
  const orphan = page.events.find(event => event.toolCallId === 'oc-orphan-id')
  assert.equal(call.toolState, 'completed')
  assert.equal(waiting.toolState, 'waiting')
  assert.equal(orphan.toolState, 'orphan')
  assert.deepEqual(call.artifacts.map(item => item.relativePath), ['result.txt'])
  assert.equal(waiting.artifacts.length, 0)
  const responseText = JSON.stringify(page)
  assert.equal(responseText.includes(fixture.secret), false)
  assert.equal(responseText.includes(fixture.dashboardSecret), false)
  assert.ok(page.events.some(event => event.type === 'assistant_message' && event.content.includes('error、失败、已终止')))
  assert.equal(page.events.some(event => event.type === 'lifecycle_error'), false)
  assert.ok(page.events.some(event => event.type === 'lifecycle_complete' && event.label === '本轮完成'))
})

test('Codex 只展示官方 reasoning summary、结构化生命周期和会话级用量', async () => {
  const fixture = fixtureEnvironment()
  const store = createSessionObservationStore({ homeDir: fixture.home, openclawDir: fixture.openclawDir })
  const listing = await store.listSessions({ source: 'codex', sessionIds: [fixture.codexA], secrets: [fixture.secret] })
  assert.equal(listing.sessions[0].usage.tokens, 100)
  assert.equal(listing.sessions[0].status, 'idle')
  assert.equal(listing.sessions[0].thinkingAvailability, 'summary-only')
  const page = await store.readEvents({ source: 'codex', sessionId: fixture.codexA, limit: 50, secrets: [fixture.secret] })
  assert.equal(page.events.filter(event => event.type === 'thinking').length, 2)
  assert.ok(page.events.filter(event => event.type === 'thinking').every(event => event.thinkingKind === 'summary'))
  assert.equal(page.events.find(event => event.toolCallId === 'cx-call-1' && event.type === 'tool_call').toolState, 'completed')
  assert.equal(page.events.find(event => event.toolCallId === 'cx-orphan').toolState, 'orphan')
  assert.ok(page.events.some(event => event.type === 'lifecycle_start'))
  assert.ok(page.events.some(event => event.type === 'lifecycle_complete'))
  assert.equal(JSON.stringify(page).includes(fixture.secret), false)
  const abortedPage = await store.readEvents({ source: 'codex', sessionId: fixture.codexB, limit: 50 })
  assert.ok(abortedPage.events.some(event => event.type === 'lifecycle_error'))
  assert.ok(abortedPage.events.some(event => event.type === 'lifecycle_aborted'))
})

test('Claude 工具结果不会误记成用户消息，is_error 是唯一结构化工具错误', async () => {
  const fixture = fixtureEnvironment()
  const store = createSessionObservationStore({ homeDir: fixture.home, openclawDir: fixture.openclawDir })
  const page = await store.readEvents({ source: 'claude-code', sessionId: fixture.claudeId, limit: 50 })
  assert.equal(page.events.filter(event => event.type === 'user_message').length, 1)
  assert.equal(page.events.find(event => event.type === 'thinking').thinkingKind, 'recorded')
  const toolResult = page.events.find(event => event.type === 'tool_result')
  assert.equal(toolResult.isError, true)
  assert.equal(toolResult.toolState, 'error')
  assert.ok(page.events.find(event => event.type === 'tool_call').artifacts.some(item => item.relativePath === 'result.txt'))
  assert.ok(page.events.some(event => event.type === 'lifecycle_complete'))
})

test('项目范围拒绝混入同名不同路径会话、未知 ID、路径和保留键污染', async () => {
  const fixture = fixtureEnvironment()
  const beforeObject = Object.getOwnPropertyDescriptors(Object.prototype)
  const beforeFunction = Object.getOwnPropertyDescriptors(Function.prototype)
  const store = createSessionObservationStore({ homeDir: fixture.home, openclawDir: fixture.openclawDir })
  await assert.rejects(store.listSessions({ source: 'codex', sessionIds: [fixture.codexA, fixture.codexB] }), /不属于同一个项目/)
  await assert.rejects(store.listSessions({ source: 'codex', sessionIds: ['../../outside'] }), /无效/)
  await assert.rejects(store.listSessions({ source: 'codex', sessionIds: ['unknown-session'] }), /未知/)
  const reserved = await store.listSessions({ source: 'codex', sessionIds: [fixture.codexA] })
  assert.equal(reserved.sessions[0].model, '**proto**')
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), beforeObject)
  assert.deepEqual(Object.getOwnPropertyDescriptors(Function.prototype), beforeFunction)
})

test('分页按稳定事件 ID 不重不漏，类型筛选和畸形行不破坏会话', async () => {
  const root = createRoot('pagination')
  const file = path.join(root, 'rollout-page.jsonl')
  const rows = [{ type: 'session_meta', timestamp: new Date().toISOString(), payload: { id: 'page-session', cwd: root } }, '{bad']
  for (let index = 0; index < 83; index += 1) {
    rows.push({ type: 'event_msg', timestamp: new Date(Date.now() + index).toISOString(), payload: { type: index % 2 ? 'agent_message' : 'user_message', message: `event-${index}` } })
  }
  writeJsonl(file, rows)
  const stat = fs.statSync(file)
  const entry = { source: 'codex', sessionId: 'page-session', file, size: stat.size, mtimeMs: stat.mtimeMs, model: 'test', projectPath: root, agentId: '' }
  const seen = []
  let cursor
  do {
    const page = await readObservedEventPage(entry, { cursor, limit: 13 })
    seen.unshift(...page.events.map(event => event.id))
    cursor = page.nextCursor
  } while (cursor)
  assert.equal(seen.length, 83)
  assert.equal(new Set(seen).size, 83)
  const filtered = await readObservedEventPage(entry, { limit: 50, types: ['assistant_message'] })
  assert.ok(filtered.events.length > 0)
  assert.ok(filtered.events.every(event => event.type === 'assistant_message'))
  await assert.rejects(readObservedEventPage(entry, { types: ['not-a-real-type'] }), /无效/)
})

test('大型工具输出受到截断和响应数量限制', async () => {
  const root = createRoot('large-output')
  const file = writeJsonl(path.join(root, 'rollout-large.jsonl'), [
    { type: 'session_meta', timestamp: new Date().toISOString(), payload: { id: 'large-session', cwd: root } },
    { type: 'response_item', timestamp: new Date().toISOString(), payload: { type: 'function_call', call_id: 'large-call', name: 'read_file', arguments: {} } },
    { type: 'response_item', timestamp: new Date().toISOString(), payload: { type: 'function_call_output', call_id: 'large-call', output: 'x'.repeat(100_000) } },
  ])
  const stat = fs.statSync(file)
  const entry = { source: 'codex', sessionId: 'large-session', file, size: stat.size, mtimeMs: stat.mtimeMs, model: 'test', projectPath: root, agentId: '' }
  const page = await readObservedEventPage(entry, { limit: 999 })
  assert.ok(page.events.length <= 50)
  const result = page.events.find(event => event.type === 'tool_result')
  assert.equal(result.resultTruncated, true)
  assert.ok(result.resultSummary.length < 9000)
})

test('约 1.3MB 单行 JSONL 在子进程硬超时内完成且保留相邻正常事件', async () => {
  const root = createRoot('large-line-child')
  const file = writeJsonl(path.join(root, 'claude-large.jsonl'), [
    { type: 'user', timestamp: new Date().toISOString(), message: { content: 'normal-before' } },
    { type: 'assistant', timestamp: new Date().toISOString(), message: { model: 'test', content: [{ type: 'text', text: 'x'.repeat(1_300_000) }] } },
    { type: 'user', timestamp: new Date().toISOString(), message: { content: 'normal-after' } },
  ])
  const code = `
    import fs from 'node:fs'
    import { readObservedEventPage } from './scripts/session-observation.mjs'
    const file = process.argv[1]
    const stat = fs.statSync(file)
    const entry = { source: 'claude-code', sessionId: 'large-line', file, size: stat.size, mtimeMs: stat.mtimeMs, model: 'test', projectPath: '', agentId: '' }
    const page = await readObservedEventPage(entry, { limit: 30, pairIndex: { calls: new Set(), results: new Map() } })
    process.stdout.write(JSON.stringify({ count: page.events.length, scannedBytes: page.scannedBytes, labels: page.events.map(event => event.type), truncated: page.events.some(event => event.contentTruncated) }))
  `
  const result = JSON.parse(await runNodeChild(code, [file], 3_000))
  assert.equal(result.count, 3)
  assert.deepEqual(result.labels, ['user_message', 'assistant_message', 'user_message'])
  assert.equal(result.truncated, true)
  assert.ok(result.scannedBytes >= 1_300_000)
})

test('超过安全行大小的记录产生明确跳过事件且不影响正常相邻行', async () => {
  const root = createRoot('oversized-line')
  const file = writeJsonl(path.join(root, 'oversized.jsonl'), [
    { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'user_message', message: 'safe-before' } },
    { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'agent_message', message: 'x'.repeat(8 * 1024 * 1024 + 100_000) } },
    { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'agent_message', message: 'safe-after' } },
  ])
  const stat = fs.statSync(file)
  const entry = { source: 'codex', sessionId: 'oversized', file, size: stat.size, mtimeMs: stat.mtimeMs, model: 'test', projectPath: root, agentId: '' }
  const page = await readObservedEventPage(entry, { limit: 30, pairIndex: { calls: new Set(), results: new Map() } })
  assert.ok(page.events.some(event => event.label === '事件过大，已跳过'))
  assert.ok(page.events.some(event => event.content === 'safe-before'))
  assert.ok(page.events.some(event => event.content === 'safe-after'))
  assert.equal(page.oversizedRecords, 1)
})

test('单条记录 400 个事件按 30 条分页后不重不漏且游标不可伪造', async () => {
  const root = createRoot('record-events')
  const file = writeJsonl(path.join(root, 'openclaw-400.jsonl'), [{
    type: 'message',
    id: 'many-blocks',
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      model: 'test',
      content: Array.from({ length: 400 }, (_, index) => ({ type: 'text', text: `block-${index}` })),
    },
  }])
  const stat = fs.statSync(file)
  const entry = { source: 'openclaw', sessionId: 'many-blocks', file, size: stat.size, mtimeMs: stat.mtimeMs, model: 'test', projectPath: root, agentId: 'main' }
  const seen = []
  let cursor
  let pages = 0
  do {
    const page = await readObservedEventPage(entry, { cursor, limit: 30, pairIndex: { calls: new Set(), results: new Map() } })
    assert.ok(page.events.length <= 30)
    seen.unshift(...page.events.map(event => event.content))
    cursor = page.nextCursor
    pages += 1
    assert.ok(pages < 20)
  } while (cursor)
  assert.equal(seen.length, 400)
  assert.equal(new Set(seen).size, 400)
  assert.deepEqual(seen, Array.from({ length: 400 }, (_, index) => `block-${index}`))

  const first = await readObservedEventPage(entry, { limit: 30, pairIndex: { calls: new Set(), results: new Map() } })
  const forged = `${first.nextCursor.slice(0, -1)}${first.nextCursor.endsWith('0') ? '1' : '0'}`
  await assert.rejects(readObservedEventPage(entry, { cursor: forged, limit: 30, pairIndex: { calls: new Set(), results: new Map() } }), /签名无效/)
  await assert.rejects(readObservedEventPage(entry, { cursor: first.nextCursor, limit: 30, types: ['thinking'], pairIndex: { calls: new Set(), results: new Map() } }), /签名无效/)
})

test('序列化响应受 256KB 硬上限约束且大小分页不会丢事件', async () => {
  const root = createRoot('response-size')
  const file = writeJsonl(path.join(root, 'response-size.jsonl'), [{
    type: 'message',
    id: 'large-blocks',
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      model: 'test',
      content: Array.from({ length: 50 }, (_, index) => ({ type: 'text', text: `${index}:`.padEnd(8_000, 'x') })),
    },
  }])
  const stat = fs.statSync(file)
  const entry = { source: 'openclaw', sessionId: 'response-size', file, size: stat.size, mtimeMs: stat.mtimeMs, model: 'test', projectPath: root, agentId: 'main' }
  const seen = []
  let cursor
  let limited = false
  do {
    const page = await readObservedEventPage(entry, { cursor, limit: 50, pairIndex: { calls: new Set(), results: new Map() } })
    const serializedBytes = Buffer.byteLength(JSON.stringify(page))
    assert.ok(serializedBytes <= page.maxResponseBytes, `${serializedBytes} > ${page.maxResponseBytes}`)
    limited ||= page.responseSizeLimited
    seen.unshift(...page.events.map(event => event.id))
    cursor = page.nextCursor
  } while (cursor)
  assert.equal(limited, true)
  assert.equal(seen.length, 50)
  assert.equal(new Set(seen).size, 50)
})

test('活动会话连续增长只替换当前指纹且缓存总量保持有界', async () => {
  const fixture = fixtureEnvironment()
  const store = createSessionObservationStore({ homeDir: fixture.home, openclawDir: fixture.openclawDir })
  for (let index = 0; index < 25; index += 1) {
    const file = path.join(fixture.home, '.codex', 'sessions', '2026', '07', '12', `rollout-${fixture.codexA}.jsonl`)
    fs.appendFileSync(file, `${JSON.stringify({ type: 'event_msg', timestamp: new Date(Date.now() + index).toISOString(), payload: { type: 'agent_message', message: `update-${index}` } })}\n`)
    await store.readEvents({ source: 'codex', sessionId: fixture.codexA, limit: 5 })
    const stats = store.cacheStats()
    assert.equal(stats.toolPairs.entries, 1)
    assert.ok(stats.toolPairs.entries <= stats.toolPairs.maxEntries)
  }
  await store.listSessions({ source: 'codex', sessionIds: [fixture.codexA] })
  const stats = store.cacheStats()
  assert.equal(stats.summary.entries, 1)
  assert.equal(stats.toolPairs.entries, 1)
  fs.unlinkSync(path.join(fixture.home, '.codex', 'sessions', '2026', '07', '12', `rollout-${fixture.codexA}.jsonl`))
  await assert.rejects(store.readEvents({ source: 'codex', sessionId: fixture.codexA, limit: 5 }), /不可用/)
  assert.equal(store.cacheStats().toolPairs.entries, 0)
  assert.equal(store.cacheStats().summary.entries, 0)
})

test('多会话摘要与配对缓存按 LRU 上限淘汰', async () => {
  const root = createRoot('cache-lru')
  const home = path.join(root, 'home')
  const project = path.join(root, 'project')
  const sessionsDir = path.join(home, '.codex', 'sessions', '2026', '07', '12')
  fs.mkdirSync(project, { recursive: true })
  const sessionIds = []
  for (let index = 0; index < 135; index += 1) {
    const sessionId = `cache-session-${index}`
    sessionIds.push(sessionId)
    writeJsonl(path.join(sessionsDir, `rollout-${sessionId}.jsonl`), [
      { type: 'session_meta', timestamp: new Date().toISOString(), payload: { id: sessionId, cwd: project, model: 'test' } },
      { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'agent_message', message: `cache ${index}` } },
    ])
  }
  const store = createSessionObservationStore({ homeDir: home, openclawDir: path.join(home, '.openclaw') })
  await store.listSessions({ source: 'codex', sessionIds })
  const stats = store.cacheStats()
  assert.equal(stats.summary.entries, stats.summary.maxEntries)
  assert.equal(stats.toolPairs.entries, stats.toolPairs.maxEntries)
  assert.equal(stats.summary.maxEntries, 128)
})

test('字符串回复、Claude 混合记录、工具错误和结构化产出筛选均保持准确', async () => {
  const root = createRoot('event-boundaries')
  const project = path.join(root, 'project')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, 'output.txt'), 'artifact')

  const openFile = writeJsonl(path.join(root, 'open.jsonl'), [
    { type: 'message', id: 'string-message', timestamp: new Date().toISOString(), message: { role: 'assistant', content: '普通字符串回复' } },
    { type: 'message', id: 'artifact-call', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'toolCall', id: 'write-1', name: 'write_file', arguments: { path: 'output.txt' } }] } },
  ])
  const openStat = fs.statSync(openFile)
  const openEntry = { source: 'openclaw', sessionId: 'event-open', file: openFile, size: openStat.size, mtimeMs: openStat.mtimeMs, model: 'test', projectPath: project, agentId: 'main' }
  const allOpen = await readObservedEventPage(openEntry, { limit: 30, pairIndex: { calls: new Set(['write-1']), results: new Map() } })
  assert.ok(allOpen.events.some(event => event.type === 'assistant_message' && event.content === '普通字符串回复'))
  const resultOpen = await readObservedEventPage(openEntry, { limit: 30, types: ['tool_result', 'artifact'], pairIndex: { calls: new Set(['write-1']), results: new Map() } })
  assert.ok(resultOpen.events.some(event => event.type === 'tool_call' && event.artifacts.length === 1))

  const claudeFile = writeJsonl(path.join(root, 'claude.jsonl'), [{
    type: 'user',
    uuid: 'mixed',
    timestamp: new Date().toISOString(),
    message: { content: [
      { type: 'text', text: '混合记录中的用户文本' },
      { type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'structured error' },
    ] },
  }])
  const claudeStat = fs.statSync(claudeFile)
  const claudeEntry = { source: 'claude-code', sessionId: 'event-claude', file: claudeFile, size: claudeStat.size, mtimeMs: claudeStat.mtimeMs, model: 'test', projectPath: project, agentId: '' }
  const mixed = await readObservedEventPage(claudeEntry, { limit: 30, pairIndex: { calls: new Set(['tool-1']), results: new Map([['tool-1', true]]) } })
  assert.ok(mixed.events.some(event => event.type === 'user_message' && event.content === '混合记录中的用户文本'))
  assert.ok(mixed.events.some(event => event.type === 'tool_result' && event.isError))
  const errors = await readObservedEventPage(claudeEntry, {
    limit: 30,
    types: ['tool_result', 'lifecycle_error', 'lifecycle_aborted'],
    errorsOnly: true,
    pairIndex: { calls: new Set(['tool-1']), results: new Map([['tool-1', true]]) },
  })
  assert.equal(errors.events.length, 1)
  assert.equal(errors.events[0].type, 'tool_result')
  assert.equal(errors.events[0].isError, true)
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

function request(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: requestPath, headers }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
  })
}

async function waitForBackend(port) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await request(port, '/api/health')
      if (response.status === 200) return
    } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('isolated Stage 3A backend did not start')
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 3000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

test('真实 HTTP 只读接口按索引反查、鉴权并脱除嵌套合成秘密', async (t) => {
  const fixture = fixtureEnvironment()
  const httpSizeSession = '66666666-6666-4666-8666-666666666666'
  writeJsonl(path.join(fixture.home, '.codex', 'sessions', '2026', '07', '12', `rollout-${httpSizeSession}.jsonl`), [
    { type: 'session_meta', timestamp: new Date().toISOString(), payload: { id: httpSizeSession, cwd: fixture.projectA, model: 'test' } },
    ...Array.from({ length: 50 }, (_, index) => ({
      type: 'event_msg',
      timestamp: new Date(Date.now() + index).toISOString(),
      payload: { type: 'agent_message', message: `${index}:`.padEnd(8_000, 'x') },
    })),
  ])
  fs.mkdirSync(fixture.openclawDir, { recursive: true })
  fs.writeFileSync(path.join(fixture.openclawDir, 'openclaw.json'), JSON.stringify({
    gateway: { auth: { token: fixture.secret } },
    providers: { test: { apiKey: fixture.dashboardSecret } },
  }), { mode: 0o600 })
  const port = await freePort()
  const backendEnv = createIsolatedProcessEnv({
    isolationRoot: fixture.root,
    homeDir: fixture.home,
    overrides: {
      BACKEND_HOST: '127.0.0.1',
      BACKEND_PORT: String(port),
      FRONTEND_PORT: String(await freePort()),
    },
  })
  const child = spawn(process.execPath, ['scripts/unified-service.js'], {
    cwd: repo,
    env: backendEnv,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => stop(child))
  await waitForBackend(port)
  const localToken = fs.readFileSync(path.join(fixture.openclawDir, 'dashboard-local-token'), 'utf8').trim()
  const headers = { 'X-Dashboard-Token': localToken }
  const noToken = await request(port, `/api/session-observation/events?source=codex&sessionId=${encodeURIComponent(fixture.codexA)}`)
  assert.equal(noToken.status, 401)
  const list = await request(port, `/api/session-observation/sessions?source=codex&sessionId=${encodeURIComponent(fixture.codexA)}`, headers)
  assert.equal(list.status, 200)
  const rejectedPath = await request(port, `/api/session-observation/events?source=codex&sessionId=${encodeURIComponent(fixture.codexA)}&path=${encodeURIComponent(fixture.outside)}`, headers)
  assert.equal(rejectedPath.status, 400)
  const events = await request(port, `/api/session-observation/events?source=codex&sessionId=${encodeURIComponent(fixture.codexA)}`, headers)
  assert.equal(events.status, 200)
  assert.equal(events.body.includes(fixture.secret), false)
  assert.equal(events.body.includes(fixture.dashboardSecret), false)
  assert.equal(events.body.includes(fixture.outside), false)
  const unknown = await request(port, '/api/session-observation/events?source=codex&sessionId=unknown-session', headers)
  assert.equal(unknown.status, 400)
  const invalidCursor = await request(port, `/api/session-observation/events?source=codex&sessionId=${encodeURIComponent(fixture.codexA)}&cursor=123`, headers)
  assert.equal(invalidCursor.status, 400)
  const payload = JSON.parse(events.body)
  assert.equal(payload.readOnly, true)
  assert.ok(payload.events.length > 0)

  const bounded = await request(port, `/api/session-observation/events?source=codex&sessionId=${httpSizeSession}&limit=50`, headers)
  assert.equal(bounded.status, 200)
  assert.ok(Buffer.byteLength(bounded.body) <= 256 * 1024)
  const boundedPayload = JSON.parse(bounded.body)
  assert.equal(boundedPayload.responseSizeLimited, true)
  assert.ok(boundedPayload.events.length <= 50)
})
