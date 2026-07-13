import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { resolvePathWithinRoots } from './security/path-boundary.mjs'
import { redactBrowserPayload, redactKnownSecretText } from './security/output-redaction.mjs'

export const SESSION_SOURCES = Object.freeze(['openclaw', 'codex', 'claude-code'])
export const SESSION_EVENT_TYPES = Object.freeze([
  'user_message',
  'assistant_message',
  'thinking',
  'tool_call',
  'tool_result',
  'lifecycle_start',
  'lifecycle_complete',
  'lifecycle_error',
  'lifecycle_aborted',
  'artifact',
  'usage',
  'unknown',
])

const INDEX_TTL_MS = 5_000
const MAX_INDEX_FILES = 1_000
const MAX_SCOPE_SESSIONS = 150
const MAX_EVENT_LIMIT = 50
const DEFAULT_EVENT_LIMIT = 30
const REVERSE_READ_CHUNK_BYTES = 512 * 1024
const MAX_JSONL_LINE_BYTES = 8 * 1024 * 1024
const MAX_PAGE_READ_BYTES = 24 * 1024 * 1024
const MAX_PAGE_WINDOWS = 64
const MAX_PAGE_PROCESS_MS = 750
const MAX_EVENTS_PER_RECORD = 2_000
const MAX_RESPONSE_BYTES = 256 * 1024
const EVENT_RESPONSE_BUDGET_BYTES = 224 * 1024
const MAX_ARTIFACTS_PER_EVENT = 20
const SESSION_CACHE_MAX_ENTRIES = 128
const MAX_MESSAGE_CHARS = 8_000
const MAX_THINKING_CHARS = 6_000
const MAX_ARGUMENT_CHARS = 6_000
const MAX_RESULT_CHARS = 8_000
const MAX_TITLE_CHARS = 80
const DEFAULT_CURSOR_SECRET = crypto.randomBytes(32)

const CLIENT_LABELS = Object.freeze({
  openclaw: 'OpenClaw',
  codex: 'Codex',
  'claude-code': 'Claude Code',
})

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0))
}

function safeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeProjectPath(value) {
  const text = String(value || '').trim()
  if (!text || !path.isAbsolute(text) || text.includes('\0')) return ''
  return path.resolve(text)
}

function shortText(value, maxChars = MAX_MESSAGE_CHARS) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: `${text.slice(0, maxChars)}\n…[内容已截断]`, truncated: true }
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text')
    .map(block => String(block.text || ''))
    .filter(Boolean)
    .join('\n')
}

function summaryText(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((entry) => {
    if (typeof entry === 'string') return entry
    return entry?.text || entry?.summary || ''
  }).filter(Boolean).join('\n')
}

function stableHash(value, length = 24) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length)
}

function safeJson(value, secrets, maxChars) {
  let text = ''
  try {
    text = JSON.stringify(redactBrowserPayload(value, secrets), null, 2)
  } catch {
    text = String(value ?? '')
  }
  return shortText(redactKnownSecretText(text, secrets), maxChars)
}

function safePlainText(value, secrets, maxChars) {
  return shortText(redactKnownSecretText(String(value ?? ''), secrets), maxChars)
}

function fileTypeFromName(filename) {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, '')
  return ext || 'file'
}

function artifactMetadata(rawPath, entry, sourceTool) {
  const projectRoot = normalizeProjectPath(entry.projectPath)
  const candidateText = String(rawPath || '').trim()
  if (!projectRoot || !candidateText || candidateText.includes('\0')) return null
  try {
    const rootStat = fs.lstatSync(projectRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null
    const realRoot = resolvePathWithinRoots(projectRoot, [projectRoot], { mustExist: true })
    const candidate = path.isAbsolute(candidateText) ? candidateText : path.join(realRoot, candidateText)
    const resolved = resolvePathWithinRoots(candidate, [realRoot], { mustExist: false })
    const relative = path.relative(realRoot, resolved)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
    let exists = false
    let size = 0
    let updatedAt = ''
    try {
      const stat = fs.lstatSync(resolved)
      if (stat.isSymbolicLink() || !stat.isFile()) return null
      exists = true
      size = stat.size
      updatedAt = stat.mtime.toISOString()
    } catch (error) {
      if (error?.code !== 'ENOENT') return null
    }
    return {
      id: stableHash(`${entry.source}\0${entry.sessionId}\0${relative}\0${sourceTool}`),
      name: path.basename(resolved),
      type: fileTypeFromName(resolved),
      relativePath: relative.split(path.sep).join('/'),
      exists,
      size,
      updatedAt,
      sourceTool: String(sourceTool || ''),
      previewAvailable: false,
    }
  } catch {
    return null
  }
}

function structuredPathCandidates(toolName, value) {
  const normalizedTool = String(toolName || '').toLowerCase()
  if (!/(?:write|edit|patch|file|image|document|artifact|notebook)/.test(normalizedTool)) return []
  if (!value || typeof value !== 'object') return []
  const candidates = []
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 3) return
    for (const [key, child] of Object.entries(node)) {
      const normalizedKey = key.replace(/[-_]/g, '').toLowerCase()
      if (typeof child === 'string' && ['path', 'filepath', 'outputpath', 'savedpath', 'targetfile'].includes(normalizedKey)) {
        candidates.push(child)
      } else if (Array.isArray(child)) {
        for (const item of child) visit(item, depth + 1)
      } else if (child && typeof child === 'object') {
        visit(child, depth + 1)
      }
    }
  }
  visit(value)
  return [...new Set(candidates)]
}

function artifactsFromTool(toolName, input, entry) {
  return structuredPathCandidates(toolName, input)
    .slice(0, MAX_ARTIFACTS_PER_EVENT)
    .map(candidate => artifactMetadata(candidate, entry, toolName))
    .filter(Boolean)
}

function createUsageTotals() {
  return { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, rawCost: 0 }
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number >= 0) return number
  }
  return 0
}

export function extractObservedUsage(raw = {}, { cachedInputIncludedInInput = false } = {}) {
  const usage = raw || {}
  const inputRaw = firstNumber(usage.input, usage.input_tokens, usage.inputTokens, usage.prompt_tokens, usage.promptTokens)
  const cacheRead = firstNumber(usage.cacheRead, usage.cache_read, usage.cached_input_tokens, usage.cachedInputTokens)
  const cacheWrite = firstNumber(usage.cacheWrite, usage.cache_write, usage.cache_creation_input_tokens)
  const output = firstNumber(usage.output, usage.output_tokens, usage.outputTokens, usage.completion_tokens, usage.reasoning_output_tokens)
  const input = cachedInputIncludedInInput ? Math.max(0, inputRaw - cacheRead) : inputRaw
  const tokens = firstNumber(usage.totalTokens, usage.total_tokens, usage.total) || input + output + cacheRead + cacheWrite
  const costObject = usage.cost && typeof usage.cost === 'object' ? usage.cost : {}
  const rawCost = firstNumber(
    usage.totalCost,
    usage.total_cost,
    typeof usage.cost === 'number' ? usage.cost : undefined,
    costObject.total,
    costObject.total_cost,
  )
  return { tokens, input, output, cacheRead, cacheWrite, rawCost }
}

function addUsage(target, usage) {
  for (const key of ['tokens', 'input', 'output', 'cacheRead', 'cacheWrite', 'rawCost']) {
    target[key] += Number(usage?.[key]) || 0
  }
}

function usageHasValue(usage) {
  return ['tokens', 'input', 'output', 'cacheRead', 'cacheWrite', 'rawCost'].some(key => Number(usage?.[key]) > 0)
}

function structuredLifecycleStatus(obj, source) {
  const at = safeTimestamp(obj?.timestamp || obj?.ts || obj?.payload?.started_at || obj?.payload?.completed_at)
  if (source === 'openclaw') {
    if (obj?.type === 'session.started') return { status: 'running', label: '正在干活', at }
    if (obj?.type === 'session.ended') return { status: 'idle', label: '没干活', at }
    const stopReason = obj?.type === 'message' && obj?.message?.role === 'assistant' ? obj.message.stopReason : ''
    if (stopReason === 'error') return { status: 'error', label: '报错', at }
    if (stopReason === 'aborted') return { status: 'aborted', label: '已终止', at }
    if (stopReason === 'stop') return { status: 'idle', label: '没干活', at }
    return null
  }
  if (source === 'codex') {
    const type = obj?.payload?.type
    if (type === 'task_started') return { status: 'running', label: '正在干活', at }
    if (type === 'task_complete') return { status: 'idle', label: '没干活', at }
    if (type === 'turn_aborted') return { status: 'aborted', label: '已终止', at }
    if (['error', 'stream_error', 'task_failed'].includes(type)) return { status: 'error', label: '报错', at }
    return null
  }
  if (obj?.isApiErrorMessage === true || obj?.level === 'error' || obj?.subtype === 'api_error') {
    return { status: 'error', label: '报错', at }
  }
  if (obj?.type === 'assistant' && ['end_turn', 'stop_sequence', 'refusal'].includes(obj?.message?.stop_reason)) {
    return { status: 'idle', label: '没干活', at }
  }
  return null
}

function normalizeModel(value) {
  return String(value || '').trim() || 'unknown'
}

function sessionFallbackName(source, mtime) {
  const label = CLIENT_LABELS[source] || source
  const date = new Date(mtime || Date.now()).toISOString().slice(0, 10)
  return `${label} 对话 · ${date}`
}

function validSessionId(value) {
  const text = String(value || '').trim()
  if (!text || text.length > 200 || /[\0/\\]/.test(text)) return ''
  return text
}

function fileConversationId(file) {
  const base = path.basename(file, path.extname(file))
  const uuid = base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return validSessionId(uuid?.[0] || base)
}

function readSegment(file, start, length) {
  const fd = fs.openSync(file, 'r')
  const buffer = Buffer.alloc(length)
  try {
    const bytes = fs.readSync(fd, buffer, 0, length, start)
    return buffer.subarray(0, bytes).toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function inspectObjects(file) {
  const stat = fs.statSync(file)
  const size = stat.size
  const headSize = Math.min(size, 128 * 1024)
  const tailStart = Math.max(0, size - 128 * 1024)
  const text = `${readSegment(file, 0, headSize)}\n${tailStart ? readSegment(file, tailStart, size - tailStart) : ''}`
  const objects = []
  for (const line of text.split('\n')) {
    try { if (line.trim()) objects.push(JSON.parse(line)) } catch { /* tolerate partial and malformed lines */ }
  }
  return objects
}

function inspectOpenClawSession(file, agentId, workspace, stat) {
  let sessionId = fileConversationId(file)
  let title = ''
  let model = ''
  let projectPath = normalizeProjectPath(workspace)
  for (const obj of inspectObjects(file)) {
    if (obj.type === 'session') {
      sessionId = validSessionId(obj.id) || sessionId
      projectPath = projectPath || normalizeProjectPath(obj.cwd)
    }
    if (obj.type !== 'message') continue
    const msg = obj.message || {}
    if (!title && msg.role === 'user') title = contentText(msg.content)
    if (!model && msg.model) model = msg.model
  }
  return { sessionId, title, model, projectPath, agentId }
}

function inspectCodexSession(file, stat) {
  let sessionId = fileConversationId(file)
  let title = ''
  let model = ''
  let projectPath = ''
  for (const obj of inspectObjects(file)) {
    const payload = obj.payload || {}
    if (obj.type === 'session_meta') {
      sessionId = validSessionId(payload.id) || sessionId
      projectPath = projectPath || normalizeProjectPath(payload.cwd)
      model = model || payload.model || ''
    }
    if (obj.type === 'turn_context') {
      projectPath = projectPath || normalizeProjectPath(payload.cwd)
      model = model || payload.model || payload.collaboration_mode?.settings?.model || ''
    }
    if (!title && payload.type === 'user_message') title = payload.message || ''
  }
  return { sessionId, title, model, projectPath, agentId: '' }
}

function inspectClaudeSession(file, stat) {
  let sessionId = fileConversationId(file)
  let title = ''
  let customTitle = ''
  let aiTitle = ''
  let model = ''
  let projectPath = ''
  for (const obj of inspectObjects(file)) {
    sessionId = validSessionId(obj.sessionId) || sessionId
    projectPath = projectPath || normalizeProjectPath(obj.cwd)
    if (obj.type === 'custom-title') customTitle = obj.customTitle || obj.title || customTitle
    if (obj.type === 'ai-title') aiTitle = obj.aiTitle || obj.title || aiTitle
    const msg = obj.message || {}
    if (!title && obj.type === 'user') title = contentText(msg.content)
    if (!model && msg.model) model = msg.model
  }
  return { sessionId, title: customTitle || aiTitle || title, model, projectPath, agentId: '' }
}

function projectKeyFor(entry) {
  if (entry.source === 'openclaw') return stableHash(`openclaw\0agent\0${entry.agentId}`)
  return stableHash(`${entry.source}\0project\0${entry.projectPath || '(unscoped)'}`)
}

function publicEntry(entry, secrets = []) {
  return {
    source: entry.source,
    clientName: CLIENT_LABELS[entry.source],
    sessionId: entry.sessionId,
    name: safePlainText(entry.name, secrets, MAX_TITLE_CHARS).text,
    projectKey: entry.projectKey,
    projectPath: safePlainText(entry.projectPath, secrets, MAX_MESSAGE_CHARS).text,
    agentId: safePlainText(entry.agentId, secrets, 200).text,
    model: safePlainText(entry.model || 'unknown', secrets, 200).text,
    updatedAt: new Date(entry.mtimeMs).toISOString(),
    lastActivityMs: entry.mtimeMs,
  }
}

function collectFiles(root, accept, maxDepth) {
  const out = []
  const visit = (dir, depth) => {
    if (depth > maxDepth || out.length >= MAX_INDEX_FILES) return
    let entries = []
    try {
      const stat = fs.lstatSync(dir)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= MAX_INDEX_FILES) break
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        visit(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !accept(entry.name, full)) continue
      try {
        const resolved = resolvePathWithinRoots(full, [root], { mustExist: true })
        const stat = fs.lstatSync(resolved)
        if (stat.isFile() && !stat.isSymbolicLink()) out.push({ file: resolved, stat })
      } catch { /* fail closed */ }
    }
  }
  visit(root, 0)
  return out
}

function openClawSessionFile(name) {
  return name.endsWith('.jsonl')
    && !name.includes('.bak')
    && !name.includes('.tmp')
    && !name.includes('.reset')
    && !name.includes('.trajectory')
    && name !== 'sessions.json'
}

export function scanSessionIndex({ homeDir, openclawDir, openclawAgents = [] } = {}) {
  const home = path.resolve(homeDir || process.env.HOME || '')
  const clawRoot = path.resolve(openclawDir || path.join(home, '.openclaw'))
  const workspaceByAgent = new Map((openclawAgents || []).map(agent => [String(agent.id || ''), String(agent.workspace || '')]))
  const entries = []

  const openclawAgentsRoot = path.join(clawRoot, 'agents')
  let realOpenClawAgentsRoot = openclawAgentsRoot
  try { realOpenClawAgentsRoot = fs.realpathSync.native(openclawAgentsRoot) } catch { /* no indexed agents */ }
  for (const row of collectFiles(openclawAgentsRoot, openClawSessionFile, 4)) {
    const relative = path.relative(realOpenClawAgentsRoot, row.file).split(path.sep)
    const agentId = validSessionId(relative[0])
    if (!agentId || relative[1] !== 'sessions') continue
    const metadata = inspectOpenClawSession(row.file, agentId, workspaceByAgent.get(agentId), row.stat)
    if (!metadata.sessionId) continue
    entries.push({ source: 'openclaw', file: row.file, size: row.stat.size, mtimeMs: row.stat.mtimeMs, ...metadata })
  }

  for (const root of [path.join(home, '.codex', 'sessions'), path.join(home, '.codex', 'archived_sessions')]) {
    for (const row of collectFiles(root, name => /^rollout-.*\.jsonl$/.test(name), 9)) {
      const metadata = inspectCodexSession(row.file, row.stat)
      if (!metadata.sessionId) continue
      entries.push({ source: 'codex', file: row.file, size: row.stat.size, mtimeMs: row.stat.mtimeMs, ...metadata })
    }
  }

  const claudeRoot = path.join(home, '.claude', 'projects')
  for (const row of collectFiles(claudeRoot, name => name.endsWith('.jsonl'), 5)) {
    const metadata = inspectClaudeSession(row.file, row.stat)
    if (!metadata.sessionId) continue
    entries.push({ source: 'claude-code', file: row.file, size: row.stat.size, mtimeMs: row.stat.mtimeMs, ...metadata })
  }

  const byKey = new Map()
  for (const entry of entries) {
    entry.name = shortText(entry.title, MAX_TITLE_CHARS).text || sessionFallbackName(entry.source, entry.mtimeMs)
    entry.model = normalizeModel(entry.model)
    entry.projectKey = projectKeyFor(entry)
    const key = `${entry.source}:${entry.sessionId}`
    const existing = byKey.get(key)
    if (!existing || existing.mtimeMs < entry.mtimeMs) byKey.set(key, entry)
  }
  return [...byKey.values()].sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function forEachJsonlObject(file, callback) {
  const input = fs.createReadStream(file, { encoding: 'utf8' })
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    try { await callback(JSON.parse(line)) } catch (error) {
      if (error instanceof SyntaxError) continue
      throw error
    }
  }
}

export async function summarizeObservedSession(entry) {
  const total = createUsageTotals()
  const byModel = new Map()
  const seenClaudeMessages = new Set()
  let currentModel = normalizeModel(entry.model)
  let lifecycle = null
  const add = (modelValue, usage) => {
    if (!usageHasValue(usage)) return
    const model = normalizeModel(modelValue || currentModel)
    currentModel = model
    if (!byModel.has(model)) byModel.set(model, createUsageTotals())
    addUsage(byModel.get(model), usage)
    addUsage(total, usage)
  }

  await forEachJsonlObject(entry.file, async (obj) => {
    const lifecycleEvent = structuredLifecycleStatus(obj, entry.source)
    if (lifecycleEvent && lifecycleEvent.at >= (lifecycle?.lastActivityMs || 0)) {
      lifecycle = { ...lifecycleEvent, lastActivityMs: lifecycleEvent.at || entry.mtimeMs }
    }
    if (entry.source === 'openclaw') {
      if (obj.type !== 'message' || obj.message?.role !== 'assistant') return
      currentModel = normalizeModel(obj.message.model || currentModel)
      add(currentModel, extractObservedUsage(obj.message.usage || {}))
      return
    }
    if (entry.source === 'codex') {
      const payload = obj.payload || {}
      if (obj.type === 'session_meta' || obj.type === 'turn_context') {
        currentModel = normalizeModel(payload.model || payload.collaboration_mode?.settings?.model || currentModel)
      }
      if (obj.type !== 'event_msg' || payload.type !== 'token_count') return
      const raw = payload.info?.last_token_usage || payload.info?.total_token_usage
      add(currentModel, extractObservedUsage(raw || {}, { cachedInputIncludedInInput: true }))
      return
    }
    const message = obj.message || {}
    const raw = message.usage || obj.usage
    if (!raw) return
    const id = String(message.id || obj.uuid || `${obj.timestamp || ''}:${message.model || ''}`)
    if (seenClaudeMessages.has(id)) return
    seenClaudeMessages.add(id)
    add(message.model || obj.model || currentModel, extractObservedUsage(raw))
  })

  return {
    usage: total,
    byModel: [...byModel.entries()].map(([model, usage]) => ({ model, usage })),
    lifecycle: lifecycle || { status: 'idle', label: '没干活', lastActivityMs: entry.mtimeMs },
  }
}

function baseEvent(entry, offset, subIndex, nativeId, type, at) {
  return {
    id: stableHash(`${entry.source}\0${entry.sessionId}\0${offset}\0${subIndex}\0${nativeId || ''}\0${type}`),
    source: entry.source,
    sessionId: entry.sessionId,
    sequence: offset * 10_000 + subIndex,
    timestamp: at ? new Date(at).toISOString() : '',
    at,
    type,
    label: '',
    model: entry.model || 'unknown',
    content: '',
    contentTruncated: false,
    thinkingKind: '',
    toolCallId: '',
    toolName: '',
    toolState: '',
    argumentsSummary: '',
    argumentsTruncated: false,
    resultSummary: '',
    resultTruncated: false,
    isError: false,
    usage: null,
    artifacts: [],
  }
}

function eventWithText(event, value, secrets, maxChars) {
  const result = safePlainText(value, secrets, maxChars)
  event.content = result.text
  event.contentTruncated = result.truncated
  return event
}

function openClawEvents(obj, entry, offset, secrets) {
  const at = safeTimestamp(obj.timestamp || obj.ts)
  if (obj.type === 'session.started') {
    const event = baseEvent(entry, offset, 0, obj.runId, 'lifecycle_start', at)
    event.label = '会话开始'
    return [event]
  }
  if (obj.type === 'session.ended') {
    const event = baseEvent(entry, offset, 0, obj.runId, 'lifecycle_complete', at)
    event.label = '会话完成'
    return [event]
  }
  if (obj.type && obj.type !== 'message' && at) {
    const event = baseEvent(entry, offset, 0, obj.id || obj.runId, 'unknown', at)
    event.label = `OpenClaw 事件：${String(obj.type).slice(0, 80)}`
    return [event]
  }
  if (obj.type !== 'message' || !obj.message) return []
  const message = obj.message
  const model = normalizeModel(message.model || entry.model)
  if (message.role === 'user') {
    const event = baseEvent(entry, offset, 0, obj.id, 'user_message', at)
    event.label = '用户消息'
    event.model = model
    return [eventWithText(event, contentText(message.content), secrets, MAX_MESSAGE_CHARS)]
  }
  if (message.role === 'toolResult') {
    const event = baseEvent(entry, offset, 0, obj.id, 'tool_result', at)
    event.label = message.isError === true ? '工具执行错误' : '工具执行结果'
    event.model = model
    event.toolCallId = String(message.toolCallId || '')
    event.toolName = String(message.toolName || '')
    event.isError = message.isError === true
    const result = safeJson(message.content ?? message.result ?? '', secrets, MAX_RESULT_CHARS)
    event.resultSummary = result.text
    event.resultTruncated = result.truncated
    return [event]
  }
  if (message.role !== 'assistant') return []
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    const type = message.stopReason === 'error' ? 'lifecycle_error' : 'lifecycle_aborted'
    const event = baseEvent(entry, offset, 0, obj.id, type, at)
    event.label = type === 'lifecycle_error' ? '执行失败' : '执行已终止'
    event.model = model
    event.isError = type === 'lifecycle_error'
    return [event]
  }
  const events = []
  let subIndex = 0
  if (typeof message.content === 'string' && message.content.trim() && message.content !== 'NO_REPLY') {
    const event = baseEvent(entry, offset, subIndex++, obj.id, 'assistant_message', at)
    event.label = 'AI 回复'
    event.model = model
    events.push(eventWithText(event, message.content, secrets, MAX_MESSAGE_CHARS))
  }
  for (const part of Array.isArray(message.content) ? message.content : []) {
    if (part?.type === 'text' && String(part.text || '').trim() && part.text !== 'NO_REPLY') {
      const event = baseEvent(entry, offset, subIndex++, obj.id, 'assistant_message', at)
      event.label = 'AI 回复'
      event.model = model
      events.push(eventWithText(event, part.text, secrets, MAX_MESSAGE_CHARS))
    } else if (part?.type === 'thinking' && String(part.thinking || '').trim()) {
      const event = baseEvent(entry, offset, subIndex++, obj.id, 'thinking', at)
      event.label = '已记录的思考'
      event.model = model
      event.thinkingKind = 'recorded'
      events.push(eventWithText(event, part.thinking, secrets, MAX_THINKING_CHARS))
    } else if (part?.type === 'toolCall') {
      const event = baseEvent(entry, offset, subIndex++, obj.id, 'tool_call', at)
      event.label = '工具调用'
      event.model = model
      event.toolCallId = String(part.id || '')
      event.toolName = String(part.name || '')
      const args = part.arguments ?? part.input ?? part.partialArgs ?? {}
      const summary = safeJson(args, secrets, MAX_ARGUMENT_CHARS)
      event.argumentsSummary = summary.text
      event.argumentsTruncated = summary.truncated
      event.artifacts = artifactsFromTool(event.toolName, args, entry)
      events.push(event)
    }
  }
  if (message.stopReason === 'stop') {
    const event = baseEvent(entry, offset, subIndex, obj.id, 'lifecycle_complete', at)
    event.label = '本轮完成'
    event.model = model
    events.push(event)
  }
  return events
}

function codexEvents(obj, entry, offset, secrets) {
  const payload = obj.payload || {}
  const type = String(payload.type || '')
  const at = safeTimestamp(obj.timestamp || payload.started_at || payload.completed_at)
  const model = normalizeModel(payload.model || entry.model)
  const event = (eventType, nativeId = payload.id || payload.call_id || payload.turn_id) => {
    const result = baseEvent(entry, offset, 0, nativeId, eventType, at)
    result.model = model
    return result
  }
  if (type === 'user_message') {
    const result = event('user_message')
    result.label = '用户消息'
    return [eventWithText(result, payload.message, secrets, MAX_MESSAGE_CHARS)]
  }
  if (type === 'agent_message') {
    const result = event('assistant_message')
    result.label = 'AI 回复'
    return [eventWithText(result, payload.message || payload.content, secrets, MAX_MESSAGE_CHARS)]
  }
  if (type === 'reasoning' || type === 'agent_reasoning') {
    const text = type === 'agent_reasoning' ? String(payload.text || '') : summaryText(payload.summary)
    if (!text) return []
    const result = event('thinking')
    result.label = '思考摘要'
    result.thinkingKind = 'summary'
    return [eventWithText(result, text, secrets, MAX_THINKING_CHARS)]
  }
  if (type === 'task_started') {
    const result = event('lifecycle_start')
    result.label = '任务开始'
    return [result]
  }
  if (type === 'task_complete') {
    const result = event('lifecycle_complete')
    result.label = '任务完成'
    return [result]
  }
  if (type === 'turn_aborted') {
    const result = event('lifecycle_aborted')
    result.label = '任务已终止'
    return [result]
  }
  if (['error', 'stream_error', 'task_failed'].includes(type)) {
    const result = event('lifecycle_error')
    result.label = '执行失败'
    result.isError = true
    return [eventWithText(result, payload.message || payload.error || '', secrets, MAX_RESULT_CHARS)]
  }
  const callTypes = new Set(['function_call', 'custom_tool_call', 'tool_search_call', 'mcp_tool_call', 'mcp_tool_call_start', 'web_search_call', 'image_generation_call'])
  if (callTypes.has(type)) {
    const result = event('tool_call')
    result.label = '工具调用'
    result.toolCallId = String(payload.call_id || payload.id || '')
    result.toolName = String(payload.name || payload.namespace || payload.invocation?.tool || type)
    const args = payload.arguments ?? payload.input ?? payload.invocation?.arguments ?? {}
    const summary = safeJson(args, secrets, MAX_ARGUMENT_CHARS)
    result.argumentsSummary = summary.text
    result.argumentsTruncated = summary.truncated
    result.artifacts = artifactsFromTool(result.toolName, args, entry)
    return [result]
  }
  const resultTypes = new Set(['function_call_output', 'custom_tool_call_output', 'tool_search_output', 'mcp_tool_call_end', 'mcp_tool_call_output', 'web_search_end'])
  if (resultTypes.has(type)) {
    const result = event('tool_result')
    result.label = '工具执行结果'
    result.toolCallId = String(payload.call_id || payload.id || '')
    result.toolName = String(payload.name || payload.invocation?.tool || type)
    const raw = payload.output ?? payload.result ?? payload.execution ?? ''
    const summary = safeJson(raw, secrets, MAX_RESULT_CHARS)
    result.resultSummary = summary.text
    result.resultTruncated = summary.truncated
    return [result]
  }
  if (type === 'patch_apply_end') {
    const result = event('tool_result')
    result.label = payload.success === false ? '补丁应用失败' : '补丁应用结果'
    result.toolCallId = String(payload.call_id || '')
    result.toolName = 'apply_patch'
    result.isError = payload.success === false || payload.status === 'failed'
    const summary = safeJson({ status: payload.status, success: payload.success, stderr: payload.stderr }, secrets, MAX_RESULT_CHARS)
    result.resultSummary = summary.text
    result.resultTruncated = summary.truncated
    result.artifacts = artifactsFromTool('apply_patch', { changes: payload.changes }, entry)
    return [result]
  }
  if (type === 'image_generation_end') {
    const result = event('artifact')
    result.label = '图片产出'
    result.toolCallId = String(payload.call_id || '')
    result.toolName = 'image_generation'
    result.artifacts = [artifactMetadata(payload.saved_path, entry, 'image_generation')].filter(Boolean)
    return result.artifacts.length ? [result] : []
  }
  if (type === 'token_count') {
    const raw = payload.info?.last_token_usage || payload.info?.total_token_usage
    const usage = extractObservedUsage(raw || {}, { cachedInputIncludedInInput: true })
    if (!usageHasValue(usage)) return []
    const result = event('usage')
    result.label = 'Token 记录'
    result.usage = usage
    return [result]
  }
  if (type && at && !['message', 'thread_settings_applied'].includes(type)) {
    const result = event('unknown')
    result.label = `Codex 事件：${type.slice(0, 80)}`
    return [result]
  }
  return []
}

function claudeEvents(obj, entry, offset, secrets) {
  const at = safeTimestamp(obj.timestamp)
  if (obj.isApiErrorMessage === true || obj.level === 'error' || obj.subtype === 'api_error') {
    const event = baseEvent(entry, offset, 0, obj.uuid, 'lifecycle_error', at)
    event.label = '执行失败'
    event.isError = true
    return [event]
  }
  const message = obj.message || {}
  const blocks = Array.isArray(message.content) ? message.content : (typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : [])
  if (obj.type === 'user') {
    const events = []
    let subIndex = 0
    const toolResults = blocks.filter(block => block?.type === 'tool_result')
    for (const block of toolResults) {
      const event = baseEvent(entry, offset, subIndex++, obj.uuid, 'tool_result', at)
      event.label = block.is_error === true ? '工具执行错误' : '工具执行结果'
      event.model = normalizeModel(message.model || entry.model)
      event.toolCallId = String(block.tool_use_id || block.toolUseId || '')
      event.isError = block.is_error === true
      const summary = safeJson(block.content ?? '', secrets, MAX_RESULT_CHARS)
      event.resultSummary = summary.text
      event.resultTruncated = summary.truncated
      events.push(event)
    }
    const text = contentText(blocks.filter(block => block?.type !== 'tool_result'))
    if (text) {
      const event = baseEvent(entry, offset, subIndex, obj.uuid, 'user_message', at)
      event.label = '用户消息'
      event.model = normalizeModel(message.model || entry.model)
      events.push(eventWithText(event, text, secrets, MAX_MESSAGE_CHARS))
    }
    return events
  }
  if (obj.type !== 'assistant') {
    if (obj.type === 'system' && at) {
      const event = baseEvent(entry, offset, 0, obj.uuid, 'unknown', at)
      event.label = `Claude Code 事件：${String(obj.subtype || 'system').slice(0, 80)}`
      return [event]
    }
    return []
  }
  const events = []
  let subIndex = 0
  for (const block of blocks) {
    if (block?.type === 'text' && String(block.text || '').trim()) {
      const event = baseEvent(entry, offset, subIndex++, obj.uuid, 'assistant_message', at)
      event.label = 'AI 回复'
      event.model = normalizeModel(message.model || entry.model)
      events.push(eventWithText(event, block.text, secrets, MAX_MESSAGE_CHARS))
    } else if (block?.type === 'thinking' && String(block.thinking || '').trim()) {
      const event = baseEvent(entry, offset, subIndex++, obj.uuid, 'thinking', at)
      event.label = '已记录的思考'
      event.model = normalizeModel(message.model || entry.model)
      event.thinkingKind = 'recorded'
      events.push(eventWithText(event, block.thinking, secrets, MAX_THINKING_CHARS))
    } else if (block?.type === 'tool_use') {
      const event = baseEvent(entry, offset, subIndex++, obj.uuid, 'tool_call', at)
      event.label = '工具调用'
      event.model = normalizeModel(message.model || entry.model)
      event.toolCallId = String(block.id || '')
      event.toolName = String(block.name || '')
      const summary = safeJson(block.input || {}, secrets, MAX_ARGUMENT_CHARS)
      event.argumentsSummary = summary.text
      event.argumentsTruncated = summary.truncated
      event.artifacts = artifactsFromTool(event.toolName, block.input, entry)
      events.push(event)
    }
  }
  if (['end_turn', 'stop_sequence', 'refusal'].includes(message.stop_reason)) {
    const event = baseEvent(entry, offset, subIndex, obj.uuid, 'lifecycle_complete', at)
    event.label = '本轮完成'
    event.model = normalizeModel(message.model || entry.model)
    events.push(event)
  }
  return events
}

function mapObjectToEvents(obj, entry, offset, secrets) {
  if (entry.source === 'openclaw') return openClawEvents(obj, entry, offset, secrets)
  if (entry.source === 'codex') return codexEvents(obj, entry, offset, secrets)
  return claudeEvents(obj, entry, offset, secrets)
}

function cursorMac(entry, offset, eventEnd, mode, filterKey, secret) {
  return crypto.createHmac('sha256', secret)
    .update(`${entry.source}\0${entry.sessionId}\0${offset}\0${eventEnd}\0${mode}\0${filterKey}`)
    .digest('hex')
    .slice(0, 24)
}

function encodeEventCursor(entry, { offset, eventEnd = 0, mode = 'n' }, filterKey, secret) {
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0))
  const safeEventEnd = Math.max(0, Math.floor(Number(eventEnd) || 0))
  const mac = cursorMac(entry, safeOffset, safeEventEnd, mode, filterKey, secret)
  return `v1.${safeOffset.toString(36)}.${safeEventEnd.toString(36)}.${mode}.${mac}`
}

function decodeEventCursor(value, entry, filterKey, secret) {
  const match = String(value || '').match(/^v1\.([0-9a-z]+)\.([0-9a-z]+)\.([ns])\.([a-f0-9]{24})$/)
  if (!match) throw new Error('分页游标格式无效')
  const offset = Number.parseInt(match[1], 36)
  const eventEnd = Number.parseInt(match[2], 36)
  const mode = match[3]
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.size) throw new Error('分页游标位置无效')
  if (!Number.isSafeInteger(eventEnd) || eventEnd < 0 || eventEnd > MAX_EVENTS_PER_RECORD) throw new Error('分页游标事件位置无效')
  if (mode === 's' && eventEnd !== 0) throw new Error('分页游标状态无效')
  const expected = cursorMac(entry, offset, eventEnd, mode, filterKey, secret)
  const supplied = Buffer.from(match[4])
  const expectedBuffer = Buffer.from(expected)
  if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) {
    throw new Error('分页游标签名无效')
  }
  return { offset, eventEnd, mode }
}

function createReadBudget() {
  return {
    startedAt: Date.now(),
    physicalReadBytes: 0,
    windows: 0,
  }
}

function readBudgetReached(budget) {
  return budget.physicalReadBytes >= MAX_PAGE_READ_BYTES
    || budget.windows >= MAX_PAGE_WINDOWS
    || Date.now() - budget.startedAt >= MAX_PAGE_PROCESS_MS
}

function readReverseChunk(fd, end, budget) {
  if (end <= 0 || readBudgetReached(budget)) return null
  const remaining = MAX_PAGE_READ_BYTES - budget.physicalReadBytes
  const length = Math.min(REVERSE_READ_CHUNK_BYTES, end, remaining)
  if (length <= 0) return null
  const start = end - length
  const buffer = Buffer.allocUnsafe(length)
  const bytesRead = fs.readSync(fd, buffer, 0, length, start)
  budget.physicalReadBytes += bytesRead
  budget.windows += 1
  return { start, buffer: buffer.subarray(0, bytesRead) }
}

function createReverseRecordReader(fd, beforeOffset, budget) {
  let currentEnd = beforeOffset
  let bufferStart = beforeOffset
  let buffer = Buffer.alloc(0)

  const loadEarlier = () => {
    const chunk = readReverseChunk(fd, bufferStart, budget)
    if (!chunk) return false
    buffer = buffer.length ? Buffer.concat([chunk.buffer, buffer]) : chunk.buffer
    bufferStart = chunk.start
    return true
  }

  return {
    position() {
      return currentEnd
    },
    next() {
      let recordEnd = null
      let discardingOversized = false

      while (currentEnd > 0 || buffer.length > 0) {
        if (!discardingOversized) {
          while (buffer.length === 0 && bufferStart > 0) {
            if (!loadEarlier()) {
              return { incomplete: true, oversized: true, nextOffset: bufferStart, end: recordEnd ?? currentEnd }
            }
          }
          let effectiveEnd = buffer.length
          while (effectiveEnd > 0 && (buffer[effectiveEnd - 1] === 10 || buffer[effectiveEnd - 1] === 13)) effectiveEnd -= 1
          if (effectiveEnd !== buffer.length) {
            buffer = buffer.subarray(0, effectiveEnd)
            currentEnd = bufferStart + effectiveEnd
          }
          if (buffer.length === 0) {
            if (bufferStart === 0) return { eof: true }
            continue
          }
          if (recordEnd === null) recordEnd = currentEnd

          const newline = buffer.lastIndexOf(10)
          if (newline >= 0) {
            const start = bufferStart + newline + 1
            const lineBuffer = buffer.subarray(newline + 1)
            buffer = buffer.subarray(0, newline + 1)
            currentEnd = start
            return lineBuffer.length > MAX_JSONL_LINE_BYTES
              ? { incomplete: false, oversized: true, start, end: recordEnd, buffer: null }
              : { incomplete: false, oversized: false, start, end: recordEnd, buffer: lineBuffer }
          }
          if (buffer.length > MAX_JSONL_LINE_BYTES) {
            discardingOversized = true
            buffer = Buffer.alloc(0)
            currentEnd = bufferStart
          } else if (bufferStart === 0) {
            const lineBuffer = buffer
            buffer = Buffer.alloc(0)
            currentEnd = 0
            return lineBuffer.length > MAX_JSONL_LINE_BYTES
              ? { incomplete: false, oversized: true, start: 0, end: recordEnd, buffer: null }
              : { incomplete: false, oversized: false, start: 0, end: recordEnd, buffer: lineBuffer }
          } else {
            if (!loadEarlier()) {
              return { incomplete: true, oversized: true, nextOffset: bufferStart, end: recordEnd }
            }
            continue
          }
        }

        if (!discardingOversized) continue
        if (bufferStart <= 0) {
          currentEnd = 0
          return { incomplete: false, oversized: true, start: 0, end: recordEnd, buffer: null }
        }
        const chunk = readReverseChunk(fd, bufferStart, budget)
        if (!chunk) {
          return { incomplete: true, oversized: true, nextOffset: bufferStart, end: recordEnd }
        }
        const newline = chunk.buffer.lastIndexOf(10)
        if (newline >= 0) {
          const start = chunk.start + newline + 1
          buffer = chunk.buffer.subarray(0, newline + 1)
          bufferStart = chunk.start
          currentEnd = start
          return { incomplete: false, oversized: true, start, end: recordEnd, buffer: null }
        }
        bufferStart = chunk.start
        currentEnd = bufferStart
      }
      return { eof: true }
    },
  }
}

function skipOversizedRecord(fd, beforeOffset, budget) {
  let scanEnd = beforeOffset
  while (scanEnd > 0) {
    const chunk = readReverseChunk(fd, scanEnd, budget)
    if (!chunk) return { incomplete: true, nextOffset: scanEnd }
    const newline = chunk.buffer.lastIndexOf(10)
    if (newline >= 0) return { incomplete: false, nextOffset: chunk.start + newline + 1 }
    scanEnd = chunk.start
  }
  return { incomplete: false, nextOffset: 0 }
}

function oversizedRecordEvent(entry, offset, continuing = false) {
  const event = baseEvent(entry, offset, 0, 'oversized-jsonl-record', 'unknown', 0)
  event.label = continuing ? '超大事件正在安全跳过' : '事件过大，已跳过'
  event.content = continuing
    ? '单条记录超过安全读取边界，下一页将继续跳过，不会解析其中内容。'
    : `单条记录超过 ${Math.round(MAX_JSONL_LINE_BYTES / 1024 / 1024)} MB，未解析其中内容。`
  event.contentTruncated = true
  return event
}

function tooManyRecordEvents(entry, offset) {
  const event = baseEvent(entry, offset, 0, 'too-many-record-events', 'unknown', 0)
  event.label = '单条记录事件过多，已跳过'
  event.content = `单条记录产生的事件超过 ${MAX_EVENTS_PER_RECORD} 条，未展开其内容。`
  event.contentTruncated = true
  return event
}

function estimatedEventBlocks(obj, source) {
  if (source === 'openclaw' && obj?.type === 'message' && obj?.message?.role === 'assistant') {
    return Array.isArray(obj.message.content) ? obj.message.content.length + 1 : 2
  }
  if (source === 'claude-code' && ['assistant', 'user'].includes(obj?.type)) {
    return Array.isArray(obj?.message?.content) ? obj.message.content.length + 1 : 2
  }
  return 1
}

function eventMatchesFilter(event, allowedTypes, errorsOnly) {
  const typeMatches = allowedTypes.size === 0
    || allowedTypes.has(event.type)
    || (allowedTypes.has('artifact') && event.artifacts?.length > 0)
  if (!typeMatches) return false
  if (!errorsOnly) return true
  return event.isError === true || ['lifecycle_error', 'lifecycle_aborted'].includes(event.type)
}

function minimalToolRefs(obj, source) {
  if (source === 'openclaw') {
    if (obj.type !== 'message') return []
    const message = obj.message || {}
    if (message.role === 'assistant') {
      return (Array.isArray(message.content) ? message.content : [])
        .filter(part => part?.type === 'toolCall' && part.id)
        .map(part => ({ kind: 'call', id: String(part.id), error: false }))
    }
    if (message.role === 'toolResult' && message.toolCallId) {
      return [{ kind: 'result', id: String(message.toolCallId), error: message.isError === true }]
    }
    return []
  }
  if (source === 'codex') {
    const payload = obj.payload || {}
    const type = payload.type || ''
    const id = String(payload.call_id || payload.id || '')
    if (!id) return []
    if (['function_call', 'custom_tool_call', 'tool_search_call', 'mcp_tool_call', 'mcp_tool_call_start', 'web_search_call', 'image_generation_call'].includes(type)) {
      return [{ kind: 'call', id, error: false }]
    }
    if (['function_call_output', 'custom_tool_call_output', 'tool_search_output', 'mcp_tool_call_end', 'mcp_tool_call_output', 'patch_apply_end', 'web_search_end', 'image_generation_end'].includes(type)) {
      return [{ kind: 'result', id, error: payload.success === false || payload.status === 'failed' }]
    }
    return []
  }
  const message = obj.message || {}
  const blocks = Array.isArray(message.content) ? message.content : []
  if (obj.type === 'assistant') {
    return blocks.filter(block => block?.type === 'tool_use' && block.id)
      .map(block => ({ kind: 'call', id: String(block.id), error: false }))
  }
  if (obj.type === 'user') {
    return blocks.filter(block => block?.type === 'tool_result' && (block.tool_use_id || block.toolUseId))
      .map(block => ({ kind: 'result', id: String(block.tool_use_id || block.toolUseId), error: block.is_error === true }))
  }
  return []
}

async function buildToolPairIndex(entry) {
  const calls = new Set()
  const results = new Map()
  await forEachJsonlObject(entry.file, async (obj) => {
    for (const ref of minimalToolRefs(obj, entry.source)) {
      if (ref.kind === 'call') calls.add(ref.id)
      else results.set(ref.id, ref.error)
    }
  })
  return { calls, results }
}

function applyToolPairing(events, pairs) {
  return events.map((event) => {
    if (!event.toolCallId) return event
    if (event.type === 'tool_call') {
      event.toolState = pairs.results.has(event.toolCallId)
        ? (pairs.results.get(event.toolCallId) ? 'error' : 'completed')
        : 'waiting'
    } else if (event.type === 'tool_result') {
      event.toolState = pairs.calls.has(event.toolCallId) ? (event.isError ? 'error' : 'matched') : 'orphan'
    }
    return event
  })
}

export async function readObservedEventPage(entry, {
  cursor,
  limit = DEFAULT_EVENT_LIMIT,
  types = [],
  errorsOnly = false,
  secrets = [],
  pairIndex,
  cursorSecret = DEFAULT_CURSOR_SECRET,
} = {}) {
  const requestedTypes = [...new Set((types || []).filter(Boolean))]
  if (requestedTypes.some(type => !SESSION_EVENT_TYPES.includes(type))) throw new Error('事件类型筛选无效')
  const allowedTypes = new Set(requestedTypes)
  const eventLimit = Math.floor(clamp(limit || DEFAULT_EVENT_LIMIT, 1, MAX_EVENT_LIMIT))
  const filterKey = `${[...requestedTypes].sort().join(',')}|errors:${errorsOnly ? 1 : 0}`
  const initial = cursor === undefined || cursor === null || cursor === ''
    ? { offset: entry.size, eventEnd: 0, mode: 'n' }
    : decodeEventCursor(cursor, entry, filterKey, cursorSecret)
  let beforeOffset = initial.offset
  let resumeEventEnd = initial.eventEnd
  let skipMode = initial.mode === 's'
  const budget = createReadBudget()
  const selectedNewestFirst = []
  let selectedPayloadBytes = 0
  let nextCursor = null
  const pairs = pairIndex || await buildToolPairIndex(entry)
  let responseSizeLimited = false
  let scanLimited = false
  let oversizedRecords = 0
  const fd = fs.openSync(entry.file, 'r')
  let reader = skipMode ? null : createReverseRecordReader(fd, beforeOffset, budget)

  try {
    pagination: while (beforeOffset > 0) {
      if (readBudgetReached(budget)) {
        beforeOffset = reader?.position() ?? beforeOffset
        nextCursor = encodeEventCursor(entry, {
          offset: beforeOffset,
          eventEnd: resumeEventEnd,
          mode: skipMode ? 's' : 'n',
        }, filterKey, cursorSecret)
        scanLimited = true
        break
      }

      if (skipMode) {
        const skipped = skipOversizedRecord(fd, beforeOffset, budget)
        if (skipped.incomplete) {
          if (selectedNewestFirst.length < eventLimit) {
            const event = oversizedRecordEvent(entry, skipped.nextOffset, true)
            selectedNewestFirst.push({
              event,
              resumeCursor: encodeEventCursor(entry, { offset: beforeOffset }, filterKey, cursorSecret),
            })
          }
          nextCursor = encodeEventCursor(entry, { offset: skipped.nextOffset, mode: 's' }, filterKey, cursorSecret)
          scanLimited = true
          break
        }
        beforeOffset = skipped.nextOffset
        resumeEventEnd = 0
        skipMode = false
        reader = createReverseRecordReader(fd, beforeOffset, budget)
        continue
      }

      const record = reader.next()
      if (record.eof) break
      if (record.incomplete) {
        if (selectedNewestFirst.length >= eventLimit) {
          nextCursor = encodeEventCursor(entry, { offset: beforeOffset }, filterKey, cursorSecret)
        } else {
          const event = oversizedRecordEvent(entry, record.nextOffset, false)
          const eventBytes = Buffer.byteLength(JSON.stringify(event))
          if (selectedPayloadBytes + eventBytes <= EVENT_RESPONSE_BUDGET_BYTES) {
            selectedNewestFirst.push({
              event,
              resumeCursor: encodeEventCursor(entry, { offset: beforeOffset }, filterKey, cursorSecret),
            })
            selectedPayloadBytes += eventBytes
          }
          nextCursor = encodeEventCursor(entry, { offset: record.nextOffset, mode: 's' }, filterKey, cursorSecret)
          oversizedRecords += 1
        }
        scanLimited = true
        break
      }

      let recordEvents = []
      if (record.oversized) {
        recordEvents = [oversizedRecordEvent(entry, record.start)]
        oversizedRecords += 1
      } else {
        const text = record.buffer.toString('utf8').trim()
        if (text) {
          try {
            const obj = JSON.parse(text)
            recordEvents = estimatedEventBlocks(obj, entry.source) > MAX_EVENTS_PER_RECORD
              ? [tooManyRecordEvents(entry, record.start)]
              : mapObjectToEvents(obj, entry, record.start, secrets)
          } catch { /* one malformed line never invalidates the page */ }
        }
      }
      recordEvents = applyToolPairing(recordEvents, pairs)
        .filter(event => eventMatchesFilter(event, allowedTypes, errorsOnly))
      if (recordEvents.length > MAX_EVENTS_PER_RECORD) recordEvents = [tooManyRecordEvents(entry, record.start)]

      const endIndex = resumeEventEnd > 0 ? Math.min(resumeEventEnd, recordEvents.length) : recordEvents.length
      if (resumeEventEnd > recordEvents.length) throw new Error('分页游标与当前事件记录不匹配')
      for (let index = endIndex - 1; index >= 0; index -= 1) {
        const resumeCursor = encodeEventCursor(entry, {
          offset: record.end,
          eventEnd: index + 1,
        }, filterKey, cursorSecret)
        const event = recordEvents[index]
        const eventBytes = Buffer.byteLength(JSON.stringify(event))
        if (selectedNewestFirst.length >= eventLimit) {
          nextCursor = resumeCursor
          break pagination
        }
        if (selectedNewestFirst.length > 0 && selectedPayloadBytes + eventBytes > EVENT_RESPONSE_BUDGET_BYTES) {
          nextCursor = resumeCursor
          responseSizeLimited = true
          break pagination
        }
        selectedNewestFirst.push({ event, resumeCursor })
        selectedPayloadBytes += eventBytes
      }
      beforeOffset = record.start
      resumeEventEnd = 0
    }
  } finally {
    fs.closeSync(fd)
  }

  let selected = selectedNewestFirst.reverse()
  const createResult = () => ({
    events: selected.map(item => item.event),
    nextCursor,
    hasMore: Boolean(nextCursor),
    scannedBytes: budget.physicalReadBytes,
    scannedWindows: budget.windows,
    processingMs: Date.now() - budget.startedAt,
    responseBytes: 0,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    responseSizeLimited,
    scanLimited,
    oversizedRecords,
    responseLimited: true,
  })
  let result = createResult()
  let responseBytes = Buffer.byteLength(JSON.stringify(result))
  while (responseBytes > MAX_RESPONSE_BYTES && selected.length > 0) {
    const removed = selected.shift()
    nextCursor = removed.resumeCursor
    responseSizeLimited = true
    result = createResult()
    responseBytes = Buffer.byteLength(JSON.stringify(result))
  }
  result.responseBytes = responseBytes
  return result
}

function deriveSessionStatus(events, mtimeMs) {
  const latest = events[events.length - 1]
  if (!latest) return { status: 'idle', label: '没干活', lastActivityMs: mtimeMs }
  if (latest.type === 'lifecycle_error') return { status: 'error', label: '报错', lastActivityMs: latest.at || mtimeMs }
  if (latest.type === 'lifecycle_aborted') return { status: 'aborted', label: '已终止', lastActivityMs: latest.at || mtimeMs }
  const lastStart = [...events].reverse().find(event => event.type === 'lifecycle_start')
  const lastEnd = [...events].reverse().find(event => ['lifecycle_complete', 'lifecycle_error', 'lifecycle_aborted'].includes(event.type))
  if (lastStart && (!lastEnd || lastStart.sequence > lastEnd.sequence)) {
    return { status: 'running', label: '正在干活', lastActivityMs: latest.at || mtimeMs }
  }
  return { status: 'idle', label: '没干活', lastActivityMs: latest.at || mtimeMs }
}

export function sessionCapabilityMatrix() {
  return [
    {
      source: 'openclaw',
      clientName: 'OpenClaw',
      userMessages: true,
      assistantMessages: true,
      thinking: 'recorded',
      toolCalls: true,
      toolResults: true,
      lifecycle: true,
      tokenAndModel: true,
      artifacts: 'structured-only',
      control: false,
    },
    {
      source: 'codex',
      clientName: 'Codex',
      userMessages: true,
      assistantMessages: true,
      thinking: 'summary-only',
      toolCalls: true,
      toolResults: true,
      lifecycle: true,
      tokenAndModel: true,
      artifacts: 'structured-only',
      control: false,
    },
    {
      source: 'claude-code',
      clientName: 'Claude Code',
      userMessages: true,
      assistantMessages: true,
      thinking: 'recorded-when-provided',
      toolCalls: true,
      toolResults: true,
      lifecycle: true,
      tokenAndModel: true,
      artifacts: 'structured-only',
      control: false,
    },
  ]
}

function createFingerprintLru(maxEntries = SESSION_CACHE_MAX_ENTRIES) {
  const values = new Map()
  const touch = (file, entry) => {
    values.delete(file)
    values.set(file, entry)
  }
  const trim = () => {
    while (values.size > maxEntries) values.delete(values.keys().next().value)
  }
  return {
    async getOrCreate(file, fingerprint, factory) {
      const existing = values.get(file)
      if (existing?.fingerprint === fingerprint) {
        touch(file, existing)
        return existing.value
      }
      const entry = { fingerprint, value: Promise.resolve().then(factory) }
      touch(file, entry)
      trim()
      try {
        return await entry.value
      } catch (error) {
        if (values.get(file) === entry) values.delete(file)
        throw error
      }
    },
    delete(file) {
      values.delete(file)
    },
    prune(validFiles) {
      for (const file of values.keys()) {
        if (!validFiles.has(file)) values.delete(file)
      }
    },
    stats() {
      return { entries: values.size, maxEntries }
    },
  }
}

export function createSessionObservationStore({
  homeDir,
  openclawDir,
  getOpenClawAgents = () => [],
} = {}) {
  let indexAt = 0
  let index = []
  const summaryCache = createFingerprintLru()
  const pairCache = createFingerprintLru()
  const cursorSecret = crypto.randomBytes(32)

  const entryFingerprint = entry => `${entry.size}:${entry.mtimeMs}:${entry.ino || 0}`

  const refreshEntry = (entry) => {
    try {
      const stat = fs.lstatSync(entry.file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('会话文件无效')
      entry.size = stat.size
      entry.mtimeMs = stat.mtimeMs
      entry.ino = stat.ino
      return entry
    } catch {
      summaryCache.delete(entry.file)
      pairCache.delete(entry.file)
      throw new Error('会话文件不可用')
    }
  }

  const getIndex = () => {
    const now = Date.now()
    if (!index.length || now - indexAt > INDEX_TTL_MS) {
      index = scanSessionIndex({ homeDir, openclawDir, openclawAgents: getOpenClawAgents() })
      indexAt = now
      const validFiles = new Set(index.map(entry => entry.file))
      summaryCache.prune(validFiles)
      pairCache.prune(validFiles)
    }
    return index
  }

  const findEntry = (source, sessionId) => {
    if (!SESSION_SOURCES.includes(source)) throw new Error('会话来源无效')
    const id = validSessionId(sessionId)
    if (!id) throw new Error('会话 ID 格式无效')
    const entry = getIndex().find(row => row.source === source && row.sessionId === id)
    if (!entry) throw new Error('会话不存在或尚未纳入只读索引')
    return refreshEntry(entry)
  }

  const cachedSummary = async (entry) => {
    return summaryCache.getOrCreate(entry.file, entryFingerprint(entry), () => summarizeObservedSession(entry))
  }

  const cachedPairs = async (entry) => {
    return pairCache.getOrCreate(entry.file, entryFingerprint(entry), () => buildToolPairIndex(entry))
  }

  return {
    capabilities: sessionCapabilityMatrix,
    indexSnapshot(secrets = []) {
      return getIndex().map(entry => publicEntry(entry, secrets))
    },
    cacheStats() {
      return {
        summary: summaryCache.stats(),
        toolPairs: pairCache.stats(),
      }
    },
    async listSessions({ source, sessionIds = [], agentId = '', secrets = [] } = {}) {
      if (!SESSION_SOURCES.includes(source)) throw new Error('会话来源无效')
      const requestedIds = [...new Set((sessionIds || []).map(validSessionId).filter(Boolean))]
      if ((sessionIds || []).length !== requestedIds.length) throw new Error('会话 ID 列表包含无效或重复值')
      if (requestedIds.length > MAX_SCOPE_SESSIONS) throw new Error('一次最多查看 150 个会话')
      const safeAgentId = validSessionId(agentId)
      if (!requestedIds.length && !(source === 'openclaw' && safeAgentId)) throw new Error('必须提供已知会话 ID 或 OpenClaw Agent ID')

      let selected = getIndex().filter(entry => entry.source === source)
      if (requestedIds.length) {
        selected = requestedIds.map(id => selected.find(entry => entry.sessionId === id)).filter(Boolean)
        if (selected.length !== requestedIds.length) throw new Error('请求包含未知会话 ID')
      } else {
        selected = selected.filter(entry => entry.agentId === safeAgentId).slice(0, MAX_SCOPE_SESSIONS)
      }
      if (!selected.length) return { scopeId: '', sessions: [], source, clientName: CLIENT_LABELS[source] }
      const projectKeys = new Set(selected.map(entry => entry.projectKey))
      if (projectKeys.size !== 1) throw new Error('请求的会话不属于同一个项目或 Agent 范围')

      const sessions = []
      for (const entry of selected.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
        refreshEntry(entry)
        const summary = await cachedSummary(entry)
        const recent = await readObservedEventPage(entry, {
          limit: 20,
          secrets,
          pairIndex: await cachedPairs(entry),
          cursorSecret,
        })
        sessions.push({
          ...publicEntry(entry, secrets),
          ...(summary.lifecycle || deriveSessionStatus(recent.events, entry.mtimeMs)),
          usage: summary.usage,
          byModel: summary.byModel,
          thinkingAvailability: entry.source === 'codex' ? 'summary-only' : 'when-provided',
        })
      }
      return {
        scopeId: [...projectKeys][0],
        source,
        clientName: CLIENT_LABELS[source],
        projectPath: selected[0].projectPath,
        agentId: selected[0].agentId,
        sessions,
      }
    },
    async readEvents({ source, sessionId, cursor, limit, types, errorsOnly = false, secrets = [] } = {}) {
      const entry = findEntry(source, sessionId)
      const page = await readObservedEventPage(entry, {
        cursor,
        limit,
        types,
        errorsOnly,
        secrets,
        pairIndex: await cachedPairs(entry),
        cursorSecret,
      })
      return {
        session: publicEntry(entry, secrets),
        ...page,
      }
    },
  }
}
