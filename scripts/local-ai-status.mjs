import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const READ_TAIL = 256 * 1024
const READ_HEAD = 64 * 1024
export const LOCAL_AI_STATUS_DEFAULT_SINCE_MS = 24 * 60 * 60 * 1000
const MAX_RECENT_SESSIONS = 150

const HOME_DIR = os.homedir()
const CODEX_HOME = path.join(HOME_DIR, '.codex')
const CLAUDE_HOME = path.join(HOME_DIR, '.claude')

function readJsonlTail(filePath) {
  if (!filePath) return []
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    return []
  }

  const readStart = Math.max(0, stat.size - READ_TAIL)
  const buf = Buffer.alloc(Math.min(READ_TAIL, stat.size))
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, buf, 0, buf.length, readStart)
  } finally {
    fs.closeSync(fd)
  }

  const rawLines = buf.toString('utf8').split('\n')
  return readStart > 0 ? rawLines.slice(1) : rawLines
}

function readJsonlHead(filePath) {
  if (!filePath) return []
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    return []
  }

  const buf = Buffer.alloc(Math.min(READ_HEAD, stat.size))
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, buf, 0, buf.length, 0)
  } finally {
    fs.closeSync(fd)
  }
  return buf.toString('utf8').split('\n')
}

function parseTimestamp(value) {
  const at = Date.parse(String(value || ''))
  return Number.isFinite(at) ? at : 0
}

function pushEvent(events, event) {
  if (!event.at) return
  events.push(event)
}

function contentBlocks(content) {
  if (Array.isArray(content)) return content
  if (typeof content === 'string' && content.trim()) return [{ type: 'text', text: content }]
  return []
}

function hasUserText(content) {
  if (typeof content === 'string') return Boolean(content.trim())
  return contentBlocks(content).some(block => block?.type === 'text' && String(block.text || '').trim())
}

function eventId(payload = {}) {
  return payload.call_id || payload.callId || payload.id || ''
}

function safeJsonLines(lines) {
  const out = []
  for (const line of lines) {
    const trimmed = String(line || '').trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      // ignore bad lines
    }
  }
  return out
}

function normalizeMs(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function decodeProjectDirName(value) {
  const raw = String(value || '').trim()
  if (!raw) return '未知项目'
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function sessionObjects(filePath) {
  return safeJsonLines([
    ...readJsonlHead(filePath),
    ...readJsonlTail(filePath),
  ])
}

function conversationIdFromFile(filePath) {
  const base = path.basename(filePath, path.extname(filePath))
  const uuid = base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return uuid?.[0] || base
}

function claudeSessionMetadata(filePath) {
  const objects = sessionObjects(filePath)
  let conversationId = ''
  let cwd = ''
  for (const obj of objects) {
    if (!conversationId && obj?.sessionId) conversationId = String(obj.sessionId)
    if (!cwd && obj?.cwd) cwd = String(obj.cwd)
    if (conversationId && cwd) break
  }
  return { conversationId: conversationId || conversationIdFromFile(filePath), cwd }
}

function codexSessionMetadata(filePath) {
  const objects = sessionObjects(filePath)
  let conversationId = ''
  let cwd = ''
  for (const obj of objects) {
    const payload = obj?.payload || {}
    if (obj?.type === 'session_meta' || payload?.type === 'session_meta') {
      conversationId = String(payload.id || payload.sessionId || conversationId).trim()
      cwd = String(payload.cwd || cwd).trim()
    }
    if (!cwd) {
      const candidate = obj?.cwd || payload?.cwd || payload?.session_meta?.cwd || payload?.metadata?.cwd
      if (candidate) cwd = String(candidate)
    }
    if (conversationId && cwd) break
  }
  return { conversationId: conversationId || conversationIdFromFile(filePath), cwd }
}

function latestCwdFromJsonl(filePath) {
  const objects = safeJsonLines([
    ...readJsonlHead(filePath),
    ...readJsonlTail(filePath),
  ])
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const obj = objects[i]
    const cwd = obj?.cwd || obj?.payload?.cwd || obj?.payload?.session_meta?.cwd || obj?.payload?.metadata?.cwd
    if (cwd) return String(cwd)
    if (obj?.type === 'session_meta' && obj?.payload?.cwd) return String(obj.payload.cwd)
  }
  return ''
}

function collectRecentFiles(rootDir, acceptFile, { sinceMs = LOCAL_AI_STATUS_DEFAULT_SINCE_MS, maxDepth = 6, maxFiles = Infinity } = {}) {
  const sinceTime = Date.now() - sinceMs
  const out = []

  const visit = (dir, depth) => {
    if (depth > maxDepth) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'cache') continue
        visit(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !acceptFile(entry.name, full)) continue
      let stat
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.mtimeMs < sinceTime) continue
      out.push({ file: full, mtime: stat.mtimeMs })
    }
  }

  visit(rootDir, 0)
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, maxFiles)
}

export function findRecentClaudeSessions({ sinceMs = LOCAL_AI_STATUS_DEFAULT_SINCE_MS } = {}) {
  const root = path.join(CLAUDE_HOME, 'projects')
  const files = collectRecentFiles(
    root,
    name => name.endsWith('.jsonl'),
    { sinceMs, maxDepth: 3, maxFiles: MAX_RECENT_SESSIONS }
  )

  return files.map((entry) => {
    const metadata = claudeSessionMetadata(entry.file)
    const projectDirName = path.basename(path.dirname(entry.file))
    return {
      app: 'claude-code',
      conversationId: metadata.conversationId,
      project: metadata.cwd || latestCwdFromJsonl(entry.file) || decodeProjectDirName(projectDirName),
      file: entry.file,
      mtime: entry.mtime,
    }
  })
}

export function findRecentCodexSessions({ sinceMs = LOCAL_AI_STATUS_DEFAULT_SINCE_MS } = {}) {
  const root = path.join(CODEX_HOME, 'sessions')
  const files = collectRecentFiles(
    root,
    name => /^rollout-.*\.jsonl$/.test(name),
    { sinceMs, maxDepth: 8, maxFiles: MAX_RECENT_SESSIONS }
  )

  return files.map((entry) => {
    const metadata = codexSessionMetadata(entry.file)
    return {
      app: 'codex',
      conversationId: metadata.conversationId,
      project: metadata.cwd || path.dirname(entry.file),
      file: entry.file,
      mtime: entry.mtime,
    }
  })
}

export function readCodexProcesses() {
  const file = path.join(CODEX_HOME, 'process_manager', 'chat_processes.json')
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }

  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.processes)
      ? raw.processes
      : Object.values(raw || {})

  return rows
    .filter(Boolean)
    .map(row => ({
      cwd: String(row.cwd || row.project || row.projectPath || row.worktree || '').trim(),
      conversationId: String(row.conversationId || row.conversation_id || row.sessionId || row.session_id || '').trim(),
      turnId: String(row.turnId || row.turn_id || row.currentTurnId || row.current_turn_id || '').trim(),
      osPid: Number(row.osPid || row.os_pid || row.pid || 0) || 0,
      startedAtMs: normalizeMs(row.startedAtMs || row.started_at_ms || row.startedAt || row.started_at),
      updatedAtMs: normalizeMs(row.updatedAtMs || row.updated_at_ms || row.updatedAt || row.updated_at || row.lastActivityMs),
    }))
}

export function parseClaudeSessionEvents(filePath) {
  const events = []

  for (const line of readJsonlTail(filePath)) {
    const trimmed = String(line || '').trim()
    if (!trimmed) continue

    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }

    const at = parseTimestamp(obj.timestamp)
    if (!at) continue

    if (obj.isApiErrorMessage === true || obj.level === 'error' || obj.subtype === 'api_error') {
      pushEvent(events, { kind: 'error', at, source: 'claude-jsonl' })
      continue
    }

    const msg = obj.message || {}
    const blocks = contentBlocks(msg.content)

    if (obj.type === 'user') {
      const toolResults = blocks.filter(block => block?.type === 'tool_result')
      if (toolResults.length > 0) {
        for (const block of toolResults) {
          pushEvent(events, {
            kind: block.is_error === true ? 'error' : 'toolResult',
            at,
            source: 'claude-jsonl',
            toolCallId: block.tool_use_id || block.toolUseId || '',
          })
        }
        continue
      }

      if (hasUserText(msg.content)) {
        pushEvent(events, { kind: 'user', at, source: 'claude-jsonl' })
      }
      continue
    }

    if (obj.type === 'assistant') {
      for (const block of blocks) {
        if (block?.type === 'thinking') {
          pushEvent(events, { kind: 'thinking', at, source: 'claude-jsonl' })
        } else if (block?.type === 'tool_use') {
          pushEvent(events, {
            kind: 'toolCall',
            at,
            source: 'claude-jsonl',
            id: block.id || '',
          })
        } else if (block?.type === 'text' && String(block.text || '').trim()) {
          pushEvent(events, { kind: 'assistantText', at, source: 'claude-jsonl' })
        }
      }
    }
  }

  return events.sort((a, b) => a.at - b.at)
}

export function parseCodexSessionEvents(filePath) {
  const events = []

  const toolCallTypes = new Set([
    'function_call',
    'custom_tool_call',
    'tool_search_call',
    'mcp_tool_call',
    'mcp_tool_call_start',
    'mcp_tool_call_begin',
  ])
  const toolResultTypes = new Set([
    'function_call_output',
    'custom_tool_call_output',
    'tool_search_output',
    'mcp_tool_call_end',
    'mcp_tool_call_output',
    'mcp_tool_call_result',
  ])

  for (const line of readJsonlTail(filePath)) {
    const trimmed = String(line || '').trim()
    if (!trimmed) continue

    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }

    const at = parseTimestamp(obj.timestamp)
    if (!at) continue

    const payload = obj.payload || {}
    const type = payload.type || ''

    if (type === 'user_message') {
      pushEvent(events, { kind: 'user', at, source: 'codex-jsonl' })
    } else if (type === 'reasoning') {
      pushEvent(events, { kind: 'thinking', at, source: 'codex-jsonl' })
    } else if (type === 'agent_message') {
      pushEvent(events, { kind: 'assistantText', at, source: 'codex-jsonl' })
    } else if (toolCallTypes.has(type)) {
      pushEvent(events, {
        kind: 'toolCall',
        at,
        source: 'codex-jsonl',
        id: eventId(payload),
      })
    } else if (toolResultTypes.has(type)) {
      pushEvent(events, {
        kind: 'toolResult',
        at,
        source: 'codex-jsonl',
        toolCallId: eventId(payload),
      })
    } else if (type === 'turn_aborted') {
      pushEvent(events, { kind: 'aborted', at, source: 'codex-jsonl' })
    } else if (type === 'task_started') {
      pushEvent(events, { kind: 'turnStart', at, source: 'codex-jsonl' })
    } else if (type === 'task_complete') {
      pushEvent(events, { kind: 'turnEnd', at, source: 'codex-jsonl' })
    }
  }

  return events.sort((a, b) => a.at - b.at)
}
