/**
 * AI 工作台总控 Unified Service
 * 合并服务：GPU VRAM + Usage Stats + Reset Agent
 * 默认端口：31022，可用 BACKEND_PORT 或 PORT 覆盖
 */

import http from 'http'
import https from 'https'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import readline from 'readline'
import { spawn, execFile, execFileSync } from 'child_process'
import iconv from 'iconv-lite'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { DatabaseSync } from 'node:sqlite'
import { handleCognitiveAnalyze, handleCognitiveHistory } from './cognitive-engine.mjs'
import { handleMemoryTree } from './memory-tree.mjs'
import { handlePersonality } from './personality-state.mjs'
import { getOrCreateLocalToken } from './dashboard-token.mjs'
import {
  assertAgentId,
  assertSafeArgumentValue,
  assertCronId,
  assertSafeCliIdentifier,
  assertSkillId,
  assertVersion,
  commandEnvironment,
  commandExists,
  openClawControlCapability,
  optionValue,
  parseCommandTemplate,
  runFileCommand,
} from './security/command-runner.mjs'
import { collectSensitiveValues, createReadOnlyDoctorSandbox, doctorCommand, redactDiagnosticResult, redactSensitiveText } from './security/diagnostics.mjs'
import { sealedFeatureForPath, sealedFeaturePayload } from './security/sealed-features.mjs'
import {
  discoverAuthorizedProjectRoots,
  findAuthorizedProject,
  resolveAuthorizedProject,
  resolveAuthorizedProjectOutput,
  resolveProjectDisplayNamesFile,
} from './security/project-paths.mjs'
import { decodeAndValidateRasterImage, validateRasterImageBuffer } from './security/raster-image.mjs'
import { installBrowserOutputRedaction, normalizeKnownSecrets } from './security/output-redaction.mjs'
import { readGatewayCredentials } from './security/gateway-credentials.mjs'
import { proxyGatewayControlRequest } from './security/gateway-control-proxy.mjs'
import { attachGatewayWebSocketRelay } from './security/gateway-websocket-relay.mjs'
import {
  ensureDirectoryWithinRoots,
  resolvePathWithinRoots,
  safeAtomicWriteFileWithinRoots,
  safeWriteFileWithinRoots,
} from './security/path-boundary.mjs'
import { assertNonSensitiveFilePath, sensitiveFileReason } from './security/sensitive-files.mjs'
import { normalizeGithubProxy, publicElectricityPerHour } from './security/public-settings.mjs'
import {
  findManagedSkillPaths,
  managedSkillParents,
  revalidateSkillPaths,
  resolveSkillReference,
  validateCliSkillPaths,
} from './security/skill-paths.mjs'
import {
  applyTrustedCorsHeaders,
  createLocalRequestPolicy,
  normalizeTrustedOrigin,
  sendBoundaryError,
  validateJsonWriteRequest,
  validateLocalToken,
  validateRequestContext,
} from './security/request-boundary.mjs'
import {
  LOCAL_AI_STATUS_DEFAULT_SINCE_MS,
  findRecentClaudeSessions,
  findRecentCodexSessions,
  parseClaudeSessionEvents,
  parseCodexSessionEvents,
  readCodexProcesses,
} from './local-ai-status.mjs'
import { createSessionObservationStore } from './session-observation.mjs'
import { GPT56_BILLING_MODELS, mergeBillingConfigWithDefaults, mergePriceStatus } from './billing-config.mjs'
import { installPrivacyConsole, installProcessErrorPrivacy } from '../src/utils/log-privacy.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const IS_DIRECT_EXECUTION = Boolean(process.argv[1] && path.resolve(process.argv[1]) === __filename)
if (IS_DIRECT_EXECUTION) {
  installPrivacyConsole(console, { scope: 'backend' })
  installProcessErrorPrivacy(process, console, { scope: 'backend' })
}
const SERVICE_STARTED_AT_MS = Date.now()

// 测试进程可显式跳过项目 .env，保证只使用临时 HOME / 模拟配置。
if (process.env.OPENCLAW_SKIP_DOTENV !== '1') {
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true })
}

// OpenClaw 数据目录
const OPENCLAW_DIR = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.openclaw')
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents')
const VOICE_DATA_DIR = path.join(OPENCLAW_DIR, 'dashboard-voice')
const VOICE_SAMPLES_DIR = path.join(VOICE_DATA_DIR, 'samples')
const VOICE_PROFILES_FILE = path.join(VOICE_DATA_DIR, 'voices.json')
const QUICK_MESSAGE_CONFIG_FILE = path.join(OPENCLAW_DIR, 'dashboard-quick-message.json')
const HOME_DIR = os.homedir()
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_DIR, 'openclaw.json')
const OLLAMA_URL = String(process.env.OPENCLAW_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
const LOCAL_TOKEN = getOrCreateLocalToken()
const LOCAL_REQUEST_POLICY = createLocalRequestPolicy(process.env)
const GATEWAY_CREDENTIALS = readGatewayCredentials({ env: process.env, homeDir: HOME_DIR })
const DASHBOARD_ROOT = path.join(__dirname, '..')
const DASHBOARD_DATA_ROOT = path.resolve(expandUserPath(
  process.env.OPENCLAW_DASHBOARD_DATA_ROOT || path.join(DASHBOARD_ROOT, 'data'),
))
const UPLOADS_ROOT = path.join(DASHBOARD_DATA_ROOT, 'uploads')

function expandUserPath(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text === '~') return HOME_DIR
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(HOME_DIR, text.slice(2))
  return text
}

function displayUserPath(value) {
  const resolved = path.resolve(expandUserPath(value))
  const rel = path.relative(HOME_DIR, resolved)
  if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return rel ? `~/${rel}` : '~'
  }
  return resolved
}

function isPathInside(childPath, parentPath) {
  if (!childPath || !parentPath) return false
  const child = path.resolve(childPath)
  const parent = path.resolve(parentPath)
  const rel = path.relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

function readOpenClawConfigSafe() {
  try {
    if (!fsSync.existsSync(OPENCLAW_CONFIG_PATH)) return {}
    const configFile = resolvePathWithinRoots(OPENCLAW_CONFIG_PATH, [OPENCLAW_DIR], { mustExist: true })
    return JSON.parse(fsSync.readFileSync(configFile, 'utf8'))
  } catch {
    return {}
  }
}

function browserOutputSecrets() {
  return normalizeKnownSecrets([
    GATEWAY_CREDENTIALS.token,
    LOCAL_TOKEN,
    ...collectSensitiveValues(readOpenClawConfigSafe()),
  ])
}

function getConfiguredOpenClawAgents() {
  const cfg = readOpenClawConfigSafe()
  const fromConfig = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : []
  const agents = []
  const seen = new Set()
  for (const agent of fromConfig) {
    let id
    try { id = assertAgentId(agent?.id) } catch { continue }
    if (seen.has(id)) continue
    seen.add(id)
    const workspace = expandUserPath(agent?.workspace || cfg?.agents?.defaults?.workspace || '')
    agents.push({
      id,
      name: String(agent?.identity?.name || agent?.name || id),
      workspace,
      avatar: agent?.identity?.avatar || '',
    })
  }

  if (agents.length > 0) return agents

  try {
    for (const entry of fsSync.readdirSync(AGENTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      let id
      try { id = assertAgentId(entry.name) } catch { continue }
      agents.push({ id, name: id, workspace: '', avatar: '' })
    }
  } catch { /* OpenClaw may not be installed yet */ }
  return agents
}

const SESSION_OBSERVATION_STORE = createSessionObservationStore({
  homeDir: HOME_DIR,
  openclawDir: OPENCLAW_DIR,
  getOpenClawAgents: getConfiguredOpenClawAgents,
})

const AGENT_UI_ACTIVE_MS = 8 * 1000
const AGENT_UI_RECENT_MS = 8 * 1000
const AGENT_UI_STALE_PENDING_MS = 10 * 60 * 1000
const AGENT_UI_DISPATCH_GRACE_MS = 30 * 1000
const AGENT_UI_DISPATCH_ERROR_MS = 60 * 1000
const CODEX_PROCESS_ACTIVE_MS = 30 * 1000
const agentDispatchRegistry = new Map()

function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function applyDispatchPendingStatus(agentId, baseStatus, now = Date.now()) {
  const pending = agentDispatchRegistry.get(agentId)
  if (!pending) return baseStatus

  const caughtBySession =
    (baseStatus.lastUserAt && baseStatus.lastUserAt >= pending.dispatchedAt - 1000) ||
    (baseStatus.lastAssistantAt && baseStatus.lastAssistantAt >= pending.dispatchedAt - 1000)

  if (caughtBySession) {
    agentDispatchRegistry.delete(agentId)
    return baseStatus
  }

  const pendingAge = now - pending.dispatchedAt
  if (pending.failedAt) {
    if (now - pending.failedAt > AGENT_UI_DISPATCH_ERROR_MS) {
      agentDispatchRegistry.delete(agentId)
      return baseStatus
    }

    return {
      ...baseStatus,
      status: 'error',
      label: '报错',
      source: 'dispatch-pending',
      reason: '任务已派发，但 session 没有写入新任务，派发进程已经结束',
      lastActivityMs: pending.failedAt,
      msAgo: Math.round(now - pending.failedAt),
      dispatchPid: pending.pid,
      dispatchMessagePreview: pending.messagePreview,
    }
  }

  const pidAlive = isPidAlive(pending.pid)
  if (!pidAlive && pendingAge > AGENT_UI_DISPATCH_GRACE_MS) {
    pending.failedAt = now
    return {
      ...baseStatus,
      status: 'error',
      label: '报错',
      source: 'dispatch-pending',
      reason: '任务已派发，但 session 没有写入新任务，且派发进程已结束',
      lastActivityMs: pending.dispatchedAt,
      msAgo: Math.round(pendingAge),
      dispatchPid: pending.pid,
      dispatchMessagePreview: pending.messagePreview,
    }
  }

  return {
    ...baseStatus,
    status: 'running',
    label: '正在干活',
    source: 'dispatch-pending',
    reason: '任务刚派发，等待 session 写入新任务',
    lastActivityMs: pending.dispatchedAt,
    msAgo: Math.round(pendingAge),
    dispatchPid: pending.pid,
    dispatchMessagePreview: pending.messagePreview,
  }
}

function isSessionJsonlFile(name) {
  return name.endsWith('.jsonl') &&
    !name.includes('.trajectory') &&
    !name.includes('.reset') &&
    !name.includes('.bak') &&
    !name.includes('.tmp') &&
    name !== 'sessions.json'
}

function findLatestAgentSessionFile(agentId) {
  const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions')
  let latestFile = null
  let latestMtime = 0
  let latestSize = 0

  try {
    for (const file of fsSync.readdirSync(sessionsDir)) {
      if (!isSessionJsonlFile(file)) continue
      const filePath = path.join(sessionsDir, file)
      const stat = fsSync.statSync(filePath)
      if (stat.mtimeMs > latestMtime) {
        latestFile = filePath
        latestMtime = stat.mtimeMs
        latestSize = stat.size
      }
    }
  } catch { /* sessions dir missing */ }

  return { latestFile, latestMtime, latestSize }
}

export function parseAgentSessionEvents(filePath) {
  if (!filePath) return []
  const READ_TAIL = 256 * 1024
  const stat = fsSync.statSync(filePath)
  const readStart = Math.max(0, stat.size - READ_TAIL)
  const buf = Buffer.alloc(Math.min(READ_TAIL, stat.size))
  const fd = fsSync.openSync(filePath, 'r')
  try {
    fsSync.readSync(fd, buf, 0, buf.length, readStart)
  } finally {
    fsSync.closeSync(fd)
  }

  const rawLines = buf.toString('utf-8').split('\n')
  const lines = readStart > 0 ? rawLines.slice(1) : rawLines
  const events = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj
    try { obj = JSON.parse(trimmed) } catch { continue }
    if (obj.type !== 'message' || !obj.message) continue

    const msg = obj.message
    const at = obj.timestamp ? Date.parse(obj.timestamp) : 0
    if (!at) continue

    if (msg.role === 'user') {
      events.push({ kind: 'user', at, source: 'session-jsonl' })
      continue
    }

    if (msg.role === 'assistant') {
      if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
        events.push({
          kind: msg.stopReason,
          at,
          source: 'session-jsonl',
        })
        continue
      }

      for (const part of (Array.isArray(msg.content) ? msg.content : [])) {
        if (part.type === 'thinking') {
          events.push({ kind: 'thinking', at, source: 'session-jsonl' })
        } else if (part.type === 'toolCall') {
          events.push({ kind: 'toolCall', at, source: 'session-jsonl', tool: part.name || '', id: part.id || '' })
        } else if (part.type === 'text') {
          const text = String(part.text || '').trim()
          if (!text || text === 'NO_REPLY') continue
          events.push({
            kind: 'assistantText',
            at,
            source: 'session-jsonl',
          })
        }
      }
      continue
    }

    if (msg.role === 'toolResult') {
      const errorLike = msg.isError === true
      events.push({
        kind: errorLike ? 'error' : 'toolResult',
        at,
        source: 'session-jsonl',
        tool: msg.toolName || '',
        toolCallId: msg.toolCallId || '',
      })
    }
  }

  return events.sort((a, b) => a.at - b.at)
}

export function classifyAgentUiStatus(events, { now = Date.now(), latestMtime = 0, latestFile = '', latestSize = 0, agentId = '' } = {}) {
  const latestEvent = events[events.length - 1] || null
  const lastUser = [...events].reverse().find(e => e.kind === 'user') || null
  const lastAssistant = [...events].reverse().find(e => ['assistantText', 'thinking', 'toolCall', 'toolResult', 'turnEnd'].includes(e.kind)) || null
  const lastFailure = [...events].reverse().find(e => e.kind === 'error' || e.kind === 'aborted') || null
  const lastTurnStart = [...events].reverse().find(e => e.kind === 'turnStart') || null
  const lastTurnEnd = [...events].reverse().find(e => e.kind === 'turnEnd') || null
  const openToolCalls = new Map()
  for (const event of events) {
    if (event.kind === 'toolCall' && event.id) {
      openToolCalls.set(event.id, event)
    } else if ((event.kind === 'toolResult' || event.kind === 'error') && event.toolCallId) {
      openToolCalls.delete(event.toolCallId)
    }
  }
  const latestOpenToolCall = [...openToolCalls.values()].sort((a, b) => b.at - a.at)[0] || null
  const lastActivityMs = latestEvent?.at || latestMtime
  const age = lastActivityMs ? now - lastActivityMs : Infinity

  let status = 'idle'
  let label = age <= AGENT_UI_RECENT_MS ? '刚动过' : '没干活'
  let source = latestEvent?.source || 'session-mtime'
  let reason = latestEvent ? `最近事件是 ${latestEvent.kind}` : '没有可解析事件，使用文件修改时间兜底'

  if (latestEvent?.kind === 'turnEnd') {
    status = 'idle'
    label = age <= AGENT_UI_RECENT_MS ? '刚动过' : '没干活'
    reason = '最近任务已经完成'
  } else if (latestEvent?.kind === 'error' && age <= AGENT_UI_RECENT_MS) {
    status = 'error'
    label = '报错'
    reason = '最近一轮事件显示错误'
  } else if (latestEvent?.kind === 'aborted' && age <= AGENT_UI_RECENT_MS) {
    status = 'aborted'
    label = '已终止'
    reason = '最近一轮事件显示终止或超时'
  } else if (lastFailure && (!latestEvent || lastFailure.at >= latestEvent.at) && now - lastFailure.at <= AGENT_UI_RECENT_MS) {
    status = lastFailure.kind === 'error' ? 'error' : 'aborted'
    label = lastFailure.kind === 'error' ? '报错' : '已终止'
    reason = '最近失败事件尚未被后续活动覆盖'
  } else if (lastTurnStart && (!lastTurnEnd || lastTurnStart.at > lastTurnEnd.at)) {
    const turnAge = now - lastTurnStart.at
    if (turnAge <= AGENT_UI_STALE_PENDING_MS) {
      status = 'running'
      label = '正在干活'
      reason = '任务已经开始，还没有完成事件'
    } else {
      status = 'error'
      label = '报错'
      reason = '任务开始后长时间没有完成事件，判定为异常等待'
    }
  } else if (lastUser && (!lastAssistant || lastUser.at > lastAssistant.at)) {
    const pendingAge = now - lastUser.at
    if (pendingAge <= AGENT_UI_STALE_PENDING_MS) {
      status = 'running'
      label = '正在干活'
      reason = '最近一条用户任务还没有对应回复'
    } else {
      status = 'error'
      label = '报错'
      reason = '用户任务长时间没有回复，判定为异常等待'
    }
  } else if (latestOpenToolCall) {
    const pendingToolAge = now - latestOpenToolCall.at
    if (pendingToolAge <= AGENT_UI_STALE_PENDING_MS) {
      status = 'running'
      label = '正在干活'
      reason = '工具调用还没有返回结果'
    } else {
      status = 'error'
      label = '报错'
      reason = '工具调用长时间没有返回结果，判定为异常等待'
    }
  } else if (
    latestEvent &&
    latestEvent.kind === 'thinking' &&
    age <= AGENT_UI_ACTIVE_MS
  ) {
    status = 'running'
    label = '正在干活'
    reason = `最近 ${Math.round(age / 1000)} 秒内仍有 ${latestEvent.kind} 事件`
  }

  return {
    id: agentId,
    status,
    label,
    source,
    reason,
    lastActivityMs,
    lastModifiedMs: latestMtime,
    msAgo: lastActivityMs ? Math.round(now - lastActivityMs) : null,
    sessionId: latestFile ? path.basename(latestFile, '.jsonl') : '',
    sessionPath: latestFile || '',
    fileSize: latestSize,
    lastEvent: latestEvent?.kind || null,
    lastUserAt: lastUser?.at || null,
    lastAssistantAt: lastAssistant?.at || null,
  }
}

function deriveAgentUiStatus(agentId, now = Date.now()) {
  const { latestFile, latestMtime, latestSize } = findLatestAgentSessionFile(agentId)
  if (!latestFile) {
    return {
      id: agentId,
      status: 'idle',
      label: '没干活',
      source: 'no-session',
      reason: '没有找到 session 文件',
      lastActivityMs: 0,
      lastModifiedMs: 0,
      msAgo: null,
    }
  }

  const events = parseAgentSessionEvents(latestFile)
  return classifyAgentUiStatus(events, { now, latestMtime, latestFile, latestSize, agentId })
}

function localAiStatusSinceMs(searchParams) {
  const hours = Number.parseFloat(searchParams.get('hours') || searchParams.get('sinceHours') || '')
  if (Number.isFinite(hours) && hours > 0) {
    return Math.min(7 * 24 * 60 * 60 * 1000, Math.max(60 * 1000, hours * 60 * 60 * 1000))
  }
  return LOCAL_AI_STATUS_DEFAULT_SINCE_MS
}

function toLocalAiStatusRow(session, status) {
  const lastActivityMs = status.lastActivityMs || session.mtime || 0
  const rawMsAgo = status.msAgo ?? (lastActivityMs ? Math.round(Date.now() - lastActivityMs) : null)
  return {
    app: session.app,
    conversationId: session.conversationId,
    project: session.project,
    status: status.status,
    label: status.label,
    reason: status.reason,
    lastActivityMs,
    msAgo: rawMsAgo == null ? null : Math.max(0, rawMsAgo),
  }
}

function isActiveCodexProcess(proc, now) {
  if ((!proc?.conversationId && !proc?.cwd) || !proc.turnId || !proc.updatedAtMs) return false
  if (now - proc.updatedAtMs > CODEX_PROCESS_ACTIVE_MS) return false
  if (proc.osPid && !isPidAlive(proc.osPid)) return false
  return true
}

function applyCodexProcessFallback(statuses, processes, now) {
  const byConversation = new Map()
  const byProject = new Map()
  for (const row of statuses) {
    if (row.app !== 'codex') continue
    if (row.conversationId) byConversation.set(row.conversationId, row)
    if (row.project) {
      const previous = byProject.get(row.project)
      if (!previous || (row.lastActivityMs || 0) > (previous.lastActivityMs || 0)) {
        byProject.set(row.project, row)
      }
    }
  }

  for (const proc of processes) {
    if (!isActiveCodexProcess(proc, now)) continue
    let existing = proc.conversationId ? byConversation.get(proc.conversationId) : null
    let matchedBy = existing ? 'conversationId' : ''
    if (!existing && proc.cwd) {
      existing = byProject.get(proc.cwd)
      if (existing) matchedBy = 'cwd'
    }
    const msAgo = Math.max(0, Math.round(now - proc.updatedAtMs))

    if (existing) {
      if (existing.status !== 'error' && existing.status !== 'aborted') {
        existing.status = 'running'
        existing.label = '正在干活'
        existing.reason = matchedBy === 'conversationId'
          ? 'Codex 进程文件显示这条对话的当前 turn 仍在活跃'
          : 'Codex 进程文件未匹配到会话 ID，已按目录关联最近一条对话'
        existing.lastActivityMs = Math.max(existing.lastActivityMs || 0, proc.updatedAtMs)
        existing.msAgo = Math.min(existing.msAgo ?? msAgo, msAgo)
      }
      continue
    }

    const row = {
      app: 'codex',
      conversationId: proc.conversationId,
      project: proc.cwd,
      status: 'running',
      label: '正在干活',
      reason: 'Codex 进程文件显示这条对话的当前 turn 仍在活跃',
      lastActivityMs: proc.updatedAtMs,
      msAgo,
    }
    statuses.push(row)
    if (row.conversationId) byConversation.set(row.conversationId, row)
    if (row.project) byProject.set(row.project, row)
  }
  return statuses
}

function getDashboardFileRoots() {
  const roots = [
    ...getConfiguredOpenClawAgents().map(agent => agent.workspace).filter(Boolean),
  ]
  const envRoots = String(process.env.OPENCLAW_DASHBOARD_FILE_ROOTS || '')
    .split(path.delimiter)
    .map(expandUserPath)
    .filter(Boolean)
  roots.push(...envRoots)

  const unique = []
  for (const root of roots) {
    const resolved = path.resolve(root)
    if (!unique.some(existing => existing === resolved)) unique.push(resolved)
  }
  return unique
}

function getOpenClawProjectRoots() {
  return discoverAuthorizedProjectRoots({
    explicitProjectsDir: expandUserPath(process.env.OPENCLAW_DASHBOARD_PROJECTS_DIR || ''),
    workspaces: getConfiguredOpenClawAgents().map(agent => agent.workspace).filter(Boolean),
    legacyRoot: path.join(HOME_DIR, 'clawd'),
  })
}

function findOpenClawProject(projectId) {
  return findAuthorizedProject(getOpenClawProjectRoots(), projectId)
}

const QUICK_MESSAGE_DEFAULT_TEMPLATES = [
  '请汇报当前状态',
  '请检查是否有异常',
  '请继续处理当前任务',
  '请总结最近进展',
]

// agent-full-history 的按文件解析缓存：path -> { mtimeMs, size, msgs:[...] }
// 稳态下 3 秒轮询只需 stat 各文件，仅重读 mtime/size 变化的那个活跃文件
const _agentHistFileCache = new Map()

// skill-readme 的技能 SKILL.md 路径缓存：skillName -> { skillDir, skillMdPath }
// 避免内置技能每次都调 openclaw CLI 解析路径
const _skillReadmePathCache = new Map()

async function resolveSkillPaths(skillName) {
  const safeSkillName = assertSkillId(skillName)
  const cachedPath = _skillReadmePathCache.get(safeSkillName)
  if (cachedPath) {
    try { return revalidateSkillPaths(cachedPath) } catch { _skillReadmePathCache.delete(safeSkillName) }
  }

  const configuredRoots = String(process.env.OPENCLAW_DASHBOARD_SKILL_ROOTS || '')
    .split(path.delimiter).map(expandUserPath).filter(Boolean)
  const local = findManagedSkillPaths(safeSkillName, managedSkillParents(HOME_DIR, configuredRoots))
  if (local) {
    _skillReadmePathCache.set(safeSkillName, local)
    return revalidateSkillPaths(local)
  }

  try {
    const result = await runOpenClawCommand(['skills', 'info', '--json', '--', safeSkillName], 15000)
    if (result.success && result.stdout) {
      const start = result.stdout.indexOf('{')
      const end = result.stdout.lastIndexOf('}')
      if (start >= 0 && end > start) {
        const info = JSON.parse(result.stdout.slice(start, end + 1))
        if (info.filePath) {
          const record = validateCliSkillPaths({
            skillMdPath: info.filePath,
            skillDir: info.baseDir || path.dirname(info.filePath),
          })
          _skillReadmePathCache.set(safeSkillName, record)
          return revalidateSkillPaths(record)
        }
      }
    }
  } catch (_) { /* unavailable or untrusted CLI path */ }
  return { trustedRoot: '', skillDir: '', skillMdPath: '' }
}

// Dashboard dist 备份目录（Version Rollback — 版本回退）
const DASHBOARD_BACKUPS_DIR = path.join(OPENCLAW_DIR, 'dashboard-backups')
const DASHBOARD_DIST_DIR = path.join(__dirname, '..', 'dist')
const DASHBOARD_REPO_DIR = path.join(__dirname, '..')

function runGit(repoDir, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: repoDir,
      shell: false,
      env: commandEnvironment(),
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout = '', stderr = '') => {
      const result = {
        stdout: String(stdout),
        stderr: String(stderr),
        code: error?.code ?? 0,
      }
      if (error && !allowFailure) {
        reject(new Error(String(stderr || error.message).trim()))
        return
      }
      resolve(result)
    })
  })
}

async function getGitTagNames(repoDir = DASHBOARD_REPO_DIR) {
  const result = await runGit(repoDir, ['tag', '-l'])
  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

async function getGitCommit(repoDir, ref) {
  const result = await runGit(repoDir, ['rev-list', '-n1', ref])
  return result.stdout.trim()
}

async function getGitHead(repoDir = DASHBOARD_REPO_DIR) {
  const result = await runGit(repoDir, ['rev-parse', 'HEAD'])
  return result.stdout.trim()
}

async function getGitBranch(repoDir = DASHBOARD_REPO_DIR) {
  const result = await runGit(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return result.stdout.trim()
}

async function gitCommitAll(repoDir, message) {
  await runGit(repoDir, ['add', '-A'])
  await runGit(repoDir, [
    '-c', 'user.name=AI Workbench Dashboard',
    '-c', 'user.email=ai-workbench-dashboard@local',
    'commit',
    '--allow-empty',
    '-m',
    message,
  ])
}

export async function listDashboardGitVersions(repoDir = DASHBOARD_REPO_DIR) {
  const head = await getGitHead(repoDir)
  const result = await runGit(repoDir, [
    'for-each-ref',
    '--sort=-creatordate',
    '--format=%(refname:short)|%(creatordate:short)|%(contents:subject)',
    'refs/tags',
  ])

  const versions = []
  for (const line of result.stdout.split('\n')) {
    const text = line.trim()
    if (!text) continue
    const [tag, date = '', ...messageParts] = text.split('|')
    if (!tag || !tag.startsWith('v')) continue
    let commit = ''
    try {
      commit = await getGitCommit(repoDir, tag)
    } catch { /* skip broken tag */ }
    versions.push({
      version: tag,
      date,
      message: messageParts.join('|'),
      isCurrent: !!commit && commit === head,
    })
  }
  return versions
}

export async function rollbackDashboardGitVersion(version, repoDir = DASHBOARD_REPO_DIR) {
  const requestedVersion = String(version || '').trim()
  if (!requestedVersion) {
    return { ok: false, statusCode: 400, error: 'version is required' }
  }
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(requestedVersion)) {
    return { ok: false, statusCode: 400, error: `invalid version tag: ${requestedVersion}` }
  }

  const tags = await getGitTagNames(repoDir)
  if (!tags.includes(requestedVersion)) {
    return { ok: false, statusCode: 400, error: `unknown version tag: ${requestedVersion}` }
  }

  const branch = await getGitBranch(repoDir)
  if (branch !== 'main') {
    return { ok: false, statusCode: 409, error: `git rollback must run on main branch, current branch is ${branch}` }
  }

  const targetCommit = await getGitCommit(repoDir, requestedVersion)
  const headBefore = await getGitHead(repoDir)
  if (targetCommit === headBefore) {
    return {
      ok: true,
      newCommit: headBefore,
      message: `当前已经是 ${requestedVersion}，无需回退`,
      backendRestartRecommended: false,
    }
  }

  const dirty = (await runGit(repoDir, ['status', '--porcelain'])).stdout.trim()
  if (dirty) {
    const stamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
    await gitCommitAll(repoDir, `自动存档：回退前保存当前状态 ${stamp}`)
  }

  await runGit(repoDir, ['read-tree', '--reset', '-u', requestedVersion])
  await gitCommitAll(repoDir, `回退到 ${requestedVersion}`)
  const newCommit = await getGitHead(repoDir)

  return {
    ok: true,
    newCommit,
    message: `已生成新提交，回退到 ${requestedVersion}`,
    backendRestartRecommended: true,
  }
}

// ── 递归复制目录（用于 dist 备份和恢复）──
async function copyDirRecursive(src, dest) {
  try {
    const destStat = await fs.lstat(dest)
    if (destStat.isSymbolicLink() || !destStat.isDirectory()) throw new Error('备份目标不是安全的普通目录')
    if ((await fs.readdir(dest)).length > 0) throw new Error('备份目标目录必须为空')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await fs.mkdir(dest, { mode: 0o700 })
  }
  const entries = await fs.readdir(src)
  for (const entry of entries) {
    const srcPath = path.join(src, entry)
    const destPath = path.join(dest, entry)
    const sourceStat = await fs.lstat(srcPath)
    if (sourceStat.isSymbolicLink()) throw new Error('备份目录包含不允许的符号链接')
    if (sourceStat.isDirectory()) {
      await copyDirRecursive(srcPath, destPath)
    } else if (sourceStat.isFile()) {
      await fs.copyFile(srcPath, destPath, fsSync.constants.COPYFILE_EXCL)
    } else {
      throw new Error('备份目录包含不支持的文件类型')
    }
  }
}

async function inspectSafeDirectoryTree(root) {
  const rootStat = await fs.lstat(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('备份不是安全的普通目录')
  let totalBytes = 0
  const walk = async (dir) => {
    const entries = await fs.readdir(dir)
    for (const entry of entries) {
      const entryPath = path.join(dir, entry)
      const stat = await fs.lstat(entryPath)
      if (stat.isSymbolicLink()) throw new Error('备份包含不允许的符号链接')
      if (stat.isDirectory()) await walk(entryPath)
      else if (stat.isFile()) totalBytes += stat.size
      else throw new Error('备份包含不支持的文件类型')
    }
  }
  await walk(root)
  return totalBytes
}

function ensureDistBackupsRoot() {
  return ensureDirectoryWithinRoots(DASHBOARD_BACKUPS_DIR, [OPENCLAW_DIR])
}

function resolveDistBackupId(backupId) {
  const id = String(backupId || '').trim()
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}_\d{10,}$/.test(id)) throw new Error('Invalid backup ID')
  ensureDistBackupsRoot()
  return resolvePathWithinRoots(path.join(DASHBOARD_BACKUPS_DIR, id), [DASHBOARD_BACKUPS_DIR], { mustExist: true })
}

// ── 启动时自动备份当前 dist（Startup Auto-Backup）──
async function backupDistOnStartup() {
  try {
    // 检查 dist 目录是否为不含链接的普通目录（开发模式下可能没有 dist）
    try { await inspectSafeDirectoryTree(DASHBOARD_DIST_DIR) } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    ensureDistBackupsRoot()
    // 读取当前版本号
    let version = 'unknown'
    try {
      const pkgContent = await fs.readFile(path.join(__dirname, '..', 'package.json'), 'utf-8')
      version = JSON.parse(pkgContent).version || 'unknown'
    } catch { /* 忽略 */ }
    // 检查是否已有同版本的近期备份（5 分钟内不重复备份）
    const entries = await fs.readdir(DASHBOARD_BACKUPS_DIR).catch(() => [])
    const now = Date.now()
    const FIVE_MIN = 5 * 60 * 1000
    for (const entry of entries) {
      const match = entry.match(/^(.+?)_(\d+)$/)
      if (match && match[1] === version && now - parseInt(match[2], 10) < FIVE_MIN) {
        console.log(`[dist-backup] 近期已备份过 v${version}，跳过`)
        return
      }
    }
    const backupName = `${version}_${now}`
    const backupPath = path.join(DASHBOARD_BACKUPS_DIR, backupName)
    await copyDirRecursive(DASHBOARD_DIST_DIR, backupPath)
    console.log(`[dist-backup] ✅ 已备份 dist v${version} → ${backupPath}`)
    // 保留最近 20 个备份，超出则删除最旧的
    const allEntries = await fs.readdir(DASHBOARD_BACKUPS_DIR).catch(() => [])
    const validEntries = allEntries
      .map(e => { const m = e.match(/^(.+?)_(\d+)$/); return m ? { name: e, ts: parseInt(m[2], 10) } : null })
      .filter(Boolean)
      .sort((a, b) => b.ts - a.ts)
    if (validEntries.length > 20) {
      for (const old of validEntries.slice(20)) {
        const oldPath = resolveDistBackupId(old.name)
        await fs.rm(oldPath, { recursive: true, force: true }).catch(() => {})
        console.log(`[dist-backup] 清理旧备份：${old.name}`)
      }
    }
  } catch (e) {
    console.warn(`[dist-backup] 备份失败（不影响服务启动）:`, e.message)
  }
}

// ===== Sprint 7: 全局搜索 SQLite 索引 =====
const SEARCH_DB_PATH = path.join(OPENCLAW_DIR, 'search-index.db')
let _searchDb = null
let _searchFtsAvailable = false

function getSearchDb() {
  if (_searchDb) return _searchDb
  try {
    _searchDb = new DatabaseSync(SEARCH_DB_PATH)
    _searchDb.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT DEFAULT '',
        file_path TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fp ON messages(file_path);
      CREATE INDEX IF NOT EXISTS idx_ts ON messages(timestamp);
      CREATE TABLE IF NOT EXISTS indexed_files (
        path TEXT PRIMARY KEY,
        mtime_ms INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      -- #9: 文档文件索引（.md 文件，管理目录 + agent 目录）
      CREATE TABLE IF NOT EXISTS docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL
      );
    `)
    try {
      _searchDb.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content, content='messages', content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS msg_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS msg_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
          content, title UNINDEXED, path UNINDEXED,
          content='docs', content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
          INSERT INTO docs_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
          INSERT INTO docs_fts(docs_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
      `)
      _searchFtsAvailable = true
    } catch {
      _searchFtsAvailable = false
    }
    return _searchDb
  } catch (e) {
    console.error('[search-db] init error:', e.message)
    _searchDb = null
    return null
  }
}

// #9: 索引 .md 文档文件
function indexDocFiles() {
  const db = getSearchDb()
  if (!db) return { error: 'SQLite unavailable' }

  const legacyClawd = path.join(HOME_DIR, 'clawd')
  const searchDirs = [
    ...getConfiguredOpenClawAgents()
      .map(agent => agent.workspace)
      .filter(Boolean)
      .map(dir => ({ dir, depth: 3 })),
    ...(fsSync.existsSync(legacyClawd)
      ? [
          { dir: legacyClawd, depth: 1 },
          { dir: path.join(legacyClawd, 'admin'), depth: 2 },
          { dir: path.join(legacyClawd, 'memory'), depth: 2 },
          { dir: path.join(legacyClawd, 'agents'), depth: 3 },
        ]
      : []),
  ]

  function collectMdFiles(dir, maxDepth, curDepth = 0) {
    const files = []
    try {
      for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath)
        else if (entry.isDirectory() && curDepth < maxDepth) files.push(...collectMdFiles(fullPath, maxDepth, curDepth + 1))
      }
    } catch { /* 目录不存在忽略 */ }
    return files
  }

  const getDoc = db.prepare('SELECT mtime_ms FROM docs WHERE path = ?')
  const upsertDoc = db.prepare('INSERT OR REPLACE INTO docs (path, title, content, mtime_ms) VALUES (?, ?, ?, ?)')
  const deleteDoc = db.prepare('DELETE FROM docs WHERE path = ?')

  let added = 0, updated = 0, skipped = 0

  for (const { dir, depth } of searchDirs) {
    for (const filePath of collectMdFiles(dir, depth)) {
      try {
        const stat = fsSync.statSync(filePath)
        const mtime = Math.round(stat.mtimeMs)
        const existing = getDoc.get(filePath)
        if (existing && existing.mtime_ms === mtime) { skipped++; continue }

        const raw = fsSync.readFileSync(filePath, 'utf8')
        const title = path.basename(filePath, '.md')
        const content = raw.slice(0, 8000) // 限制每个文件最多 8000 字符

        if (existing) { deleteDoc.run(filePath) }
        upsertDoc.run(filePath, title, content, mtime)
        if (existing) updated++; else added++
      } catch { /* 读取失败忽略 */ }
    }
  }

  db.prepare("INSERT OR REPLACE INTO meta VALUES ('docs_indexed_at', ?)").run(new Date().toISOString())
  const total = db.prepare('SELECT COUNT(*) as n FROM docs').get()
  return { added, updated, skipped, totalDocs: total?.n || 0 }
}

// #8: 技能调用统计（扫 session .jsonl 里的 tool_use 事件，内存缓存 30 分钟）
let _toolCallCache = null
let _toolCallCacheTime = 0
const TOOL_CALL_TTL = 30 * 60 * 1000 // 30 分钟

function buildToolCallStats(days = 30) {
  const now = Date.now()
  if (_toolCallCache && now - _toolCallCacheTime < TOOL_CALL_TTL) return _toolCallCache

  const since = now - days * 86400000
  const counts = new Map() // toolName -> { total, byAgent: Map }

  try {
    for (const agentId of fsSync.readdirSync(AGENTS_DIR)) {
      const sessDir = path.join(AGENTS_DIR, agentId, 'sessions')
      let files
      try { files = fsSync.readdirSync(sessDir) } catch { continue }

      for (const f of files) {
        if (!f.endsWith('.jsonl') || f.includes('.trajectory') || f.includes('.bak') || f.includes('.tmp')) continue
        const filePath = path.join(sessDir, f)
        try {
          const stat = fsSync.statSync(filePath)
          if (stat.mtimeMs < since) continue // 跳过超出时间范围的旧文件
          const lines = fsSync.readFileSync(filePath, 'utf8').split('\n')
          for (const line of lines) {
            if (!line.trim()) continue
            let d
            try { d = JSON.parse(line) } catch { continue }
            if (d.type !== 'message' || d.message?.role !== 'assistant') continue
            const content = d.message?.content
            if (!Array.isArray(content)) continue
            for (const c of content) {
              // OpenClaw session 格式：type='toolCall'（不是 'tool_use'）
              const isToolCall = c?.type === 'toolCall' || c?.type === 'tool_use'
              if (!isToolCall || !c.name) continue
              if (!counts.has(c.name)) counts.set(c.name, { total: 0, byAgent: new Map() })
              const entry = counts.get(c.name)
              entry.total++
              entry.byAgent.set(agentId, (entry.byAgent.get(agentId) || 0) + 1)
            }
          }
        } catch { }
      }
    }
  } catch { }

  const ranked = [...counts.entries()]
    .map(([name, data]) => ({ name, total: data.total, byAgent: Object.fromEntries(data.byAgent) }))
    .sort((a, b) => b.total - a.total)

  _toolCallCache = { ranked, generatedAt: now, days }
  _toolCallCacheTime = now
  return _toolCallCache
}

function doIndexMessages(opts = {}) {
  const { rebuild = false } = opts
  const db = getSearchDb()
  if (!db) return { error: 'SQLite unavailable' }

  if (rebuild) {
    db.exec('DELETE FROM messages; DELETE FROM indexed_files;')
    if (_searchFtsAvailable) db.exec("INSERT OR REPLACE INTO messages_fts(messages_fts) VALUES('rebuild')")
  }

  const getIndexed = db.prepare('SELECT mtime_ms FROM indexed_files WHERE path = ?')
  const upsertIndexed = db.prepare('INSERT OR REPLACE INTO indexed_files (path, mtime_ms, message_count) VALUES (?, ?, ?)')
  const deleteMsgs = db.prepare('DELETE FROM messages WHERE file_path = ?')
  const insertMsg = db.prepare('INSERT INTO messages (agent_id, session_id, role, content, timestamp, file_path) VALUES (?, ?, ?, ?, ?, ?)')

  let newFiles = 0, updatedFiles = 0, skippedFiles = 0, totalMessages = 0

  try {
    const agentIds = fsSync.readdirSync(AGENTS_DIR)
    for (const agentId of agentIds) {
      const sessDir = path.join(AGENTS_DIR, agentId, 'sessions')
      let files
      try { files = fsSync.readdirSync(sessDir) } catch { continue }

      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue
        if (f.includes('.trajectory') || f.includes('.bak') || f.includes('.tmp')) continue
        if (f === 'sessions.json') continue
        const filePath = path.join(sessDir, f)
        const sessionId = f.replace('.jsonl', '')
        try {
          const stat = fsSync.statSync(filePath)
          const mtime = Math.round(stat.mtimeMs)
          const indexed = getIndexed.get(filePath)
          if (indexed && indexed.mtime_ms === mtime) { skippedFiles++; continue }
          if (indexed) { deleteMsgs.run(filePath); updatedFiles++ }
          else { newFiles++ }

          const lines = fsSync.readFileSync(filePath, 'utf8').split('\n')
          let msgCount = 0
          db.exec('BEGIN')
          try {
            for (const line of lines) {
              if (!line.trim()) continue
              let d
              try { d = JSON.parse(line) } catch { continue }
              if (d.type !== 'message') continue
              const msg = d.message || {}
              const role = msg.role || ''
              if (role === 'system') continue
              let text = ''
              const content = msg.content
              if (typeof content === 'string') text = content
              else if (Array.isArray(content)) {
                text = content.map(c => {
                  if (typeof c === 'string') return c
                  if (c?.type === 'text') return c.text || ''
                  if (c?.type === 'tool_result') {
                    const inner = c.content
                    if (typeof inner === 'string') return inner
                    if (Array.isArray(inner)) return inner.map(x => x?.text || '').join(' ')
                  }
                  return ''
                }).join(' ')
              }
              text = text.trim()
              if (text.length < 3) continue
              if (text.length > 2000) text = text.slice(0, 2000)
              insertMsg.run(agentId, sessionId, role, text, d.timestamp || '', filePath)
              msgCount++
            }
            db.exec('COMMIT')
          } catch (e2) {
            db.exec('ROLLBACK')
            console.error('[search-index] tx error:', e2.message)
          }
          upsertIndexed.run(filePath, mtime, msgCount)
          totalMessages += msgCount
        } catch (e3) {
          console.warn('[search-index] file skip:', filePath, e3.message)
        }
      }
    }
  } catch (e) {
    return { error: e.message, newFiles, updatedFiles, skippedFiles, totalMessages }
  }

  const total = db.prepare('SELECT COUNT(*) as n FROM messages').get()
  db.prepare("INSERT OR REPLACE INTO meta VALUES ('last_indexed_at', ?)").run(new Date().toISOString())
  return { newFiles, updatedFiles, skippedFiles, totalMessages, totalInDb: total?.n || 0 }
}
// ===== END Sprint 7 init =====

// 端口号
const PORT = Number.parseInt(process.env.BACKEND_PORT || process.env.PORT || '31022', 10)
const HOST = process.env.BACKEND_HOST || '127.0.0.1'

// 缓存结果
let cachedUsageResult = null
let lastUsageUpdate = 0
const CACHE_TTL = 10000 // 10 秒缓存

// 版本号
const openclawVersion = process.env.OPENCLAW_VERSION || 'unknown'

function parseVersion(value) {
  const match = String(value || '').match(/(\d{4}\.\d+\.\d+(?:[-.a-zA-Z0-9]*)?)/)
  return match ? match[1] : ''
}

function readGatewayServiceVersion() {
  const fromEnv = parseVersion(process.env.OPENCLAW_SERVICE_VERSION)
  if (fromEnv) return { version: fromEnv, source: 'env:OPENCLAW_SERVICE_VERSION' }

  const serviceEnvPath = path.join(OPENCLAW_DIR, 'service-env', 'ai.openclaw.gateway.env')
  try {
    const content = fsSync.readFileSync(serviceEnvPath, 'utf8')
    const match = content.match(/OPENCLAW_SERVICE_VERSION=['"]?([^'"\n]+)['"]?/)
    const version = parseVersion(match?.[1])
    if (version) return { version, source: serviceEnvPath }
  } catch { /* ignore */ }

  const configPath = process.env.OPENCLAW_CONFIG_PATH || path.join(OPENCLAW_DIR, 'openclaw.json')
  try {
    const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'))
    const version = parseVersion(config?.meta?.lastTouchedVersion)
      || parseVersion(config?.wizard?.lastRunVersion)
    if (version) return { version, source: configPath }
  } catch { /* ignore */ }

  return null
}

// Gateway 凭据只在服务端读取；不再接受会被打入浏览器包的 VITE_ 凭据。
if (GATEWAY_CREDENTIALS.token) console.log(`[Auth] Gateway credential configured (${GATEWAY_CREDENTIALS.source})`)
else console.warn('[Auth] Gateway credential missing; Gateway control requests will be unavailable')

// Windows 代码页 → iconv-lite 编码名映射
const CP_TO_ENCODING = {
  437: 'cp437',
  65001: 'utf8',
  936: 'gbk',
  932: 'shiftjis',
  949: 'euc-kr',
  950: 'big5',
  850: 'cp850',
  1252: 'cp1252',
  20127: 'ascii',
}

let cachedSystemEncoding = null

/**
 * 检测 Windows 系统活动 OEM 代码页，返回 iconv-lite 编码名
 * chcp 65001 只影响控制台，不影响管道输出（管道始终使用 OEM 代码页）
 * 因此必须通过 chcp.com 检测实际代码页，用 iconv-lite 正确解码
 */
function detectSystemEncoding() {
  if (cachedSystemEncoding) return cachedSystemEncoding
  cachedSystemEncoding = 'utf8'
  if (os.platform() !== 'win32') return cachedSystemEncoding
  try {
    const output = execFileSync('chcp.com', [], {
      encoding: 'utf8',
      timeout: 3000,
      shell: false,
      env: commandEnvironment(),
    })
    const match = output.match(/(\d+)/)
    const cp = match ? parseInt(match[1], 10) : 0
    cachedSystemEncoding = CP_TO_ENCODING[cp] || 'utf8'
    console.log(`[System] Windows 代码页: ${cp} → 编码: ${cachedSystemEncoding}`)
  } catch (e) {
    // 默认使用 utf8
  }
  return cachedSystemEncoding
}

/**
 * 解码子进程输出 Buffer
 * 优先尝试 UTF-8（Node.js CLI 工具输出），若含替换字符则回退到系统编码
 */
function decodeBuffer(buf) {
  if (!buf || buf.length === 0) return ''
  if (os.platform() !== 'win32') return buf.toString('utf8')
  const utf8Result = buf.toString('utf8')
  // 检测是否包含 U+FFFD（替换字符）—— 说明不是合法 UTF-8
  if (!utf8Result.includes('\uFFFD')) {
    return utf8Result
  }
  // 回退到系统代码页编码
  const enc = detectSystemEncoding()
  if (enc === 'utf8') return utf8Result
  try {
    return iconv.decode(buf, enc)
  } catch (e) {
    return utf8Result
  }
}

// ============================================
// 版本管理功能
// ============================================

// 缓存文件路径：public/versions-cache.json
const VERSIONS_CACHE_PATH = path.join(__dirname, '..', 'public', 'versions-cache.json')

// 并发锁：防止并发操作
let syncingVersions = false
let switchingVersion = false

/**
 * 读取版本缓存文件
 */
async function readVersionsCache() {
  try {
    const content = await fs.readFile(VERSIONS_CACHE_PATH, 'utf-8')
    const data = JSON.parse(content)
    return data
  } catch (e) {
    return { lastSync: null, source: null, versions: [] }
  }
}

/**
 * 原子写入版本缓存（.tmp + rename）
 */
async function writeVersionsCache(data) {
  const tmpPath = VERSIONS_CACHE_PATH + '.tmp'
  const dir = path.dirname(VERSIONS_CACHE_PATH)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmpPath, VERSIONS_CACHE_PATH)
}

/**
 * 清理 GitHub release body：去除 Markdown 标记，合并多余换行和空白
 */
function cleanReleaseBody(body) {
  if (!body || typeof body !== 'string') return ''
  return body
    .replace(/#{1,6}\s?/g, '')           // 移除 Markdown 标题标记 # ## ###
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
    .replace(/[*_~`]/g, '')              // 移除加粗/斜体/代码标记
    .replace(/^-+\s+/gm, '• ')           // 列表 - → •
    .replace(/\n{2,}/g, '\n')            // 合并多余换行
    .replace(/\r/g, '')                  // 移除 \r
    .trim()
}

/**
 * 从 GitHub Releases API 拉取版本列表（含镜像站回退，自动分页获取全部）
 */
async function fetchReleasesFromGitHub() {
  const officialBase = 'https://api.github.com/repos/openclaw/openclaw/releases?per_page=100'
  const proxyBase = normalizeGithubProxy(process.env.OPENCLAW_GITHUB_PROXY)
  const proxyUrl = proxyBase ? `${proxyBase}/${officialBase}` : ''

  // 分页拉取所有版本
  async function fetchAllReleases(basePage) {
    let allReleases = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const pageUrl = `${basePage}&page=${page}`
      const data = await fetchWithTimeout(pageUrl, 30000)
      const releases = JSON.parse(data)

      if (!Array.isArray(releases) || releases.length === 0) {
        hasMore = false
        break
      }

      allReleases = allReleases.concat(releases)

      // GitHub 返回少于 per_page 说明已经是最后一页
      if (releases.length < 100) {
        hasMore = false
      } else {
        page++
      }
    }

    console.log(`[Version Sync] 共拉取 ${allReleases.length} 条 release（${page} 页）`)
    return allReleases
  }

  // 1. 尝试官方 API
  try {
    const releases = await fetchAllReleases(officialBase)
    const source = 'github-api'

    const versions = releases
      .filter(r => !r.draft)
      .map(r => ({
        version: r.tag_name.replace(/^v/, ''),
        name: r.name || r.tag_name,
        description: cleanReleaseBody(r.body),
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        htmlUrl: r.html_url
      }))

    return { versions, source }
  } catch (e) {
    if (!proxyUrl) {
      throw new Error(`无法从 GitHub 官方 API 拉取版本列表，且未配置 OPENCLAW_GITHUB_PROXY: ${e.message}`)
    }
    console.log(`[Version Sync] 官方 API 失败，尝试 GitHub 代理: ${e.message}`)
  }

  // 2. 仅在部署者明确配置时回退到 GitHub 代理。
  try {
    const releases = await fetchAllReleases(proxyUrl)
    const source = 'github-proxy'

    const versions = releases
      .filter(r => !r.draft)
      .map(r => ({
        version: r.tag_name.replace(/^v/, ''),
        name: r.name || r.tag_name,
        description: cleanReleaseBody(r.body),
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        htmlUrl: r.html_url
      }))

    return { versions, source }
  } catch (e) {
    console.error(`[Version Sync] GitHub 代理也失败: ${e.message}`)
    throw new Error(`无法从 GitHub 拉取版本列表: ${e.message}`)
  }
}

/**
 * 带超时的 HTTP GET 请求（使用静态导入的 http/https 模块）
 */
function fetchWithTimeout(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const isHttps = urlObj.protocol === 'https:'
    const fetchMod = isHttps ? https : http

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'OpenClaw-Dashboard',
        'Accept': 'application/vnd.github.v3+json'
      }
    }

    const req = fetchMod.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        clearTimeout(timeoutId)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data)
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      })
    })

    const timeoutId = setTimeout(() => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    req.on('error', (err) => {
      clearTimeout(timeoutId)
      reject(err)
    })

    req.end()
  })
}

/**
 * 执行单个命令（spawn），返回 { success, stdout, stderr, error }
 */
function runCommandSafe(command, args, timeoutMs) {
  return runFileCommand(command, args, timeoutMs, { decode: decodeBuffer })
}

function runCommand(command, args, timeoutMs) {
  return runFileCommand(command, args, timeoutMs, { decode: decodeBuffer })
}

function openClawCommandEnvironment({ gatewayAccess = false } = {}) {
  const extra = {}
  for (const key of ['OPENCLAW_CONFIG_PATH', 'OPENCLAW_STATE_DIR']) {
    if (process.env[key]) extra[key] = process.env[key]
  }
  const allowSensitiveKeys = []
  if (gatewayAccess && GATEWAY_CREDENTIALS.token) {
    extra.OPENCLAW_GATEWAY_TOKEN = GATEWAY_CREDENTIALS.token
    extra.OPENCLAW_GATEWAY_URL = GATEWAY_CREDENTIALS.gatewayUrl
    allowSensitiveKeys.push('OPENCLAW_GATEWAY_TOKEN')
  }
  return commandEnvironment(process.env, { extra, allowSensitiveKeys })
}

function runOpenClawCommand(args, timeoutMs, { gatewayAccess = false } = {}) {
  if (os.platform() === 'win32') {
    return Promise.resolve({ success: false, stdout: '', stderr: '', error: 'Windows 的安全 OpenClaw 命令入口尚未接入' })
  }
  return runFileCommand('openclaw', args, timeoutMs, {
    decode: decodeBuffer,
    env: openClawCommandEnvironment({ gatewayAccess }),
    allowSensitiveEnvKeys: gatewayAccess ? ['OPENCLAW_GATEWAY_TOKEN'] : [],
  })
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function publicDashboardConfig() {
  const trustedHttpsOrigin = String(process.env.OPENCLAW_DASHBOARD_TRUSTED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .map(normalizeTrustedOrigin)
    .find(value => value.startsWith('https://')) || ''
  let shareRepoUrl = ''
  try {
    const candidate = new URL(String(process.env.OPENCLAW_PUBLIC_SHARE_REPO_URL || ''))
    if (candidate.protocol === 'https:' && !candidate.username && !candidate.password && !candidate.search && !candidate.hash) {
      shareRepoUrl = candidate.toString().replace(/\/$/, '')
    }
  } catch { /* optional public setting */ }
  return {
    trustedHttpsOrigin,
    shareRepoUrl,
    electricityPerHour: publicElectricityPerHour(process.env.OPENCLAW_PUBLIC_ELECTRICITY_PER_HOUR),
  }
}

function readJsonRequest(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(new Error(`JSON 解析失败: ${e.message}`))
      }
    })
    req.on('error', reject)
  })
}

function toPublicAssetPath(value, fallback) {
  const raw = String(value || '').trim()
  const asset = raw || fallback
  if (!asset) return ''
  if (path.isAbsolute(expandUserPath(asset)) || asset.startsWith('~/') || asset.startsWith('~\\')) return ''
  if (/^(https?:|data:|\/)/i.test(asset)) return asset
  return `/${asset.replace(/^public\//, '')}`
}

function avatarContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.svg') return 'image/svg+xml'
  return ''
}

function defaultAvatarFile() {
  return path.join(__dirname, '..', 'public', 'avatars', 'default.svg')
}

function resolveConfiguredAvatarFile(agentId) {
  const id = String(agentId || '').trim()
  if (!id) return ''

  const cfg = readOpenClawConfigSafe()
  const agentsList = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : []
  const agent = agentsList.find(item => String(item?.id || '').trim() === id)
  const raw = String(agent?.identity?.avatar || '').trim()
  if (!raw) return ''

  const candidates = []
  const workspace = expandUserPath(agent?.workspace || cfg?.agents?.defaults?.workspace || '')
  const allowedRoots = [OPENCLAW_DIR, workspace, path.join(DASHBOARD_ROOT, 'public', 'avatars')].filter(Boolean)
  const expanded = expandUserPath(raw)
  if (path.isAbsolute(expanded)) {
    candidates.push(expanded)
  } else {
    candidates.push(path.join(OPENCLAW_DIR, expanded))
    if (workspace) candidates.push(path.join(workspace, expanded))
  }

  for (const candidate of candidates) {
    let resolved
    try { resolved = resolvePathWithinRoots(candidate, allowedRoots, { mustExist: true }) } catch { continue }
    const type = avatarContentType(resolved)
    if (!type || type === 'image/svg+xml') continue
    return resolved
  }

  return ''
}

function configuredAvatarUrl(id, rawAvatar) {
  const localFile = resolveConfiguredAvatarFile(id)
  if (localFile) {
    const mtime = fsSync.statSync(localFile).mtimeMs.toFixed(0)
    return `/api/agent-avatar/${encodeURIComponent(id)}?v=${mtime}`
  }
  const publicAsset = toPublicAssetPath(rawAvatar, '')
  if (/^\/avatars\/[A-Za-z0-9@._/-]+\.(?:png|jpe?g|webp|gif)(?:\?[^#]*)?$/i.test(publicAsset)) return publicAsset
  return '/avatars/default.svg'
}

async function readConfiguredAgents() {
  const configPath = resolvePathWithinRoots(OPENCLAW_CONFIG_PATH, [OPENCLAW_DIR], { mustExist: true })
  const raw = await fs.readFile(configPath, 'utf-8')
  const config = JSON.parse(raw)
  const agentsList = Array.isArray(config?.agents?.list) ? config.agents.list : []

  const agents = agentsList
    .map(a => {
      let id
      try { id = assertAgentId(a?.id) } catch { return null }
      return {
        id,
        name: a?.identity?.name || a.name || id,
        emoji: a?.identity?.emoji || '',
        avatar: configuredAvatarUrl(id, a?.identity?.avatar),
        model: a.model || (config?.agents?.defaults?.model?.primary || 'unknown'),
        workspace: a.workspace || null,
        configured: true,
        skills: Array.isArray(a.skills) ? a.skills : [],
        skillsUnconstrained: !Array.isArray(a.skills),
      }
    })
    .filter(Boolean)

  return { agents, configPath }
}

function normalizeTemplateList(value, useDefaultWhenMissing = true) {
  if (!Array.isArray(value)) {
    return useDefaultWhenMissing ? [...QUICK_MESSAGE_DEFAULT_TEMPLATES] : []
  }
  const seen = new Set()
  const templates = []
  for (const item of value) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    templates.push(text.slice(0, 500))
    if (templates.length >= 20) break
  }
  return templates
}

function normalizeQuickMessageConfig(raw, agents) {
  const agentIds = agents.map(a => a.id)
  const validIds = new Set(agentIds)
  const hasEnabledIds = Array.isArray(raw?.enabledAgentIds)
  const enabledAgentIds = hasEnabledIds
    ? raw.enabledAgentIds.map(id => String(id || '').trim()).filter(id => validIds.has(id))
    : agentIds

  return {
    version: 1,
    enabledAgentIds,
    templates: normalizeTemplateList(raw?.templates, !Array.isArray(raw?.templates)),
    updatedAt: raw?.updatedAt || null,
  }
}

async function readQuickMessageConfig() {
  const { agents } = await readConfiguredAgents()
  let raw = null
  if (fsSync.existsSync(QUICK_MESSAGE_CONFIG_FILE)) {
    try {
      const configFile = resolvePathWithinRoots(QUICK_MESSAGE_CONFIG_FILE, [OPENCLAW_DIR], { mustExist: true })
      raw = JSON.parse(await fs.readFile(configFile, 'utf-8'))
    } catch (e) {
      console.warn('[quick-message-config] 配置读取失败，使用默认值:', e.message)
    }
  }
  return {
    agents,
    config: normalizeQuickMessageConfig(raw, agents),
    defaults: {
      templates: [...QUICK_MESSAGE_DEFAULT_TEMPLATES],
    },
  }
}

async function writeQuickMessageConfig(payload) {
  const { agents } = await readConfiguredAgents()
  const validIds = new Set(agents.map(a => a.id))
  const requestedIds = Array.isArray(payload?.enabledAgentIds) ? payload.enabledAgentIds : []
  const enabledAgentIds = requestedIds
    .map(id => String(id || '').trim())
    .filter(id => validIds.has(id))

  const templates = normalizeTemplateList(payload?.templates, false)
  const config = {
    version: 1,
    enabledAgentIds,
    templates,
    updatedAt: new Date().toISOString(),
  }

  safeAtomicWriteFileWithinRoots(
    QUICK_MESSAGE_CONFIG_FILE,
    `${JSON.stringify(config, null, 2)}\n`,
    [OPENCLAW_DIR],
  )

  return {
    agents,
    config,
    defaults: {
      templates: [...QUICK_MESSAGE_DEFAULT_TEMPLATES],
    },
  }
}

function voiceCapabilities(req) {
  const host = String(req.headers.host || `127.0.0.1:${process.env.FRONTEND_PORT || '31021'}`).split(':')[0]
  const frontendPort = process.env.FRONTEND_PORT || '31021'
  const httpsFrontendPort = process.env.OPENCLAW_HTTPS_FRONTEND_PORT || (process.env.OPENCLAW_HTTPS === '1' ? frontendPort : '31023')
  const httpsEnabled = process.env.OPENCLAW_HTTPS === '1' || Boolean(process.env.OPENCLAW_HTTPS_FRONTEND_PORT)
  const trustedHttps = publicDashboardConfig().trustedHttpsOrigin
  const sttCommand = process.env.OPENCLAW_VOICE_STT_COMMAND_JSON || process.env.OPENCLAW_VOICE_STT_COMMAND || ''
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY || process.env.OPENCLAW_VOICE_STT_API_KEY)
  const hasDashscope = Boolean(dashscopeApiKey())
  const hasGptSoVits = Boolean(gptSoVitsUrl())
  const hasTtsCommand = ttsCommandConfigured()
  return {
    ok: true,
    secureContextRequired: true,
    httpsEnabled,
    currentHost: host,
    localUrls: {
      http: `http://127.0.0.1:${frontendPort}`,
      https: `https://127.0.0.1:${httpsFrontendPort}`,
      trustedHttps,
      lanHttps: [],
    },
    stt: {
      browserPreferred: true,
      localCommandConfigured: Boolean(sttCommand),
      localCommandHint: sttCommand ? '已配置本地 STT 参数数组' : '未配置本地 STT 参数数组',
      openAiCompatibleConfigured: hasOpenAi,
      whisperCliDetected: commandExists('whisper') || commandExists('whisper-cli'),
    },
    tts: {
      browserSpeechSynthesis: true,
      macSayDetected: os.platform() === 'darwin' && commandExists('say'),
      dashscopeConfigured: hasDashscope,
      gptSoVitsConfigured: hasGptSoVits,
      localCommandConfigured: hasTtsCommand,
      cloneConfigured: hasDashscope || hasGptSoVits || hasTtsCommand,
    },
    hints: [
      '浏览器麦克风必须运行在 https:// 或 localhost/127.0.0.1。',
      '当前安全配置仅允许本机使用，不向局域网或公网开放。',
      '如果浏览器没有 SpeechRecognition，可配置 OPENCLAW_VOICE_STT_COMMAND_JSON 或 OpenAI 兼容 STT 接口。',
      '语音克隆/专属音色可配置 OPENCLAW_VOICE_DASHSCOPE_API_KEY、OPENCLAW_GPTSOVITS_URL，或 OPENCLAW_VOICE_TTS_COMMAND_JSON。',
    ],
  }
}

async function transcribeWithConfiguredCommand(inputPath) {
  const template = process.env.OPENCLAW_VOICE_STT_COMMAND_JSON || process.env.OPENCLAW_VOICE_STT_COMMAND
  if (!template) return null
  try {
    const parsed = parseCommandTemplate(template, { '{input}': inputPath })
    if (!String(template).includes('{input}')) parsed.args.push(inputPath)
    const result = await runFileCommand(parsed.command, parsed.args, parseInt(process.env.OPENCLAW_VOICE_STT_TIMEOUT_MS || '120000', 10))
    if (!result.success) return { ok: false, error: result.stderr?.trim() || result.error }
    return { ok: true, text: String(result.stdout || '').trim() }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

// 阿里 Qwen3-ASR（原生 multimodal-generation 接口）— 听走阿里，与作者同一套
async function transcribeWithDashscopeQwen(inputPath) {
  const apiKey = dashscopeApiKey()
  if (!apiKey) return null
  const model = process.env.OPENCLAW_VOICE_QWEN_ASR_MODEL || 'qwen3-asr-flash'
  let wavPath = inputPath
  try { wavPath = await convertAudioToWav16k(inputPath) } catch { wavPath = inputPath }
  try {
    const audio = await fs.readFile(wavPath)
    const dataUri = `data:audio/wav;base64,${audio.toString('base64')}`
    const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: { messages: [
          { role: 'system', content: [{ text: '' }] },
          { role: 'user', content: [{ audio: dataUri }] },
        ]},
        parameters: { asr_options: { language: process.env.OPENCLAW_VOICE_STT_LANGUAGE || 'zh', enable_lid: true, enable_itn: true } },
      }),
    })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok) return { ok: false, error: json?.message || json?.code || `HTTP ${resp.status}` }
    const content = json?.output?.choices?.[0]?.message?.content
    const text = Array.isArray(content) ? content.map(c => c.text || '').join('').trim() : String(content || '').trim()
    return { ok: true, text }
  } finally {
    if (wavPath !== inputPath) await fs.rm(wavPath, { force: true }).catch(() => {})
  }
}

async function transcribeWithOpenAiCompatible(inputPath, mimeType) {
  const apiKey = process.env.OPENCLAW_VOICE_STT_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) return null
  const endpoint = process.env.OPENCLAW_VOICE_STT_ENDPOINT || 'https://api.openai.com/v1/audio/transcriptions'
  const model = process.env.OPENCLAW_VOICE_STT_MODEL || 'whisper-1'
  const audio = await fs.readFile(inputPath)
  const form = new FormData()
  form.append('model', model)
  form.append('file', new Blob([audio], { type: mimeType || 'audio/webm' }), path.basename(inputPath))
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  const text = await resp.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* ignore */ }
  if (!resp.ok) {
    return { ok: false, error: json?.error?.message || text.slice(0, 500) || `HTTP ${resp.status}` }
  }
  return { ok: true, text: String(json?.text || '').trim() }
}

async function transcribeWithWhisperCli(inputPath) {
  if (!commandExists('whisper')) return null
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-whisper-'))
  const result = await runCommandSafe('whisper', [
    inputPath,
    '--language', process.env.OPENCLAW_VOICE_LANGUAGE || 'Chinese',
    '--model', process.env.OPENCLAW_VOICE_WHISPER_MODEL || 'base',
    '--output_format', 'txt',
    '--output_dir', outDir,
  ], parseInt(process.env.OPENCLAW_VOICE_STT_TIMEOUT_MS || '180000', 10))
  if (!result.success) {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: result.error || result.stderr || 'whisper 执行失败' }
  }
  const base = path.basename(inputPath).replace(/\.[^.]+$/, '')
  const txtPath = path.join(outDir, `${base}.txt`)
  const text = await fs.readFile(txtPath, 'utf-8').catch(() => result.stdout || '')
  await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
  return { ok: true, text: String(text || '').trim() }
}

function audioExtensionFromMime(mimeType) {
  if (/mp4|m4a/.test(mimeType || '')) return '.m4a'
  if (/ogg/.test(mimeType || '')) return '.ogg'
  if (/wav/.test(mimeType || '')) return '.wav'
  return '.webm'
}

const COSYVOICE_PRESET_VOICES = [
  { voiceId: 'longxiaochun_v3', name: '龙小淳 · 明亮女声', provider: 'cosyvoice', category: 'premade', language: 'zh' },
  { voiceId: 'longxiaoxia_v3', name: '龙小夏 · 沉稳女声', provider: 'cosyvoice', category: 'premade', language: 'zh' },
  { voiceId: 'longyumi_v3', name: 'YUMI · 年轻女声', provider: 'cosyvoice', category: 'premade', language: 'zh' },
  { voiceId: 'longanyun_v3', name: '龙安云 · 温暖男声', provider: 'cosyvoice', category: 'premade', language: 'zh' },
  { voiceId: 'longanwen_v3', name: '龙安雯 · 优雅女声', provider: 'cosyvoice', category: 'premade', language: 'zh' },
  { voiceId: 'longanlang_v3', name: '龙安朗 · 清晰男声', provider: 'cosyvoice', category: 'premade', language: 'zh' },
]

function dashscopeApiKey() {
  return process.env.OPENCLAW_VOICE_DASHSCOPE_API_KEY
    || process.env.DASHSCOPE_API_KEY
    || process.env.QWEN_API_KEY
    || ''
}

function gptSoVitsUrl() {
  return (process.env.OPENCLAW_GPTSOVITS_URL
    || process.env.GPTSOVITS_API_URL
    || process.env.GPTSOVITS_URL
    || '').replace(/\/$/, '')
}

function ttsCommandConfigured() {
  return Boolean(process.env.OPENCLAW_VOICE_TTS_COMMAND_JSON || process.env.OPENCLAW_VOICE_TTS_COMMAND)
}

function minimaxApiKey() {
  return process.env.OPENCLAW_VOICE_MINIMAX_API_KEY
    || process.env.MINIMAX_API_KEY
    || ''
}

function minimaxConfigured() {
  return Boolean(minimaxApiKey())
}

function ensureVoiceDirs() {
  ensureDirectoryWithinRoots(VOICE_DATA_DIR, [OPENCLAW_DIR])
  ensureDirectoryWithinRoots(VOICE_SAMPLES_DIR, [VOICE_DATA_DIR])
}

function sanitizeFileName(name, fallback = 'voice-sample') {
  const ext = path.extname(String(name || '')).toLowerCase().replace(/[^.\w-]/g, '')
  const base = path.basename(String(name || fallback), ext)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || fallback
  return `${base}${ext || '.webm'}`
}

function publicSampleUrl(fileName) {
  return `/api/voice/samples/${encodeURIComponent(fileName)}`
}

function resolveVoiceSamplePath(fileName, { mustExist = false } = {}) {
  ensureVoiceDirs()
  const name = String(fileName || '')
  if (!name || name !== path.basename(name) || name.includes('..') || /[\\/\0]/.test(name)) {
    throw new Error('声音样本文件名无效')
  }
  return resolvePathWithinRoots(path.join(VOICE_SAMPLES_DIR, name), [VOICE_SAMPLES_DIR], { mustExist })
}

function resolveStoredVoiceSamplePath(value, { mustExist = false } = {}) {
  ensureVoiceDirs()
  if (typeof value !== 'string' || !value.trim()) throw new Error('声音样本路径无效')
  return resolvePathWithinRoots(value, [VOICE_SAMPLES_DIR], { mustExist })
}

function samplePathFromUrl(sampleUrl) {
  const pathname = new URL(sampleUrl, 'http://localhost').pathname
  const prefix = '/api/voice/samples/'
  if (!pathname.startsWith(prefix)) throw new Error('声音样本 URL 无效')
  const fileName = decodeURIComponent(pathname.slice(prefix.length))
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error('声音样本文件名无效')
  }
  return resolveVoiceSamplePath(fileName, { mustExist: true })
}

function audioBufferFromPayload(payload) {
  const dataUrl = payload.dataUrl || payload.audioDataUrl || ''
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
    const base64 = dataUrl.split(',')[1] || ''
    return Buffer.from(base64, 'base64')
  }
  const raw = payload.audioBase64 || payload.base64 || ''
  if (!raw || typeof raw !== 'string') return null
  return Buffer.from(raw.includes(',') ? raw.split(',').pop() : raw, 'base64')
}

async function readVoiceProfiles() {
  ensureVoiceDirs()
  let raw
  try {
    const file = resolvePathWithinRoots(VOICE_PROFILES_FILE, [VOICE_DATA_DIR], { mustExist: true })
    raw = await fs.readFile(file, 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.message === '路径不存在') return []
    throw error
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.voices) ? parsed.voices : []
  } catch { return [] }
}

async function writeVoiceProfiles(voices) {
  ensureVoiceDirs()
  safeAtomicWriteFileWithinRoots(
    VOICE_PROFILES_FILE,
    `${JSON.stringify({ voices }, null, 2)}\n`,
    [VOICE_DATA_DIR],
  )
}

// 待确认录音（持久化：保存样本但不克隆，刷新不丢）
const PENDING_RECS_FILE = path.join(VOICE_DATA_DIR, 'pending-recordings.json')
async function readPendingRecs() {
  ensureVoiceDirs()
  let raw
  try {
    const file = resolvePathWithinRoots(PENDING_RECS_FILE, [VOICE_DATA_DIR], { mustExist: true })
    raw = await fs.readFile(file, 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.message === '路径不存在') return []
    throw error
  }
  try {
    const p = JSON.parse(raw)
    return Array.isArray(p.pending) ? p.pending : []
  } catch { return [] }
}
async function writePendingRecs(list) {
  ensureVoiceDirs()
  safeAtomicWriteFileWithinRoots(
    PENDING_RECS_FILE,
    `${JSON.stringify({ pending: list }, null, 2)}\n`,
    [VOICE_DATA_DIR],
  )
}

async function upsertVoiceProfile(profile) {
  const voices = await readVoiceProfiles()
  const idx = voices.findIndex(v => v.voiceId === profile.voiceId)
  if (idx >= 0) voices[idx] = { ...voices[idx], ...profile, updatedAt: new Date().toISOString() }
  else voices.unshift({ ...profile, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  await writeVoiceProfiles(voices)
  return idx >= 0 ? voices[idx] : voices[0]
}

function voiceProfileRuntime(profile) {
  let safeSamplePath = ''
  if (profile?.samplePath) {
    try { safeSamplePath = resolveStoredVoiceSamplePath(profile.samplePath, { mustExist: true }) } catch { /* invalid stored path stays unavailable */ }
  }
  const provider = profile?.provider || 'cosyvoice'
  const synthesisReady = provider === 'cosyvoice'
    ? Boolean(dashscopeApiKey())
    : provider === 'command'
      ? ttsCommandConfigured()
      : provider === 'gptsovits'
        ? Boolean(gptSoVitsUrl())
        : provider === 'local-reference'
          ? Boolean(gptSoVitsUrl()) || ttsCommandConfigured()
        : false
  return {
    ...profile,
    samplePath: safeSamplePath,
    synthesisReady,
    status: synthesisReady ? (profile.status === 'pending-config' ? 'ready' : profile.status || 'ready') : 'pending-config',
    message: synthesisReady
      ? profile.message
      : '声音样本已保存；配置 OPENCLAW_GPTSOVITS_URL、OPENCLAW_VOICE_DASHSCOPE_API_KEY 或 OPENCLAW_VOICE_TTS_COMMAND_JSON 后即可合成。',
  }
}

function publicVoiceRecord(record) {
  if (!record || typeof record !== 'object') return record
  const safe = { ...record }
  delete safe.samplePath
  return safe
}

async function convertAudioToWav16k(inputPath) {
  if (path.extname(inputPath).toLowerCase() === '.wav') return inputPath
  if (!commandExists('ffmpeg')) {
    throw new Error('克隆声音需要 ffmpeg 把录音转为 16k 单声道 WAV。请先安装 ffmpeg，或直接上传 wav 文件。')
  }
  const wavPath = path.join(os.tmpdir(), `openclaw-voice-clone-${Date.now()}.wav`)
  const result = await runCommandSafe('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-acodec', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    wavPath,
  ], 30000)
  if (!result.success) {
    throw new Error(`声音样本转换失败：${result.error || result.stderr || 'ffmpeg 执行失败'}`)
  }
  return wavPath
}

async function cloneWithCosyVoice(samplePath, name) {
  const apiKey = dashscopeApiKey()
  if (!apiKey) {
    throw new Error('未配置 DashScope API Key。请在 .env 配置 OPENCLAW_VOICE_DASHSCOPE_API_KEY 或 DASHSCOPE_API_KEY。')
  }
  const wavPath = await convertAudioToWav16k(samplePath)
  try {
    const audioBase64 = (await fs.readFile(wavPath)).toString('base64')
    const prefix = String(name || 'voice').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'voice'
    const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'voice-enrollment',
        input: {
          action: 'create_voice',
          target_model: process.env.OPENCLAW_COSYVOICE_TARGET_MODEL || 'cosyvoice-v3-flash',
          url: `data:audio/wav;base64,${audioBase64}`,
          prefix,
        },
      }),
    })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      throw new Error(json?.message || json?.code || `HTTP ${resp.status}`)
    }
    const voiceId = json?.output?.voice_id || json?.output?.voiceId
    if (!voiceId) throw new Error(`CosyVoice 未返回 voice_id：${JSON.stringify(json).slice(0, 500)}`)
    return voiceId
  } finally {
    if (wavPath !== samplePath) await fs.rm(wavPath, { force: true }).catch(() => {})
  }
}

// MiniMax 云克隆：上传录音 → voice_clone 注册 → 返回 voice_id。
// 注意：克隆走 files/upload + voice_clone 两个接口，均需 GroupId（按量付费账号才有）。
// sk-cp 套餐 key 无 GroupId，大概率克隆不了——会在这里抛清晰错误。
async function cloneWithMiniMax(samplePath, name, customVoiceId) {
  // 克隆专用 key（按量付费）优先；没配则退回主 key
  const apiKey = (process.env.OPENCLAW_VOICE_MINIMAX_CLONE_API_KEY || '').trim() || minimaxApiKey()
  if (!apiKey) throw new Error('未配置 MiniMax API Key。')
  const groupId = (process.env.OPENCLAW_VOICE_MINIMAX_GROUP_ID || '').trim()
  if (!groupId) {
    throw new Error('MiniMax 克隆需要 Group ID（按量付费账号才有）。请在 .env 配置 OPENCLAW_VOICE_MINIMAX_GROUP_ID；sk-cp 套餐 key 不支持克隆。')
  }
  const baseUrl = (process.env.OPENCLAW_VOICE_MINIMAX_BASE_URL || 'https://api.minimaxi.com').replace(/\/$/, '')
  const voiceId = customVoiceId || `clone${Date.now().toString(36)}`

  // 1) 上传录音文件（multipart, purpose=voice_clone）
  const buf = await fs.readFile(samplePath)
  const form = new FormData()
  form.append('purpose', 'voice_clone')
  form.append('file', new Blob([buf]), path.basename(samplePath))
  const upResp = await fetch(`${baseUrl}/v1/files/upload?GroupId=${encodeURIComponent(groupId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  const upJson = await upResp.json().catch(() => ({}))
  const upCode = upJson?.base_resp?.status_code
  if (!upResp.ok || (upCode && upCode !== 0)) {
    throw new Error(`MiniMax 上传失败：${upJson?.base_resp?.status_msg || upJson?.message || `HTTP ${upResp.status}`}`)
  }
  const fileId = upJson?.file?.file_id
  if (!fileId) throw new Error(`MiniMax 未返回 file_id：${JSON.stringify(upJson).slice(0, 300)}`)

  // 2) 注册克隆音色（voice_id 自定义：≥8位、字母开头、含字母和数字）
  const clResp = await fetch(`${baseUrl}/v1/voice_clone?GroupId=${encodeURIComponent(groupId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, voice_id: voiceId, need_noise_reduction: true }),
  })
  const clJson = await clResp.json().catch(() => ({}))
  const clCode = clJson?.base_resp?.status_code
  if (!clResp.ok || (clCode && clCode !== 0)) {
    throw new Error(`MiniMax 克隆失败：${clJson?.base_resp?.status_msg || clJson?.message || `HTTP ${clResp.status}`}`)
  }
  return voiceId
}

async function synthesizeWithCosyVoice(text, voiceId, options = {}) {
  const apiKey = dashscopeApiKey()
  if (!apiKey) throw new Error('未配置 DashScope API Key，无法使用 CosyVoice 播放。')
  const input = {
    text,
    voice: voiceId || 'longxiaochun_v3',
    format: 'mp3',
    sample_rate: 22050,
  }
  // CosyVoice 认的是 rate（倍率 0.5~2，模型自然变速），不是 speech_rate
  if (options.rate) input.rate = Math.min(2, Math.max(0.5, Number(options.rate)))
  if (options.pitch && Number(options.pitch) !== 1) input.pitch = Math.round((Number(options.pitch) - 1) * 100)
  // 情绪：自然语言指令（cosyvoice-v3-flash 对克隆音色支持），模型按这个情绪重新生成，不是粗暴改音调
  if (options.instruction) input.instruction = String(options.instruction).slice(0, 100)
  const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENCLAW_COSYVOICE_TTS_MODEL || 'cosyvoice-v3-flash',
      input,
    }),
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(json?.message || json?.code || `HTTP ${resp.status}`)
  const audioUrl = json?.output?.audio?.url
  if (!audioUrl) throw new Error(`CosyVoice 未返回音频地址：${JSON.stringify(json).slice(0, 500)}`)
  const audioResp = await fetch(audioUrl)
  if (!audioResp.ok) throw new Error(`下载 CosyVoice 音频失败：HTTP ${audioResp.status}`)
  return { buffer: Buffer.from(await audioResp.arrayBuffer()), mimeType: 'audio/mpeg' }
}

// MiniMax T2A v2 语音合成。兼容两种 key：
//  - 按量付费 key：需配 OPENCLAW_VOICE_MINIMAX_GROUP_ID
//  - Token Plan sk-cp key：先不填 GroupId 试，若返回 invalid api key 说明该 key 不支持直连 T2A
async function synthesizeWithMiniMax(text, voiceId, options = {}) {
  const apiKey = minimaxApiKey()
  if (!apiKey) {
    throw new Error('未配置 MiniMax API Key。请在 .env 配置 OPENCLAW_VOICE_MINIMAX_API_KEY。')
  }
  const baseUrl = (process.env.OPENCLAW_VOICE_MINIMAX_BASE_URL || 'https://api.minimaxi.com').replace(/\/$/, '')
  const groupId = (process.env.OPENCLAW_VOICE_MINIMAX_GROUP_ID || '').trim()
  const model = process.env.OPENCLAW_VOICE_MINIMAX_MODEL || 'speech-2.6-hd'
  const endpoint = `${baseUrl}/v1/t2a_v2${groupId ? `?GroupId=${encodeURIComponent(groupId)}` : ''}`
  const voiceSetting = {
    voice_id: voiceId || process.env.OPENCLAW_VOICE_MINIMAX_VOICE || 'female-tianmei',
    speed: options.rate ? Math.min(2, Math.max(0.5, Number(options.rate))) : 1.0,
    vol: 1.0,
    pitch: options.pitch ? Math.round((Number(options.pitch) - 1) * 12) : 0,
  }
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      text,
      stream: false,
      voice_setting: voiceSetting,
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    }),
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(json?.base_resp?.status_msg || json?.message || `HTTP ${resp.status}`)
  const code = json?.base_resp?.status_code
  if (code && code !== 0) {
    throw new Error(`MiniMax 返回错误 ${code}：${json?.base_resp?.status_msg || '未知错误'}`)
  }
  const hexAudio = json?.data?.audio
  if (!hexAudio) throw new Error(`MiniMax 未返回音频：${JSON.stringify(json).slice(0, 400)}`)
  return { buffer: Buffer.from(hexAudio, 'hex'), mimeType: 'audio/mpeg' }
}

async function synthesizeWithGptSoVits(text, profile) {
  const baseUrl = gptSoVitsUrl()
  if (!baseUrl) throw new Error('未配置 GPT-SoVITS 地址。请在 .env 配置 OPENCLAW_GPTSOVITS_URL，例如 http://127.0.0.1:9880。')
  const body = {
    text,
    text_lang: 'zh',
    ref_audio_path: profile.samplePath,
    prompt_text: profile.promptText || process.env.OPENCLAW_GPTSOVITS_PROMPT_TEXT || '你好，这是我的声音样本。',
    prompt_lang: 'zh',
    text_split_method: 'cut0',
    batch_size: 1,
    media_type: 'wav',
    streaming_mode: false,
  }
  const resp = await fetch(`${baseUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const textBody = await resp.text().catch(() => '')
    throw new Error(`GPT-SoVITS 合成失败：HTTP ${resp.status} ${textBody.slice(0, 300)}`)
  }
  return { buffer: Buffer.from(await resp.arrayBuffer()), mimeType: resp.headers.get('content-type') || 'audio/wav' }
}

async function synthesizeWithConfiguredCommand(text, profile) {
  const template = process.env.OPENCLAW_VOICE_TTS_COMMAND_JSON || process.env.OPENCLAW_VOICE_TTS_COMMAND
  if (!template) return null
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-tts-'))
  const outputPath = path.join(tempDir, 'speech.wav')
  const replacements = {
    '{text}': text,
    '{voiceId}': profile?.voiceId || '',
    '{voiceName}': profile?.name || '',
    '{sample}': profile?.samplePath || '',
    '{output}': outputPath,
  }
  try {
    const parsed = parseCommandTemplate(template, replacements)
    const result = await runFileCommand(parsed.command, parsed.args, parseInt(process.env.OPENCLAW_VOICE_TTS_TIMEOUT_MS || '120000', 10))
    if (!result.success) return { ok: false, error: result.stderr?.trim() || result.error }
    const stdoutPath = String(result.stdout || '').trim().split(/\r?\n/).pop()
    const realOutput = fsSync.existsSync(outputPath) ? outputPath : stdoutPath
    if (!realOutput || !fsSync.existsSync(realOutput)) {
      return { ok: false, error: 'TTS 命令没有生成音频文件。请在参数数组中使用 {output} 输出音频。' }
    }
    const buffer = await fs.readFile(realOutput)
    return { ok: true, buffer, mimeType: /mp3$/i.test(realOutput) ? 'audio/mpeg' : 'audio/wav' }
  } catch (error) {
    return { ok: false, error: error.message }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * 切换 OpenClaw 版本：串行执行 npm install → gateway restart
 * 支持 Windows / Linux / macOS 跨平台
 */
export function openClawInstallArgs(version) {
  const safeVersion = assertVersion(version)
  const args = ['install', '-g', `openclaw@${safeVersion}`]
  const registry = String(process.env.OPENCLAW_NPM_REGISTRY || '').trim()
  if (registry) {
    const registryUrl = new URL(registry)
    if (!['http:', 'https:'].includes(registryUrl.protocol) || registryUrl.username || registryUrl.password) {
      throw new Error('OPENCLAW_NPM_REGISTRY 格式无效')
    }
    args.push(`--registry=${registryUrl.toString()}`)
  }
  return args
}

function openClawInstallCommandText(version, { sudo = false } = {}) {
  return `${sudo ? 'sudo ' : ''}npm ${openClawInstallArgs(version).join(' ')}`
}

async function switchOpenClawVersion(version) {
  const safeVersion = assertVersion(version)
  const INSTALL_TIMEOUT = 1200000  // 安装 20 分钟超时
  const RESTART_TIMEOUT = 60000   // 重启 60 秒超时
  const platform = os.platform()  // win32 | linux | darwin

  console.log(`[Switch Version] 开始安装 openclaw@${safeVersion}（平台：${platform}）`)

  // Step 1: npm install -g（Linux/macOS 可能需要 sudo）
  const isWindows = platform === 'win32'
  const isLinux = platform === 'linux'

  // 构建 npm install 命令（不依赖 chcp，由 runCommand 通过环境变量控制编码）
  let installCommand = 'npm'
  let installArgs = openClawInstallArgs(safeVersion)

  // Linux 系统：检测是否需要 sudo（方案 A：非 root + 系统级 prefix → 返回手动操作引导）
  if (isLinux) {
    // 检查 npm 全局前缀
    const prefixCheck = await runCommand('npm', ['prefix', '-g'], 5000)
    const rawPrefix = prefixCheck.stdout?.trim()
    const npmPrefix = rawPrefix?.replace(/\/$/, '') // 去除尾部斜杠

    // 如果 prefix 是 /usr/local 或 /usr，通常需要 root 权限
    if (npmPrefix && /^\/usr(\/local)?$/.test(npmPrefix)) {
      // 检测当前用户是否为 root
      const uidCheck = await runCommand('id', ['-u'], 5000)
      const uid = uidCheck.stdout?.trim()
      if (uid !== '0') {
        // 非 root 用户 + 系统级 npm 前缀 → 无法通过 Web API 自动安装（sudo 需要 TTY）
        console.log(`[Switch Version] 非 root 用户(u=${uid}) + 系统 prefix(${npmPrefix})，返回手动引导`)
        return {
          success: false,
          error: `需要 root 权限安装全局包。请手动执行：\n  ${openClawInstallCommandText(safeVersion, { sudo: true })}\n  sudo openclaw gateway restart`,
          requiresManualAction: true,
          manualCommands: [
            openClawInstallCommandText(safeVersion, { sudo: true }),
            'sudo openclaw gateway restart'
          ]
        }
      }
      // root 用户，直接 npm install（无需 sudo）
      console.log(`[Switch Version] root 用户，直接执行 npm install`)
    }
    // nvm/fnm 等用户级 prefix 不需要 sudo，直接执行
  }

  const installResult = await runCommand(installCommand, installArgs, INSTALL_TIMEOUT)

  if (!installResult.success) {
    console.error(`[Switch Version] 安装失败: ${installResult.error}`)
    // 如果是权限问题，提示用户手动执行
    if (installResult.stderr && /EACCES|permission denied|EPERM/i.test(installResult.stderr)) {
      return {
        success: false,
        error: `权限不足，请手动执行：${openClawInstallCommandText(safeVersion, { sudo: true })}`,
        stdout: installResult.stdout,
        stderr: installResult.stderr
      }
    }
    return { success: false, error: `安装失败: ${installResult.error}`, stdout: installResult.stdout, stderr: installResult.stderr }
  }

  console.log(`[Switch Version] 安装成功，开始重启网关`)

  // Step 2: openclaw gateway restart
  let restartCommand = isWindows ? 'openclaw.cmd' : 'openclaw'

  const restartResult = await runCommand(restartCommand, ['gateway', 'restart'], RESTART_TIMEOUT)

  if (!restartResult.success) {
    console.error(`[Switch Version] 网关重启失败: ${restartResult.error}`)
    // 如果命令不存在，给出友好提示
    if (restartResult.error && /not found|ENOENT/i.test(restartResult.error)) {
      return {
        success: false,
        error: `openclaw 命令未找到，请确认已正确安装或手动重启网关`,
        stdout: restartResult.stdout,
        stderr: restartResult.stderr
      }
    }
    return { success: false, error: `安装成功但网关重启失败: ${restartResult.error}`, stdout: restartResult.stdout, stderr: restartResult.stderr }
  }

  console.log(`[Switch Version] 版本切换完成（${safeVersion}），网关已重启`)
  return { success: true, message: `版本已切换到 ${safeVersion}，网关已重启` }
}

// ============================================
// Usage Stats 功能
// ============================================

function createUsageTotals() {
  return { tokens: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function hasUsageValue(usage) {
  return Boolean(
    (Number(usage?.tokens) || 0) ||
    (Number(usage?.cost) || 0) ||
    (Number(usage?.input) || 0) ||
    (Number(usage?.output) || 0) ||
    (Number(usage?.cacheRead) || 0) ||
    (Number(usage?.cacheWrite) || 0)
  )
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const num = Number(value)
    if (Number.isFinite(num)) return num
  }
  return 0
}

function normalizeModelId(modelId) {
  const raw = String(modelId || '').trim()
  if (!raw) return 'unknown'
  const parts = raw.split('/')
  return parts[parts.length - 1] || raw
}

function extractModelIdFromEntry(entry = {}, usage = {}) {
  return normalizeModelId(
    usage.model ||
    usage.modelId ||
    usage.model_id ||
    entry.model ||
    entry.modelId ||
    entry.model_id ||
    entry.message?.model ||
    entry.message?.modelId ||
    entry.message?.model_id ||
    entry.data?.modelId ||
    entry.data?.model_id ||
    entry.data?.model?.name ||
    entry.data?.model?.id ||
    'unknown'
  )
}

function extractUsageTotals(usage = {}) {
  const usageMetadata = usage.usageMetadata || usage.usage_metadata || {}
  const costObject = usage && typeof usage.cost === 'object' ? usage.cost : {}
  const promptDetails = usage.promptTokensDetails || usage.prompt_tokens_details || usage.inputTokenDetails || usage.input_token_details || {}
  const completionDetails = usage.completionTokensDetails || usage.completion_tokens_details || usage.outputTokenDetails || usage.output_token_details || {}
  const input = firstNumber(
    usage.input,
    usage.inputTokens,
    usage.input_tokens,
    usage.promptTokens,
    usage.prompt_tokens,
    usage.promptEvalCount,
    usage.prompt_eval_count,
    usage.prompt_eval_tokens,
    usageMetadata.promptTokenCount,
    usageMetadata.prompt_token_count
  )
  const output = firstNumber(
    usage.output,
    usage.outputTokens,
    usage.output_tokens,
    usage.completionTokens,
    usage.completion_tokens,
    usage.completionEvalCount,
    usage.completion_eval_count,
    usage.evalCount,
    usage.eval_count,
    usage.eval_tokens,
    usage.responseTokens,
    usage.response_tokens,
    usage.candidatesTokenCount,
    usage.candidates_token_count,
    usageMetadata.candidatesTokenCount,
    usageMetadata.candidates_token_count,
    usageMetadata.outputTokenCount,
    usageMetadata.output_token_count
  )
  const cacheRead = firstNumber(
    usage.cacheRead,
    usage.cache_read,
    usage.cacheReadTokens,
    usage.cache_read_tokens,
    usage.cachedInputTokens,
    usage.cached_input_tokens,
    promptDetails.cachedTokens,
    promptDetails.cached_tokens,
    usageMetadata.cachedContentTokenCount,
    usageMetadata.cached_content_token_count
  )
  const cacheWrite = firstNumber(
    usage.cacheWrite,
    usage.cache_write,
    usage.cacheWriteTokens,
    usage.cache_write_tokens
  )
  const reasoning = firstNumber(
    usage.reasoningTokens,
    usage.reasoning_tokens,
    completionDetails.reasoningTokens,
    completionDetails.reasoning_tokens,
    usageMetadata.thoughtsTokenCount,
    usageMetadata.thoughts_token_count
  )
  const totalFromProvider = firstNumber(
    usage.totalTokens,
    usage.total_tokens,
    usage.tokens,
    usage.total,
    usage.totalTokenCount,
    usage.total_token_count,
    usageMetadata.totalTokenCount,
    usageMetadata.total_token_count
  )
  const tokens = totalFromProvider
    || input + output + cacheRead + cacheWrite
  const directCost = firstNumber(
    usage.totalCost,
    usage.total_cost,
    typeof usage.cost === 'number' ? usage.cost : undefined,
    costObject.total,
    costObject.totalCost,
    costObject.total_cost
  )
  const cost = directCost || (
    firstNumber(usage.inputCost, usage.input_cost, costObject.input, costObject.inputCost, costObject.input_cost) +
    firstNumber(usage.outputCost, usage.output_cost, costObject.output, costObject.outputCost, costObject.output_cost) +
    firstNumber(usage.cacheReadCost, usage.cache_read_cost, costObject.cacheRead, costObject.cache_read, costObject.cacheReadCost) +
    firstNumber(usage.cacheWriteCost, usage.cache_write_cost, costObject.cacheWrite, costObject.cache_write, costObject.cacheWriteCost)
  )
  return { tokens, cost, input, output: output || reasoning, cacheRead, cacheWrite }
}

function getBillingDiscountFactor(cfg = {}, timeMs = Date.now()) {
  if (cfg.discountFactor === undefined) return 1
  if (cfg.discountStartHour === undefined || cfg.discountEndHour === undefined) return 1
  const hour = new Date(timeMs).getHours()
  const start = Number(cfg.discountStartHour)
  const end = Number(cfg.discountEndHour)
  const inWindow = start < end
    ? (hour >= start && hour < end)
    : (hour >= start || hour < end)
  return inWindow ? Number(cfg.discountFactor) || 0 : 1
}

export function resolveBillingConfig(modelId, billingConfig) {
  const normalized = normalizeModelId(modelId)
  const models = billingConfig?.models || {}
  if (models[normalized]) return models[normalized]

  const lower = normalized.toLowerCase()
  const prefixMatch = Object.keys(models)
    .sort((a, b) => b.length - a.length)
    .find((key) => {
      const k = key.toLowerCase()
      return lower === k || lower.startsWith(`${k}-`) || lower.startsWith(`${k}:`)
    })
  if (prefixMatch) return models[prefixMatch]

  if (lower.includes('qwen')) {
    return models['qwen3.5'] || models['qwen3.5:9b'] || models['Qwen3.5-4B-OptiQ-4bit'] || billingConfig?.fallback
  }
  if (lower.includes('gemma') || lower.includes('google')) {
    return models['gemma3'] || models['gemma3:12b'] || billingConfig?.fallback
  }

  return billingConfig?.fallback
}

export function calculateUsageCostWithBilling(modelId, usage, rawCost, billingConfig, timeMs = Date.now()) {
  const cfg = resolveBillingConfig(modelId, billingConfig)
  if (!cfg) return rawCost || 0

  if (cfg.mode === 'free') return 0
  if (cfg.mode === 'use_default') return rawCost || 0
  if (cfg.mode === 'subscription_monthly') return rawCost || 0
  if (cfg.mode !== 'per_token') return rawCost || 0

  const totalTokens = Number(usage?.tokens) || 0
  let inputTokens = Number(usage?.input) || 0
  let outputTokens = Number(usage?.output) || 0
  const cacheReadTokens = Number(usage?.cacheRead) || 0
  const cacheWriteTokens = Number(usage?.cacheWrite) || 0

  if (!inputTokens && !outputTokens && totalTokens) {
    inputTokens = totalTokens * 0.7
    outputTokens = totalTokens * 0.3
  }

  const factor = getBillingDiscountFactor(cfg, timeMs)
  return (
    (inputTokens / 1_000_000) * (Number(cfg.inputPriceCNYPerMillion) || 0) +
    (outputTokens / 1_000_000) * (Number(cfg.outputPriceCNYPerMillion) || 0) +
    (cacheReadTokens / 1_000_000) * (Number(cfg.cacheReadPriceCNYPerMillion) || 0) +
    (cacheWriteTokens / 1_000_000) * (Number(cfg.cacheWritePriceCNYPerMillion) || 0)
  ) * factor
}

export function observationPriceConfigured(modelId, usage, billingConfig) {
  if ((Number(usage?.rawCost) || 0) > 0) return true
  const cfg = resolveBillingConfig(modelId, billingConfig)
  if (!cfg || cfg === billingConfig?.fallback) return false
  if (cfg.mode === 'free') return true
  if (cfg.mode !== 'per_token') return false
  return [
    cfg.inputPriceCNYPerMillion,
    cfg.outputPriceCNYPerMillion,
    cfg.cacheReadPriceCNYPerMillion,
    cfg.cacheWritePriceCNYPerMillion,
  ].some(value => (Number(value) || 0) > 0)
}

function enrichObservationUsage(summary, billingConfig, timeMs = Date.now()) {
  const byModel = (summary?.byModel || []).map((row) => {
    const usage = row.usage || {}
    const billingMode = resolveBillingConfig(row.model, billingConfig)?.mode || 'unconfigured'
    const priceConfigured = observationPriceConfigured(row.model, usage, billingConfig)
    const cost = calculateUsageCostWithBilling(row.model, usage, usage.rawCost, billingConfig, timeMs)
    return { ...row, usage: { ...usage, cost, billingMode }, priceConfigured }
  })
  const usage = byModel.reduce((total, row) => {
    addUsageTotals(total, row.usage)
    return total
  }, createUsageTotals())
  const configuredCount = byModel.filter(row => row.priceConfigured).length
  const priceStatus = byModel.length === 0 || configuredCount === 0
    ? 'unconfigured'
    : (configuredCount === byModel.length ? 'configured' : 'partial')
  return { usage, byModel, priceStatus }
}

function enrichObservationEvent(event, billingConfig) {
  if (!event?.usage) return event
  const billingMode = resolveBillingConfig(event.model, billingConfig)?.mode || 'unconfigured'
  const priceConfigured = observationPriceConfigured(event.model, event.usage, billingConfig)
  const cost = calculateUsageCostWithBilling(event.model, event.usage, event.usage.rawCost, billingConfig, event.at || Date.now())
  return { ...event, usage: { ...event.usage, cost, billingMode }, priceConfigured }
}

function addUsageTotals(target, usage) {
  if (!usage) return target
  target.tokens += Number(usage.tokens) || 0
  target.cost += Number(usage.cost) || 0
  target.input += Number(usage.input) || 0
  target.output += Number(usage.output) || 0
  target.cacheRead += Number(usage.cacheRead) || 0
  target.cacheWrite += Number(usage.cacheWrite) || 0
  target.priceStatus = mergePriceStatus(target.priceStatus, usage.priceStatus)
  if (usage.billingMode) {
    target.billingMode = !target.billingMode || target.billingMode === usage.billingMode
      ? usage.billingMode
      : 'mixed'
  }
  return target
}

function createKeyedDictionary() {
  return Object.create(null)
}

function keyedDictionaryFrom(value) {
  const output = createKeyedDictionary()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output
  for (const [key, child] of Object.entries(value)) output[key] = child
  return output
}

function ensureUsageBucket(map, key) {
  if (!Object.hasOwn(map, key)) map[key] = createUsageTotals()
  return map[key]
}

// ============================================
// Local AI Usage: Codex / Claude Code
// 只读取本地日志里的 token 数字、模型、时间、项目路径，不读取对话正文。
// ============================================

const CODEX_HOME = path.join(os.homedir(), '.codex')
const CLAUDE_HOME = path.join(os.homedir(), '.claude')
const LOCAL_AI_USAGE_TTL = 30 * 1000
const LOCAL_AI_USAGE_MAX_DAYS = Math.min(
  365,
  Math.max(7, parseInt(process.env.OPENCLAW_LOCAL_AI_USAGE_MAX_DAYS || '90', 10) || 90)
)
const LOCAL_AI_USAGE_CACHE_MAX_ENTRIES = 8
const localAiUsageCache = new Map()
const localAiUsageInFlight = new Map()
let localAiUsageCacheGeneration = 0

function clearLocalAiUsageCache() {
  localAiUsageCacheGeneration += 1
  localAiUsageCache.clear()
  localAiUsageInFlight.clear()
}

function pruneLocalAiUsageCache(now = Date.now()) {
  for (const [key, cached] of localAiUsageCache) {
    if (!cached || (now - cached.at) >= LOCAL_AI_USAGE_TTL) localAiUsageCache.delete(key)
  }
  while (localAiUsageCache.size > LOCAL_AI_USAGE_CACHE_MAX_ENTRIES) {
    const oldestKey = localAiUsageCache.keys().next().value
    if (oldestKey === undefined) break
    localAiUsageCache.delete(oldestKey)
  }
}

function localStartOfDayMs(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function localDateKeyToMs(dateKey, endOfDay = false) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) return 0
  const d = new Date(`${dateKey}T00:00:00`)
  if (endOfDay) d.setHours(23, 59, 59, 999)
  return d.getTime()
}

function localDateKeyFromMs(timeMs) {
  if (!timeMs || !Number.isFinite(timeMs)) return ''
  const d = new Date(timeMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localHourKeyFromMs(timeMs) {
  if (!timeMs || !Number.isFinite(timeMs)) return ''
  const d = new Date(timeMs)
  return `${localDateKeyFromMs(timeMs)} ${String(d.getHours()).padStart(2, '0')}:00`
}

function localTimelineKeyFromMs(timeMs, granularity = 'day') {
  return granularity === 'hour' ? localHourKeyFromMs(timeMs) : localDateKeyFromMs(timeMs)
}

function localMaxStartMs(now = Date.now()) {
  return localStartOfDayMs(new Date(now - (LOCAL_AI_USAGE_MAX_DAYS - 1) * 86400_000))
}

function buildLocalUsageRange(searchParams) {
  const now = Date.now()
  const maxStartMs = localMaxStartMs(now)
  const granularity = searchParams.get('granularity') === 'hour' ? 'hour' : 'day'
  const startParam = searchParams.get('start')
  const endParam = searchParams.get('end')
  if (startParam || endParam) {
    const requestedStartMs = localDateKeyToMs(startParam) || 0
    const startMs = Math.max(requestedStartMs || maxStartMs, maxStartMs)
    const endMs = localDateKeyToMs(endParam, true) || now
    return {
      startMs,
      endMs,
      all: false,
      cappedDays: LOCAL_AI_USAGE_MAX_DAYS,
      capped: Boolean(requestedStartMs && requestedStartMs < maxStartMs),
      granularity,
      key: `start=${startParam || ''}&end=${endParam || ''}&granularity=${granularity}&max=${LOCAL_AI_USAGE_MAX_DAYS}`,
    }
  }

  const daysParam = searchParams.get('days') || '7'
  if (daysParam === 'all' || searchParams.get('range') === 'all') {
    return {
      startMs: maxStartMs,
      endMs: now,
      all: false,
      requestedAll: true,
      capped: true,
      cappedDays: LOCAL_AI_USAGE_MAX_DAYS,
      granularity,
      key: `all-capped-${LOCAL_AI_USAGE_MAX_DAYS}&granularity=${granularity}`,
    }
  }

  const days = Math.min(LOCAL_AI_USAGE_MAX_DAYS, Math.max(1, parseInt(daysParam, 10) || 7))
  return {
    startMs: localStartOfDayMs(new Date(now - (days - 1) * 86400_000)),
    endMs: now,
    all: false,
    cappedDays: LOCAL_AI_USAGE_MAX_DAYS,
    granularity,
    key: `days=${days}&granularity=${granularity}&max=${LOCAL_AI_USAGE_MAX_DAYS}`,
  }
}

function isTimeInLocalRange(timeMs, range) {
  if (!timeMs || !Number.isFinite(timeMs)) return false
  if (timeMs < range.startMs) return false
  if (range.endMs && timeMs > range.endMs) return false
  return true
}

function collectJsonlFiles(rootDir, maxDepth = 5, range = { startMs: 0 }) {
  const out = []
  const visit = (dir, depth) => {
    if (depth > maxDepth) return
    let entries = []
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'cache' || entry.name === 'file-history') continue
        visit(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      let stat
      try { stat = fsSync.statSync(full) } catch { continue }
      if (!range.all && range.startMs && stat.mtimeMs < range.startMs) continue
      out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size })
    }
  }
  visit(rootDir, 0)
  return out
}

async function forEachJsonlObject(filePath, onObject) {
  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const text = String(line || '').trim()
      if (!text) continue
      try {
        await onObject(JSON.parse(text))
      } catch {
        // 忽略单行解析失败或不相关行
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

function getLocalUsageTimestamp(entry) {
  const raw = entry?.timestamp || entry?.message?.timestamp || entry?.created_at || entry?.createdAt
  if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw
  const parsed = Date.parse(String(raw || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function extractLocalUsageTotals(raw = {}, options = {}) {
  const usage = extractUsageTotals(raw)
  const reasoning = firstNumber(
    raw.reasoningOutputTokens,
    raw.reasoning_output_tokens,
    raw.reasoningTokens,
    raw.reasoning_tokens
  )
  const explicitOutput = firstNumber(raw.outputTokens, raw.output_tokens, raw.completionTokens, raw.completion_tokens)
  if (reasoning && explicitOutput) usage.output += reasoning
  if (options.cachedInputIncludedInInput && usage.cacheRead > 0 && usage.input >= usage.cacheRead) {
    usage.input -= usage.cacheRead
  }
  return usage
}

function localConversationTitle(value, maxLength = 30) {
  const collectText = (content) => {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((part) => typeof part === 'string' || part?.type === 'text')
        .map((part) => typeof part === 'string' ? part : part.text)
        .join(' ')
    }
    if (content && typeof content === 'object') {
      if (typeof content.text === 'string') return content.text
      return collectText(content.content)
    }
    return ''
  }

  const text = collectText(value).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const chars = Array.from(text)
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}…` : text
}

function localConversationIdFromFile(filePath) {
  const base = path.basename(filePath, path.extname(filePath))
  const uuid = base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return uuid?.[0] || base
}

function localConversationFallbackName(appName, timeMs) {
  const date = localDateKeyFromMs(timeMs) || '未知日期'
  return `${appName} 对话 · ${date}`
}

function createLocalApp(id, name, itemLabel) {
  return {
    id,
    name,
    itemLabel,
    usage: createUsageTotals(),
    byModel: createKeyedDictionary(),
    timelineByDay: createKeyedDictionary(),
    items: [],
    updatedAt: '',
    lastActivityMs: 0,
  }
}

function localUsageSourceKey(appId, itemId) {
  return `local:${appId}:${itemId}`
}

function ensureLocalTimelineBucket(map, dateKey) {
  if (!Object.hasOwn(map, dateKey)) {
    map[dateKey] = {
      date: dateKey,
      ...createUsageTotals(),
      byModel: createKeyedDictionary(),
      byAgentByModel: createKeyedDictionary(),
    }
  }
  return map[dateKey]
}

function ensureLocalItem(app, id, name, meta = {}) {
  let item = app.items.find((row) => row.id === id)
  if (!item) {
    item = {
      id,
      name,
      type: meta.type || app.itemLabel || '项目',
      path: meta.path || '',
      project: meta.project || meta.path || '',
      model: meta.model || 'unknown',
      usage: createUsageTotals(),
      byModel: createKeyedDictionary(),
      updatedAt: '',
      lastActivityMs: 0,
      exists: false,
    }
    app.items.push(item)
  }
  if (meta.path && !item.path) item.path = meta.path
  if ((meta.project || meta.path) && !item.project) item.project = meta.project || meta.path
  if (meta.model && (!item.model || item.model === 'unknown')) item.model = meta.model
  return item
}

function localUsagePathExists(value) {
  const text = String(value || '').trim()
  if (!text) return false
  try {
    return fsSync.existsSync(text)
  } catch {
    return false
  }
}

function addLocalUsage(app, item, modelId, rawUsage, billingConfig, timeMs, range = {}) {
  const model = normalizeModelId(modelId || item.model || 'unknown')
  const usage = { ...rawUsage }
  usage.billingMode = resolveBillingConfig(model, billingConfig)?.mode || 'unconfigured'
  usage.priceStatus = observationPriceConfigured(model, usage, billingConfig) ? 'configured' : 'unconfigured'
  usage.cost = calculateUsageCostWithBilling(model, usage, usage.cost, billingConfig, timeMs)

  addUsageTotals(app.usage, usage)
  addUsageTotals(item.usage, usage)
  addUsageTotals(ensureUsageBucket(app.byModel, model), usage)
  addUsageTotals(ensureUsageBucket(item.byModel, model), usage)

  const dateKey = localTimelineKeyFromMs(timeMs, range.granularity)
  if (dateKey) {
    const bucket = ensureLocalTimelineBucket(app.timelineByDay, dateKey)
    const sourceId = localUsageSourceKey(app.id, item.id)
    addUsageTotals(bucket, usage)
    addUsageTotals(ensureUsageBucket(bucket.byModel, model), usage)
    if (!Object.hasOwn(bucket.byAgentByModel, sourceId)) bucket.byAgentByModel[sourceId] = createKeyedDictionary()
    addUsageTotals(ensureUsageBucket(bucket.byAgentByModel[sourceId], model), usage)
  }

  item.model = model
  item.lastActivityMs = Math.max(item.lastActivityMs || 0, timeMs || 0)
  item.updatedAt = item.lastActivityMs ? new Date(item.lastActivityMs).toISOString() : item.updatedAt
  app.lastActivityMs = Math.max(app.lastActivityMs || 0, item.lastActivityMs || 0)
  app.updatedAt = app.lastActivityMs ? new Date(app.lastActivityMs).toISOString() : app.updatedAt
}

function finalizeLocalApp(app) {
  for (const item of app.items) {
    item.exists = localUsagePathExists(item.path || item.id)
  }
  app.items = app.items
    .filter((item) => hasUsageValue(item.usage))
    .sort((a, b) => (b.usage.tokens || 0) - (a.usage.tokens || 0) || a.name.localeCompare(b.name, 'zh-CN'))
  app.timeline = Object.values(app.timelineByDay || {}).sort((a, b) => a.date.localeCompare(b.date))
  delete app.timelineByDay
  app.count = app.items.length
  return app
}

async function collectCodexUsage(range, billingConfig) {
  const app = createLocalApp('codex', 'Codex', '项目')
  const roots = [
    path.join(CODEX_HOME, 'sessions'),
    path.join(CODEX_HOME, 'archived_sessions'),
  ]
  for (const root of roots) {
    const files = collectJsonlFiles(root, 6, range)
    for (const file of files) {
      let conversationId = ''
      let conversationTitle = ''
      let currentCwd = ''
      let currentModel = 'unknown'
      let firstObservedModel = ''
      let firstActivityMs = 0
      const usageEvents = []
      await forEachJsonlObject(file.path, async (entry) => {
        const payload = entry?.payload || {}
        const entryTimeMs = getLocalUsageTimestamp(entry)
        if (entryTimeMs && (!firstActivityMs || entryTimeMs < firstActivityMs)) firstActivityMs = entryTimeMs
        if (entry?.type === 'session_meta' && payload) {
          conversationId = payload.id || conversationId
          currentCwd = payload.cwd || currentCwd
          currentModel = payload.model || currentModel
          if (!firstObservedModel && payload.model) firstObservedModel = payload.model
          return
        }
        if (entry?.type === 'turn_context' && payload) {
          currentCwd = payload.cwd || currentCwd
          currentModel = payload.model || payload.collaboration_mode?.settings?.model || currentModel
          if (!firstObservedModel && currentModel !== 'unknown') firstObservedModel = currentModel
          return
        }
        if (entry?.type === 'event_msg' && payload?.type === 'user_message' && !conversationTitle) {
          conversationTitle = localConversationTitle(payload.message)
          return
        }
        if (entry?.type !== 'event_msg' || payload?.type !== 'token_count') return
        const timeMs = entryTimeMs
        if (!isTimeInLocalRange(timeMs, range)) return
        const rawUsage = payload.info?.last_token_usage || payload.info?.total_token_usage
        const usage = extractLocalUsageTotals(rawUsage || {}, { cachedInputIncludedInInput: true })
        if (!hasUsageValue(usage)) return
        usageEvents.push({ usage, model: currentModel, timeMs })
      })

      if (!usageEvents.length) continue
      // 新版 Codex 会在部分会话开头先写 token_count，随后才写首个
      // turn_context。只回填这些前导事件；整份会话都没有明确模型时仍保持
      // unknown，避免把真正未知的用量猜成某个模型。
      if (firstObservedModel) {
        for (const event of usageEvents) {
          if (event.model !== 'unknown') break
          event.model = firstObservedModel
        }
      }
      const itemId = conversationId || localConversationIdFromFile(file.path)
      const item = ensureLocalItem(
        app,
        itemId,
        conversationTitle || localConversationFallbackName('Codex', firstActivityMs || file.mtimeMs),
        {
          type: '项目',
          path: currentCwd,
          project: currentCwd,
          model: usageEvents[0]?.model || currentModel,
        }
      )
      for (const event of usageEvents) {
        addLocalUsage(app, item, event.model, event.usage, billingConfig, event.timeMs, range)
      }
    }
  }
  return finalizeLocalApp(app)
}

async function collectClaudeCodeUsage(range, billingConfig) {
  const app = createLocalApp('claude-code', 'Claude Code', '项目')
  const root = path.join(CLAUDE_HOME, 'projects')
  const files = collectJsonlFiles(root, 5, range)
  for (const file of files) {
    const seenMessageIds = new Set()
    let conversationId = ''
    let customTitle = ''
    let aiTitle = ''
    let firstUserTitle = ''
    let currentCwd = ''
    let firstActivityMs = 0
    const usageEvents = []
    await forEachJsonlObject(file.path, async (entry) => {
      conversationId = entry?.sessionId || conversationId
      if (entry?.cwd) currentCwd = entry.cwd
      const entryTimeMs = getLocalUsageTimestamp(entry)
      if (entryTimeMs && (!firstActivityMs || entryTimeMs < firstActivityMs)) firstActivityMs = entryTimeMs
      if (entry?.type === 'custom-title') {
        customTitle = localConversationTitle(entry.customTitle || entry.title) || customTitle
        return
      }
      if (entry?.type === 'ai-title') {
        aiTitle = localConversationTitle(entry.aiTitle || entry.title) || aiTitle
        return
      }
      if (entry?.type === 'user' && !firstUserTitle) {
        firstUserTitle = localConversationTitle(entry?.message?.content)
      }
      const msg = entry?.message
      const usageRaw = msg?.usage || entry?.usage
      if (!usageRaw) return
      const messageId = msg?.id || entry?.uuid || `${file.path}:${entry?.timestamp || ''}`
      if (seenMessageIds.has(messageId)) return
      seenMessageIds.add(messageId)
      const timeMs = entryTimeMs
      if (!isTimeInLocalRange(timeMs, range)) return
      const usage = extractLocalUsageTotals(usageRaw)
      if (!hasUsageValue(usage)) return
      const model = msg?.model || entry?.model || usageRaw.model || 'unknown'
      usageEvents.push({ usage, model, timeMs })
    })

    if (!usageEvents.length) continue
    const itemId = conversationId || localConversationIdFromFile(file.path)
    const item = ensureLocalItem(
      app,
      itemId,
      customTitle || aiTitle || firstUserTitle || localConversationFallbackName('Claude Code', firstActivityMs || file.mtimeMs),
      {
        type: '项目',
        path: currentCwd,
        project: currentCwd,
        model: usageEvents[0]?.model || 'unknown',
      }
    )
    for (const event of usageEvents) {
      addLocalUsage(app, item, event.model, event.usage, billingConfig, event.timeMs, range)
    }
  }
  return finalizeLocalApp(app)
}

async function collectLocalAiUsage(range, billingConfig) {
  const cacheKey = String(range.key || 'default')
  const now = Date.now()
  const generation = localAiUsageCacheGeneration
  pruneLocalAiUsageCache(now)
  const cached = localAiUsageCache.get(cacheKey)
  if (cached && (now - cached.at) < LOCAL_AI_USAGE_TTL) {
    localAiUsageCache.delete(cacheKey)
    localAiUsageCache.set(cacheKey, cached)
    return cached.result
  }
  if (localAiUsageInFlight.has(cacheKey)) return localAiUsageInFlight.get(cacheKey)

  const task = (async () => {
    const apps = await Promise.all([
      collectCodexUsage(range, billingConfig),
      collectClaudeCodeUsage(range, billingConfig),
    ])
    const totals = createUsageTotals()
    const timelineByDay = createKeyedDictionary()
    if (range.granularity === 'hour') {
      const start = new Date(range.startMs || Date.now())
      start.setMinutes(0, 0, 0)
      const endMs = Math.min(range.endMs || Date.now(), Date.now())
      for (let t = start.getTime(); t <= endMs; t += 3600_000) {
        ensureLocalTimelineBucket(timelineByDay, localHourKeyFromMs(t))
      }
    }
    for (const app of apps) {
      addUsageTotals(totals, app.usage)
      for (const day of app.timeline || []) {
        const bucket = ensureLocalTimelineBucket(timelineByDay, day.date)
        addUsageTotals(bucket, day)
        for (const [model, usage] of Object.entries(day.byModel || {})) {
          addUsageTotals(ensureUsageBucket(bucket.byModel, model), usage)
        }
        for (const [sourceId, modelMap] of Object.entries(day.byAgentByModel || {})) {
          if (!Object.hasOwn(bucket.byAgentByModel, sourceId)) bucket.byAgentByModel[sourceId] = createKeyedDictionary()
          for (const [model, usage] of Object.entries(modelMap || {})) {
            addUsageTotals(ensureUsageBucket(bucket.byAgentByModel[sourceId], model), usage)
          }
        }
      }
    }
    const timeline = Object.values(timelineByDay).sort((a, b) => a.date.localeCompare(b.date))
    const result = {
      range: {
        startMs: range.startMs,
        endMs: range.endMs,
        all: range.all,
        requestedAll: Boolean(range.requestedAll),
        capped: Boolean(range.capped),
        cappedDays: range.cappedDays || LOCAL_AI_USAGE_MAX_DAYS,
        granularity: range.granularity || 'day',
      },
      apps,
      timeline,
      totals,
      updatedAt: new Date().toISOString(),
    }
    if (generation === localAiUsageCacheGeneration) {
      localAiUsageCache.delete(cacheKey)
      localAiUsageCache.set(cacheKey, { at: Date.now(), result })
      pruneLocalAiUsageCache()
    }
    return result
  })()

  localAiUsageInFlight.set(cacheKey, task)
  try {
    return await task
  } finally {
    if (localAiUsageInFlight.get(cacheKey) === task) localAiUsageInFlight.delete(cacheKey)
  }
}

/**
 * 从 .usage-cost-cache.json 读取某个 agent 的预计算用量
 * 返回 { sessionUuids: Set<string>, totals: { tokens, cost, input, output, cacheRead, cacheWrite }, byModel }
 */
async function readUsageCache(agentSessionsDir) {
  const cachePath = path.join(agentSessionsDir, '.usage-cost-cache.json')
  try {
    const content = await fs.readFile(cachePath, 'utf-8')
    const data = JSON.parse(content)
    if (!data?.files) return { sessionUuids: new Set(), totals: createUsageTotals(), byModel: createKeyedDictionary() }

    const sessionUuids = new Set()
    const totals = createUsageTotals()
    const byModel = createKeyedDictionary()
    const addModelUsage = (modelId, usage) => {
      addUsageTotals(ensureUsageBucket(byModel, normalizeModelId(modelId)), usage)
    }

    for (const [filePath, entry] of Object.entries(data.files)) {
      if (entry?.totals) {
        addUsageTotals(totals, extractUsageTotals(entry.totals))
      }
      // 从绝对路径中提取 UUID（兼容 .jsonl.deleted.* 等变体）
      const basename = path.basename(filePath)
      const uuid = extractSessionUuid(basename)
      if (uuid) sessionUuids.add(uuid)

      const usageEntries = Array.isArray(entry?.usageEntries) ? entry.usageEntries : []
      if (usageEntries.length > 0) {
        for (const usage of usageEntries) {
          addModelUsage(extractModelIdFromEntry(entry, usage), extractUsageTotals(usage))
        }
      } else if (entry?.totals) {
        const usage = extractUsageTotals(entry.totals)
        if (hasUsageValue(usage)) addModelUsage(extractModelIdFromEntry(entry, entry.totals), usage)
      }
    }

    return { sessionUuids, totals, byModel }
  } catch (e) {
    return { sessionUuids: new Set(), totals: createUsageTotals(), byModel: createKeyedDictionary() }
  }
}

/**
 * 从文件名中提取 session UUID
 * 格式: "uuid.jsonl", "uuid.jsonl.reset.TIMESTAMP", "uuid.jsonl.deleted.TIMESTAMP" 等
 */
function extractSessionUuid(filename) {
  // 匹配 .jsonl 前的 UUID 部分
  const match = filename.match(/^([a-f0-9-]+)\.jsonl/)
  return match ? match[1] : null
}

/**
 * 解析单个 .jsonl 文件，取最后一条累计值作为该 session 的总用量（含按模型分组）
 * .jsonl 中每行的 message.usage.totalTokens 是会话累计值，
 * 取最后（最大）一条即可得到该 session 的总 token 数。
 */
async function parseJsonlFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim())

    const sessionTotals = createUsageTotals()
    const byModel = createKeyedDictionary()  // model -> usage（各模型的最后累计值）

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        const usage = entry.message?.usage || entry.usage || entry.data?.usage || entry.usageMetadata || entry.usage_metadata || entry.data?.usageMetadata || entry.data?.usage_metadata
        if (usage) {
          const model = extractModelIdFromEntry(entry, usage)
          const parts = extractUsageTotals(usage)

          // totalTokens 是累计值 — 取最大（最后）一条
          if (parts.tokens > sessionTotals.tokens) {
            sessionTotals.tokens = parts.tokens
            sessionTotals.input = parts.input
            sessionTotals.output = parts.output
            sessionTotals.cacheRead = parts.cacheRead
            sessionTotals.cacheWrite = parts.cacheWrite
          }
          // cost.total 也是累计值 — 取最后一条
          if (parts.cost) sessionTotals.cost = parts.cost

          // 按模型记录（保留每个模型的最新/最大累计值）
          if (model && parts.tokens) {
            const modelUsage = ensureUsageBucket(byModel, model)
            if (parts.tokens > modelUsage.tokens) {
              byModel[model] = { ...parts }
            } else if (parts.cost) {
              modelUsage.cost = parts.cost
            }
          }
        }
      } catch (e) {
        // 忽略单行解析错误
      }
    }

    return { totalTokens: sessionTotals.tokens, totalCost: sessionTotals.cost, totals: sessionTotals, byModel }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message)
    return { totalTokens: 0, totalCost: 0, totals: createUsageTotals(), byModel: createKeyedDictionary() }
  }
}

/**
 * 判断文件名是否为可解析的 session 文件
 * 包含所有状态：活跃(.jsonl)、已重置(.jsonl.reset.*)、已删除(.jsonl.deleted.*)
 */
function isSessionFile(filename) {
  if (filename.startsWith('.')) return false
  if (filename.endsWith('.trajectory.jsonl')) return false
  if (filename.endsWith('.trajectory-path.json')) return false
  if (filename.includes('.bak-')) return false
  if (filename.endsWith('.tmp')) return false
  if (filename === 'sessions.json') return false
  if (filename.endsWith('.lock')) return false
  // 包含所有 .jsonl 变体
  return filename.includes('.jsonl') && !filename.startsWith('.usage-cost-cache')
}

/**
 * 读取所有 agent 的所有 session 用量
 * 数据来源优先级：
 *   1. .usage-cost-cache.json（OpenClaw 预计算，每行 input/output 非累计）
 *   2. 不在缓存中的 .jsonl 文件（新近会话，取最后一条累计值）
 * 包含 .jsonl.deleted.* 文件，确保清空会话后总量不减少
 */
async function collectUsageStats() {
  const now = Date.now()
  if (cachedUsageResult && (now - lastUsageUpdate) < CACHE_TTL) {
    return cachedUsageResult
  }

  const globalTotals = createUsageTotals()
  const byAgent = createKeyedDictionary()
  const byModel = createKeyedDictionary()        // 全局按模型汇总
  const byAgentByModel = createKeyedDictionary() // agent -> model -> usage

  try {
    const agents = await fs.readdir(AGENTS_DIR)

    for (const agent of agents) {
      const agentSessionsDir = path.join(AGENTS_DIR, agent, 'sessions')

      try {
        await fs.access(agentSessionsDir)
      } catch (e) {
        continue // 跳过无 sessions 目录的 agent
      }

      // Step 1: 从 usage-cache 获取预计算数据（按 uuid 索引）
      const cache = await readUsageCache(agentSessionsDir)
      const cachedUuids = cache.sessionUuids
      for (const [model, data] of Object.entries(cache.byModel || {})) {
        addUsageTotals(ensureUsageBucket(byModel, model), data)

        if (!Object.hasOwn(byAgentByModel, agent)) byAgentByModel[agent] = createKeyedDictionary()
        addUsageTotals(ensureUsageBucket(byAgentByModel[agent], model), data)
      }

      // 构建 uuid → usage 映射，用于替换活跃文件的缓存值
      const cacheByUuid = new Map()
      const cachePath = path.join(agentSessionsDir, '.usage-cost-cache.json')
      try {
        const cacheContent = await fs.readFile(cachePath, 'utf-8')
        const cacheData = JSON.parse(cacheContent)
        if (cacheData?.files) {
          for (const [filePath, entry] of Object.entries(cacheData.files)) {
            if (entry?.totals) {
              const basename = path.basename(filePath)
              const uuid = extractSessionUuid(basename)
              if (uuid) {
                cacheByUuid.set(uuid, extractUsageTotals(entry.totals))
              }
            }
          }
        }
      } catch (e) { /* 已经通过 readUsageCache 处理了 */ }

      // Step 2: 扫描文件系统，每个 uuid 只计一次
      // 优先级：活跃 .jsonl 文件 > 缓存 > 归档文件解析
      const files = await fs.readdir(agentSessionsDir)
      const sessionFiles = files.filter(isSessionFile)

      // 收集所有文件的 uuid 和类型
      const fileEntries = sessionFiles.map(file => ({
        file,
        uuid: extractSessionUuid(file),
        isActive: file.endsWith('.jsonl') &&
          !file.includes('.reset') &&
          !file.includes('.deleted') &&
          !file.includes('.bak') &&
          !file.includes('.lock')
      })).filter(e => e.uuid)

      // 去重：活跃文件优先，同一个 uuid 只保留一个
      const seenUuids = new Set()
      const filesToParse = []

      // 先处理活跃文件（优先级最高）
      for (const entry of fileEntries) {
        if (entry.isActive && !seenUuids.has(entry.uuid)) {
          seenUuids.add(entry.uuid)
          filesToParse.push(entry)
        }
      }
      // 再处理非活跃文件（uuid 未被活跃文件占用）
      for (const entry of fileEntries) {
        if (!entry.isActive && !seenUuids.has(entry.uuid)) {
          seenUuids.add(entry.uuid)
          filesToParse.push(entry)
        }
      }

      const agentUsage = createUsageTotals()
      let sessionCount = 0

      for (const { file, uuid } of filesToParse) {
        // 缓存优先（包含 cacheRead 等全部历史数据，不受文件截断影响）
        const cacheEntry = cacheByUuid.get(uuid)

        if (cacheEntry) {
          addUsageTotals(agentUsage, cacheEntry)
          sessionCount++
          continue
        }

        // 缓存中没有的 → 实时解析 .jsonl 作为后备
        const filePath = path.join(agentSessionsDir, file)
        const result = await parseJsonlFile(filePath)
        if (hasUsageValue(result.totals)) {
          addUsageTotals(agentUsage, result.totals)

          sessionCount++

          // 聚合按模型数据
          for (const [model, data] of Object.entries(result.byModel || {})) {
            addUsageTotals(ensureUsageBucket(byModel, model), data)

            if (!Object.hasOwn(byAgentByModel, agent)) byAgentByModel[agent] = createKeyedDictionary()
            addUsageTotals(ensureUsageBucket(byAgentByModel[agent], model), data)
          }
        }
      }

      // 缓存中有但文件系统已完全删除的 session → 计入
      for (const [uuid, entry] of cacheByUuid) {
        if (!seenUuids.has(uuid)) {
          addUsageTotals(agentUsage, entry)
          if (hasUsageValue(entry)) sessionCount++
        }
      }

      if (hasUsageValue(agentUsage)) {
        byAgent[agent] = { ...agentUsage, sessionCount }
        addUsageTotals(globalTotals, agentUsage)
      }
    }

    const result = {
      totalTokens: globalTotals.tokens,
      totalCost: globalTotals.cost,
      totalInputTokens: globalTotals.input,
      totalOutputTokens: globalTotals.output,
      totalCacheReadTokens: globalTotals.cacheRead,
      totalCacheWriteTokens: globalTotals.cacheWrite,
      byAgent,
      byModel,
      byAgentByModel,
      updatedAt: new Date().toISOString(),
      version: openclawVersion
    }

    cachedUsageResult = result
    lastUsageUpdate = now

    return result
  } catch (e) {
    console.error('Error collecting usage stats:', e.message)
    return {
      totalTokens: 0,
      totalCost: 0,
      byAgent: createKeyedDictionary(),
      updatedAt: new Date().toISOString(),
      version: openclawVersion
    }
  }
}

// ============================================
// GPU VRAM 功能
// ============================================

/**
 * 获取 GPU VRAM 使用情况
 * 本地查询：macOS system_profiler > nvidia-smi
 */
async function getGpuVram() {
  const platform = os.platform()

  if (platform === 'darwin') {
    return getMacOSGpuInfo()
  }

  try {
    return await runNvidiaSmi()
  } catch (e) {
    console.log('[GPU] nvidia-smi 不可用:', e.message)
    return { usedPct: null, nvidiaSmiAvailable: false }
  }
}

function getMacOSGpuInfo() {
  return new Promise((resolve) => {
    // 修复 R-10: spawn 选项不支持 timeout，改用 setTimeout + child.kill()
    const child = spawn('system_profiler', ['SPDisplaysDataType'], { shell: false, env: commandEnvironment() })

    const timeoutId = setTimeout(() => {
      console.log('[GPU] macOS system_profiler 超时，强制终止')
      child.kill('SIGKILL')
      resolve({ usedPct: null })
    }, 10000)

    let stdout = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      if (code !== 0) {
        resolve({ usedPct: null })
        return
      }

      // 解析 GPU 名称
      const gpuMatch = stdout.match(/Chipset Model:\s*(.+)/)
      const gpuName = gpuMatch?.[1]?.trim() || null

      // 解析 VRAM (如 "VRAM: 16 MB" 或 "VRAM: 16 GB")
      const vramMatch = stdout.match(/VRAM:\s*(\d+)\s*(MB|GB)/i)
      let totalMb = 0
      if (vramMatch) {
        const value = parseInt(vramMatch[1], 10)
        const unit = vramMatch[2].toUpperCase()
        totalMb = unit === 'GB' ? value * 1024 : value
      }

      resolve({ usedPct: null, totalMb, gpuName: gpuName || undefined })
    })

    child.on('error', () => {
      clearTimeout(timeoutId)
      resolve({ usedPct: null })
    })
  })
}

function runNvidiaSmi() {
  return new Promise((resolve, reject) => {
    const isWindows = os.platform() === 'win32'

    let command
    let args

    if (isWindows) {
      command = 'C:\\Windows\\System32\\nvidia-smi.exe'
      args = [
        '--query-gpu=memory.used,memory.total',
        '--format=csv,noheader,nounits'
      ]
    } else {
      command = 'nvidia-smi'
      args = [
        '--query-gpu=memory.used,memory.total',
        '--format=csv,noheader,nounits'
      ]
    }

    // 修复 R-13: spawn 选项不支持 timeout，改用 setTimeout + child.kill()
    const child = spawn(command, args, { shell: false, windowsHide: isWindows, env: commandEnvironment() })

    const timeoutId = setTimeout(() => {
      console.log('[GPU] nvidia-smi 超时，强制终止')
      child.kill('SIGKILL')
      reject(new Error('nvidia-smi timeout after 10s'))
    }, 10000)

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`nvidia-smi exited with code ${code}: ${stderr.trim()}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeoutId)
      reject(err)
    })
  })
}

function parseVramOutput(output) {
  // 兼容非字符串输入（如 getGpuVram 错误分支返回的对象）
  if (typeof output !== 'string' || !output.trim()) {
    return { usedPct: null }
  }
  const lines = output.split('\n').filter(l => l.trim())
  if (lines.length === 0) {
    return { usedPct: null }
  }

  let totalUsed = 0
  let totalMemory = 0

  for (const line of lines) {
    const parts = line.split(',').map(s => parseFloat(s.trim()))
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      totalUsed += parts[0]
      totalMemory += parts[1]
    }
  }

  if (totalMemory === 0) {
    return { usedPct: null }
  }

  const usedPct = Math.round((totalUsed / totalMemory) * 100)

  return {
    usedPct,
    usedMb: Math.round(totalUsed),
    totalMb: Math.round(totalMemory)
  }
}

// ============================================
// Reset Agent 功能
// ============================================

/**
 * 重置指定 Agent 的会话
 */
async function resetAgent(agentId) {
  const safeAgentId = assertAgentId(agentId)
  const result = await runOpenClawCommand([
    'agent', optionValue('--agent', safeAgentId), optionValue('--message', '/reset'), '--local',
  ], 30000, { gatewayAccess: true })
  return { ...result, agentId: safeAgentId }
}

// ============================================
// Tasks API — 当前任务进度
// ============================================

// .openclaw 目录（项目级）
const PROJECT_OPENCLAW_DIR = path.join(__dirname, '..', '.openclaw')

/**
 * 读取 REC-STATUS.json 和 REC-TASK-DOING.json，获取当前任务数据
 */
async function getCurrentTaskData() {
  const recStatusPath = path.join(PROJECT_OPENCLAW_DIR, 'REC-STATUS.json')
  const recDoingPath = path.join(PROJECT_OPENCLAW_DIR, 'REC-TASK-DOING.json')

  let recStatus = { currentTask: null, status: 'idle', phase: null, agent: null, lastUpdate: null }
  let recDoing = { tasks: [], pendingTasks: [] }

  try {
    const content = await fs.readFile(recStatusPath, 'utf-8')
    recStatus = JSON.parse(content)
  } catch (e) { /* 文件不存在或解析失败 */ }

  try {
    const content = await fs.readFile(recDoingPath, 'utf-8')
    recDoing = JSON.parse(content)
  } catch (e) { /* 文件不存在或解析失败 */ }

  // 合并：以 recDoing 中对应任务的信息补充
  const taskId = recStatus.currentTask
  let taskInfo = null
  if (taskId) {
    taskInfo = recDoing.tasks.find(t => t.rec === taskId) || null
  }

  return {
    taskId: taskId,
    status: recStatus.status,
    phase: taskInfo?.phase || recStatus.phase,
    agent: taskInfo?.agent || recStatus.agent,
    lastUpdate: taskInfo?.lastUpdate || recStatus.lastUpdate,
    dispatchedAt: taskInfo?.dispatchedAt || null,
    description: taskInfo?.description || null,
    pendingTasks: recDoing.pendingTasks || recStatus.pendingTasks || []
  }
}

/**
 * 扫描 .openclaw 目录下 REC-{taskId}-* 文件，检测涉及的 agent 和阶段完成度
 */
async function scanTaskProgress(taskId) {
  try {
    const files = await fs.readdir(PROJECT_OPENCLAW_DIR)
    const prefix = `${taskId}-`

    // 检测阶段文件是否存在
    let hasAnalyze = false, hasExecute = false, hasAudit = false, hasTest = false

    // 检测是否有多 agent（通过文件名中的 agent 前缀识别）
    const multiAgentFiles = createKeyedDictionary()

    for (const file of files) {
      if (!file.startsWith(prefix)) continue

      // 识别 agent 前缀：REC-XXX-backend-* 或 REC-XXX-frontend-*
      const agentMatch = file.match(/^REC-\d+-(backend|frontend)-/)
      const agentName = agentMatch ? agentMatch[1] : null

      // 有 agent 前缀的文件：按 agent 分类
      if (agentName) {
        if (!Object.hasOwn(multiAgentFiles, agentName)) multiAgentFiles[agentName] = []
        multiAgentFiles[agentName].push(file)
        continue
      }

      // 前端专属文件（检测前端 agent）— 不参与通用阶段标志
      if (file.includes('前端')) {
        if (!Object.hasOwn(multiAgentFiles, 'frontend')) multiAgentFiles.frontend = []
        multiAgentFiles['frontend'].push(file)
        continue
      }

      // 无 agent 前缀的通用阶段文件（backend 拥有）
      if (file.includes('分析')) hasAnalyze = true
      if (file.includes('修复') || (file.match(/\.md$/i) && file.includes('fix'))) hasExecute = true
      if (file.includes('代码审计')) hasAudit = true
      if (file.includes('测试')) hasTest = true
    }

    // 构建 agent 列表
    const allAgents = Object.keys(multiAgentFiles)

    // 如果有通用阶段文件，添加 backend agent
    const hasAnyStageFile = hasAnalyze || hasExecute || hasAudit || hasTest
    if (!allAgents.includes('backend') && hasAnyStageFile) {
      allAgents.unshift('backend')
    }

    // 如果没有 agent 但无阶段文件，返回空
    if (allAgents.length === 0 && !hasAnyStageFile) {
      return { agents: [], error: null }
    }

    const totalPhases = 4
    const agents = allAgents.map(name => {
      const agentFiles = multiAgentFiles[name] || []

      let analyze = false
      let execute = false
      let audit = false
      let test = false

      // 如果有多 agent 文件，按 agent 分类计算
      if (agentFiles.length > 0) {
        analyze = agentFiles.some(f => f.includes('分析'))
        execute = agentFiles.some(f => f.includes('修复') || f.includes('fix'))
        audit = agentFiles.some(f => f.includes('代码审计') || f.includes('audit'))
        test = agentFiles.some(f => f.includes('测试') || f.includes('test'))
      } else if (name === 'backend') {
        // backend 无专属文件时，继承通用文件标志（backend 拥有通用文件）
        analyze = hasAnalyze
        execute = hasExecute
        audit = hasAudit
        test = hasTest
      }

      const completedCount = [analyze, execute, audit, test].filter(Boolean).length
      const progress = Math.round((completedCount / totalPhases) * 100)

      let currentStage = 'completed'
      if (!analyze) currentStage = 'analyze'
      else if (!execute) currentStage = 'execute'
      else if (!audit) currentStage = 'audit'
      else if (!test) currentStage = 'test'

      const status = currentStage === 'completed' ? '已完成' : '执行中'

      return {
        name,
        status,
        currentStage: currentStage === 'completed' ? null : currentStage,
        _analyze: analyze,
        _execute: execute,
        _audit: audit,
        _test: test
      }
    })

    return { agents, error: null }
  } catch (e) {
    return { agents: [], error: e.message }
  }
}

/**
 * 获取当前任务进度
 * @param {string} taskId - 可选，指定任务 ID（默认从 REC-STATUS.json 读取）
 */
async function getCurrentTaskProgress(taskId) {
  const data = await getCurrentTaskData()
  const targetTaskId = taskId || data.taskId

  if (!targetTaskId) {
    return {
      taskId: null,
      projectName: null,
      taskName: null,
      progress: 0,
      currentStage: null,
      totalStages: 0,
      agents: [],
      startedAt: null,
      runningMinutes: 0
    }
  }

  const { agents } = await scanTaskProgress(targetTaskId)

  // 计算整体进度（取所有 agent 平均进度）
  let overallProgress = 0
  let overallStage = null
  if (agents.length > 0) {
    let totalPct = 0
    let firstRunning = null
    for (const a of agents) {
      const cnt = [a._analyze, a._execute, a._audit, a._test].filter(Boolean).length
      totalPct += cnt * 25
      if (!firstRunning && a.currentStage) firstRunning = a.currentStage
    }
    overallProgress = Math.round(totalPct / agents.length)
    overallStage = firstRunning
  }

  // 开始时间
  const startedAt = data.dispatchedAt || data.lastUpdate || new Date().toISOString()
  const startedMs = new Date(startedAt).getTime()
  const runningMinutes = Math.max(0, Math.round((Date.now() - startedMs) / 60000))

  // 查找任务描述
  const taskDescription = data.taskId === targetTaskId ? data.description : null

  return {
    taskId: targetTaskId,
    projectName: 'AI 工作台总控',
    taskName: taskDescription || targetTaskId,
    progress: overallProgress,
    currentStage: overallStage,
    totalStages: 4,
    agents: agents.map(a => {
      const label = `${a.name}(${a.status})`
      return a.currentStage ? `${label}[${a.currentStage}]` : label
    }),
    startedAt,
    runningMinutes
  }
}

/**
 * 解析 clawhub search 命令的输出为技能数组
 * 格式: "name  @author  description  (score)"
 */
function parseClawHubSearchOutput(rawOutput) {
  const skills = []
  const lines = rawOutput.split('\n').filter(l => l.trim())

  for (const line of lines) {
    // 跳过 "- Searching" 等提示行
    if (line.startsWith('-') || line.startsWith('Searching') || line.startsWith('No results')) continue

    // 按双空格分割: name  @author  description  (score)
    const parts = line.split('  ').map(s => s.trim()).filter(Boolean)
    if (parts.length < 1) continue

    const name = parts[0] || ''
    const authorPart = parts[1] || ''
    const description = parts[2] || ''
    const scoreMatch = parts[3]?.match(/\(([\d.]+)\)/)
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0

    const author = authorPart.replace(/^@/, '')

    skills.push({
      name,
      author,
      description,
      score,
      installed: false,
      source: 'clawhub',
      sourceRaw: 'clawhub',
      sourceLabel: 'ClawHub 社区',
      sourceMaintainer: author ? `@${author}` : '未知维护者',
      sourceTrust: author && /^openclaw$/i.test(author) ? '官方' : '社区',
      sourceKind: author && /^openclaw$/i.test(author) ? 'official' : 'community'
    })
  }

  return skills
}

function parseMaintainerFromUrl(homepage) {
  const raw = String(homepage || '')
  const match = raw.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)(?:\/([^/?#]+))?/i)
  if (match) return match[2] ? `${match[1]}/${match[2]}` : match[1]
  return ''
}

function buildSkillSourceInfo(skill) {
  const raw = String(skill?.source || '')
  const homepage = String(skill?.homepage || '')
  const homepageMaintainer = parseMaintainerFromUrl(homepage)

  if (raw === 'openclaw-bundled') {
    return {
      sourceRaw: raw,
      sourceLabel: 'OpenClaw 官方内置',
      sourceMaintainer: 'OpenClaw',
      sourceTrust: '官方',
      sourceKind: 'official'
    }
  }
  if (raw === 'openclaw-extra') {
    return {
      sourceRaw: raw,
      sourceLabel: 'OpenClaw 官方扩展',
      sourceMaintainer: 'OpenClaw',
      sourceTrust: '官方',
      sourceKind: 'official'
    }
  }
  if (raw === 'openclaw-workspace') {
    return {
      sourceRaw: raw,
      sourceLabel: '本地工作区',
      sourceMaintainer: '当前工作区',
      sourceTrust: '本地',
      sourceKind: 'workspace'
    }
  }
  if (raw === 'openclaw-managed') {
    return {
      sourceRaw: raw,
      sourceLabel: '本机已安装',
      sourceMaintainer: homepageMaintainer || '本机托管',
      sourceTrust: homepageMaintainer ? '社区' : '本地',
      sourceKind: homepageMaintainer ? 'community' : 'managed'
    }
  }
  if (raw === 'agents-skills-project') {
    return {
      sourceRaw: raw,
      sourceLabel: '项目技能',
      sourceMaintainer: '项目目录',
      sourceTrust: '项目',
      sourceKind: 'project'
    }
  }
  if (raw === 'agents-skills-personal') {
    return {
      sourceRaw: raw,
      sourceLabel: '个人技能',
      sourceMaintainer: '个人目录',
      sourceTrust: '个人',
      sourceKind: 'personal'
    }
  }
  if (raw === 'clawhub') {
    const author = String(skill?.author || '')
    return {
      sourceRaw: raw,
      sourceLabel: 'ClawHub 社区',
      sourceMaintainer: author ? `@${author}` : homepageMaintainer || '未知维护者',
      sourceTrust: author && /^openclaw$/i.test(author) ? '官方' : '社区',
      sourceKind: author && /^openclaw$/i.test(author) ? 'official' : 'community'
    }
  }
  return {
    sourceRaw: raw || 'unknown',
    sourceLabel: raw ? raw : '未知来源',
    sourceMaintainer: homepageMaintainer || '未知维护者',
    sourceTrust: '未知',
    sourceKind: 'unknown'
  }
}

/**
 * REC-014: 获取已安装技能名称集合
 * 通过 openclaw skills list --json 获取，判断 missing 为空即为已安装
 */
async function getInstalledSkillNames() {
  const isWindows = os.platform() === 'win32'
  const command = isWindows ? 'openclaw.cmd' : 'openclaw'
  const installedNames = new Set()

  try {
    const result = await runCommand(command, ['skills', 'list', '--json'], 30000)
    if (result.success) {
      let rawOutput = result.stdout || result.stderr || ''
      const jsonStart = rawOutput.indexOf('{')
      if (jsonStart >= 0) {
        const jsonStr = rawOutput.slice(jsonStart)
        const parsed = JSON.parse(jsonStr)
        const skills = parsed.skills || []
        for (const skill of skills) {
          const m = skill.missing || {}
          const isInstalled = (m.bins || []).length === 0
            && (m.anyBins || []).length === 0
            && (m.env || []).length === 0
            && (m.config || []).length === 0
            && (m.os || []).length === 0
          if (isInstalled && skill.name) {
            installedNames.add(skill.name)
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Installed Skills] 获取失败:', err.message)
  }

  console.log(`[Installed Skills] 已安装技能: ${[...installedNames].join(', ') || '(none)'}`)
  return installedNames
}

/**
 * REC-016: 获取已安装技能信息，用于与 ClawHub 搜索结果匹配
 *
 * 问题根因：
 *   - ClawHub 搜索返回 slug: "douyin-no-watermark-downloader"
 *   - 已安装技能名称是文件夹名: "无水印抖音视频下载器"
 *   - 部分技能无 homepage 字段，无法提取 slug
 *
 * 匹配策略（优先级从高到低）:
 *   1. slug 精确匹配（从 homepage URL 提取的 ClawHub slug）
 *   2. 名称精确匹配（skill.name 直接对比）
 *   3. 描述关键词匹配（搜索结果的 description 包含在已安装技能的 description 中或反之）
 */
async function getInstalledSkillInfo() {
  const isWindows = os.platform() === 'win32'
  const command = isWindows ? 'openclaw.cmd' : 'openclaw'
  const installedSlugs = new Set()
  const installedNames = new Set()
  const installedDescriptions = [] // {name, description}

  try {
    const result = await runCommand(command, ['skills', 'list', '--json'], 30000)
    if (result.success) {
      let rawOutput = result.stdout || result.stderr || ''
      const jsonStart = rawOutput.indexOf('{')
      if (jsonStart >= 0) {
        const jsonStr = rawOutput.slice(jsonStart)
        const parsed = JSON.parse(jsonStr)
        const skills = parsed.skills || []
        for (const skill of skills) {
          // 从 homepage URL 提取 ClawHub slug（clawhub.ai / clawic.com）
          const homepage = skill.homepage || ''
          const slugMatch = homepage.match(/(?:clawhub\.ai|clawic\.com)\/skills\/([^/?#]+)/)
          if (slugMatch) {
            installedSlugs.add(slugMatch[1])
          }

          // 名称集合
          if (skill.name) {
            installedNames.add(skill.name)
          }

          // 描述信息（用于模糊匹配）
          const desc = (skill.description || '').trim()
          if (desc) {
            installedDescriptions.push({ name: skill.name, description: desc })
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Installed Skill Info] 获取失败:', err.message)
  }

  console.log(`[Installed Skill Info] slugs: ${installedSlugs.size}, names: ${installedNames.size}, descriptions: ${installedDescriptions.length}`)
  return { installedSlugs, installedNames, installedDescriptions }
}

/**
 * 通过 clawhub inspect --json 获取单个技能的统计信息
 * 返回 { updatedAt, stars, downloads } 或 null
 * 注意: clawhub inspect --json 可能返回非 0 退出码但仍有有效 JSON 输出
 */
async function getClawHubSkillInfo(skillName) {
  const isWindows = os.platform() === 'win32'
  const command = isWindows ? 'npx.cmd' : 'npx'
  const INSPECT_TIMEOUT = 5000 // 5 秒超时（REC-013 优化：缩短超时减少阻塞）

  const safeSkillName = assertSkillId(skillName)
  const result = await runCommand(command, ['clawhub', 'inspect', '--json', '--', safeSkillName], INSPECT_TIMEOUT)

  // clawhub inspect --json 可能返回非 0 退出码但仍有有效 JSON，所以即使 success=false 也尝试解析
  const output = (result.stdout || '') + (result.stderr || '')

  // 解析 JSON 输出（跳过 "- Fetching skill" 等提示行）
  // JSON 对象可能跨多行，从第一个 { 开始到最后一个 } 结束
  const firstBrace = output.indexOf('{')
  const lastBrace = output.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return null
  }
  const jsonStr = output.substring(firstBrace, lastBrace + 1)

  if (!jsonStr) {
    return null
  }

  try {
    const data = JSON.parse(jsonStr)
    const skill = data.skill || {}
    const stats = skill.stats || {}

    // updatedAt 是毫秒时间戳，转为 ISO 日期字符串
    const updatedAt = skill.updatedAt ? new Date(skill.updatedAt).toISOString().split('T')[0] : null

    return {
      updatedAt,
      slug: skill.slug || null,
      displayName: skill.displayName || null,
      stars: stats.stars || 0,
      downloads: stats.downloads || 0
    }
  } catch (parseError) {
    return null
  }
}

/**
 * 批量获取技能统计信息（并行调用，限制并发数）
 * REC-013 优化：
 * - 并发数 5 → 10（减少批次，降低总耗时）
 * - 单个超时 15s → 5s（快速跳过慢响应）
 * - 失败立即跳过而非阻塞
 */
async function enrichSkillsWithInfo(skills, maxConcurrent = 10) {
  if (skills.length === 0) return

  const enrichStartTime = Date.now()

  // 按批次并行执行，提高并发数减少批次
  for (let i = 0; i < skills.length; i += maxConcurrent) {
    const batch = skills.slice(i, i + maxConcurrent)
    // Promise.allSettled 确保单个失败不影响其他请求
    const results = await Promise.allSettled(
      batch.map(skill => getClawHubSkillInfo(skill.name))
    )

    // 将结果合并回 skills 数组
    for (let j = 0; j < batch.length; j++) {
      const result = results[j]
      // 处理 rejected 或返回 null 的情况（REC-013：失败跳过而非阻塞）
      if (result.status === 'fulfilled' && result.value) {
        batch[j].updatedAt = result.value.updatedAt
        batch[j].slug = result.value.slug || null
        batch[j].displayName = result.value.displayName || null
        batch[j].stars = result.value.stars
        batch[j].downloads = result.value.downloads
      } else {
        batch[j].updatedAt = null
        batch[j].slug = null
        batch[j].displayName = null
        batch[j].stars = 0
        batch[j].downloads = 0
      }
    }
  }

  const enrichDuration = ((Date.now() - enrichStartTime) / 1000).toFixed(1)
  console.log(`[Skills Enrich] 完成 ${skills.length} 个技能 enrich，耗时 ${enrichDuration}s`)
}

// ============================================
// HTTP Server
// ============================================

export const server = http.createServer(async (req, res) => {
  const contextDecision = validateRequestContext(req, LOCAL_REQUEST_POLICY)
  if (!contextDecision.ok) {
    sendBoundaryError(res, contextDecision)
    return
  }
  applyTrustedCorsHeaders(req, res, LOCAL_REQUEST_POLICY.allowedOrigins)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // 工作台应用接口统一做精确脱密；Gateway 原生资源、WS 与二进制响应不经过此层。
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/reset') {
    installBrowserOutputRedaction(res, browserOutputSecrets)
  }

  // 健康检查放行，其余本地后端接口全部要求 Vite 代理注入共享 token。
  if (pathname !== '/api/health') {
    const tokenDecision = validateLocalToken(req, LOCAL_TOKEN)
    if (!tokenDecision.ok) {
      sendBoundaryError(res, tokenDecision)
      return
    }
  }

  const contentDecision = validateJsonWriteRequest(req)
  if (!contentDecision.ok) {
    sendBoundaryError(res, contentDecision)
    return
  }

  const sealedFeature = sealedFeatureForPath(pathname)
  if (sealedFeature) {
    sendJson(res, 503, sealedFeaturePayload(sealedFeature))
    return
  }

  if (pathname === '/gateway-api' || pathname.startsWith('/gateway-api/')) {
    proxyGatewayControlRequest(req, res, {
      gatewayUrl: GATEWAY_CREDENTIALS.gatewayUrl,
      gatewayToken: GATEWAY_CREDENTIALS.token,
    })
    return
  }

  if (pathname === '/api/public-config' && (req.method === 'GET' || req.method === 'HEAD')) {
    const payload = JSON.stringify(publicDashboardConfig())
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(payload),
    })
    if (req.method === 'GET') res.end(payload)
    else res.end()
    return
  }

  // ============================================
  // GPU VRAM API
  // ============================================

  if (pathname === '/api/gpu-vram') {
    if (req.method === 'GET') {
      try {
        const output = await getGpuVram()
        const result = parseVramOutput(output)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (error) {
        console.error('[GPU] Error:', error.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ usedPct: null }))
      }
      return
    }
  }

  // ============================================
  // Usage Stats API
  // ============================================

  if (pathname === '/api/usage') {
    if (req.method === 'GET') {
      try {
        const stats = await collectUsageStats()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(stats))
      } catch (error) {
        console.error('[Usage] Error:', error.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: error.message }))
      }
      return
    }
  }

  // ============================================
  // Health Check API
  // ============================================

  if (pathname === '/api/health') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        port: PORT,
        uptime: process.uptime(),
        uptimeMs: Math.max(0, Date.now() - SERVICE_STARTED_AT_MS),
        startedAt: new Date(SERVICE_STARTED_AT_MS).toISOString(),
        timestamp: new Date().toISOString()
      }))
      return
    }
  }

  // ============================================
  // 已配置 Agent 列表 API（从 openclaw.json 读取）
  // 解决 dashboard 只能显示有 webchat 会话的 agent 的问题
  // ============================================

  if (pathname === '/api/agents-configured' && req.method === 'GET') {
    try {
      const { agents } = await readConfiguredAgents()
      sendJson(res, 200, { agents, count: agents.length })
    } catch (e) {
      console.error('[agents-configured] 读取失败:', e.message)
      sendJson(res, 500, { error: e.message })
    }
    return
  }

  if (pathname.startsWith('/api/agent-avatar/') && (req.method === 'GET' || req.method === 'HEAD')) {
    try {
      const id = decodeURIComponent(pathname.slice('/api/agent-avatar/'.length))
      const filePath = resolveConfiguredAvatarFile(id) || defaultAvatarFile()
      const type = avatarContentType(filePath)
      if (!filePath || !type || !fsSync.existsSync(filePath)) {
        sendJson(res, 404, { error: 'avatar not found' })
        return
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      fsSync.createReadStream(filePath).pipe(res)
    } catch (e) {
      console.error('[agent-avatar] 读取失败:', e.message)
      sendJson(res, 500, { error: e.message })
    }
    return
  }

  // ============================================
  // 快捷发送配置：GET / POST /api/quick-message-config
  // 存储在 ~/.openclaw/dashboard-quick-message.json
  // ============================================
  if (pathname === '/api/quick-message-config' && req.method === 'GET') {
    try {
      sendJson(res, 200, await readQuickMessageConfig())
    } catch (e) {
      console.error('[quick-message-config GET] error:', e.message)
      sendJson(res, 500, { success: false, error: e.message })
    }
    return
  }

  if (pathname === '/api/quick-message-config' && req.method === 'POST') {
    try {
      const payload = await readJsonRequest(req, 128 * 1024)
      const result = await writeQuickMessageConfig(payload)
      sendJson(res, 200, { success: true, ...result, path: displayUserPath(QUICK_MESSAGE_CONFIG_FILE) })
    } catch (e) {
      console.error('[quick-message-config POST] error:', e.message)
      sendJson(res, 400, { success: false, error: e.message })
    }
    return
  }

  // ============================================
  // Agent Running Status API（基于 session 文件修改时间检测运行状态）
  // ============================================

  if (pathname === '/api/agent-running-status' && req.method === 'GET') {
    try {
      const RUNNING_THRESHOLD_MS = 90 * 1000
      const now = Date.now()

      // 动态读取 openclaw.json 中的 agent 列表，避免硬编码
      let agentIds = []
      try {
        const configRaw = await fs.readFile(path.join(OPENCLAW_DIR, 'openclaw.json'), 'utf-8')
        const config = JSON.parse(configRaw)
        const list = config?.agents?.list || []
        agentIds = list.map(a => a.id).filter(Boolean)
      } catch (e) {
        console.warn('[agent-running-status] 读取 openclaw.json 失败，返回空列表:', e.message)
      }

      const results = []

      for (const id of agentIds) {
        const sessionsDir = path.join(AGENTS_DIR, id, 'sessions')
        let latestMtime = 0

        try {
          const files = fsSync.readdirSync(sessionsDir)
          const sessionFiles = files.filter(f =>
            f.endsWith('.jsonl') &&
            !f.includes('.trajectory') &&
            !f.includes('.reset') &&
            !f.includes('.bak') &&
            !f.includes('.tmp') &&
            f !== 'sessions.json'
          )
          for (const file of sessionFiles) {
            const stat = fsSync.statSync(path.join(sessionsDir, file))
            if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs
          }
        } catch (e) { /* 目录不存在，忽略 */ }

        const msAgo = latestMtime > 0 ? now - latestMtime : Infinity
        results.push({
          id,
          status: msAgo < RUNNING_THRESHOLD_MS ? 'running' : 'idle',
          lastModifiedMs: latestMtime,
          msAgo: latestMtime > 0 ? Math.round(msAgo) : null
        })
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ agents: results, checkedAt: now }))
    } catch (e) {
      console.error('[agent-running-status] Error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, agents: [] }))
    }
    return
  }

  // ============================================
  // Agent UI Status API（按客户端会话事件源判断当前状态）
  // ============================================
  if (pathname === '/api/agent-ui-status' && req.method === 'GET') {
    try {
      const now = Date.now()
      const agents = getConfiguredOpenClawAgents()
      const results = agents.map(agent => ({
        ...applyDispatchPendingStatus(agent.id, deriveAgentUiStatus(agent.id, now), now),
        name: agent.name,
      }))

      sendJson(res, 200, {
        agents: results,
        checkedAt: now,
        sourcePriority: ['session-events', 'gateway-session', 'session-mtime-fallback'],
        thresholds: {
          activeMs: AGENT_UI_ACTIVE_MS,
          recentMs: AGENT_UI_RECENT_MS,
          stalePendingMs: AGENT_UI_STALE_PENDING_MS,
          dispatchGraceMs: AGENT_UI_DISPATCH_GRACE_MS,
          dispatchErrorMs: AGENT_UI_DISPATCH_ERROR_MS,
        },
      })
    } catch (e) {
      console.error('[agent-ui-status] Error:', e.message)
      sendJson(res, 500, { error: e.message, agents: [] })
    }
    return
  }

  // ============================================
  // GET /api/agent-full-history?agentId=pm&limit=1500
  //   聚合某 agent 的【全部历史 session 文件】，按时间排序返回最近 N 条消息
  //   解决"抽屉只看到当前一个 session、看不到全部历史"的问题
  //   返回的每条记录保留原始 {message:{role,content,...}} 结构，兼容前端归一化器
  // ============================================
  if (pathname === '/api/agent-full-history' && req.method === 'GET') {
    try {
      const agentId = String(url.searchParams.get('agentId') || url.searchParams.get('agent') || '').trim()
      let limit = Number.parseInt(String(url.searchParams.get('limit') || '1500'), 10)
      if (!Number.isFinite(limit) || limit <= 0) limit = 1500
      if (limit > 5000) limit = 5000

      if (!agentId || !/^[a-zA-Z0-9_-]+$/.test(agentId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid agentId', messages: [] }))
        return
      }

      const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions')
      let files = []
      try {
        files = fsSync.readdirSync(sessionsDir)
          .filter(f =>
            f.endsWith('.jsonl') &&
            !f.includes('.trajectory') &&
            !f.includes('.reset') &&
            !f.includes('.deleted') &&
            !f.includes('.bak') &&
            !f.includes('.tmp') &&
            f !== 'sessions.json'
          )
          .map(f => {
            let mtime = 0
            try { mtime = fsSync.statSync(path.join(sessionsDir, f)).mtimeMs } catch {}
            return { f, mtime }
          })
          .sort((a, b) => b.mtime - a.mtime) // 最新文件在前
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ agentId, total: 0, returned: 0, truncated: false, sessionCount: 0, messages: [] }))
        return
      }

      // 解析单个 session 文件为 message 记录数组（带 mtime+size 缓存）
      const parseSessionFile = (fname, mtimeMs) => {
        const fp = path.join(sessionsDir, fname)
        let size = 0
        try { size = fsSync.statSync(fp).size } catch {}
        const cached = _agentHistFileCache.get(fp)
        if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.msgs
        let content = ''
        try { content = fsSync.readFileSync(fp, 'utf8') } catch { return [] }
        const sid = fname.replace('.jsonl', '')
        const out = []
        for (const line of content.split('\n')) {
          const t = line.trim()
          if (!t) continue
          let o
          try { o = JSON.parse(t) } catch { continue }
          if (o.type !== 'message') continue
          const m = o.message
          if (!m || typeof m !== 'object' || !m.role) continue
          const tsRaw = o.timestamp || m.timestamp || null
          let tsMs = 0
          if (tsRaw) { const d = Date.parse(tsRaw); if (Number.isFinite(d)) tsMs = d }
          out.push({ message: m, timestamp: tsRaw, _tsMs: tsMs, _session: sid })
        }
        _agentHistFileCache.set(fp, { mtimeMs, size, msgs: out })
        return out
      }

      const collected = []
      let truncated = false
      let readFiles = 0

      for (let i = 0; i < files.length; i++) {
        // 已收集到足够多的"最近"消息（按最新文件优先），剩余更老的文件不再读
        if (collected.length >= limit) { truncated = true; break }
        readFiles++
        const msgs = parseSessionFile(files[i].f, files[i].mtime)
        for (const r of msgs) collected.push(r)
      }
      if (readFiles < files.length) truncated = true

      // 按时间升序排，取最近 limit 条
      collected.sort((a, b) => a._tsMs - b._tsMs)
      const total = collected.length
      const sliced = total > limit ? collected.slice(total - limit) : collected
      // 去掉内部排序字段
      const messages = sliced.map(r => ({ message: r.message, timestamp: r.timestamp, _session: r._session }))

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        agentId,
        total,
        returned: messages.length,
        truncated: truncated || total > limit,
        sessionCount: files.length,
        readFiles,
        messages,
      }))
    } catch (e) {
      console.error('[agent-full-history] Error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, messages: [] }))
    }
    return
  }

  // ============================================
  // GET /api/session-detail?agentId=pm&sessionId=<uuid>
  //   解析单个 session 的 .jsonl，返回"这次会话到底做了什么"的步骤列表
  //   供活动时间线点击查看：用户提问 / 助手回复 / 工具调用 + 结果
  // ============================================
  if (pathname === '/api/session-detail' && req.method === 'GET') {
    try {
      const agentId = String(url.searchParams.get('agentId') || url.searchParams.get('agent') || '').trim()
      const sessionId = String(url.searchParams.get('sessionId') || url.searchParams.get('session') || '').trim()
      if (!agentId || !/^[a-zA-Z0-9_-]+$/.test(agentId) || !sessionId || !/^[a-zA-Z0-9_.-]+$/.test(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid agentId/sessionId', steps: [] }))
        return
      }

      const fp = path.join(AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`)
      let content = ''
      try { content = fsSync.readFileSync(fp, 'utf8') }
      catch {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'session not found', steps: [] }))
        return
      }

      const CLIP = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + ' …（已截断）' : s }
      const briefArgs = (a) => {
        if (!a || typeof a !== 'object') return CLIP(a, 200)
        if (a.command) return CLIP(a.command, 300)
        if (a.file_path || a.path) return CLIP(a.file_path || a.path, 200)
        if (a.query) return CLIP(a.query, 200)
        if (a.url) return CLIP(a.url, 200)
        if (a.message || a.text) return CLIP(a.message || a.text, 300)
        try { return CLIP(JSON.stringify(a), 300) } catch { return '' }
      }
      const pickResultText = (inner) => {
        if (typeof inner.text === 'string' && inner.text) return inner.text
        if (typeof inner.content === 'string' && inner.content) return inner.content
        if (Array.isArray(inner.content)) {
          return inner.content.map(x => (typeof x === 'string' ? x : (x && x.text) || '')).join('\n')
        }
        return ''
      }

      const steps = []
      let model = ''
      let startTs = null, endTs = null
      const MAX_STEPS = 500

      for (const line of content.split('\n')) {
        const t = line.trim()
        if (!t) continue
        let o
        try { o = JSON.parse(t) } catch { continue }
        if (o.type === 'model_change' && o.model) { model = o.model; continue }
        if (o.type !== 'message') continue
        const m = o.message
        if (!m || typeof m !== 'object') continue
        const ts = o.timestamp || m.timestamp || null
        if (ts) { if (!startTs) startTs = ts; endTs = ts }
        if (!model && m.model) model = m.model
        const role = String(m.role || '').toLowerCase()
        const c = m.content

        if (role === 'user') {
          const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(p => (p && p.text) || '').join('\n') : '')
          if (text.trim()) steps.push({ kind: 'user', text: CLIP(text, 4000), ts })
        } else if (role === 'assistant') {
          if (typeof c === 'string') {
            if (c.trim()) steps.push({ kind: 'assistant', text: CLIP(c, 4000), ts })
          } else if (Array.isArray(c)) {
            for (const p of c) {
              if (!p || typeof p !== 'object') continue
              if (p.type === 'text' && p.text && p.text.trim()) steps.push({ kind: 'assistant', text: CLIP(p.text, 4000), ts })
              else if (p.type === 'thinking' && (p.text || p.thinking)) steps.push({ kind: 'thinking', text: CLIP(p.text || p.thinking, 2000), ts })
              else if (p.type === 'toolCall') steps.push({ kind: 'tool', name: p.name || '工具', brief: briefArgs(p.arguments || p.input), ts })
            }
          }
        } else if (role === 'toolresult') {
          let name = '', out = ''
          if (Array.isArray(c) && c.length) { name = c[0].name || c[0].toolName || ''; out = pickResultText(c[0]) }
          else if (c && typeof c === 'object') { name = c.name || c.toolName || ''; out = pickResultText(c) }
          else if (typeof c === 'string') out = c
          if (out.trim()) steps.push({ kind: 'toolResult', name: name || '工具', text: CLIP(out, 2000), ts })
        }
        if (steps.length >= MAX_STEPS) { steps.push({ kind: 'note', text: `步骤过多，仅显示前 ${MAX_STEPS} 步` }); break }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        agentId, sessionId, model,
        startTime: startTs, endTime: endTs,
        stepCount: steps.length, steps,
      }))
    } catch (e) {
      console.error('[session-detail] Error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, steps: [] }))
    }
    return
  }

  // ============================================
  // GET /api/agent-daily-summary?agentId=pm&days=14
  //   按日期总结某 agent 的历史：每天有哪些会话、每条做了什么（任务→执行→结果）
  //   解决"翻历史太累"——直接看 agent 每天干了啥
  // ============================================
  if (pathname === '/api/agent-daily-summary' && req.method === 'GET') {
    try {
      const agentId = String(url.searchParams.get('agentId') || url.searchParams.get('agent') || '').trim()
      let days = Number.parseInt(String(url.searchParams.get('days') || '14'), 10)
      if (!Number.isFinite(days) || days <= 0) days = 14
      if (days > 90) days = 90
      if (!agentId || !/^[a-zA-Z0-9_-]+$/.test(agentId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid agentId', days: [] }))
        return
      }

      const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions')
      const sinceMs = Date.now() - days * 86400000
      const CLIP = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }
      // 去掉飞书消息的 [message_id:...] / ou_xxx: 前缀，取真正内容
      const cleanMsg = (s) => {
        let t = String(s || '')
        t = t.replace(/^\[cron:[^\]]*\]\s*/i, '')        // 去掉 [cron:uuid] 前缀
        t = t.replace(/^\[message_id:[^\]]*\]\s*/i, '')  // 去掉飞书消息 id 前缀
        t = t.replace(/^ou_[a-zA-Z0-9]+:\s*/i, '')       // 去掉 ou_xxx: 发送者前缀
        t = t.replace(/^\[[^\]]{0,60}\]\s*/, '')         // 去掉其它短括号前缀
        return t.trim()
      }
      const localParts = (iso) => {
        try {
          // 返回 "YYYY-MM-DD HH:MM"（北京时间）
          const s = new Date(iso).toLocaleString('sv', { timeZone: 'Asia/Shanghai' })
          return { date: s.slice(0, 10), time: s.slice(11, 16) }
        } catch { return { date: '未知', time: '' } }
      }

      let files = []
      try {
        files = fsSync.readdirSync(sessionsDir)
          .filter(f => f.endsWith('.jsonl') && !f.includes('.trajectory') && !f.includes('.reset') &&
            !f.includes('.deleted') && !f.includes('.bak') && !f.includes('.tmp') && f !== 'sessions.json')
          .map(f => { let m = 0; try { m = fsSync.statSync(path.join(sessionsDir, f)).mtimeMs } catch {}; return { f, m } })
          .filter(x => x.m >= sinceMs)
          .sort((a, b) => b.m - a.m)
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ agentId, days, totalSessions: 0, daysList: [] }))
        return
      }

      const MAX_FILES = 400
      const truncated = files.length > MAX_FILES
      const use = files.slice(0, MAX_FILES)
      const byDate = createKeyedDictionary() // date -> [session]

      for (const { f } of use) {
        let content = ''
        try { content = fsSync.readFileSync(path.join(sessionsDir, f), 'utf8') } catch { continue }
        let firstTs = null, lastTs = null, firstUser = '', lastAssistant = '', model = ''
        const toolCounts = new Map()
        let stepCount = 0
        for (const line of content.split('\n')) {
          const t = line.trim()
          if (!t) continue
          let o; try { o = JSON.parse(t) } catch { continue }
          if (o.type === 'model_change' && o.model) { model = o.model; continue }
          if (o.type !== 'message') continue
          const m = o.message; if (!m || typeof m !== 'object') continue
          const ts = o.timestamp || m.timestamp || null
          if (ts) { if (!firstTs) firstTs = ts; lastTs = ts }
          if (!model && m.model) model = m.model
          const role = String(m.role || '').toLowerCase()
          const c = m.content
          if (role === 'user') {
            stepCount++
            if (!firstUser) { const v = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(p => (p && p.text) || '').join(' ') : ''); firstUser = cleanMsg(v) }
          } else if (role === 'assistant') {
            stepCount++
            if (typeof c === 'string') { if (c.trim()) lastAssistant = c }
            else if (Array.isArray(c)) {
              for (const p of c) {
                if (!p || typeof p !== 'object') continue
                if (p.type === 'text' && p.text && p.text.trim()) lastAssistant = p.text
                else if (p.type === 'toolCall') { const n = p.name || '工具'; toolCounts.set(n, (toolCounts.get(n) || 0) + 1) }
              }
            }
          }
        }
        if (!firstTs) continue
        const { date, time } = localParts(firstTs)
        const tools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])
        const TOOL_ZH = {
          bash: '终端命令', shell: '终端命令', exec: '终端命令',
          apply_patch: '修改文件', edit: '修改文件', str_replace: '修改文件',
          read: '读取文件', read_file: '读取文件', cat: '读取文件',
          write: '写入文件', write_file: '写入文件', create_file: '写入文件',
          web_search: '联网搜索', browser: '浏览网页', fetch: '抓取网页',
          sessions_send: '发送消息', message: '发送飞书消息', im: '发送飞书消息',
          cron: '定时任务', task: '任务操作', glob: '查找文件', grep: '搜索内容',
        }
        const toolSummary = tools.map(([n, c]) => {
          const key = String(n).toLowerCase()
          return `${Object.hasOwn(TOOL_ZH, key) ? TOOL_ZH[key] : n} ${c}次`
        }).join('、')
        const totalTools = tools.reduce((s, [, c]) => s + c, 0)
        // 触发类型：cron/系统型 first message 多以"执行/巡检/归档/检查"开头或含 NO_REPLY 约定
        const isCron = /^执行|巡检|归档|检查|定时|cron|每日|汇总/.test(firstUser) || /NO_REPLY/.test(firstUser)
        const session = {
          sessionId: f.replace('.jsonl', ''),
          time,
          trigger: isCron ? 'cron' : 'user',
          task: CLIP(firstUser, 110) || '(无触发消息)',
          toolSummary: toolSummary || '（无工具调用）',
          toolCount: totalTools,
          result: CLIP(lastAssistant, 140) || '（无文字回复）',
          model,
        }
        if (!Object.hasOwn(byDate, date)) byDate[date] = []
        byDate[date].push(session)
      }

      const daysList = Object.keys(byDate).sort((a, b) => b.localeCompare(a)).map(date => {
        const sessions = byDate[date].sort((a, b) => b.time.localeCompare(a.time))
        return { date, sessionCount: sessions.length, totalTools: sessions.reduce((s, x) => s + x.toolCount, 0), sessions }
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        agentId, days,
        totalSessions: use.length,
        scannedFiles: use.length,
        truncated,
        daysList,
      }))
    } catch (e) {
      console.error('[agent-daily-summary] Error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, daysList: [] }))
    }
    return
  }

  // ============================================
  // GET /api/agent-live-activity?agent=id — 读取 agent 正在做什么（session jsonl 末尾）
  // ============================================
  if (pathname === '/api/agent-live-activity' && req.method === 'GET') {
    let agentId = ''
    try {
      agentId = assertAgentId(url.searchParams.get('agent'))
      const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions')
      // 找最近修改的 session .jsonl 文件
      let latestFile = null
      let latestMtime = 0
      try {
        const files = fsSync.readdirSync(sessionsDir)
        for (const f of files) {
          if (!f.endsWith('.jsonl') || f.includes('.trajectory') || f.includes('.reset') || f.includes('.bak') || f.includes('.tmp') || f === 'sessions.json') continue
          const fpath = path.join(sessionsDir, f)
          const stat = fsSync.statSync(fpath)
          if (stat.mtimeMs > latestMtime) { latestMtime = stat.mtimeMs; latestFile = fpath }
        }
      } catch (e) { /* sessions dir missing */ }

      if (!latestFile) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ agentId, steps: [], msAgo: null }))
        return
      }

      // 读最后 12KB，避免读超大文件
      const READ_TAIL = 12 * 1024
      const stat = fsSync.statSync(latestFile)
      const fileSize = stat.size
      const readStart = Math.max(0, fileSize - READ_TAIL)
      const buf = Buffer.alloc(Math.min(READ_TAIL, fileSize))
      const fd = fsSync.openSync(latestFile, 'r')
      fsSync.readSync(fd, buf, 0, buf.length, readStart)
      fsSync.closeSync(fd)

      // 按行解析，跳过第一行（可能截断），取完整 JSON 行
      const rawLines = buf.toString('utf-8').split('\n')
      const lines = readStart > 0 ? rawLines.slice(1) : rawLines  // 截断偏移时丢掉首行残片

      const steps = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let obj
        try { obj = JSON.parse(trimmed) } catch { continue }
        if (obj.type !== 'message' || !obj.message) continue
        const msg = obj.message
        const ts = obj.timestamp || null

        if (msg.role === 'user') {
          // 触发消息
          const textPart = Array.isArray(msg.content) ? msg.content.find(c => c.type === 'text') : null
          const text = textPart?.text || ''
          steps.push({ type: 'trigger', text: text.slice(0, 120), timestamp: ts })
        } else if (msg.role === 'assistant') {
          for (const part of (Array.isArray(msg.content) ? msg.content : [])) {
            if (part.type === 'thinking') {
              steps.push({ type: 'thinking', text: (part.thinking || '').slice(0, 120), timestamp: ts })
            } else if (part.type === 'toolCall') {
              const inputStr = part.input ? JSON.stringify(part.input).slice(0, 100) : ''
              steps.push({ type: 'tool', name: part.name || '', text: inputStr, timestamp: ts })
            } else if (part.type === 'text') {
              const t = (part.text || '').trim()
              if (t && t !== 'NO_REPLY') steps.push({ type: 'text', text: t.slice(0, 120), timestamp: ts })
            }
          }
        } else if (msg.role === 'toolResult') {
          const textPart = Array.isArray(msg.content) ? msg.content.find(c => c.type === 'text') : null
          const text = (textPart?.text || '').trim().slice(0, 120)
          if (text) steps.push({ type: 'toolResult', name: msg.toolName || '', text, timestamp: ts })
        }
      }

      // 只返回最后 8 步
      const recentSteps = steps.slice(-8)
      const msAgo = latestMtime > 0 ? Date.now() - latestMtime : null

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ agentId, steps: recentSteps, msAgo, fileSize }))
    } catch (e) {
      console.error('[agent-live-activity] Error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ agentId, steps: [], msAgo: null, error: e.message }))
    }
    return
  }

  // ============================================
  // POST /api/agent-send-message — 通过 openclaw CLI 发消息给 agent
  // body: { agentId: string, message: string }
  // ============================================
  if (pathname === '/api/agent-send-message' && req.method === 'POST') {
    try {
      const { agentId, message } = await readJsonRequest(req, 64 * 1024)
      const cleanAgentId = String(agentId || '').trim()
      const cleanMessage = String(message || '').trim()
      if (!cleanAgentId || !cleanMessage) {
        sendJson(res, 400, { success: false, error: 'agentId 和 message 必填' })
        return
      }
      const safeAgentId = assertAgentId(cleanAgentId)
      const safeMessage = assertSafeArgumentValue(cleanMessage, '消息内容', {
        maxLength: 64 * 1024,
        allowNewlines: true,
        allowLeadingDash: true,
      })

      const { agents } = await readConfiguredAgents()
      const targetAgent = agents.find(a => a.id === safeAgentId)
      if (!targetAgent) {
        sendJson(res, 400, { success: false, error: `Agent 不存在：${safeAgentId}` })
        return
      }

      const controlCapability = openClawControlCapability()
      if (!controlCapability.supported) {
        sendJson(res, 501, { success: false, error: controlCapability.error })
        return
      }

      if (!commandExists('openclaw')) {
        sendJson(res, 500, { success: false, error: '找不到 openclaw 命令，无法发送' })
        return
      }

      // 后台启动 openclaw agent，不阻塞 HTTP 响应（agent 可能跑几十秒）
      const child = spawn('openclaw', [
        'agent',
        optionValue('--agent', safeAgentId),
        optionValue('--message', safeMessage),
        optionValue('--session-key', `agent:${safeAgentId}:main`),
      ], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        env: openClawCommandEnvironment({ gatewayAccess: true }),
      })
      agentDispatchRegistry.set(safeAgentId, {
        dispatchedAt: Date.now(),
        pid: child.pid,
        messagePreview: safeMessage.slice(0, 80),
      })
      child.once('error', () => {
        const pending = agentDispatchRegistry.get(safeAgentId)
        if (pending) pending.failedAt = Date.now()
      })
      child.once('exit', (code) => {
        const pending = agentDispatchRegistry.get(safeAgentId)
        if (pending && code && code !== 0) pending.failedAt = Date.now()
      })
      child.unref()
      console.log(`[agent-send-message] dispatched to ${safeAgentId}`)
      sendJson(res, 200, { success: true, agentId: safeAgentId, agentName: targetAgent.name, dispatched: true })
    } catch (e) {
      console.error('[agent-send-message] Error:', e.message)
      sendJson(res, 500, { success: false, error: e.message })
    }
    return
  }

  // ============================================
  // Voice local deployment helpers
  // GET  /api/voice/capabilities
  // GET  /api/voice/voices
  // GET  /api/voice/samples/:file
  // POST /api/voice/samples — body: { audioBase64/dataUrl, mimeType, filename }
  // POST /api/voice/clone — body: { sampleUrl, name, provider }
  // POST /api/voice/synthesize — body: { text, voiceId, provider }
  // POST /api/voice/transcribe — body: { audioBase64, mimeType }
  // ============================================
  if (pathname === '/api/voice/capabilities' && req.method === 'GET') {
    sendJson(res, 200, voiceCapabilities(req))
    return
  }

  if (pathname === '/api/voice/voices' && req.method === 'GET') {
    try {
      const ownerAgentId = (url.searchParams.get('agentId') || '').trim()
      if (ownerAgentId) assertAgentId(ownerAgentId)
      let cloned = (await readVoiceProfiles()).map(voiceProfileRuntime).map(publicVoiceRecord)
      // 按 Agent 归属过滤：只返回属于该 Agent 的克隆音色（没传则全返回）
      if (ownerAgentId) cloned = cloned.filter(v => (v.agentId || '') === ownerAgentId)
      sendJson(res, 200, {
        ok: true,
        cloned,
        premade: COSYVOICE_PRESET_VOICES,
        providers: {
          cosyvoice: Boolean(dashscopeApiKey()),
          gptsovits: Boolean(gptSoVitsUrl()),
          command: ttsCommandConfigured(),
        },
      })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (pathname.startsWith('/api/voice/samples/') && req.method === 'GET') {
    try {
      await ensureVoiceDirs()
      const fileName = decodeURIComponent(pathname.replace('/api/voice/samples/', ''))
      if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
        sendJson(res, 400, { ok: false, error: '声音样本文件名无效' })
        return
      }
      const filePath = resolveVoiceSamplePath(fileName, { mustExist: true })
      const ext = path.extname(fileName).toLowerCase()
      const mimeType = ext === '.wav' ? 'audio/wav'
        : ext === '.mp3' ? 'audio/mpeg'
          : ext === '.m4a' ? 'audio/mp4'
            : ext === '.ogg' ? 'audio/ogg'
              : 'audio/webm'
      res.writeHead(200, { 'Content-Type': mimeType, 'Cache-Control': 'no-cache' })
      fsSync.createReadStream(filePath).pipe(res)
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (pathname === '/api/voice/samples' && req.method === 'POST') {
    try {
      await ensureVoiceDirs()
      const payload = await readJsonRequest(req, 40 * 1024 * 1024)
      const audio = audioBufferFromPayload(payload)
      if (!audio || audio.length < 1024) {
        sendJson(res, 400, { ok: false, error: '声音样本为空或太短' })
        return
      }
      if (audio.length > 32 * 1024 * 1024) {
        sendJson(res, 413, { ok: false, error: '声音样本太大，请控制在 32MB 内' })
        return
      }
      const mimeType = payload.mimeType || 'audio/webm'
      const ext = audioExtensionFromMime(mimeType)
      const original = sanitizeFileName(payload.filename || `voice-sample${ext}`)
      const stem = path.basename(original, path.extname(original))
      const fileName = `${Date.now()}-${stem}${path.extname(original) || ext}`
      const filePath = resolveVoiceSamplePath(fileName)
      safeWriteFileWithinRoots(filePath, audio, [VOICE_SAMPLES_DIR], { mode: 0o600 })
      sendJson(res, 200, {
        ok: true,
        url: publicSampleUrl(fileName),
        filename: fileName,
        size: audio.length,
        mimeType,
      })
    } catch (e) {
      console.error('[voice-samples] Error:', e.message)
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  // 待确认录音：保存样本但不克隆，按 agent 持久化（刷新不丢）
  if (pathname === '/api/voice/pending' && req.method === 'POST') {
    try {
      await ensureVoiceDirs()
      const payload = await readJsonRequest(req, 40 * 1024 * 1024)
      const audio = audioBufferFromPayload(payload)
      if (!audio || audio.length < 500) { sendJson(res, 400, { ok: false, error: '录音为空或太短' }); return }
      if (audio.length > 32 * 1024 * 1024) { sendJson(res, 413, { ok: false, error: '录音太大（>32MB）' }); return }
      const mimeType = payload.mimeType || 'audio/webm'
      const ext = audioExtensionFromMime(mimeType)
      const stem = sanitizeFileName(payload.filename || `rec${ext}`)
      const fileName = `pending-${Date.now()}-${path.basename(stem, path.extname(stem))}${path.extname(stem) || ext}`
      const filePath = resolveVoiceSamplePath(fileName)
      safeWriteFileWithinRoots(filePath, audio, [VOICE_SAMPLES_DIR], { mode: 0o600 })
      const pendingAgentId = String(payload.agentId || '').trim()
      if (pendingAgentId) assertAgentId(pendingAgentId)
      const entry = {
        id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        agentId: pendingAgentId,
        label: String(payload.label || '录音').slice(0, 40),
        seconds: Number(payload.seconds) || 0,
        sampleUrl: publicSampleUrl(fileName),
        samplePath: filePath,
        mimeType,
        createdAt: new Date().toISOString(),
      }
      const list = await readPendingRecs(); list.unshift(entry); await writePendingRecs(list)
      sendJson(res, 200, { ok: true, ...publicVoiceRecord(entry) })
    } catch (e) {
      console.error('[voice-pending] Error:', e.message)
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (pathname === '/api/voice/pending' && req.method === 'GET') {
    try {
      const aid = (url.searchParams.get('agentId') || '').trim()
      let list = await readPendingRecs()
      if (aid) list = list.filter(x => (x.agentId || '') === aid)
      sendJson(res, 200, { ok: true, pending: list.map(publicVoiceRecord) })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (pathname === '/api/voice/pending/delete' && req.method === 'POST') {
    try {
      const { id } = await readJsonRequest(req, 64 * 1024)
      const list = await readPendingRecs()
      const target = list.find(x => x.id === id)
      const safeSamplePath = target?.samplePath
        ? resolveStoredVoiceSamplePath(target.samplePath)
        : ''
      await writePendingRecs(list.filter(x => x.id !== id))
      if (safeSamplePath && fsSync.existsSync(safeSamplePath)) await fs.rm(safeSamplePath, { force: true }).catch(() => {})
      sendJson(res, 200, { ok: true })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (pathname === '/api/voice/clone' && req.method === 'POST') {
    try {
      await ensureVoiceDirs()
      const payload = await readJsonRequest(req, 5 * 1024 * 1024)
      const sampleUrl = payload.sampleUrl || payload.sampleUrls?.[0]
      if (!sampleUrl) {
        sendJson(res, 400, { ok: false, error: 'sampleUrl 必填' })
        return
      }
      const samplePath = samplePathFromUrl(sampleUrl)
      if (!fsSync.existsSync(samplePath)) {
        sendJson(res, 404, { ok: false, error: '声音样本不存在，请重新上传' })
        return
      }

      const requestedProvider = payload.provider || process.env.OPENCLAW_VOICE_TTS_PROVIDER || 'auto'
      const name = String(payload.name || 'OpenClaw Voice').trim() || 'OpenClaw Voice'
      let provider = requestedProvider
      let voiceId = ''
      let cloneStatus = 'ready'
      let cloneMessage = ''

      if (provider === 'auto') {
        provider = dashscopeApiKey() ? 'cosyvoice' : gptSoVitsUrl() ? 'gptsovits' : ttsCommandConfigured() ? 'command' : 'local-reference'
      } else if (provider === 'minimax' && !minimaxConfigured()) {
        provider = 'local-reference'
        cloneMessage = '声音样本已保存；MiniMax 克隆需要先配置 OPENCLAW_VOICE_MINIMAX_API_KEY。'
      } else if (provider === 'cosyvoice' && !dashscopeApiKey()) {
        provider = 'local-reference'
        cloneMessage = '声音样本已保存；CosyVoice 需要先配置 OPENCLAW_VOICE_DASHSCOPE_API_KEY。'
      } else if (provider === 'gptsovits' && !gptSoVitsUrl()) {
        provider = 'local-reference'
        cloneMessage = '声音样本已保存；GPT-SoVITS 需要先配置 OPENCLAW_GPTSOVITS_URL。'
      } else if (provider === 'command' && !ttsCommandConfigured()) {
        provider = 'local-reference'
        cloneMessage = '声音样本已保存；本地 TTS 需要先配置 OPENCLAW_VOICE_TTS_COMMAND_JSON。'
      }

      let synthesisReady = provider === 'cosyvoice' || provider === 'gptsovits' || provider === 'command' || provider === 'minimax'

      if (provider === 'cosyvoice') {
        voiceId = await cloneWithCosyVoice(samplePath, name)
      } else if (provider === 'minimax') {
        const slug = String(name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'voice'
        voiceId = await cloneWithMiniMax(samplePath, name, `oc${slug}${Date.now().toString().slice(-6)}`)
        cloneStatus = 'ready'
        cloneMessage = 'MiniMax 云克隆完成。首次合成时收取 9.9 元克隆费。'
      } else {
        provider = provider === 'gptsovits' ? 'gptsovits' : provider === 'command' ? 'command' : 'local-reference'
        voiceId = `local-${Date.now().toString(36)}`
        synthesisReady = provider === 'gptsovits' || provider === 'command'
        cloneStatus = synthesisReady ? 'ready' : 'pending-config'
        cloneMessage = cloneMessage || (synthesisReady
          ? '已保存本地参考声音。'
          : '已保存声音样本；配置 OPENCLAW_GPTSOVITS_URL 或 OPENCLAW_VOICE_TTS_COMMAND_JSON 后即可用它合成。')
      }

      const profile = await upsertVoiceProfile({
        voiceId,
        name,
        provider,
        category: provider === 'cosyvoice' || provider === 'minimax' ? 'cloned' : 'local-reference',
        language: 'zh',
        agentId: String(payload.agentId || '').trim(),  // 归属哪个 Agent，列表按它过滤
        sampleUrl,
        samplePath,
        status: cloneStatus,
        synthesisReady,
        message: cloneMessage,
      })
      sendJson(res, 200, { ok: true, ...publicVoiceRecord(profile) })
    } catch (e) {
      console.error('[voice-clone] Error:', e.message)
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  // POST /api/voice/delete — 删除一个克隆音色（从 voices.json 移除，并删本地样本文件）
  if (pathname === '/api/voice/delete' && req.method === 'POST') {
    try {
      const payload = await readJsonRequest(req, 64 * 1024)
      const voiceId = String(payload.voiceId || '').trim()
      if (!voiceId) { sendJson(res, 400, { ok: false, error: 'voiceId 必填' }); return }
      const voices = await readVoiceProfiles()
      const target = voices.find(v => v.voiceId === voiceId)
      if (!target) { sendJson(res, 404, { ok: false, error: '没找到这个音色' }); return }
      const remaining = voices.filter(v => v.voiceId !== voiceId)
      const stillUsed = remaining.some(v => v.samplePath === target.samplePath)
      const safeSamplePath = target.samplePath && !stillUsed
        ? resolveStoredVoiceSamplePath(target.samplePath)
        : ''
      await writeVoiceProfiles(remaining)
      // 顺手删掉只属于它的本地样本文件（被别的音色共用则保留）
      if (safeSamplePath && fsSync.existsSync(safeSamplePath)) await fs.rm(safeSamplePath, { force: true }).catch(() => {})
      sendJson(res, 200, { ok: true, voiceId, name: target.name || '' })
    } catch (e) {
      console.error('[voice-delete] Error:', e.message)
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  // 自动情绪：用 qwen 快模型(LLM自带能力，非本地部署)读"用户的话+要念的回复"，判断该用什么情绪
  if (pathname === '/api/voice/auto-emotion' && req.method === 'POST') {
    try {
      const apiKey = dashscopeApiKey()
      if (!apiKey) { sendJson(res, 200, { ok: true, emotion: '' }); return }
      const { text = '', userText = '' } = await readJsonRequest(req, 64 * 1024)
      const prompt = `你是语音情绪判断器。根据[用户的话]和[要朗读的回复]，判断这句回复用什么语气念最自然。只输出一个英文代码，别的都不要：happy(开心) / gentle(温柔关心) / excited(兴奋) / serious(严肃) / sad(低落) / calm(平静)。\n[用户的话]：${String(userText).slice(0, 300)}\n[要朗读的回复]：${String(text).slice(0, 500)}\n情绪代码：`
      const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENCLAW_VOICE_EMOTION_MODEL || 'qwen-turbo',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 8,
        }),
      })
      const j = await resp.json().catch(() => ({}))
      let emo = String(j?.choices?.[0]?.message?.content || '').trim().toLowerCase()
      const valid = ['happy', 'gentle', 'excited', 'serious', 'sad', 'calm']
      emo = valid.find(v => emo.includes(v)) || ''
      if (emo === 'calm') emo = ''   // 平静 = 不加指令
      sendJson(res, 200, { ok: true, emotion: emo })
    } catch (e) {
      sendJson(res, 200, { ok: true, emotion: '' })   // 失败→平静，不阻塞朗读
    }
    return
  }

  if (pathname === '/api/voice/synthesize' && req.method === 'POST') {
    try {
      const payload = await readJsonRequest(req, 1024 * 1024)
      const text = String(payload.text || '').trim()
      if (!text) {
        sendJson(res, 400, { ok: false, error: 'text 必填' })
        return
      }
      if (text.length > 3000) {
        sendJson(res, 413, { ok: false, error: '语音文本太长，请控制在 3000 字内' })
        return
      }
      const voices = await readVoiceProfiles()
      const voiceId = String(payload.voiceId || '').trim()
      const profile = voiceProfileRuntime(voices.find(v => v.voiceId === voiceId)
        || COSYVOICE_PRESET_VOICES.find(v => v.voiceId === voiceId)
        || { voiceId: voiceId || 'longxiaochun_v3', provider: payload.provider || 'cosyvoice', name: '默认音色' })

      const commandResult = await synthesizeWithConfiguredCommand(text, profile)
      if (commandResult) {
        if (!commandResult.ok) throw new Error(commandResult.error)
        res.writeHead(200, {
          'Content-Type': commandResult.mimeType,
          'Cache-Control': 'no-cache',
        })
        res.end(commandResult.buffer)
        return
      }

      const provider = payload.provider || profile.provider || 'cosyvoice'
      if (!profile.synthesisReady && ['cosyvoice', 'gptsovits', 'local-reference', 'command'].includes(provider)) {
        sendJson(res, 409, { ok: false, error: profile.message || '克隆音色合成引擎未配置' })
        return
      }
      const audio = provider === 'gptsovits' || provider === 'local-reference'
        ? await synthesizeWithGptSoVits(text, profile)
        : provider === 'minimax'
          ? await synthesizeWithMiniMax(text, profile.voiceId, { rate: payload.rate, pitch: payload.pitch })
          : await synthesizeWithCosyVoice(text, profile.voiceId, { rate: payload.rate, pitch: payload.pitch, instruction: payload.instruction })
      res.writeHead(200, { 'Content-Type': audio.mimeType, 'Cache-Control': 'no-cache' })
      res.end(audio.buffer)
    } catch (e) {
      console.error('[voice-synthesize] Error:', e.message)
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (pathname === '/api/voice/transcribe' && req.method === 'POST') {
    let tempDir = ''
    try {
      const { audioBase64, mimeType = 'audio/webm' } = await readJsonRequest(req)
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        sendJson(res, 400, { ok: false, error: 'audioBase64 必填' })
        return
      }
      const audio = Buffer.from(audioBase64, 'base64')
      if (audio.length < 512) {
        sendJson(res, 200, { ok: true, text: '' })
        return
      }
      if (audio.length > 20 * 1024 * 1024) {
        sendJson(res, 413, { ok: false, error: '音频片段太大' })
        return
      }

      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-voice-'))
      const inputPath = path.join(tempDir, `segment${audioExtensionFromMime(mimeType)}`)
      await fs.writeFile(inputPath, audio)

      // 优先阿里 Qwen3-ASR（有 DashScope key 时）；失败再退本地 faster-whisper、OpenAI兼容、whisper-cli
      const providers = [
        ['dashscope-qwen-asr', () => transcribeWithDashscopeQwen(inputPath)],
        ['local-command', () => transcribeWithConfiguredCommand(inputPath)],
        ['openai-compatible', () => transcribeWithOpenAiCompatible(inputPath, mimeType)],
        ['whisper-cli', () => transcribeWithWhisperCli(inputPath)],
      ]

      const tried = []
      for (const [name, runProvider] of providers) {
        const result = await runProvider()
        if (!result) continue
        tried.push({ name, ok: result.ok, error: result.error || '' })
        if (result.ok) {
          sendJson(res, 200, { ok: true, provider: name, text: result.text || '' })
          return
        }
      }

      sendJson(res, 501, {
        ok: false,
        error: '没有可用的本地语音识别配置。请在 .env 配置 OPENCLAW_VOICE_STT_COMMAND_JSON，或配置 OPENCLAW_VOICE_STT_API_KEY / OPENAI_API_KEY。',
        tried,
      })
    } catch (e) {
      console.error('[voice-transcribe] Error:', e.message)
      sendJson(res, 500, { ok: false, error: e.message })
    } finally {
      if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
    return
  }

  // ============================================
  // GET /api/agent-crons — 获取所有 Agent 的定时任务
  // ============================================
  if (pathname === '/api/agent-crons' && req.method === 'GET') {
    const rawAgentFilter = url.searchParams.get('agent') || ''
    let agentFilter = null
    try { agentFilter = rawAgentFilter ? assertAgentId(rawAgentFilter) : null } catch {
      sendJson(res, 400, { jobs: [], error: 'Agent ID 格式无效' })
      return
    }
    try {
      const result = await runOpenClawCommand(['cron', 'list', '--json'], 30000, { gatewayAccess: true })
      if (!result.success) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jobs: [], error: result.error }))
        return
      }
      let rawOutput = result.stdout || result.stderr || ''
      const jsonStart = rawOutput.indexOf('{')
      if (jsonStart < 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jobs: [] }))
        return
      }
      const parsed = JSON.parse(rawOutput.slice(jsonStart))
      let jobs = parsed.jobs || []
      if (agentFilter) {
        jobs = jobs.filter(j => j.agentId === agentFilter)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jobs, total: jobs.length }))
    } catch (e) {
      console.error('[agent-crons] Error:', e.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jobs: [], error: e.message }))
    }
    return
  }

  // ============================================
  // GET /api/system/skill-readme?name=lark-im — 读取技能 SKILL.md
  // ============================================
  if (pathname === '/api/system/skill-readme' && req.method === 'GET') {
    let skillName = ''
    try { skillName = assertSkillId(url.searchParams.get('name') || '') } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid skill name' }))
      return
    }
    try {
      const skillPaths = await resolveSkillPaths(skillName)
      const { skillDir, skillMdPath } = skillPaths

      let content = ''
      let description = ''
      let tools = []
      if (skillMdPath) {
        try {
          content = fsSync.readFileSync(skillMdPath, 'utf8')
          // Extract frontmatter description
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
          if (fmMatch) {
            const fm = fmMatch[1]
            const quotedMatch = fm.match(/^description:\s*"([\s\S]*?)"\s*(?:\n|$)/m)
            const blockMatch = !quotedMatch && fm.match(/^description:\s*>\s*\n([\s\S]*?)(?=\n\w|\n---|\n$|$)/m)
            const inlineMatch = !quotedMatch && !blockMatch && fm.match(/^description:\s*(.+)/m)
            if (quotedMatch) description = quotedMatch[1].replace(/\\n/g, '\n').trim()
            else if (blockMatch) description = blockMatch[1].replace(/  /g, '').trim()
            else if (inlineMatch) description = inlineMatch[1].trim()
          }
          if (content.length > 20000) content = content.slice(0, 20000) + '\n\n... (内容已截断)'
        } catch (_) { /* read fail */ }
      }
      // List tools from references/
      try {
        if (skillDir) {
          const current = revalidateSkillPaths(skillPaths)
          const refsDir = resolvePathWithinRoots(path.join(current.skillDir, 'references'), [current.trustedRoot], { mustExist: true })
          const refFiles = fsSync.readdirSync(refsDir)
          tools = refFiles.filter((f) => {
            if (!f.endsWith('.md')) return false
            try { resolveSkillReference(current, f.replace(/\.md$/, '')); return true } catch { return false }
          }).map(f => f.replace(/\.md$/, ''))
        }
      } catch (_) { /* no references dir */ }
      // 中文译文缓存（skill-translations/<name>.md，由人工/Claude 预翻译，含代码讲解）
      let translated = ''
      try {
        const translationKey = skillName.replace(/[@/]/g, '_')
        const trPath = path.join(__dirname, '..', 'skill-translations', `${translationKey}.md`)
        if (fsSync.existsSync(trPath)) translated = fsSync.readFileSync(trPath, 'utf8')
      } catch (_) { /* 无译文 */ }
      // 检测原文是否本来就以中文为主（这类无需翻译）
      // 阈值放宽到 en*0.25：技术类文档里 CLI 命令/参数/路径本身就是英文，
      // 即使正文已经是中文讲解，英文字符数也会偏高，0.4 的阈值会误判成"待翻译"
      let alreadyChinese = false
      if (!translated && content) {
        const zh = (content.match(/[一-鿿]/g) || []).length
        const en = (content.match(/[a-zA-Z]/g) || []).length
        alreadyChinese = zh > 60 && zh > en * 0.25
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: skillName, description, content, tools, translated, hasTranslation: !!translated, alreadyChinese }))
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: skillName, description: '', content: '', tools: [], error: e.message }))
    }
    return
  }

  // ============================================
  // GET /api/system/skill-reference?name=lark-doc&ref=block-types — 读取技能 references/*.md
  // ============================================
  if (pathname === '/api/system/skill-reference' && req.method === 'GET') {
    let skillName = ''
    const refName = url.searchParams.get('ref') || ''
    try { skillName = assertSkillId(url.searchParams.get('name') || '') } catch { /* rejected below */ }
    if (!skillName || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(refName) || ['__proto__', 'prototype', 'constructor'].includes(refName.toLowerCase())) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid skill reference' }))
      return
    }
    try {
      const skillPaths = await resolveSkillPaths(skillName)
      let content = ''
      if (skillPaths.skillDir) {
        const resolved = resolveSkillReference(skillPaths, refName)
        content = fsSync.readFileSync(resolved, 'utf8')
        if (content.length > 20000) content = content.slice(0, 20000) + '\n\n... (内容已截断)'
      }

      let translated = ''
      try {
        const translationKey = skillName.replace(/[@/]/g, '_')
        const candidates = [
          path.join(__dirname, '..', 'skill-translations', `${translationKey}__${refName}.md`),
          path.join(__dirname, '..', 'skill-translations', `${translationKey}-${refName}.md`),
        ]
        for (const trPath of candidates) {
          if (fsSync.existsSync(trPath)) {
            translated = fsSync.readFileSync(trPath, 'utf8')
            break
          }
        }
      } catch (_) { /* 无译文 */ }

      let alreadyChinese = false
      if (!translated && content) {
        const zh = (content.match(/[一-鿿]/g) || []).length
        const en = (content.match(/[a-zA-Z]/g) || []).length
        alreadyChinese = zh > 60 && zh > en * 0.25
      }
      if (!translated && content && !alreadyChinese) {
        const summary = content
          .split('\n')
          .filter(line => line.trim())
          .slice(0, 8)
          .map(line => `- ${line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim()}`)
          .join('\n')
        translated = `# 参考资料：${refName}\n\n这是一份随技能附带的英文参考资料。当前工作台先保留原文，方便核对字段、参数或接口约定；你可以点击右上角「显示英文原文」查看完整内容。\n\n## 内容摘要\n\n${summary}`
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: skillName, ref: refName, content, translated, hasTranslation: !!translated, alreadyChinese }))
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: skillName, ref: refName, content: '', translated: '', error: e.message }))
    }
    return
  }

  // ============================================
  // System Version API
  // ============================================

  if (pathname === '/api/system/version') {
    if (req.method === 'GET') {
      try {
        const runtimeVersion = readGatewayServiceVersion()
        if (runtimeVersion) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(runtimeVersion))
          return
        }

        const versionCommand = os.platform() === 'win32' ? 'openclaw.cmd' : 'openclaw'
        const result = await runCommand(versionCommand, ['-v'], 10000)
        if (result.success) {
          const match = result.stdout.match(/(\d{4}\.\d+\.\d+)/)
          const version = match ? match[1] : 'unknown'
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ version, source: 'openclaw -v' }))
        } else {
          console.error(`[System Version] Error: ${result.error}`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ version: 'unknown', error: result.error }))
        }
      } catch (err) {
        console.error(`[System Version] Unexpected error: ${err.message}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ version: 'unknown', error: err.message }))
      }
      return
    }
  }

  // ============================================
  // GET /api/system/git-versions — 列出可回退的 git 版本标签
  // ============================================

  if (pathname === '/api/system/git-versions' && req.method === 'GET') {
    try {
      const versions = await listDashboardGitVersions(DASHBOARD_REPO_DIR)
      sendJson(res, 200, { versions })
    } catch (error) {
      console.error('[Git Versions] 读取 git tags 失败:', error.message)
      sendJson(res, 200, { versions: [], error: error.message })
    }
    return
  }

  // ============================================
  // POST /api/system/git-rollback — 生成新提交回退到指定 git tag
  // body: { version: "v2.7.1" }
  // ============================================

  if (pathname === '/api/system/git-rollback' && req.method === 'POST') {
    try {
      const input = await readJsonRequest(req, 1024)
      const result = await rollbackDashboardGitVersion(input.version, DASHBOARD_REPO_DIR)
      const statusCode = result.statusCode || (result.ok ? 200 : 500)
      const { statusCode: _statusCode, ...payload } = result
      sendJson(res, statusCode, payload)
    } catch (error) {
      console.error('[Git Rollback] 回退失败:', error.message)
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        backendRestartRecommended: false,
      })
    }
    return
  }

  // ============================================
  // GET /api/system/versions — 获取版本列表
  // ============================================

  if (pathname === '/api/system/versions' && req.method === 'GET') {
    try {
      const cache = await readVersionsCache()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        versions: cache.versions || [],
        lastSync: cache.lastSync || null
      }))
    } catch (error) {
      console.error('[Versions] 读取缓存失败:', error.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ versions: [], lastSync: null }))
    }
    return
  }

  // ============================================
  // POST /api/system/sync-versions — 同步版本列表
  // ============================================

  if (pathname === '/api/system/sync-versions' && req.method === 'POST') {
    if (syncingVersions) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: '版本同步正在进行中，请稍后再试' }))
      return
    }

    syncingVersions = true
    try {
      const result = await fetchReleasesFromGitHub()

      // 增量合并：读取现有缓存 → 按 tag_name 去重合并 → 写回
      const existingCache = await readVersionsCache()
      const existingTags = new Set((existingCache.versions || []).map(v => v.version))

      // 新版本追加到开头，已存在版本保留
      const newVersions = result.versions.filter(v => !existingTags.has(v.version))
      const mergedVersions = [...result.versions, ...(existingCache.versions || []).filter(v => !result.versions.some(r => r.version === v.version))]

      // 按 published_at 降序排列
      mergedVersions.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))

      const cacheData = {
        lastSync: new Date().toISOString(),
        source: result.source,
        versions: mergedVersions
      }

      await writeVersionsCache(cacheData)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        count: mergedVersions.length,
        added: newVersions.length,
        source: result.source
      }))
    } catch (error) {
      console.error('[Version Sync] 同步失败:', error.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: error.message }))
    } finally {
      syncingVersions = false
    }
    return
  }

  // ============================================
  // POST /api/system/switch-version — 切换版本
  // ============================================

  if (pathname === '/api/system/switch-version' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const input = JSON.parse(body)
        const { version } = input

        if (!version) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '缺少 version 参数' }))
          return
        }

        // 验证版本格式: YYYY.N.N / YYYY.N.N.P / YYYY.N.N-beta.N
        if (!/^\d{4}\.\d+\.\d+(\.\d+)?(-(beta|alpha|rc)\.\d+)?$/.test(version)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '版本格式不正确，应为 YYYY.N.N（如 2026.3.28）' }))
          return
        }

        if (switchingVersion) {
          res.writeHead(429, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '版本切换正在进行中，请稍后再试' }))
          return
        }

        switchingVersion = true
        try {
          const result = await switchOpenClawVersion(version)

          if (result.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              success: true,
              message: result.message || `版本已切换到 ${version}，网关已重启`,
              restarted: true
            }))
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              success: false,
              error: result.error,
              stdout: result.stdout || '',
              stderr: result.stderr || ''
            }))
          }
        } finally {
          switchingVersion = false
        }
      } catch (error) {
        console.error('[Switch Version] 解析错误:', error.message)
        switchingVersion = false
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }))
      }
    })
    return
  }

  // ============================================
  // Reset Agent API
  // ============================================

  if (pathname === '/reset') {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', chunk => {
        body += chunk.toString()
      })

      req.on('end', async () => {
        try {
          const data = JSON.parse(body)
          const { agentId } = data

          if (!agentId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing agentId parameter' }))
            return
          }

          const safeAgentId = assertAgentId(agentId)
          if (!getConfiguredOpenClawAgents().some(agent => agent.id === safeAgentId)) throw new Error('Agent 不存在')
          const result = await resetAgent(safeAgentId)

          if (result.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          }
        } catch (error) {
          console.error('[Reset] Parse error:', error.message)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
        }
      })
      return
    }
  }

  // ============================================
  // Upload Image API — 图片上传
  // ============================================

  if (pathname === '/api/upload-image' && req.method === 'POST') {
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024
    const MAX_BODY_SIZE = Math.ceil(MAX_IMAGE_SIZE * 4 / 3) + 64 * 1024
    const chunks = []
    let totalBytes = 0
    let sizeExceeded = false

    req.on('data', chunk => {
      if (sizeExceeded) return // 已超限，丢弃后续 chunk
      totalBytes += chunk.length
      if (totalBytes > MAX_BODY_SIZE) {
        sizeExceeded = true
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })

    req.on('end', async () => {
      if (sizeExceeded) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: '图片大小超过 5MB 限制' }))
        return
      }

      try {
        const body = Buffer.concat(chunks).toString()
        const { agentId, mediaType, data } = JSON.parse(body)
        if (agentId) {
          const safeAgentId = assertAgentId(agentId)
          if (!getConfiguredOpenClawAgents().some(agent => agent.id === safeAgentId)) throw new Error('Agent 不存在')
        }

        if (!data) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '缺少 data 参数' }))
          return
        }

        // 强制要求 mediaType 参数，缺失即拒绝
        if (!mediaType) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '缺少 mediaType 参数' }))
          return
        }

        const validated = decodeAndValidateRasterImage(data, mediaType, { maxBytes: MAX_IMAGE_SIZE })
        const { buffer, extension: ext } = validated

        // 存储路径：uploads 目录（按日期分文件夹）
        const today = new Date().toISOString().slice(0, 10) // 2026-05-16
        ensureDirectoryWithinRoots(DASHBOARD_DATA_ROOT, [path.dirname(DASHBOARD_DATA_ROOT)])
        ensureDirectoryWithinRoots(UPLOADS_ROOT, [DASHBOARD_DATA_ROOT])
        const uploadDir = ensureDirectoryWithinRoots(path.join(UPLOADS_ROOT, today), [UPLOADS_ROOT])

        const fileName = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
        const filePath = path.join(uploadDir, fileName)
        safeWriteFileWithinRoots(filePath, buffer, [UPLOADS_ROOT], { mode: 0o600 })

        // 返回相对路径，供前端访问
        const relativePath = `/uploads/${today}/${fileName}`

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          filePath: relativePath,
          url: `${relativePath}`
        }))
      } catch (error) {
        console.error('[Upload] Error:', error.message)
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
      }
    })
    return
  }

  // ============================================
  // Static file serving for uploads
  // ============================================

  if (pathname.startsWith('/uploads/')) {
    try {
      const uploadsBase = path.resolve(UPLOADS_ROOT)
      const relativePath = decodeURIComponent(pathname.slice('/uploads/'.length))
      const filePath = resolvePathWithinRoots(path.resolve(uploadsBase, relativePath), [uploadsBase], { mustExist: true })

      const content = await fs.readFile(filePath)
      const { mediaType } = validateRasterImageBuffer(content)

      res.writeHead(200, {
        'Content-Type': mediaType,
        'Content-Length': content.length,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'private, no-store',
      })
      res.end(content)
      return
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'File not found' }))
    }
    return
  }

  // ============================================
  // GET /api/tasks/current — 获取当前任务进度
  // ============================================

  if (pathname === '/api/tasks/current' && req.method === 'GET') {
    // 5 秒超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('GET /api/tasks/current timeout after 5s')), 5000)
    })

    const handler = async () => {
      try {
        const params = url.searchParams
        const overrideTaskId = params.get('taskId')

        // 支持 ?taskId= 查询参数，无参数时读取 REC-STATUS.json
        const progress = await getCurrentTaskProgress(overrideTaskId || null)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(progress))
      } catch (error) {
        console.error('[Tasks] Error:', error.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          taskId: null,
          projectName: null,
          taskName: null,
          progress: 0,
          currentStage: null,
          totalStages: 0,
          agents: [],
          startedAt: null,
          runningMinutes: 0
        }))
      }
    }

    Promise.race([handler(), timeoutPromise]).catch(err => {
      console.error('[Tasks] Route handler error:', err.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        taskId: null,
        projectName: null,
        taskName: null,
        progress: 0,
        currentStage: null,
        totalStages: 0,
        agents: [],
        startedAt: null,
        runningMinutes: 0
      }))
    })
    return
  }

  // ============================================
  // GET /api/system/skills — 获取技能列表
  // ============================================

  if (pathname === '/api/system/skills' && req.method === 'GET') {
    const isWindows = os.platform() === 'win32'
    const command = isWindows ? 'openclaw.cmd' : 'openclaw'
    const SKILLS_TIMEOUT = 60000 // 60 秒超时

    // 60秒内存缓存:CLI 每次要 3 秒+,频繁打开技能库时直接复用
    if (!global.__skillsCache) global.__skillsCache = { at: 0, body: null }
    if (global.__skillsCache.body && Date.now() - global.__skillsCache.at < 60000) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(global.__skillsCache.body)
      return
    }

    console.log(`[Skills] 执行: ${command} skills list --json`)

    const result = await runCommand(command, ['skills', 'list', '--json'], SKILLS_TIMEOUT)

    if (result.success) {
      try {
        // openclaw 在 Windows 上将 JSON 输出到 stderr（含配置警告）
        // 优先从 stdout 取，为空则从 stderr 取，跳过非 JSON 前缀
        let rawOutput = result.stdout || result.stderr || ''
        const jsonStart = rawOutput.indexOf('{')
        const jsonStr = jsonStart >= 0 ? rawOutput.slice(jsonStart) : rawOutput
        const parsed = JSON.parse(jsonStr)
        const skills = parsed.skills || []

        // 为每个技能增强 installed、enabled 和来源展示字段
        const skillsWithStatus = skills.map(skill => {
          const sourceInfo = buildSkillSourceInfo(skill)
          return {
            ...skill,
            sourceRaw: sourceInfo.sourceRaw,
            sourceLabel: sourceInfo.sourceLabel,
            sourceMaintainer: sourceInfo.sourceMaintainer,
            sourceTrust: sourceInfo.sourceTrust,
            sourceKind: sourceInfo.sourceKind,
            installed: (() => {
              const m = skill.missing || {}
              return (m.bins || []).length === 0
                && (m.anyBins || []).length === 0
                && (m.env || []).length === 0
                && (m.config || []).length === 0
                && (m.os || []).length === 0
            })(),
            enabled: skill.disabled !== true,
            source: skill.source === 'openclaw-bundled' || skill.source === 'openclaw-extra' ? 'builtin' : 'clawhub'
          }
        })

        const ready = skillsWithStatus.filter(s => s.eligible).length

        const __skillsBody = JSON.stringify({
          success: true,
          total: skillsWithStatus.length,
          ready: ready,
          skills: skillsWithStatus,
          workspaceDir: parsed.workspaceDir,
          managedSkillsDir: parsed.managedSkillsDir
        })
        global.__skillsCache = { at: Date.now(), body: __skillsBody }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(__skillsBody)
      } catch (parseError) {
        console.error('[Skills] JSON 解析失败:', parseError.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          error: '解析技能列表失败',
          raw: (result.stdout || result.stderr || '').substring(0, 200)
        }))
      }
    } else {
      console.error(`[Skills] 命令执行失败: ${result.error}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: false,
        error: result.error,
        stderr: result.stderr || ''
      }))
    }
    return
  }

  // ============================================
  // POST /api/system/skills/install — 安装技能
  // ============================================

  if (pathname === '/api/system/skills/install' && req.method === 'POST') {
    let body = ''
    let bodyExceeded = false
    const MAX_BODY_SIZE = 1024 // 1KB 限制

    req.on('data', chunk => {
      body += chunk.toString()
      if (body.length > MAX_BODY_SIZE && !bodyExceeded) {
        bodyExceeded = true
        req.destroy() // H-2 残留修复：立即终止请求，不再入内存
      }
    })
    req.on('end', async () => {
      if (bodyExceeded) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          message: '请求体过大（限制 1KB）',
          stdout: '',
          stderr: ''
        }))
        return
      }
      try {
        const input = JSON.parse(body)
        const skillName = input?.name

        // 输入验证：类型检查 + 非空 + 白名单 + 长度 + 路径遍历防护
        if (!skillName || typeof skillName !== 'string' || !skillName.trim()) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: '缺少技能名称参数',
            stdout: '',
            stderr: ''
          }))
          return
        }

        const trimmed = assertSkillId(skillName)

        const isWindows = os.platform() === 'win32'
        const command = isWindows ? 'npx.cmd' : 'npx'
        const INSTALL_TIMEOUT = 60000 // 60 秒超时

        console.log(`[Skills Install] 执行: ${command} clawhub install ${trimmed}`)

        const result = await runCommand(command, ['clawhub', 'install', '--', trimmed], INSTALL_TIMEOUT)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: result.success,
          message: result.success ? `技能 ${trimmed} 安装成功` : `技能 ${trimmed} 安装失败`,
          stdout: result.stdout || '',
          stderr: result.stderr || ''
        }))
      } catch (parseError) {
        console.error('[Skills Install] 请求解析失败:', parseError.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          message: '请求参数格式错误',
          stdout: '',
          stderr: parseError.message
        }))
      }
    })
    return
  }

  // ============================================
  // GET /api/system/skills/search — 搜索 ClawHub 技能
  // ============================================

  if (pathname === '/api/system/skills/search' && req.method === 'GET') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams
    const query = params.get('q') || ''

    if (!query.trim()) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, total: 0, skills: [] }))
      return
    }

    const isWindows = os.platform() === 'win32'
    const command = isWindows ? 'npx.cmd' : 'npx'
    const SEARCH_TIMEOUT = 30000 // 30 秒超时

    let safeQuery
    try { safeQuery = assertSafeArgumentValue(query, '搜索内容', { maxLength: 200 }) } catch (error) {
      sendJson(res, 400, { success: false, total: 0, skills: [], error: error.message })
      return
    }
    console.log('[Skills Search] 执行安全参数搜索')

    const result = await runCommand(command, ['clawhub', 'search', '--', safeQuery], SEARCH_TIMEOUT)

    if (result.success) {
      try {
        let rawOutput = result.stdout || result.stderr || ''
        // clawhub search 输出是纯文本格式，需要解析
        // 格式: "name  @author  description  (score)"
        const skills = parseClawHubSearchOutput(rawOutput)

        // 通过 clawhub inspect --json 补充统计信息（含描述）
        if (skills.length > 0) {
          console.log(`[Skills Search] 获取 ${skills.length} 个技能的统计信息...`)
          await enrichSkillsWithInfo(skills)
        }

        // REC-016: enrich 后再标记 installed（多重匹配策略）
        if (skills.length > 0) {
          const { installedSlugs, installedNames, installedDescriptions } = await getInstalledSkillInfo()
          for (const skill of skills) {
            // 策略 1: enrich 获取的 slug 与 homepage 提取的 slug 精确匹配
            if (skill.slug && installedSlugs.has(skill.slug)) {
              skill.installed = true
            }
            // 策略 2: 搜索名称与 homepage 提取的 slug 匹配
            else if (installedSlugs.has(skill.name)) {
              skill.installed = true
            }
            // 策略 3: 搜索名称与已安装名称精确匹配
            else if (installedNames.has(skill.name)) {
              skill.installed = true
            }
            // 策略 4: enrich 获取的 displayName 与已安装名称匹配
            else if (skill.displayName && installedNames.has(skill.displayName)) {
              skill.installed = true
            }
            // 策略 5: description 与已安装技能的 description 模糊匹配（兜底）
            else if (skill.description) {
              for (const inst of installedDescriptions) {
                const sDesc = skill.description.trim()
                const iDesc = inst.description.trim()
                if (sDesc === iDesc || sDesc.includes(iDesc) || iDesc.includes(sDesc)) {
                  skill.installed = true
                  break
                }
              }
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          total: skills.length,
          skills
        }))
      } catch (parseError) {
        console.error('[Skills Search] 解析失败:', parseError.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          total: 0,
          skills: [],
          _debug: (result.stdout || result.stderr || '').substring(0, 500)
        }))
      }
    } else {
      console.error(`[Skills Search] 搜索失败: ${result.error}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: false,
        total: 0,
        skills: [],
        error: result.error,
        stderr: (result.stderr || '').substring(0, 500)
      }))
    }
    return
  }

  // ============================================
  // POST /api/system/skills/toggle — 启用/禁用技能
  // ============================================

  if (pathname === '/api/system/skills/toggle' && req.method === 'POST') {
    let body = ''
    let bodyExceeded = false
    const MAX_BODY_SIZE = 1024

    req.on('data', chunk => {
      body += chunk.toString()
      if (body.length > MAX_BODY_SIZE && !bodyExceeded) {
        bodyExceeded = true
        req.destroy()
      }
    })
    req.on('end', async () => {
      if (bodyExceeded) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          message: '请求体过大（限制 1KB）'
        }))
        return
      }
      try {
        const input = JSON.parse(body)
        const { name, enabled } = input

        // 参数验证
        if (!name || typeof name !== 'string' || !name.trim()) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: '缺少 name 参数'
          }))
          return
        }
        if (typeof enabled !== 'boolean') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: 'enabled 参数必须为布尔值'
          }))
          return
        }

        const skillName = assertSkillId(name)

        // 读取 openclaw.json
        const openclawJsonPath = resolvePathWithinRoots(OPENCLAW_CONFIG_PATH, [OPENCLAW_DIR], { mustExist: true })
        const content = await fs.readFile(openclawJsonPath, 'utf-8')
        const config = JSON.parse(content)

        if (!config.skills || typeof config.skills !== 'object' || Array.isArray(config.skills)) throw new Error('skills 配置格式无效')
        if (!config.skills.entries || typeof config.skills.entries !== 'object' || Array.isArray(config.skills.entries)) throw new Error('skills.entries 配置格式无效')

        // 检查技能是否存在
        if (!Object.hasOwn(config.skills.entries, skillName)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            message: `技能 "${skillName}" 不存在于配置中`
          }))
          return
        }

        // 修改 enabled 字段
        const entry = config.skills.entries[skillName]
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('技能配置格式无效')
        entry.enabled = enabled

        safeAtomicWriteFileWithinRoots(openclawJsonPath, `${JSON.stringify(config, null, 2)}\n`, [OPENCLAW_DIR])

        console.log(`[Skills Toggle] ${skillName} → enabled: ${enabled}`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          name: skillName,
          enabled
        }))
      } catch (error) {
        console.error('[Skills Toggle] 失败:', error.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: false,
          message: error.message
        }))
      }
    })
    return
  }

  // ============================================
  // GET /api/system/doctor — 在一次性 HOME / 状态目录执行 doctor --lint
  // ============================================

  if (pathname === '/api/system/doctor' && req.method === 'GET') {
    const plan = doctorCommand(os.platform())
    const DOCTOR_TIMEOUT = 120000 // 120 秒
    if (!plan.supported) {
      sendJson(res, 501, { success: false, error: plan.reason, command: plan.display, readOnly: true })
      return
    }
    let sandbox
    try {
      sandbox = createReadOnlyDoctorSandbox({ configPath: OPENCLAW_CONFIG_PATH })
      console.log(`[Doctor] 执行隔离只读诊断: ${plan.display}`)
      const result = await runFileCommand(plan.command, plan.args, DOCTOR_TIMEOUT, {
        decode: decodeBuffer,
        env: sandbox.env,
      })
      const isolatedConfig = JSON.parse(fsSync.readFileSync(sandbox.configPath, 'utf8'))
      const secrets = [GATEWAY_CREDENTIALS.token, ...collectSensitiveValues(isolatedConfig)]
      const redacted = redactDiagnosticResult(result, {
        secrets,
        homeDirs: [sandbox.home, process.env.HOME, process.env.USERPROFILE].filter(Boolean),
      })
      sendJson(res, 200, {
        success: result.success,
        ...redacted,
        command: plan.display,
        platform: os.platform(),
        readOnly: true,
        isolated: true,
      })
    } catch (error) {
      const redacted = redactDiagnosticResult({ error: error.message }, {
        secrets: [GATEWAY_CREDENTIALS.token],
        homeDirs: [sandbox?.home, process.env.HOME, process.env.USERPROFILE].filter(Boolean),
      })
      sendJson(res, 500, { success: false, error: redacted.error, readOnly: true })
    } finally {
      sandbox?.cleanup()
    }
    return
  }

  // ============================================
  // 计费配置：GET / POST /api/billing-config
  // 存储在 ./billing-config.json（项目根目录），编辑后立即生效
  // ============================================
  const BILLING_CONFIG_PATH = path.join(__dirname, '..', 'billing-config.json')

  // 内置主流 provider 默认值（人民币 / 100 万 token；以各官网 API 对外报价 × 7.2 固定汇率折算，2026-07 官网核对）
  const BILLING_DEFAULTS = {
    version: 1,
    models: {
      ...GPT56_BILLING_MODELS,
      'MiniMax-M2.7': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 2.16,
        outputPriceCNYPerMillion: 8.64,
        cacheReadPriceCNYPerMillion: 0.432,
        note: 'MiniMax M2.7：未在 2026-07 本次官网核验中公开确认，沿用原配置 ($0.30/$1.20/cache $0.06)，汇率 7.2',
      },
      'deepseek-v4-flash': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 1.008,
        outputPriceCNYPerMillion: 2.016,
        cacheReadPriceCNYPerMillion: 0.0202,
        note: 'DeepSeek V4 Flash 官方 API ($0.14 输入 / $0.28 输出 / 缓存命中 $0.0028 per M)，汇率 7.2，2026-07 官网核对',
      },
      'deepseek-v4-pro': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 3.132,
        outputPriceCNYPerMillion: 6.264,
        cacheReadPriceCNYPerMillion: 0.0261,
        note: 'DeepSeek V4 Pro 官方 API ($0.435 输入 / $0.87 输出 / 缓存命中 $0.003625 per M)，汇率 7.2，2026-07 官网核对',
      },
      'deepseek-v3': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 1.008,
        outputPriceCNYPerMillion: 2.016,
        cacheReadPriceCNYPerMillion: 0.0202,
        note: 'DeepSeek V3 旧记录兼容：当前官网主推 deepseek-v4-flash / deepseek-chat 价位，无夜间折扣，汇率 7.2',
      },
      'deepseek-chat': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 1.008,
        outputPriceCNYPerMillion: 2.016,
        cacheReadPriceCNYPerMillion: 0.0202,
        note: 'DeepSeek chat 兼容名：官网说明将于 2026-07-24 废弃，对应 deepseek-v4-flash 非思考模式，汇率 7.2',
      },
      'deepseek-reasoner': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 1.008,
        outputPriceCNYPerMillion: 2.016,
        cacheReadPriceCNYPerMillion: 0.0202,
        note: 'DeepSeek reasoner 兼容名：官网说明将于 2026-07-24 废弃，对应 deepseek-v4-flash 思考模式，汇率 7.2',
      },
      'claude-fable-5': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 72,
        outputPriceCNYPerMillion: 360,
        cacheReadPriceCNYPerMillion: 7.2,
        cacheWritePriceCNYPerMillion: 90,
        note: 'Anthropic Claude Fable 5 官方 API ($10/$50，5 分钟缓存写 $12.5、读 $1 per M)，汇率 7.2，2026-07 官网核对',
      },
      'claude-opus-4-8': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 36,
        outputPriceCNYPerMillion: 180,
        cacheReadPriceCNYPerMillion: 3.6,
        cacheWritePriceCNYPerMillion: 45,
        note: 'Anthropic Claude Opus 4.8 官方 API ($5/$25，5 分钟缓存写 $6.25、读 $0.5 per M)，汇率 7.2，2026-07 官网核对',
      },
      'claude-sonnet-5': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 14.4,
        outputPriceCNYPerMillion: 72,
        cacheReadPriceCNYPerMillion: 1.44,
        cacheWritePriceCNYPerMillion: 18,
        note: 'Anthropic Claude Sonnet 5 官方限时价 ($2/$10，5 分钟缓存写 $2.5、读 $0.2 per M)，限时到 2026-08-31，汇率 7.2',
      },
      'claude-haiku-4-5': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 7.2,
        outputPriceCNYPerMillion: 36,
        cacheReadPriceCNYPerMillion: 0.72,
        cacheWritePriceCNYPerMillion: 9,
        note: 'Anthropic Claude Haiku 4.5 官方 API ($1/$5，5 分钟缓存写 $1.25、读 $0.1 per M)，汇率 7.2，2026-07 官网核对',
      },
      'claude-sonnet-4-6': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 21.6,
        outputPriceCNYPerMillion: 108,
        cacheReadPriceCNYPerMillion: 2.16,
        cacheWritePriceCNYPerMillion: 27,
        note: 'Anthropic Claude Sonnet 4.6 官方 API ($3/$15，5 分钟缓存写 $3.75、读 $0.3 per M)，汇率 7.2，2026-07 官网核对',
      },
      'claude-sonnet-4-5': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 21.6,
        outputPriceCNYPerMillion: 108,
        cacheReadPriceCNYPerMillion: 2.16,
        cacheWritePriceCNYPerMillion: 27,
        note: 'Anthropic Claude Sonnet 4.5 官方 API ($3/$15，5 分钟缓存写 $3.75、读 $0.3 per M)，汇率 7.2，2026-07 官网核对',
      },
      'claude-opus-4': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 108,
        outputPriceCNYPerMillion: 540,
        cacheReadPriceCNYPerMillion: 10.8,
        cacheWritePriceCNYPerMillion: 135,
        note: 'Claude Opus 4 旧记录兼容：按旧 Opus 4 / Opus 4.1 高价位 ($15/$75，5 分钟缓存写 $18.75、读 $1.5 per M) 保留，汇率 7.2',
      },
      'claude-opus-4-6': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 36,
        outputPriceCNYPerMillion: 180,
        cacheReadPriceCNYPerMillion: 3.6,
        cacheWritePriceCNYPerMillion: 45,
        note: 'Anthropic Claude Opus 4.6 官方 API ($5/$25，5 分钟缓存写 $6.25、读 $0.5 per M)，汇率 7.2，2026-07 官网核对',
      },
      'claude-opus-4-7': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 36,
        outputPriceCNYPerMillion: 180,
        cacheReadPriceCNYPerMillion: 3.6,
        cacheWritePriceCNYPerMillion: 45,
        note: 'Anthropic Claude Opus 4.7 官方 API ($5/$25，5 分钟缓存写 $6.25、读 $0.5 per M)，汇率 7.2，2026-07 官网核对',
      },
      'claude-opus-4-5': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 36,
        outputPriceCNYPerMillion: 180,
        cacheReadPriceCNYPerMillion: 3.6,
        cacheWritePriceCNYPerMillion: 45,
        note: 'Anthropic Claude Opus 4.5 官方 API ($5/$25，5 分钟缓存写 $6.25、读 $0.5 per M)，汇率 7.2，2026-07 官网核对',
      },
      'chat-latest': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 36,
        outputPriceCNYPerMillion: 216,
        cacheReadPriceCNYPerMillion: 3.6,
        note: 'OpenAI ChatGPT chat-latest 官方 API ($5/$30，缓存读 $0.5 per M)，汇率 7.2，2026-07 官网核对',
      },
      'gpt-5.3-codex': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 12.6,
        outputPriceCNYPerMillion: 100.8,
        cacheReadPriceCNYPerMillion: 1.26,
        note: 'OpenAI Codex gpt-5.3-codex 官方 API ($1.75/$14，缓存读 $0.175 per M)，汇率 7.2，2026-07 官网核对',
      },
      'gpt-5.4': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 18,
        outputPriceCNYPerMillion: 108,
        cacheReadPriceCNYPerMillion: 1.8,
        note: 'OpenAI GPT-5.4 官方 API 标准短上下文 ($2.5/$15，缓存读 $0.25 per M)，汇率 7.2，2026-07 官网核对',
      },
      'gpt-5.4-mini': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 5.4,
        outputPriceCNYPerMillion: 32.4,
        cacheReadPriceCNYPerMillion: 0.54,
        note: 'OpenAI GPT-5.4 Mini 官方 API ($0.75/$4.5，缓存读 $0.075 per M)，汇率 7.2，2026-07 官网核对',
      },
      'gpt-5.4-nano': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 1.44,
        outputPriceCNYPerMillion: 9,
        cacheReadPriceCNYPerMillion: 0.144,
        note: 'OpenAI GPT-5.4 Nano 官方 API ($0.2/$1.25，缓存读 $0.02 per M)，汇率 7.2，2026-07 官网核对',
      },
      'gpt-5.4-pro': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 216,
        outputPriceCNYPerMillion: 1296,
        note: 'OpenAI GPT-5.4 Pro 官方 API 标准短上下文 ($30/$180 per M)，汇率 7.2，2026-07 官网核对',
      },
      'gpt-4o': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 18,
        outputPriceCNYPerMillion: 72,
        cacheReadPriceCNYPerMillion: 9,
        note: 'OpenAI GPT-4o 旧配置保留：2026-07 OpenAI 当前主价格页未列通用文本 gpt-4o',
      },
      'gpt-4o-mini': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 1.08,
        outputPriceCNYPerMillion: 4.32,
        note: 'OpenAI GPT-4o-mini 旧配置保留：2026-07 OpenAI 当前主价格页未列通用文本 gpt-4o-mini',
      },
      'gpt-5.5': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 36,
        outputPriceCNYPerMillion: 216,
        cacheReadPriceCNYPerMillion: 3.6,
        note: 'OpenAI GPT-5.5 官方 API 标准短上下文 ($5/$30，缓存读 $0.5 per M)，汇率 7.2，2026-07 官网核对',
      },
      'gpt-5.5-pro': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 216,
        outputPriceCNYPerMillion: 1296,
        note: 'OpenAI GPT-5.5 Pro 官方 API 标准短上下文 ($30/$180 per M)，汇率 7.2，2026-07 官网核对',
      },
      'codex-auto-review': {
        mode: 'free',
        note: 'Codex 自动审查记录：默认只统计 Token，不计入费用；如需计费可改为按 token 计费',
      },
      'Qwen3.5-4B-OptiQ-4bit': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地千问模型：默认只统计 Token；填入单价后计入费用',
      },
      'qwen3.5': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地千问模型：默认只统计 Token；填入单价后计入费用',
      },
      'qwen3.5:9b': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地千问模型：默认只统计 Token；填入单价后计入费用',
      },
      'qwen2.5': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地千问模型：默认只统计 Token；填入单价后计入费用',
      },
      'gemma3:12b': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地 Google Gemma 模型：默认只统计 Token；填入单价后计入费用',
      },
      'gemma3': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地 Google Gemma 模型：默认只统计 Token；填入单价后计入费用',
      },
      'gemma2': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地 Google Gemma 模型：默认只统计 Token；填入单价后计入费用',
      },
      'gemma4:31b-mlx': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地 Google Gemma 模型：默认只统计 Token；填入单价后计入费用',
      },
      'gemma4:26b-mlx': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地 Google Gemma 模型：默认只统计 Token；填入单价后计入费用',
      },
      'gemma4:12b-mlx': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地 Google Gemma 模型：默认只统计 Token；填入单价后计入费用',
      },
      'gemma4:12b-mlx-bf16': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地 Google Gemma 模型：默认只统计 Token；填入单价后计入费用',
      },
      'gemma4:12b-mxfp8': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地 Google Gemma 模型：默认只统计 Token；填入单价后计入费用',
      },
      'gemma4:12b-nvfp4': {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '本地 Google Gemma 模型：默认只统计 Token；填入单价后计入费用',
      },
    },
    fallback: {
      mode: 'use_default',
      note: '未在上方配置的模型，使用 OpenClaw 自带计费',
    },
  }

  const readEffectiveBillingConfig = () => {
    let savedConfig = null
    try {
      if (fsSync.existsSync(BILLING_CONFIG_PATH)) {
        savedConfig = JSON.parse(fsSync.readFileSync(BILLING_CONFIG_PATH, 'utf8'))
      }
    } catch { /* use reviewed defaults */ }
    return mergeBillingConfigWithDefaults(BILLING_DEFAULTS, savedConfig)
  }

  const readObservationBillingConfig = readEffectiveBillingConfig

  // ============================================
  // 阶段 3A：统一只读会话执行详情
  // 仅接受来源、Agent ID、会话 ID 和分页参数；不接受文件路径。
  // ============================================
  if (pathname === '/api/session-observation/capabilities' && req.method === 'GET') {
    sendJson(res, 200, { capabilities: SESSION_OBSERVATION_STORE.capabilities(), readOnly: true })
    return
  }

  if (pathname === '/api/session-observation/sessions' && req.method === 'GET') {
    try {
      const allowedQueryKeys = new Set(['source', 'agentId', 'sessionId', 'sessionIds'])
      if ([...url.searchParams.keys()].some(key => !allowedQueryKeys.has(key))) throw new Error('请求包含不支持的查询参数')
      const source = String(url.searchParams.get('source') || '')
      const agentId = String(url.searchParams.get('agentId') || '')
      const sessionIds = [
        ...url.searchParams.getAll('sessionId'),
        ...String(url.searchParams.get('sessionIds') || '').split(','),
      ].map(value => value.trim()).filter(Boolean)
      const result = await SESSION_OBSERVATION_STORE.listSessions({
        source,
        agentId,
        sessionIds,
        secrets: browserOutputSecrets(),
      })
      const billingConfig = readObservationBillingConfig()
      sendJson(res, 200, {
        ...result,
        sessions: result.sessions.map(session => ({
          ...session,
          ...enrichObservationUsage(session, billingConfig, session.lastActivityMs),
        })),
        readOnly: true,
      })
    } catch (error) {
      sendJson(res, 400, { error: error.message, sessions: [], readOnly: true })
    }
    return
  }

  if (pathname === '/api/session-observation/events' && req.method === 'GET') {
    try {
      const allowedQueryKeys = new Set(['source', 'sessionId', 'cursor', 'limit', 'type', 'types', 'errorsOnly'])
      if ([...url.searchParams.keys()].some(key => !allowedQueryKeys.has(key))) throw new Error('请求包含不支持的查询参数')
      const source = String(url.searchParams.get('source') || '')
      const sessionId = String(url.searchParams.get('sessionId') || '')
      const rawCursor = String(url.searchParams.get('cursor') || '')
      const limit = Number(url.searchParams.get('limit') || 30)
      const rawErrorsOnly = String(url.searchParams.get('errorsOnly') || '')
      if (rawErrorsOnly && !['0', '1'].includes(rawErrorsOnly)) throw new Error('错误筛选参数无效')
      const types = [
        ...url.searchParams.getAll('type'),
        ...String(url.searchParams.get('types') || '').split(','),
      ].map(value => value.trim()).filter(Boolean)
      const result = await SESSION_OBSERVATION_STORE.readEvents({
        source,
        sessionId,
        cursor: rawCursor || undefined,
        limit,
        types,
        errorsOnly: rawErrorsOnly === '1',
        secrets: browserOutputSecrets(),
      })
      const billingConfig = readObservationBillingConfig()
      sendJson(res, 200, {
        ...result,
        events: result.events.map(event => enrichObservationEvent(event, billingConfig)),
        readOnly: true,
      })
    } catch (error) {
      sendJson(res, 400, { error: error.message, events: [], readOnly: true })
    }
    return
  }

  if (pathname === '/api/billing-config' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(readEffectiveBillingConfig()))
    } catch (e) {
      console.error('[billing-config GET] error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, ...BILLING_DEFAULTS }))
    }
    return
  }

  if (pathname === '/api/billing-config' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body)
        if (!cfg || typeof cfg !== 'object' || !cfg.models) {
          throw new Error('Invalid config: 必须包含 models 字段')
        }
        // 备份旧文件
        if (fsSync.existsSync(BILLING_CONFIG_PATH)) {
          fsSync.copyFileSync(BILLING_CONFIG_PATH, BILLING_CONFIG_PATH + '.bak')
        }
        fsSync.writeFileSync(BILLING_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8')
        clearLocalAiUsageCache()
        console.log('[billing-config POST] saved, models:', Object.keys(cfg.models).length)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, path: BILLING_CONFIG_PATH }))
      } catch (e) {
        console.error('[billing-config POST] error:', e.message)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: e.message }))
      }
    })
    return
  }

  // GET /api/billing-config/defaults — 获取内置预设（用于"恢复默认"或新增模型时下拉选择）
  if (pathname === '/api/billing-config/defaults' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(BILLING_DEFAULTS))
    return
  }

  // ============================================
  // 本地 AI 消耗：Codex / Claude Code
  // GET /api/local-ai-usage?days=7|all 或 ?start=YYYY-MM-DD&end=YYYY-MM-DD
  // ============================================
  if (pathname === '/api/local-ai-usage' && req.method === 'GET') {
    try {
      const billingConfig = readEffectiveBillingConfig()

      const range = buildLocalUsageRange(url.searchParams)
      const result = await collectLocalAiUsage(range, billingConfig)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (e) {
      console.error('[local-ai-usage] error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, apps: [], totals: createUsageTotals() }))
    }
    return
  }

  // ============================================
  // 本地 AI 实时状态：Codex / Claude Code
  // GET /api/local-ai-status
  // ============================================
  if (pathname === '/api/local-ai-status' && req.method === 'GET') {
    try {
      const now = Date.now()
      const sinceMs = localAiStatusSinceMs(url.searchParams)
      const claudeSessions = findRecentClaudeSessions({ sinceMs })
      const codexSessions = findRecentCodexSessions({ sinceMs })

      const statuses = []
      for (const session of claudeSessions) {
        const events = parseClaudeSessionEvents(session.file)
        const status = classifyAgentUiStatus(events, {
          now,
          latestMtime: session.mtime,
          latestFile: session.file,
          agentId: session.conversationId,
        })
        statuses.push(toLocalAiStatusRow(session, status))
      }

      for (const session of codexSessions) {
        const events = parseCodexSessionEvents(session.file)
        const status = classifyAgentUiStatus(events, {
          now,
          latestMtime: session.mtime,
          latestFile: session.file,
          agentId: session.conversationId,
        })
        statuses.push(toLocalAiStatusRow(session, status))
      }

      applyCodexProcessFallback(statuses, readCodexProcesses(), now)
      statuses.sort((a, b) => (b.lastActivityMs || 0) - (a.lastActivityMs || 0))

      sendJson(res, 200, {
        statuses,
        checkedAt: now,
        sinceMs,
        processFallbackMs: CODEX_PROCESS_ACTIVE_MS,
      })
    } catch (e) {
      console.error('[local-ai-status] error:', e.message)
      sendJson(res, 500, { error: e.message, statuses: [] })
    }
    return
  }

  // ============================================
  // GET /api/cost-summary  Sprint 1
  // 返回：{ todayCNY, monthCNY, monthForecastCNY }
  // 数据来源：OpenClaw Agent 会话 + 本机 Codex / Claude Code 日志
  // ============================================
  if (pathname === '/api/cost-summary' && req.method === 'GET') {
    try {
      const result = await collectUsageStats()
      // 用 by-session jsonl mtime 聚合到日
      const AGENTS_DIR_LOCAL = path.join(OPENCLAW_DIR, 'agents')
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      const todayStartMs = today.getTime()
      const monthStartMs = monthStart.getTime()
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
      const dayOfMonth = today.getDate()

      const billingConfig = readEffectiveBillingConfig()

      let todayCost = 0
      let monthCost = 0
      // 扫所有 agent 的 sessions，按文件 mtime 聚合
      const agentDirs = fsSync.readdirSync(AGENTS_DIR_LOCAL).filter(d => {
        try { return fsSync.statSync(path.join(AGENTS_DIR_LOCAL, d)).isDirectory() } catch { return false }
      })
      for (const agent of agentDirs) {
        const sessionsDir = path.join(AGENTS_DIR_LOCAL, agent, 'sessions')
        if (!fsSync.existsSync(sessionsDir)) continue
        // 读 per-agent usage cache
        const cacheByUuid = new Map()
        try {
          const cachePath = path.join(sessionsDir, '.usage-cost-cache.json')
          if (fsSync.existsSync(cachePath)) {
            const cacheData = JSON.parse(fsSync.readFileSync(cachePath, 'utf-8'))
            for (const [filePath, entry] of Object.entries(cacheData.files || {})) {
              if (entry?.totals) {
                const basename = path.basename(filePath)
                const uuid = extractSessionUuid(basename)
                if (uuid) {
                  const usageTotals = extractUsageTotals(entry.totals)
                  const model = extractModelIdFromEntry(entry, entry.totals)
                  cacheByUuid.set(uuid, { model, usage: usageTotals })
                }
              }
            }
          }
        } catch (e) { /* ignore */ }
        const files = fsSync.readdirSync(sessionsDir).filter(f => isSessionFile(f))
        for (const file of files) {
          const fp = path.join(sessionsDir, file)
          let stat
          try { stat = fsSync.statSync(fp) } catch { continue }
          if (stat.mtimeMs < monthStartMs) continue
          const uuid = extractSessionUuid(file)
          if (!uuid) continue
          const cached = cacheByUuid.get(uuid)
          const cost = cached
            ? calculateUsageCostWithBilling(cached.model, cached.usage, cached.usage.cost, billingConfig, stat.mtimeMs)
            : 0
          if (stat.mtimeMs >= todayStartMs) todayCost += cost
          monthCost += cost
        }
      }

      const monthStartKey = localDateKeyFromMs(monthStartMs)
      const todayKey = localDateKeyFromMs(todayStartMs)
      const localAllUsage = await collectLocalAiUsage({
        startMs: localMaxStartMs(Date.now()),
        endMs: Date.now(),
        all: false,
        requestedAll: true,
        capped: true,
        cappedDays: LOCAL_AI_USAGE_MAX_DAYS,
        granularity: 'day',
        key: `all-capped-${LOCAL_AI_USAGE_MAX_DAYS}&granularity=day`,
      }, billingConfig)
      for (const day of localAllUsage.timeline || []) {
        const dayCost = Number(day.cost) || 0
        if (day.date === todayKey) todayCost += dayCost
        if (day.date >= monthStartKey) monthCost += dayCost
      }

      // 预估本月总费用：按当前已过天数线性外推
      const monthForecast = dayOfMonth > 0 ? (monthCost / dayOfMonth) * daysInMonth : monthCost

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        todayCNY: todayCost,
        monthCNY: monthCost,
        monthForecastCNY: monthForecast,
        daysInMonth,
        dayOfMonth,
        totalAllTime: Object.entries(result.byModel || {}).reduce((sum, [model, usage]) => {
          return sum + calculateUsageCostWithBilling(model, usage, usage.cost, billingConfig)
        }, 0) + (Number(localAllUsage.totals?.cost) || 0),
      }))
    } catch (e) {
      console.error('[cost-summary] error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, todayCNY: 0, monthCNY: 0, monthForecastCNY: 0 }))
    }
    return
  }

  // ============================================
  // 文件管理 API
  // GET  /api/file-manager/tree      → 文件清单（带中文说明）
  // POST /api/file-manager/read      → 读取文件内容（body: { path }）
  // ============================================
  const FILE_MANAGER_EDITABLE_EXTS = ['.md', '.json', '.py', '.txt', '.yaml', '.yml', '.sh', '.js', '.ts', '.env']

  // 通用文件接口只允许 Agent 工作空间和部署者显式根，不开放 ~/.openclaw 内部数据。
  function resolveSafePath(p, { mustExist = false } = {}) {
    if (!p || typeof p !== 'string') throw new Error('invalid path')
    const resolved = resolvePathWithinRoots(expandUserPath(p), getDashboardFileRoots(), { mustExist })
    assertNonSensitiveFilePath(resolved)
    return resolved
  }

  function resolveManagedBackupPath(backupPath, targetPath, { mustExist = false } = {}) {
    const target = resolveSafePath(targetPath)
    const backup = resolvePathWithinRoots(expandUserPath(backupPath), getDashboardFileRoots(), { mustExist })
    const escapedTarget = path.basename(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const expected = new RegExp(`^${escapedTarget}\\.bak\\.\\d{10,17}$`)
    if (path.dirname(backup) !== path.dirname(target) || !expected.test(path.basename(backup))) {
      throw new Error('备份文件与目标文件不匹配')
    }
    if (mustExist) {
      const stat = fsSync.lstatSync(backup)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('备份必须是普通文件')
    }
    return backup
  }

  function fileItem(filePath, cn, desc, usedBy = [], extra = {}) {
    return {
      path: displayUserPath(filePath),
      cn,
      desc,
      usedBy,
      ...extra,
      sensitive: Boolean(extra.sensitive || sensitiveFileReason(filePath)),
    }
  }

  function buildAgentWorkspaceGroup(agent) {
    if (!agent.workspace) return null
    const root = agent.workspace
    const usedBy = [agent.name || agent.id]
    return {
      name: `${agent.name || agent.id} 工作空间`,
      items: [
        fileItem(root, `${agent.name || agent.id} 工作空间`, '该 Agent 的真实工作目录', usedBy, { isDir: true }),
        fileItem(path.join(root, 'IDENTITY.md'), '身份卡', 'Agent 的身份、名字、角色和行为设定', usedBy),
        fileItem(path.join(root, 'SOUL.md'), '灵魂书', 'Agent 的核心原则和长期风格设定', usedBy),
        fileItem(path.join(root, 'USER.md'), '用户偏好', 'Agent 读取的用户偏好和工作习惯', usedBy),
        fileItem(path.join(root, 'AGENTS.md'), '工作规则', '该工作空间内的协作规则', usedBy),
        fileItem(path.join(root, 'TOOLS.md'), '工具注记', '该 Agent 可用工具和注意事项', usedBy),
        fileItem(path.join(root, 'HEARTBEAT.md'), '心跳清单', 'Agent 的待处理事项或心跳任务', usedBy),
        fileItem(path.join(root, 'MEMORY.md'), '长期记忆', '该 Agent 的长期记忆文件', usedBy),
        fileItem(path.join(root, 'openclaw-workspace-state.json'), '工作空间状态', 'OpenClaw 记录的工作空间状态', usedBy),
      ],
    }
  }

  function buildLegacyClawdCategory() {
    const legacy = path.join(HOME_DIR, 'clawd')
    if (!fsSync.existsSync(legacy)) return null
    return {
      name: '兼容旧工作目录',
      rootDesc: `${displayUserPath(legacy)}，仅在该目录真实存在时显示`,
      groups: [
        {
          name: '常见文件',
          items: [
            fileItem(legacy, '旧工作目录', '兼容旧版 OpenClaw / 开发者工作区', ['旧版 OpenClaw'], { isDir: true }),
            ...['IDENTITY.md', 'SOUL.md', 'USER.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md', 'MEMORY.md', 'skills-lock.json']
              .map(name => fileItem(path.join(legacy, name), name, '旧工作目录中的常见配置文件', ['旧版 OpenClaw'])),
          ],
        },
        {
          name: '常见子目录',
          items: [
            fileItem(path.join(legacy, 'agents'), 'Agent 子目录', '旧版按角色划分的 Agent 配置', ['旧版 OpenClaw'], { isDir: true }),
            fileItem(path.join(legacy, 'admin'), '管理目录', '旧版项目、定时任务和管理文件', ['旧版 OpenClaw'], { isDir: true }),
            fileItem(path.join(legacy, 'admin', 'projects'), '项目档案目录', '旧版项目看板数据目录', ['项目看板'], { isDir: true }),
            fileItem(path.join(legacy, 'memory'), '记忆目录', '旧版长期记忆 markdown 文件', ['旧版 OpenClaw'], { isDir: true }),
            fileItem(path.join(legacy, 'scripts'), '脚本目录', '旧版自动化脚本', ['旧版 OpenClaw'], { isDir: true }),
          ],
        },
      ],
    }
  }

  /** 文件清单（按当前机器自动发现 OpenClaw 配置 + 谁在用） */
  function buildFileManifest() {
    const agents = getConfiguredOpenClawAgents()
    const workspaceGroups = agents.map(buildAgentWorkspaceGroup).filter(Boolean)
    const categories = []
    if (workspaceGroups.length > 0) {
      categories.push({
        name: 'Agent 工作空间',
        rootDesc: '从本机安全配置读取；不同电脑会显示各自真实的 Agent 工作目录',
        groups: workspaceGroups,
      })
    }

    return categories
  }

  // 给清单填充实时元数据（大小、存在、mtime）
  function enrichManifest() {
    return buildFileManifest().map(cat => ({
      ...cat,
      groups: cat.groups.map(g => ({
        ...g,
        items: g.items.map(item => {
          try {
            const real = resolveSafePath(item.path, { mustExist: true })
            const stat = fsSync.statSync(real)
            return {
              ...item,
              exists: true,
              isDir: stat.isDirectory(),
              size: stat.isFile() ? stat.size : null,
              entries: stat.isDirectory() ? (fsSync.readdirSync(real).length) : null,
              mtime: stat.mtimeMs,
            }
          } catch (e) {
            return { ...item, exists: false }
          }
        }),
      })),
    }))
  }

  if (pathname === '/api/file-manager/tree' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ categories: enrichManifest() }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // POST /api/file-manager/reveal — 用系统默认方式打开文件或在 Finder 显示
  // body: { path, mode: 'open' | 'reveal' }
  //   open    → 用默认 app 打开（文件→编辑器，目录→Finder）
  //   reveal  → 在 Finder 中定位该文件（高亮显示）
  if (pathname === '/api/file-manager/reveal' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const { path: p, mode } = JSON.parse(body)
        const real = resolveSafePath(p, { mustExist: true })
        const platform = os.platform()
        let cmd, args
        if (platform === 'darwin') {
          if (mode === 'reveal') {
            cmd = 'open'; args = ['-R', real]
          } else {
            cmd = 'open'; args = [real]
          }
        } else if (platform === 'win32') {
          if (mode === 'reveal') {
            cmd = 'explorer'; args = ['/select,', real]
          } else {
            cmd = 'explorer'; args = [real]
          }
        } else {
          // linux: 用 xdg-open 打开文件，或打开父目录
          if (mode === 'reveal') {
            cmd = 'xdg-open'; args = [path.dirname(real)]
          } else {
            cmd = 'xdg-open'; args = [real]
          }
        }
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false, env: commandEnvironment() })
        child.unref()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, platform, mode, path: real }))
      } catch (e) {
        console.error('[file-manager/reveal] error:', e.message)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: e.message }))
      }
    })
    return
  }

  if (pathname === '/api/file-manager/read' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const { path: p } = JSON.parse(body)
        const real = resolveSafePath(p, { mustExist: true })
        const stat = fsSync.statSync(real)
        if (stat.isDirectory()) {
          // 目录 → 返回前 50 个子项
          const safeEntries = fsSync.readdirSync(real)
            .filter(name => {
              try { resolveSafePath(path.join(real, name), { mustExist: true }); return true } catch { return false }
            })
          const list = safeEntries.slice(0, 50)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'dir', entries: list, totalCount: safeEntries.length }))
          return
        }
        const MAX = 512 * 1024 // 512KB 上限
        if (stat.size > MAX) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'too_large', size: stat.size, message: `文件 ${(stat.size / 1024).toFixed(1)} KB 超过 512KB 预览上限` }))
          return
        }
        // 简单 binary 检测：扩展名或内容含 NUL
        const ext = path.extname(real).toLowerCase()
        const binaryExts = ['.sqlite', '.sqlite-shm', '.sqlite-wal', '.db', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.gz', '.exe', '.dylib']
        if (binaryExts.includes(ext)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'binary', size: stat.size, message: `二进制文件（${ext}）不支持预览` }))
          return
        }
        let content = fsSync.readFileSync(real, 'utf-8')
        if (content.includes('\x00')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'binary', size: stat.size, message: '检测到二进制内容（含 NUL 字节）' }))
          return
        }
        if (['.json', '.yaml', '.yml'].includes(ext)) {
          content = redactSensitiveText(content, [GATEWAY_CREDENTIALS.token, LOCAL_TOKEN])
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          type: 'text',
          size: stat.size,
          mtime: stat.mtimeMs,
          ext,
          content,
        }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: e.message }))
      }
    })
    return
  }

  // ============================================
  // Sprint 4: 文件写入 API
  // ============================================

  // POST /api/file-manager/write — 写入文件（含自动备份）
  if (pathname === '/api/file-manager/write' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { path: p, content } = JSON.parse(body)
        if (typeof content !== 'string') throw new Error('content must be string')
        const MAX_WRITE = 512 * 1024
        if (content.length > MAX_WRITE) throw new Error(`内容超过 512KB 上限（${(content.length/1024).toFixed(1)}KB）`)

        const real = resolveSafePath(p)
        const roots = getDashboardFileRoots()

        const ext = path.extname(real).toLowerCase()
        if (!FILE_MANAGER_EDITABLE_EXTS.includes(ext)) throw new Error(`不允许编辑 ${ext} 类型文件`)

        // 自动备份（仅文件存在时）
        let backupPath = null
        try {
          if (fsSync.existsSync(real)) {
            const ts = Date.now()
            backupPath = `${real}.bak.${ts}`
            safeWriteFileWithinRoots(backupPath, fsSync.readFileSync(real), roots, { mode: 0o600 })
          }
        } catch { /* 备份失败不影响写入 */ }

        safeWriteFileWithinRoots(real, content, roots, { encoding: 'utf8', mode: 0o600 })

        // 检测是否 IDENTITY.md（建议 agent reset）
        const isIdentity = path.basename(real) === 'IDENTITY.md'
        let resetHint = null
        if (isIdentity) {
          const owner = getConfiguredOpenClawAgents()
            .find(agent => agent.workspace && isPathInside(real, agent.workspace))
          resetHint = owner?.id || null
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, backupPath, resetHint, writtenBytes: content.length }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ============================================
  // #16: 文件备份管理 API
  // ============================================

  // GET /api/file-manager/backups?path=... — 列出某文件的所有备份（.bak.{ts} 格式）
  if (pathname === '/api/file-manager/backups' && req.method === 'GET') {
    try {
      const rawPath = url.searchParams.get('path') || ''
      if (!rawPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'path 参数必填' }))
        return
      }
      const real = resolveSafePath(rawPath)
      const dir = path.dirname(real)
      const base = path.basename(real)
      const backups = []
      try {
        const files = fsSync.readdirSync(dir)
        for (const f of files) {
          // 备份文件格式：{base}.bak.{timestamp}
          if (new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.bak\\.\\d+$`).test(f)) {
            const tsStr = f.slice(base.length + 5) // ".bak." = 5 chars
            const ts = parseInt(tsStr, 10)
            if (!isNaN(ts)) {
              const fullPath = resolveManagedBackupPath(path.join(dir, f), real, { mustExist: true })
              const stat = fsSync.lstatSync(fullPath)
              backups.push({
                path: fullPath,
                displayPath: displayUserPath(fullPath),
                ts,
                date: new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
                size: stat.size,
              })
            }
          }
        }
        // 最新的排在前面
        backups.sort((a, b) => b.ts - a.ts)
      } catch { /* 目录不存在 */ }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, backups, count: backups.length }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // POST /api/file-manager/restore — 从备份恢复（将 backupPath 复制回 targetPath）
  // body: { backupPath, targetPath }
  if (pathname === '/api/file-manager/restore' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { backupPath, targetPath } = JSON.parse(body)
        if (!backupPath || !targetPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'backupPath 和 targetPath 必填' }))
          return
        }
        const realTgt = resolveSafePath(targetPath)
        const realBak = resolveManagedBackupPath(backupPath, realTgt, { mustExist: true })
        const expectedBackup = new RegExp(`^${path.basename(realTgt).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.bak\\.\\d+$`)
        if (path.dirname(realBak) !== path.dirname(realTgt) || !expectedBackup.test(path.basename(realBak))) {
          throw new Error('备份文件与目标文件不匹配')
        }
        // 恢复前先备份当前文件
        if (fsSync.existsSync(realTgt)) {
          safeWriteFileWithinRoots(`${realTgt}.bak.${Date.now()}`, fsSync.readFileSync(realTgt), getDashboardFileRoots(), { mode: 0o600 })
        }
        safeWriteFileWithinRoots(realTgt, fsSync.readFileSync(realBak), getDashboardFileRoots(), { mode: 0o600 })
        console.log(`[file-manager/restore] ${realBak} → ${realTgt}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, restored: displayUserPath(realTgt) }))
      } catch (e) {
        console.error('[file-manager/restore] error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ============================================
  // Sprint 6: 费用时间线 API
  // ============================================

  // GET /api/cost-timeline?days=30|all — 按天聚合 token + 费用；granularity=hour 时按小时聚合
  if (pathname === '/api/cost-timeline' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost')
      const daysParam = url.searchParams.get('days') || '30'
      const allRange = daysParam === 'all' || url.searchParams.get('range') === 'all'
      const days = allRange ? null : Math.min(90, parseInt(daysParam, 10) || 30)
      const granularity = url.searchParams.get('granularity') === 'hour' ? 'hour' : 'day'
      const now = Date.now()
      const dayMs = 86400_000
      const hourMs = 3600_000
      const buckets = createKeyedDictionary()
      const makeDayKey = (timeMs) => {
        const d = new Date(timeMs)
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      }
      const makeHourKey = (timeMs) => {
        const d = new Date(timeMs)
        return `${makeDayKey(timeMs)} ${String(d.getHours()).padStart(2, '0')}:00`
      }
      const makeBucketKey = (timeMs) => granularity === 'hour' ? makeHourKey(timeMs) : makeDayKey(timeMs)
      const toTimeMs = (value) => {
        if (!value) return 0
        if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
        const parsed = Date.parse(value)
        return Number.isFinite(parsed) ? parsed : 0
      }
      const ensureBucket = (dateKey) => {
        if (!Object.hasOwn(buckets, dateKey)) {
          buckets[dateKey] = {
            date: dateKey,
            ...createUsageTotals(),
            byModel: createKeyedDictionary(),
            byAgentByModel: createKeyedDictionary(),
          }
        }
        return buckets[dateKey]
      }
      const shouldTrackBucket = (bucketKey) => allRange || Boolean(buckets[bucketKey])
      const billingConfig = readEffectiveBillingConfig()

      const addBucketUsage = (bucket, agentId, modelId, usage, usageTimeMs = Date.now()) => {
        const usageTotals = extractUsageTotals(usage || {})
        if (!hasUsageValue(usageTotals)) return

        const model = normalizeModelId(modelId)
        usageTotals.billingMode = resolveBillingConfig(model, billingConfig)?.mode || 'unconfigured'
        usageTotals.priceStatus = observationPriceConfigured(model, usageTotals, billingConfig) ? 'configured' : 'unconfigured'
        usageTotals.cost = calculateUsageCostWithBilling(model, usageTotals, usageTotals.cost, billingConfig, usageTimeMs)

        addUsageTotals(bucket, usageTotals)
        addUsageTotals(ensureUsageBucket(bucket.byModel, model), usageTotals)

        if (agentId) {
          if (!Object.hasOwn(bucket.byAgentByModel, agentId)) bucket.byAgentByModel[agentId] = createKeyedDictionary()
          addUsageTotals(ensureUsageBucket(bucket.byAgentByModel[agentId], model), usageTotals)
        }
      }

      // 初始化固定天数空桶；全量模式等扫完数据后再补齐连续日期
      if (!allRange) {
        if (granularity === 'hour') {
          const start = new Date(now - (days - 1) * dayMs)
          start.setHours(0, 0, 0, 0)
          for (let t = start.getTime(); t <= now; t += hourMs) {
            ensureBucket(makeHourKey(t))
          }
        } else {
          for (let i = days - 1; i >= 0; i--) {
            ensureBucket(makeDayKey(now - i * dayMs))
          }
        }
      }

      const agentsDir = path.join(os.homedir(), '.openclaw', 'agents')

      try {
        const agentDirs = fsSync.readdirSync(agentsDir, { withFileTypes: true })
          .filter(e => e.isDirectory()).map(e => e.name)

        for (const agentId of agentDirs) {
          const cachedUuids = new Set()
          // 优先读 .usage-cost-cache.json（轻量）
          const cacheFile = path.join(agentsDir, agentId, 'sessions', '.usage-cost-cache.json')
          try {
            const cache = JSON.parse(fsSync.readFileSync(cacheFile, 'utf8'))
            // cache 有 dailyUsage 字段（如果有的话）
            if (cache.dailyUsage && granularity !== 'hour') {
              for (const [dateKey, usage] of Object.entries(cache.dailyUsage)) {
                if (!shouldTrackBucket(dateKey)) continue
                const bucket = ensureBucket(dateKey)
                const byModel = usage.byModel || usage.models
                if (byModel && typeof byModel === 'object') {
                  for (const [model, data] of Object.entries(byModel)) {
                    addBucketUsage(bucket, agentId, model, data, new Date(`${dateKey}T12:00:00`).getTime())
                  }
                } else {
                  addBucketUsage(bucket, agentId, extractModelIdFromEntry({}, usage), usage, new Date(`${dateKey}T12:00:00`).getTime())
                }
              }
              continue
            }
            if (cache.files && typeof cache.files === 'object') {
              for (const [filePath, fileEntry] of Object.entries(cache.files)) {
                const uuid = extractSessionUuid(path.basename(filePath))
                if (uuid) cachedUuids.add(uuid)

                const usageEntries = Array.isArray(fileEntry?.usageEntries) ? fileEntry.usageEntries : []
                if (usageEntries.length > 0) {
                  for (const usage of usageEntries) {
                    const timeMs = toTimeMs(usage.timestamp || usage.ts || fileEntry?.mtimeMs || fileEntry?.scannedAt)
                    if (!timeMs) continue
                    const bucketKey = makeBucketKey(timeMs)
                    if (!shouldTrackBucket(bucketKey)) continue
                    addBucketUsage(ensureBucket(bucketKey), agentId, extractModelIdFromEntry(fileEntry, usage), usage, timeMs)
                  }
                  continue
                }

                const totals = fileEntry?.totals
                const timeMs = toTimeMs(fileEntry?.mtimeMs || fileEntry?.scannedAt)
                if (!totals || !timeMs) continue
                const bucketKey = makeBucketKey(timeMs)
                if (!shouldTrackBucket(bucketKey)) continue
                addBucketUsage(ensureBucket(bucketKey), agentId, extractModelIdFromEntry(fileEntry, totals), totals, timeMs)
              }
            }
          } catch { /* 没有缓存，改扫 jsonl */ }

          // 扫 session jsonl 文件
          const sessionsDir = path.join(agentsDir, agentId, 'sessions')
          let sessionFiles = []
          try { sessionFiles = fsSync.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl') && !f.startsWith('.')) } catch { continue }

          for (const sf of sessionFiles) {
            const uuid = extractSessionUuid(sf)
            if (uuid && cachedUuids.has(uuid)) continue
            const sfPath = path.join(sessionsDir, sf)
            try {
              const stat = fsSync.statSync(sfPath)
              // 固定范围只扫 days 天内修改的文件；全量模式扫全部历史
              if (!allRange && now - stat.mtimeMs > days * dayMs + dayMs) continue
              const lines = fsSync.readFileSync(sfPath, 'utf8').split('\n').filter(Boolean)
              let previousSessionTokens = 0
              let previousSessionCost = 0
              for (const line of lines) {
                try {
                  const entry = JSON.parse(line)
                  // 寻找 usage 类型条目
                  const ts = entry.ts || entry.timestamp || entry.created_at
                  if (!ts) continue
                  const timeMs = toTimeMs(ts)
                  if (!timeMs) continue
                  const bucketKey = makeBucketKey(timeMs)
                  if (!shouldTrackBucket(bucketKey)) continue

                  // 多种格式兼容
                  let tokens = 0, cost = 0, model = ''
                  let usageParts = createUsageTotals()
                  let cumulativeTokens = 0, cumulativeCost = 0
                  if (entry.type === 'usage' || entry.usage) {
                    const u = entry.usage || entry
                    usageParts = extractUsageTotals(u)
                    cumulativeTokens = u.totalTokens || u.total_tokens || 0
                    tokens = cumulativeTokens || usageParts.tokens
                    model = extractModelIdFromEntry(entry, u)
                    cumulativeCost = typeof u.cost === 'object' ? (u.cost?.total || 0) : 0
                    cost = typeof u.cost === 'number' ? u.cost : cumulativeCost || usageParts.cost
                  } else if (entry.type === 'message' && entry.usage) {
                    const u = entry.usage
                    usageParts = extractUsageTotals(u)
                    cumulativeTokens = u.totalTokens || u.total_tokens || 0
                    tokens = cumulativeTokens || usageParts.tokens
                    model = extractModelIdFromEntry(entry, u)
                    cumulativeCost = typeof u.cost === 'object' ? (u.cost?.total || 0) : 0
                    cost = typeof u.cost === 'number' ? u.cost : cumulativeCost || usageParts.cost
                  } else if (entry.message?.usage) {
                    const u = entry.message.usage
                    usageParts = extractUsageTotals(u)
                    cumulativeTokens = u.totalTokens || u.total_tokens || 0
                    tokens = cumulativeTokens || usageParts.tokens
                    model = extractModelIdFromEntry(entry, u)
                    cumulativeCost = typeof u.cost === 'object' ? (u.cost?.total || 0) : 0
                    cost = typeof u.cost === 'number' ? u.cost : cumulativeCost || usageParts.cost
                  } else if (entry.data?.usage || entry.data?.usageMetadata || entry.data?.usage_metadata || entry.usageMetadata || entry.usage_metadata) {
                    const u = entry.data?.usage || entry.data?.usageMetadata || entry.data?.usage_metadata || entry.usageMetadata || entry.usage_metadata
                    usageParts = extractUsageTotals(u)
                    cumulativeTokens = u.totalTokens || u.total_tokens || u.totalTokenCount || u.total_token_count || 0
                    tokens = cumulativeTokens || usageParts.tokens
                    model = extractModelIdFromEntry(entry, u)
                    cumulativeCost = typeof u.cost === 'object' ? (u.cost?.total || 0) : 0
                    cost = typeof u.cost === 'number' ? u.cost : cumulativeCost || usageParts.cost
                  } else { continue }

                  if (cumulativeTokens > 0) {
                    const deltaTokens = Math.max(0, cumulativeTokens - previousSessionTokens)
                    previousSessionTokens = Math.max(previousSessionTokens, cumulativeTokens)
                    tokens = deltaTokens
                  }
                  if (tokens === 0) continue
                  if (cumulativeCost > 0) {
                    const deltaCost = Math.max(0, cumulativeCost - previousSessionCost)
                    previousSessionCost = Math.max(previousSessionCost, cumulativeCost)
                    cost = deltaCost
                  }
                  const scale = usageParts.tokens > 0 && tokens >= 0 && tokens < usageParts.tokens ? tokens / usageParts.tokens : 1
                  addBucketUsage(ensureBucket(bucketKey), agentId, model, {
                    ...usageParts,
                    tokens,
                    cost,
                    input: Math.round(usageParts.input * scale),
                    output: Math.round(usageParts.output * scale),
                    cacheRead: Math.round(usageParts.cacheRead * scale),
                    cacheWrite: Math.round(usageParts.cacheWrite * scale),
                  }, timeMs)
                } catch { /* 跳过单行异常 */ }
              }
            } catch { /* 跳过文件错误 */ }
          }
        }
      } catch { /* agentsDir 不存在 */ }

      let timeline = Object.values(buckets)
      if (allRange && timeline.length > 0 && granularity !== 'hour') {
        const keys = Object.keys(buckets).sort()
        const start = new Date(`${keys[0]}T00:00:00`).getTime()
        const today = new Date(now)
        today.setHours(0, 0, 0, 0)
        timeline = []
        for (let t = start; t <= today.getTime(); t += dayMs) {
          timeline.push(ensureBucket(makeDayKey(t)))
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ timeline, days: allRange ? 'all' : days, range: allRange ? 'all' : `${days}d`, granularity, generatedAt: Date.now() }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, timeline: [] }))
    }
    return
  }

  // ============================================
  // Sprint 2: 项目看板 API
  // ============================================

  // GET /api/projects/list — 扫描当前环境可用的 OpenClaw 项目目录
  if (pathname === '/api/projects/list' && req.method === 'GET') {
    try {
      const projects = []
      const projectRoots = getOpenClawProjectRoots()
      for (const projectRoot of projectRoots) {
        let displayNames = createKeyedDictionary()
        try {
          const namesFile = resolveProjectDisplayNamesFile(projectRoot, { mustExist: true })
          displayNames = keyedDictionaryFrom(JSON.parse(fsSync.readFileSync(namesFile, 'utf8')))
        } catch { /* 无安全映射文件 */ }
        const entries = fsSync.readdirSync(projectRoot.projectsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          try {
            const project = resolveAuthorizedProject(projectRoot, entry.name)
            const raw = fsSync.readFileSync(project.stateFile, 'utf8')
            const state = JSON.parse(raw)
            const stat = fsSync.statSync(project.stateFile)
            projects.push({
              id: entry.name,
              name: state.name || state.project_name || entry.name,
              displayName: (typeof displayNames[entry.name] === 'string' ? displayNames[entry.name] : displayNames[entry.name]?.displayName) || '',
              initiator: (typeof displayNames[entry.name] === 'object' ? displayNames[entry.name]?.initiator : '') || state.initiator || state.created_by || '',
              phase: state.phase || 'unknown',
              responsible_agent: state.responsible_agent || state.agent || null,
              blocked_reason: state.blocked_reason || null,
              retry_count: state.retry_count || 0,
              updated_at: state.updated_at || null,
              created_at: state.created_at || null,
              file_mtime: stat.mtimeMs,
              project_root: displayUserPath(project.projectDir),
              raw: state,
            })
          } catch { /* 跳过无法解析的 */ }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ projects, total: projects.length, projectDirs: projectRoots.map(root => displayUserPath(root.projectsDir)), checkedAt: Date.now() }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, projects: [] }))
    }
    return
  }

  // GET /api/projects/file?id=xxx&key=pm_plan — 读取项目产出文件内容(限定项目目录内)
  if (pathname === '/api/projects/file' && req.method === 'GET') {
    try {
      const id = String(url.searchParams.get('id') || '')
      const fileKey = String(url.searchParams.get('key') || '')
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !/^[A-Za-z0-9_-]{1,128}$/.test(fileKey)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid id/key' }))
        return
      }
      const project = findOpenClawProject(id)
      if (!project) throw new Error('project directory not found')
      const state = JSON.parse(fsSync.readFileSync(project.stateFile, 'utf8'))
      const fname = String((state.files || {})[fileKey] || `${fileKey}.md`)
      const fpath = resolveAuthorizedProjectOutput(project, fname)
      const content = fsSync.readFileSync(fpath, 'utf8')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ content, filename: fname, mtime: fsSync.statSync(fpath).mtimeMs }))
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `文件不存在或无法读取: ${e.message}` }))
    }
    return
  }

  // POST /api/projects/rename — 设置项目中文显示名(存 display-names.json,不动 state.json)
  if (pathname === '/api/projects/rename' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { id, displayName, initiator } = JSON.parse(body || '{}')
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(id || ''))) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid id' })); return }
        const project = findOpenClawProject(id)
        if (!project) throw new Error('未找到安全的 OpenClaw 项目目录')
        const mapFile = resolveProjectDisplayNamesFile(project)
        let names = createKeyedDictionary()
        try { names = keyedDictionaryFrom(JSON.parse(fsSync.readFileSync(mapFile, 'utf8'))) } catch { /* 首次 */ }
        // 旧格式(纯字符串)自动升级为对象
        const previousValue = Object.hasOwn(names, id) ? names[id] : undefined
        const prev = typeof previousValue === 'string' ? { displayName: previousValue } : (previousValue || {})
        const entry = { ...prev }
        if (displayName !== undefined) entry.displayName = String(displayName || '').trim()
        if (initiator !== undefined) entry.initiator = String(initiator || '').trim()
        if (!entry.displayName && !entry.initiator) delete names[id]
        else names[id] = entry
        safeAtomicWriteFileWithinRoots(mapFile, JSON.stringify(names, null, 2), [project.authorizationRoot])
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, displayName: entry.displayName || '', initiator: entry.initiator || '' }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // GET /api/projects/state?id=xxx — 返回单个项目 state.json 全文
  if (pathname === '/api/projects/state' && req.method === 'GET') {
    try {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id')
      if (!id || !/^[a-zA-Z0-9_\-]+$/.test(id)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid id' }))
        return
      }
      const project = findOpenClawProject(id)
      if (!project) throw new Error('project directory not found')
      const raw = fsSync.readFileSync(project.stateFile, 'utf8')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(raw)
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Sprint 3: Cron 任务中心 API
  // ============================================

  // GET /api/cron/list — 读取 cron jobs + 最近执行记录
  if (pathname === '/api/cron/list' && req.method === 'GET') {
    try {
      const cronDir = path.join(os.homedir(), '.openclaw', 'cron')
      const jobsFile = path.join(cronDir, 'jobs.json')
      const stateFile = path.join(cronDir, 'jobs-state.json')
      const runsDir = path.join(cronDir, 'runs')

      // OpenClaw 2026.6 起 jobs.json 已迁移,优先用 CLI 读取真实任务列表
      let jobs = []
      try {
        const cliResult = await runOpenClawCommand(['cron', 'list', '--json'], 15000, { gatewayAccess: true })
        if (!cliResult.success) throw new Error(cliResult.error || cliResult.stderr || 'cron list failed')
        const parsed = JSON.parse(cliResult.stdout)
        jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || [])
      } catch (cliErr) { console.error('[cron/list] CLI fallback:', cliErr && cliErr.message) }
      if (jobs.length === 0) {
        try {
          const raw = fsSync.readFileSync(jobsFile, 'utf8')
          const parsed = JSON.parse(raw)
          jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || [])
        } catch { /* jobs.json 不存在或格式异常 */ }
      }

      // 读取 jobs-state.json（含 nextRunAtMs / lastRunStatus）
      let jobsState = {}
      try {
        const stateRaw = fsSync.readFileSync(stateFile, 'utf8')
        jobsState = JSON.parse(stateRaw).jobs || {}
      } catch { /* 忽略 */ }

      // 为每个 job 读取最近 10 条执行记录（jsonl 格式）
      const jobsWithRuns = jobs.map(job => {
        const jobId = job.id || job.name
        const state = jobsState[jobId] || { state: job.state || {} }
        let runs = []
        try {
          const runFile = path.join(runsDir, `${jobId}.jsonl`)
          const lines = fsSync.readFileSync(runFile, 'utf8').trim().split('\n').filter(Boolean)
          runs = lines.slice(-10).reverse().map(l => {
            try { return JSON.parse(l) } catch { return null }
          }).filter(Boolean)
        } catch { /* 没有执行记录 */ }

        const failCount = runs.filter(r => r && (r.status === 'error' || r.status === 'failed')).length
        const consecutiveErrors = (state.state || {}).consecutiveErrors || 0
        const lastRun = runs[0] ? {
          status: runs[0].status,
          startedAt: runs[0].ts ? new Date(runs[0].ts).toISOString() : null,
          durationMs: runs[0].durationMs,
          message: runs[0].summary || runs[0].message || null,
          error: runs[0].status === 'error' ? (runs[0].summary || runs[0].error || null) : null,
        } : ((state.state || {}).lastRunAtMs ? {
          status: (state.state || {}).lastRunStatus || 'ok',
          startedAt: new Date((state.state || {}).lastRunAtMs).toISOString(),
          durationMs: (state.state || {}).lastDurationMs,
        } : null)

        return {
          ...job,
          runs: runs.map(r => ({
            status: r.status,
            startedAt: r.ts ? new Date(r.ts).toISOString() : null,
            durationMs: r.durationMs,
            message: r.summary || null,
            error: r.status === 'error' ? (r.summary || r.error || null) : null,
          })),
          failCount: Math.max(failCount, consecutiveErrors),
          lastRun,
          nextRunAtMs: (state.state || {}).nextRunAtMs || null,
        }
      })

      // 失败 >=3 次排最前
      jobsWithRuns.sort((a, b) => {
        const aFail = (a.failCount || 0) >= 3
        const bFail = (b.failCount || 0) >= 3
        if (aFail && !bFail) return -1
        if (!aFail && bFail) return 1
        return 0
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jobs: jobsWithRuns, total: jobsWithRuns.length, checkedAt: Date.now() }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, jobs: [] }))
    }
    return
  }

  // POST /api/day-summary-ai — 历史总结 AI 摘要(昨天及以前=本地 Ollama Gemma,今天=DeepSeek)
  if (pathname === '/api/day-summary-ai' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', async () => {
      try {
        const { agentId, date, material } = JSON.parse(body || '{}')
        if (!agentId || !date || !material) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'agentId/date/material required' }))
          return
        }
        const cacheFile = path.join(os.homedir(), '.openclaw', 'dashboard-day-summaries.json')
        let cache = createKeyedDictionary()
        try { cache = keyedDictionaryFrom(JSON.parse(fsSync.readFileSync(cacheFile, 'utf8'))) } catch { /* 首次无缓存 */ }
        const today = new Date().toLocaleDateString('sv-SE')
        const isToday = date >= today
        const matKey = `${material.length}:${material.slice(0, 80)}`
        const key = `${agentId}:${date}`
        const hit = cache[key]
        // 历史日永久缓存;今天的素材变了才重新生成
        if (hit && hit.summary && (!isToday || hit.matKey === matKey)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ summary: hit.summary, model: hit.model, cached: true }))
          return
        }
        const prompt = `你是团队工作日志助理。下面是 AI 助手「${agentId}」在 ${date} 的会话记录要点。请用中文写一段不超过3句话的当天工作总结:说人话、突出做了什么事、结果如何、有没有异常。不要用列表,不要输出英文术语,直接给总结正文。\n\n${String(material).slice(0, 3500)}`
        let summary = ''
        let usedModel = ''
        if (!isToday) {
          const r = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gemma4:12b-nvfp4', messages: [{ role: 'user', content: prompt }], stream: false, think: false, options: { num_predict: 300, temperature: 0.3 } }),
            signal: AbortSignal.timeout(180000),
          })
          const j = await r.json()
          summary = String(j.message?.content || '').trim()
          usedModel = '本地 Gemma'
        } else {
          const oc = JSON.parse(fsSync.readFileSync(path.join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'))
          const prov = oc?.models?.providers?.['custom-api-deepseek-com'] || {}
          const baseUrl = String(prov.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
          let modelId = 'deepseek-chat'
          if (Array.isArray(prov.models) && prov.models.length) {
            const m0 = prov.models[0]
            modelId = typeof m0 === 'string' ? m0 : (m0.id || modelId)
          }
          const r = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${prov.apiKey || ''}` },
            body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.3 }),
            signal: AbortSignal.timeout(60000),
          })
          const j = await r.json()
          summary = String(j.choices?.[0]?.message?.content || '').trim()
          usedModel = 'DeepSeek'
        }
        if (!summary) throw new Error('模型未返回内容')
        cache[key] = { summary, model: usedModel, generatedAt: Date.now(), matKey }
        fsSync.writeFileSync(cacheFile, JSON.stringify(cache, null, 2))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ summary, model: usedModel, cached: false }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // POST /api/cron/trigger — 立即触发一个 cron job
  if (pathname === '/api/cron/trigger' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body)
        const safeId = assertCronId(id)
        const result = await runOpenClawCommand(['cron', 'run', safeId], 30000, { gatewayAccess: true })
        if (!result.success) throw new Error(result.stderr || result.error)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, stdout: result.stdout }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // POST /api/cron/pause — 暂停 cron job
  if (pathname === '/api/cron/pause' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body)
        const safeId = assertCronId(id)
        const result = await runOpenClawCommand(['cron', 'disable', safeId], 10000, { gatewayAccess: true })
        if (!result.success) throw new Error(result.stderr || result.error)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  // POST /api/cron/resume — 恢复 cron job
  if (pathname === '/api/cron/resume' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body)
        const safeId = assertCronId(id)
        const result = await runOpenClawCommand(['cron', 'enable', safeId], 10000, { gatewayAccess: true })
        if (!result.success) throw new Error(result.stderr || result.error)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  // POST /api/cron/create — 创建 cron job
  if (pathname === '/api/cron/create' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', async () => {
      try {
        const {
          name,
          agentId,
          scheduleType = 'cron',
          scheduleValue,
          message,
          deliveryMode = 'none',
        } = JSON.parse(body || '{}')
        if (!name || !agentId || !scheduleValue || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'name/agentId/scheduleValue/message required' }))
          return
        }
        const safeName = assertSafeArgumentValue(name, '任务名称', { maxLength: 200 })
        const safeAgentId = assertAgentId(agentId)
        const safeScheduleValue = assertSafeArgumentValue(scheduleValue, '定时表达式', { maxLength: 200 })
        const safeMessage = assertSafeArgumentValue(message, '任务内容', {
          maxLength: 64 * 1024,
          allowNewlines: true,
          allowLeadingDash: true,
        })
        if (!['cron', 'every', 'at'].includes(scheduleType)) throw new Error('scheduleType 格式无效')
        if (!['none', 'announce'].includes(deliveryMode)) throw new Error('deliveryMode 格式无效')
        if (!getConfiguredOpenClawAgents().some(agent => agent.id === safeAgentId)) throw new Error('Agent 不存在')
        const cronTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        const args = [
          'cron', 'add',
          '--json',
          optionValue('--name', safeName),
          optionValue('--agent', safeAgentId),
          optionValue('--session', 'isolated'),
          optionValue('--message', safeMessage),
          optionValue('--tz', cronTimezone),
        ]
        if (scheduleType === 'every') args.push(optionValue('--every', safeScheduleValue))
        else if (scheduleType === 'at') args.push(optionValue('--at', safeScheduleValue))
        else args.push(optionValue('--cron', safeScheduleValue))
        if (deliveryMode === 'announce') args.push('--announce', optionValue('--channel', 'last'))
        else args.push('--no-deliver')

        const result = await runOpenClawCommand(args, 30000, { gatewayAccess: true })
        if (!result.success) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: result.error || result.stderr || 'create failed', stderr: result.stderr }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, stdout: result.stdout }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // POST /api/cron/update — 编辑 cron job
  if (pathname === '/api/cron/update' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', async () => {
      try {
        const {
          id,
          name,
          agentId,
          scheduleType = 'cron',
          scheduleValue,
          message,
          deliveryMode = 'none',
        } = JSON.parse(body || '{}')
        if (!id || !name || !agentId || !scheduleValue || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'id/name/agentId/scheduleValue/message required' }))
          return
        }
        const safeId = assertCronId(id)
        const safeName = assertSafeArgumentValue(name, '任务名称', { maxLength: 200 })
        const safeAgentId = assertAgentId(agentId)
        const safeScheduleValue = assertSafeArgumentValue(scheduleValue, '定时表达式', { maxLength: 200 })
        const safeMessage = assertSafeArgumentValue(message, '任务内容', {
          maxLength: 64 * 1024,
          allowNewlines: true,
          allowLeadingDash: true,
        })
        if (!['cron', 'every', 'at'].includes(scheduleType)) throw new Error('scheduleType 格式无效')
        if (!['none', 'announce'].includes(deliveryMode)) throw new Error('deliveryMode 格式无效')
        if (!getConfiguredOpenClawAgents().some(agent => agent.id === safeAgentId)) throw new Error('Agent 不存在')
        const cronTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        const args = [
          'cron', 'edit', safeId,
          optionValue('--name', safeName),
          optionValue('--agent', safeAgentId),
          optionValue('--session', 'isolated'),
          optionValue('--message', safeMessage),
          optionValue('--tz', cronTimezone),
        ]
        if (scheduleType === 'every') args.push(optionValue('--every', safeScheduleValue))
        else if (scheduleType === 'at') args.push(optionValue('--at', safeScheduleValue))
        else args.push(optionValue('--cron', safeScheduleValue))
        if (deliveryMode === 'announce') args.push('--announce', optionValue('--channel', 'last'))
        else args.push('--no-deliver')

        const result = await runOpenClawCommand(args, 30000, { gatewayAccess: true })
        if (!result.success) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: result.error || result.stderr || 'update failed', stderr: result.stderr }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, stdout: result.stdout }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // POST /api/cron/delete — 删除 cron job
  if (pathname === '/api/cron/delete' && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body || '{}')
        const safeId = assertCronId(id)
        const result = await runOpenClawCommand(['cron', 'rm', '--json', safeId], 30000, { gatewayAccess: true })
        if (!result.success) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: result.error || result.stderr || 'delete failed', stderr: result.stderr }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, stdout: result.stdout }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ============================================
  // Sprint 7: GET /api/search — 全文搜索
  // ============================================
  if (pathname === '/api/search' && req.method === 'GET') {
    try {
      const q = (url.searchParams.get('q') || '').trim()
      const type = url.searchParams.get('type') || 'all'
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
      const results = { agents: [], messages: [] }

      if (!q) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ results, q, total: 0 }))
        return
      }

      const qLower = q.toLowerCase()

      // Agent search (instant, from config)
      if (type === 'all' || type === 'agents') {
        try {
          const configPath = path.join(OPENCLAW_DIR, 'openclaw.json')
          const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'))
          const agentList = Array.isArray(config.agents) ? config.agents : []
          for (const a of agentList) {
            const name = (a.name || a.id || '').toLowerCase()
            if (name.includes(qLower) || (a.id || '').includes(qLower)) {
              results.agents.push({ id: a.id, name: a.name || a.id, emoji: a.emoji || '', model: a.model || '' })
            }
          }
        } catch { /* ignore */ }
      }

      // FTS 对话历史搜索
      if (type === 'all' || type === 'messages') {
        try {
          const db = getSearchDb()
          if (db) {
            const ftsQ = q.replace(/["'*^()]/g, ' ').trim().split(/\s+/).filter(Boolean).map(w => `"${w}"*`).join(' ')
            if (ftsQ) {
              const rows = _searchFtsAvailable
                ? db.prepare(`
                    SELECT m.agent_id, m.session_id, m.role, m.timestamp,
                      snippet(messages_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
                    FROM messages_fts
                    JOIN messages m ON m.id = messages_fts.rowid
                    WHERE messages_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                  `).all(ftsQ, limit)
                : db.prepare(`
                    SELECT agent_id, session_id, role, timestamp, substr(content, 1, 500) AS snippet
                    FROM messages
                    WHERE instr(lower(content), lower(?)) > 0
                    ORDER BY timestamp DESC
                    LIMIT ?
                  `).all(q, limit)
              results.messages = rows
            }
          }
        } catch (e) {
          console.warn('[search] FTS error:', e.message)
          results.messages = []
        }
      }

      // #9: 文档文件搜索（.md 文件：admin/ + memory/ + agent 目录）
      results.docs = []
      if (type === 'all' || type === 'docs') {
        try {
          const db = getSearchDb()
          if (db) {
            const ftsQ = q.replace(/["'*^()]/g, ' ').trim().split(/\s+/).filter(Boolean).map(w => `"${w}"*`).join(' ')
            if (ftsQ) {
              const rows = _searchFtsAvailable
                ? db.prepare(`
                    SELECT d.path, d.title,
                      snippet(docs_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
                    FROM docs_fts
                    JOIN docs d ON d.id = docs_fts.rowid
                    WHERE docs_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                  `).all(ftsQ, Math.min(limit, 10))
                : db.prepare(`
                    SELECT path, title, substr(content, 1, 500) AS snippet
                    FROM docs
                    WHERE instr(lower(content), lower(?)) > 0 OR instr(lower(title), lower(?)) > 0
                    ORDER BY mtime_ms DESC
                    LIMIT ?
                  `).all(q, q, Math.min(limit, 10))
              results.docs = rows
            }
          }
        } catch (e) {
          console.warn('[search] docs FTS error:', e.message)
        }
      }

      const total = results.agents.length + results.messages.length + (results.docs?.length || 0)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ results, q, total }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Sprint 7: POST /api/search/index — 触发索引
  // ============================================
  if (pathname === '/api/search/index' && req.method === 'POST') {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const opts = body ? JSON.parse(body) : {}
        console.log('[search-index] build start, rebuild=', !!opts.rebuild)
        const result = doIndexMessages({ rebuild: !!opts.rebuild })
        // 同时索引 .md 文档文件（#9）
        const docResult = indexDocFiles()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, ...result, docs: docResult }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ============================================
  // Sprint 7: GET /api/search/status — 索引状态
  // ============================================
  if (pathname === '/api/search/status' && req.method === 'GET') {
    try {
      const db = getSearchDb()
      if (!db) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'SQLite unavailable', totalMessages: 0, totalFiles: 0 }))
        return
      }
      const total = db.prepare('SELECT COUNT(*) as n FROM messages').get()
      const files = db.prepare('SELECT COUNT(*) as n FROM indexed_files').get()
      const lastAt = db.prepare("SELECT value FROM meta WHERE key='last_indexed_at'").get()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, totalMessages: total?.n || 0, totalFiles: files?.n || 0, lastIndexedAt: lastAt?.value || null }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Sprint 7: GET /api/activity-timeline — Gantt 时间线
  // ============================================
  if (pathname === '/api/activity-timeline' && req.method === 'GET') {
    try {
      const hours = Math.min(parseInt(url.searchParams.get('hours') || '24'), 24 * 30)
      const since = Date.now() - hours * 3600 * 1000
      const sessions = []

      try {
        const agentIds = fsSync.readdirSync(AGENTS_DIR)
        for (const agentId of agentIds) {
          const sessDir = path.join(AGENTS_DIR, agentId, 'sessions')
          let files
          try { files = fsSync.readdirSync(sessDir) } catch { continue }

          for (const f of files) {
            if (!f.endsWith('.trajectory.jsonl')) continue
            const filePath = path.join(sessDir, f)
            try {
              const stat = fsSync.statSync(filePath)
              if (stat.mtimeMs < since) continue // quick filter

              const lines = fsSync.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
              let startTs = null, endTs = null, trigger = 'user'

              for (const line of lines) {
                try {
                  const d = JSON.parse(line)
                  if (d.type === 'session.started') { startTs = d.ts; trigger = d.data?.trigger || 'user' }
                  else if (d.type === 'session.ended') endTs = d.ts
                } catch { }
              }

              if (!startTs) continue
              const startMs = new Date(startTs).getTime()
              if (startMs < since) continue

              const endMs = endTs ? new Date(endTs).getTime() : Math.min(stat.mtimeMs, Date.now())
              sessions.push({
                agentId,
                sessionId: f.replace('.trajectory.jsonl', ''),
                startTs, endTs: endTs || null,
                startMs, endMs,
                durationMs: Math.max(endMs - startMs, 0),
                trigger,
              })
            } catch { }
          }
        }
      } catch (e) {
        console.error('[activity-timeline] scan error:', e.message)
      }

      sessions.sort((a, b) => a.startMs - b.startMs)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions, hours, generatedAt: Date.now(), total: sessions.length }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // Sprint 8: GET /api/skill-usage — 技能调用排行榜（#8）
  // ============================================
  if (pathname === '/api/skill-usage' && req.method === 'GET') {
    try {
      const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 365)
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100)
      const data = buildToolCallStats(days)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ...data, ranked: data.ranked.slice(0, limit) }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ============================================
  // 自动修复在本阶段停用：浏览器布尔值不能作为可信的执行确认。
  // ============================================
  if (pathname === '/api/system/auto-fix' || pathname === '/api/system/auto-fix/preview') {
    sendJson(res, 410, { ok: false, error: '自动修复已暂时停用；诊断只读，修复操作需另行安全接入' })
    return
  }

  // ============================================
  // GET /api/system/dist-backups — 列出 dist 备份（Dist Backup List）
  // ============================================
  if (pathname === '/api/system/dist-backups' && req.method === 'GET') {
    try {
      ensureDistBackupsRoot()
      const entries = await fs.readdir(DASHBOARD_BACKUPS_DIR)
      const backups = []
      for (const entry of entries) {
        const fullPath = path.join(DASHBOARD_BACKUPS_DIR, entry)
        let stat
        try {
          const lstat = await fs.lstat(fullPath)
          if (lstat.isSymbolicLink()) continue
          stat = lstat
        } catch { continue }
        if (!stat.isDirectory()) continue
        // 目录名格式：{version}_{timestamp_ms}
        const match = entry.match(/^(.+?)_(\d+)$/)
        if (!match) continue
        const [, version, tsStr] = match
        const ts = parseInt(tsStr, 10)
        const d = new Date(ts)
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
        let totalBytes
        try { totalBytes = await inspectSafeDirectoryTree(fullPath) } catch { continue }
        const sizeDisplay = totalBytes > 1024 * 1024
          ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB`
          : `${(totalBytes / 1024).toFixed(0)} KB`
        backups.push({ id: entry, version, ts, date: dateStr, sizeDisplay })
      }
      // 按时间倒序（最新在前）
      backups.sort((a, b) => b.ts - a.ts)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ backups }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, backups: [] }))
    }
    return
  }

  // ============================================
  // POST /api/system/dist-rollback — 恢复 dist 备份（Dist Rollback）
  // body: { backupId: string }
  // ============================================
  if (pathname === '/api/system/dist-rollback' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { backupId } = JSON.parse(body || '{}')
        if (!backupId || typeof backupId !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'backupId is required' }))
          return
        }
        const normalBackup = resolveDistBackupId(backupId)
        await inspectSafeDirectoryTree(normalBackup)
        // 先把当前 dist 也备份一次（"回退前先保存现状"）
        const nowTs = Date.now()
        let curVersion = 'unknown'
        try {
          const pkgPath = path.join(__dirname, '..', 'package.json')
          const pkgContent = await fs.readFile(pkgPath, 'utf-8')
          curVersion = JSON.parse(pkgContent).version || 'unknown'
        } catch { /* 忽略 */ }
        const preSaveName = `${curVersion}_${nowTs}`
        const preSavePath = path.join(DASHBOARD_BACKUPS_DIR, preSaveName)
        try {
          await inspectSafeDirectoryTree(DASHBOARD_DIST_DIR)
          await copyDirRecursive(DASHBOARD_DIST_DIR, preSavePath)
          console.log(`[dist-rollback] 回退前自动备份当前 dist → ${preSavePath}`)
        } catch (saveErr) {
          await fs.rm(preSavePath, { recursive: true, force: true }).catch(() => {})
          throw new Error(`回退前保存当前 dist 失败，已中止：${saveErr.message}`)
        }

        const distParent = path.dirname(DASHBOARD_DIST_DIR)
        const stagingPath = path.join(distParent, `.dist-restore-${process.pid}-${nowTs}`)
        const previousPath = path.join(distParent, `.dist-before-restore-${process.pid}-${nowTs}`)
        let movedCurrent = false
        try {
          await copyDirRecursive(normalBackup, stagingPath)
          await inspectSafeDirectoryTree(stagingPath)
          await fs.rename(DASHBOARD_DIST_DIR, previousPath)
          movedCurrent = true
          await fs.rename(stagingPath, DASHBOARD_DIST_DIR)
          await fs.rm(previousPath, { recursive: true, force: true })
        } catch (restoreError) {
          await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
          if (movedCurrent) {
            await fs.rm(DASHBOARD_DIST_DIR, { recursive: true, force: true }).catch(() => {})
            await fs.rename(previousPath, DASHBOARD_DIST_DIR).catch(() => {})
          }
          throw restoreError
        }
        console.log(`[dist-rollback] 已成功恢复备份 ${backupId} → ${DASHBOARD_DIST_DIR}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, message: '回退成功，请刷新页面' }))
      } catch (e) {
        console.error('[dist-rollback] 错误:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ============================================
  // 认知引擎 + 情绪感知
  // ============================================
  if (pathname === '/api/cognitive/analyze') {
    return handleCognitiveAnalyze(req, res)
  }
  if (pathname === '/api/cognitive/history') {
    return handleCognitiveHistory(req, res, path.join(OPENCLAW_DIR, 'cognitive-log.json'))
  }

  // ============================================
  // 层级记忆树
  // ============================================
  if (pathname.startsWith('/api/memory-tree')) {
    return handleMemoryTree(req, res, fsSync)
  }

  // ============================================
  // 人格演化引擎
  // ============================================
  if (pathname.startsWith('/api/personality')) {
    return handlePersonality(req, res, fsSync)
  }

  // ============================================
  // 404 for other routes
  // ============================================

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

attachGatewayWebSocketRelay(server, {
  route: '/gateway-ws',
  gatewayUrl: GATEWAY_CREDENTIALS.gatewayUrl,
  gatewayToken: GATEWAY_CREDENTIALS.token,
  localToken: LOCAL_TOKEN,
  requestPolicy: LOCAL_REQUEST_POLICY,
})

if (IS_DIRECT_EXECUTION) {
  server.listen(PORT, HOST, () => {
    console.log('='.repeat(50))
    console.log('   AI 工作台总控 Unified Service')
    console.log('='.repeat(50))
    console.log(`[配置] 地址：${HOST}:${PORT}`)
    console.log('[功能] GPU VRAM + Usage Stats + Reset Agent')
    console.log(`[提示] 按 Ctrl+C 可停止服务`)
    console.log('')
    console.log('[API 端点]')
    console.log('  GET  /api/gpu-vram              - GPU VRAM 使用情况')
    console.log('  GET  /api/usage                 - 获取用量统计')
    console.log('  GET  /api/health                - 健康检查')
    console.log('  GET  /api/system/version        - OpenClaw 版本号')
    console.log('  GET  /api/system/versions       - 获取版本列表')
    console.log('  POST /api/system/sync-versions  - 同步版本列表')
    console.log('  POST /api/system/switch-version - 切换版本')
    console.log('  GET  /api/tasks/current           - 获取当前任务进度')
    console.log('  GET  /api/agent-live-activity     - 读取 agent 当前正在做什么')
    console.log('  GET  /api/system/skills           - 获取技能列表')
    console.log('  POST /api/system/skills/install   - 安装技能')
    console.log('  POST /api/system/skills/toggle    - 启用/禁用技能')
    console.log('  GET  /api/system/skills/search    - 搜索 ClawHub 技能')
    console.log('  GET  /api/system/doctor          - 隔离执行 openclaw doctor --lint 只读诊断')
    console.log('  POST /reset                     - 重置 Agent')
    console.log('  POST /api/upload-image           - 图片上传 (base64, ≤5MB)')
    console.log('  GET  /api/system/dist-backups    - 列出 dist 备份（版本回退）')
    console.log('  POST /api/system/dist-rollback   - 恢复 dist 备份（版本回退）')
    console.log('')

    // 启动后自动备份当前 dist（异步，不阻塞服务）
    backupDistOnStartup()
  })
}

// 优雅关闭
process.on('SIGINT', () => {
  server.close(() => {
    console.log('[服务] 已关闭')
    process.exit(0)
  })
})

// SIGTERM 仅在 Unix 平台注册（Windows 不支持）
if (os.platform() !== 'win32') {
  process.on('SIGTERM', () => {
    server.close(() => {
      console.log('[服务] 已关闭')
      process.exit(0)
    })
  })
}
