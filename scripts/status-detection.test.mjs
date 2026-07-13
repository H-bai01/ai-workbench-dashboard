import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'

let tmpRoot
let tmpHome
let isolatedProcessEnv
let parseAgentSessionEvents
let classifyAgentUiStatus
const isolatedKeys = [
  'HOME',
  'USERPROFILE',
  'AI_WORKBENCH_HOME',
  'AI_WORKBENCH_LOCAL_TOKEN_FILE',
  'OPENCLAW_SKIP_DOTENV',
]
const originalEnvironment = new Map(isolatedKeys.map(key => [key, process.env[key]]))

function messageLine(message, timestamp) {
  return JSON.stringify({
    type: 'message',
    timestamp: new Date(timestamp).toISOString(),
    message,
  })
}

function writeSession(lines) {
  const file = path.join(tmpRoot, `session-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`)
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-status-detection-'))
  tmpHome = path.join(tmpRoot, 'home')
  fs.mkdirSync(tmpHome, { recursive: true })
  isolatedProcessEnv = createIsolatedProcessEnv({ isolationRoot: tmpRoot, homeDir: tmpHome })
  for (const key of isolatedKeys) process.env[key] = isolatedProcessEnv[key]

  const moduleUrl = pathToFileURL(path.join(process.cwd(), 'scripts', 'unified-service.js')).href
  const mod = await import(moduleUrl)
  parseAgentSessionEvents = mod.parseAgentSessionEvents
  classifyAgentUiStatus = mod.classifyAgentUiStatus
})

after(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test('状态判定同进程导入使用完整隔离环境', () => {
  assert.equal(process.env.HOME, tmpHome)
  assert.equal(process.env.USERPROFILE, tmpHome)
  assert.equal(process.env.AI_WORKBENCH_HOME, path.join(tmpHome, '.ai-workbench-test'))
  assert.equal(process.env.AI_WORKBENCH_LOCAL_TOKEN_FILE, path.join(tmpHome, '.ai-workbench-test', 'secrets', 'dashboard-local-token'))
  assert.equal(process.env.OPENCLAW_SKIP_DOTENV, '1')
})

test('assistant 正文关键词只解析为 assistantText', () => {
  const now = Date.now()
  const file = writeSession([
    messageLine({
      role: 'assistant',
      stopReason: 'stop',
      content: [{ type: 'text', text: '我把这个 error 修好了，上次失败的测试也通过了，取消和超时只是描述。' }],
    }, now),
  ])

  const events = parseAgentSessionEvents(file)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'assistantText')
  assert.notEqual(events[0].kind, 'error')
  assert.notEqual(events[0].kind, 'aborted')
})

test('toolResult 文本包含 error 但 isError 非 true 时仍为 toolResult', () => {
  const file = writeSession([
    messageLine({
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'grep',
      isError: false,
      content: [{ type: 'text', text: 'grep output: Error: this is just log text' }],
    }, Date.now()),
  ])

  const events = parseAgentSessionEvents(file)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'toolResult')
})

test('toolResult isError true 解析为 error', () => {
  const file = writeSession([
    messageLine({
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'read',
      isError: true,
      content: [{ type: 'text', text: 'real tool failure' }],
    }, Date.now()),
  ])

  const events = parseAgentSessionEvents(file)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'error')
})

test('assistant stopReason error 解析为 error', () => {
  const file = writeSession([
    messageLine({
      role: 'assistant',
      stopReason: 'error',
      content: [{ type: 'text', text: '[assistant turn failed before producing content]' }],
    }, Date.now()),
  ])

  const events = parseAgentSessionEvents(file)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'error')
})

test('assistant stopReason aborted 解析为 aborted', () => {
  const file = writeSession([
    messageLine({
      role: 'assistant',
      stopReason: 'aborted',
      content: [{ type: 'text', text: '' }],
    }, Date.now()),
  ])

  const events = parseAgentSessionEvents(file)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'aborted')
})

test('classify: 最近 assistantText 关键词不会变成 error/aborted', () => {
  const now = Date.now()
  const result = classifyAgentUiStatus([
    { kind: 'assistantText', at: now - 1000, source: 'session-jsonl' },
  ], { now, agentId: 'test-agent' })

  assert.equal(result.status, 'idle')
  assert.equal(result.label, '刚动过')
  assert.equal(result.lastEvent, 'assistantText')
  assert.notEqual(result.status, 'error')
  assert.notEqual(result.status, 'aborted')
})

test('classify: 最近 error 仍判为报错', () => {
  const now = Date.now()
  const result = classifyAgentUiStatus([
    { kind: 'error', at: now - 1000, source: 'session-jsonl' },
  ], { now, agentId: 'test-agent' })

  assert.equal(result.status, 'error')
  assert.equal(result.label, '报错')
})

test('classify: 最近 aborted 仍判为已终止', () => {
  const now = Date.now()
  const result = classifyAgentUiStatus([
    { kind: 'aborted', at: now - 1000, source: 'session-jsonl' },
  ], { now, agentId: 'test-agent' })

  assert.equal(result.status, 'aborted')
  assert.equal(result.label, '已终止')
})

test('classify: 用户任务长时间无回复仍触发超时兜底 error', () => {
  const now = Date.now()
  const result = classifyAgentUiStatus([
    { kind: 'user', at: now - 11 * 60 * 1000, source: 'session-jsonl' },
  ], { now, agentId: 'test-agent' })

  assert.equal(result.status, 'error')
  assert.equal(result.label, '报错')
  assert.equal(result.reason, '用户任务长时间没有回复，判定为异常等待')
})
