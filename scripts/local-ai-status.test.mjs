import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseClaudeSessionEvents, parseCodexSessionEvents } from './local-ai-status.mjs'

let tmpRoot

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-local-ai-status-'))
})

after(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
})

function writeJsonl(name, lines) {
  const file = path.join(tmpRoot, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`)
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

function claudeLine(type, timestamp, message = {}, extra = {}) {
  return JSON.stringify({ type, timestamp, message, ...extra })
}

function codexLine(payloadType, timestamp, payload = {}) {
  return JSON.stringify({
    type: 'event_msg',
    timestamp,
    payload: { type: payloadType, ...payload },
  })
}

test('Claude: 正常 user 到 assistant 文本，坏行被忽略并按时间排序', () => {
  const file = writeJsonl('claude-normal', [
    '{bad json',
    claudeLine('assistant', '2026-07-05T10:00:03.000Z', {
      content: [{ type: 'text', text: '完成了' }],
      stop_reason: 'end_turn',
    }),
    claudeLine('user', '2026-07-05T10:00:01.000Z', {
      content: [{ type: 'text', text: '帮我看一下' }],
    }),
  ])

  const events = parseClaudeSessionEvents(file)
  assert.deepEqual(events.map(e => e.kind), ['user', 'assistantText'])
  assert.equal(events[0].source, 'claude-jsonl')
})

test('Claude: assistant tool_use 与 user tool_result 配对，tool_result 不被误记为 user', () => {
  const file = writeJsonl('claude-tool', [
    claudeLine('assistant', '2026-07-05T10:01:00.000Z', {
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read' }],
      stop_reason: 'tool_use',
    }),
    claudeLine('user', '2026-07-05T10:01:02.000Z', {
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
    }),
  ])

  const events = parseClaudeSessionEvents(file)
  assert.deepEqual(events.map(e => e.kind), ['toolCall', 'toolResult'])
  assert.equal(events[0].id, 'toolu_1')
  assert.equal(events[1].toolCallId, 'toolu_1')
  assert.equal(events.some(e => e.kind === 'user'), false)
})

test('Claude: tool_result is_error true 解析为 error', () => {
  const file = writeJsonl('claude-tool-error', [
    claudeLine('user', '2026-07-05T10:02:00.000Z', {
      content: [{ type: 'tool_result', tool_use_id: 'toolu_err', is_error: true, content: 'failed' }],
    }),
  ])

  const events = parseClaudeSessionEvents(file)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'error')
  assert.equal(events[0].toolCallId, 'toolu_err')
})

test('Claude: 顶层 API error 解析为 error，thinking 与 refusal 文本保持正常事件', () => {
  const file = writeJsonl('claude-error-thinking', [
    claudeLine('assistant', '2026-07-05T10:03:00.000Z', {
      content: [
        { type: 'thinking', thinking: '分析中' },
        { type: 'text', text: '我不能执行这个请求' },
      ],
      stop_reason: 'refusal',
    }),
    claudeLine('assistant', '2026-07-05T10:03:02.000Z', {}, { isApiErrorMessage: true }),
  ])

  const events = parseClaudeSessionEvents(file)
  assert.deepEqual(events.map(e => e.kind), ['thinking', 'assistantText', 'error'])
})

test('Codex: 正常 user 到 assistant 文本，坏行被忽略并按时间排序', () => {
  const file = writeJsonl('codex-normal', [
    codexLine('agent_message', '2026-07-05T11:00:03.000Z', { message: '完成了' }),
    'not json',
    codexLine('user_message', '2026-07-05T11:00:01.000Z', { message: '帮我看一下' }),
  ])

  const events = parseCodexSessionEvents(file)
  assert.deepEqual(events.map(e => e.kind), ['user', 'assistantText'])
  assert.equal(events[0].source, 'codex-jsonl')
})

test('Codex: function_call 与 function_call_output 配对', () => {
  const file = writeJsonl('codex-tool', [
    codexLine('function_call', '2026-07-05T11:01:00.000Z', { call_id: 'call_1', name: 'shell' }),
    codexLine('function_call_output', '2026-07-05T11:01:02.000Z', { call_id: 'call_1', output: 'ok' }),
  ])

  const events = parseCodexSessionEvents(file)
  assert.deepEqual(events.map(e => e.kind), ['toolCall', 'toolResult'])
  assert.equal(events[0].id, 'call_1')
  assert.equal(events[1].toolCallId, 'call_1')
})

test('Codex: 工具输出即使带错误文本也默认 toolResult', () => {
  const file = writeJsonl('codex-tool-output', [
    codexLine('custom_tool_call_output', '2026-07-05T11:02:00.000Z', {
      call_id: 'call_error_text',
      output: 'Error: log text only',
    }),
  ])

  const events = parseCodexSessionEvents(file)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'toolResult')
  assert.equal(events[0].toolCallId, 'call_error_text')
})

test('Codex: reasoning、turn_aborted、task_started、task_complete 映射正确', () => {
  const file = writeJsonl('codex-status', [
    codexLine('task_started', '2026-07-05T11:03:00.000Z'),
    codexLine('reasoning', '2026-07-05T11:03:01.000Z'),
    codexLine('turn_aborted', '2026-07-05T11:03:02.000Z'),
    codexLine('task_complete', '2026-07-05T11:03:03.000Z'),
  ])

  const events = parseCodexSessionEvents(file)
  assert.deepEqual(events.map(e => e.kind), ['turnStart', 'thinking', 'aborted', 'turnEnd'])
})
