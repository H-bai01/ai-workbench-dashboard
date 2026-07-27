import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  ensureDirectoryWithinRoots,
  safeAtomicWriteFileWithinRoots,
} from './security/path-boundary.mjs'

const LEDGER_SCHEMA_VERSION = 4
const READ_CHUNK_BYTES = 64 * 1024
const MAX_JSONL_LINE_BYTES = 2 * 1024 * 1024
const MAX_TITLE_CHARS = 30
const PROVIDER_DEFINITIONS = Object.freeze({
  codex: { name: 'Codex', itemLabel: '项目', maxDepth: 6 },
  'claude-code': { name: 'Claude Code', itemLabel: '项目', maxDepth: 5 },
})

function dictionary() {
  return Object.create(null)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = number(value)
    if (parsed > 0) return parsed
  }
  return 0
}

function extractUsage(raw = {}) {
  const usageMetadata = raw.usageMetadata || raw.usage_metadata || {}
  const promptDetails = raw.promptTokensDetails || raw.prompt_tokens_details || raw.inputTokenDetails || raw.input_token_details || {}
  const completionDetails = raw.completionTokensDetails || raw.completion_tokens_details || raw.outputTokenDetails || raw.output_token_details || {}
  const input = firstNumber(
    raw.input, raw.inputTokens, raw.input_tokens, raw.promptTokens, raw.prompt_tokens,
    raw.promptEvalCount, raw.prompt_eval_count, raw.prompt_eval_tokens,
    usageMetadata.promptTokenCount, usageMetadata.prompt_token_count,
  )
  const output = firstNumber(
    raw.output, raw.outputTokens, raw.output_tokens, raw.completionTokens, raw.completion_tokens,
    raw.completionEvalCount, raw.completion_eval_count, raw.evalCount, raw.eval_count,
    raw.eval_tokens, raw.responseTokens, raw.response_tokens, raw.candidatesTokenCount,
    raw.candidates_token_count, usageMetadata.candidatesTokenCount,
    usageMetadata.candidates_token_count, usageMetadata.outputTokenCount,
    usageMetadata.output_token_count,
  )
  const cacheRead = firstNumber(
    raw.cacheRead, raw.cache_read, raw.cacheReadTokens, raw.cache_read_tokens,
    raw.cachedInputTokens, raw.cached_input_tokens, promptDetails.cachedTokens,
    promptDetails.cached_tokens, usageMetadata.cachedContentTokenCount,
    usageMetadata.cached_content_token_count,
  )
  const cacheWrite = firstNumber(
    raw.cacheWrite, raw.cache_write, raw.cacheWriteTokens, raw.cache_write_tokens,
  )
  const reasoning = firstNumber(
    raw.reasoningTokens, raw.reasoning_tokens, completionDetails.reasoningTokens,
    completionDetails.reasoning_tokens, usageMetadata.thoughtsTokenCount,
    usageMetadata.thoughts_token_count,
  )
  const tokens = firstNumber(
    raw.totalTokens, raw.total_tokens, raw.tokens, raw.total, raw.totalTokenCount,
    raw.total_token_count, usageMetadata.totalTokenCount, usageMetadata.total_token_count,
  ) || input + output + cacheRead + cacheWrite
  return { tokens, cost: 0, input, output: output || reasoning, cacheRead, cacheWrite }
}

function hasUsage(usage) {
  return ['tokens', 'input', 'output', 'cacheRead', 'cacheWrite']
    .some(key => number(usage?.[key]) > 0)
}

function subtractUsage(current = {}, previous = {}) {
  const delta = {
    tokens: number(current.tokens) - number(previous.tokens),
    cost: 0,
    input: number(current.input) - number(previous.input),
    output: number(current.output) - number(previous.output),
    cacheRead: number(current.cacheRead) - number(previous.cacheRead),
    cacheWrite: number(current.cacheWrite) - number(previous.cacheWrite),
  }
  return Object.values(delta).every(value => Number.isFinite(value) && value >= 0) ? delta : null
}

function timestampOf(entry) {
  const raw = entry?.timestamp || entry?.message?.timestamp || entry?.created_at || entry?.createdAt
  if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw
  const parsed = Date.parse(String(raw || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeModel(value) {
  const text = String(value || 'unknown').trim()
  return text || 'unknown'
}

function safeSessionId(value, filePath) {
  const text = String(value || '').trim()
  if (text) return text.slice(0, 200)
  const base = path.basename(filePath, path.extname(filePath))
  const uuid = base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return uuid?.[0] || base.slice(0, 200)
}

function normalizeTitle(value) {
  const collectText = (content) => {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter(part => typeof part === 'string' || part?.type === 'text')
        .map(part => typeof part === 'string' ? part : part.text)
        .join(' ')
    }
    if (content && typeof content === 'object') {
      if (typeof content.text === 'string') return content.text
      return collectText(content.content)
    }
    return ''
  }

  const text = collectText(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  const chars = Array.from(text)
  return chars.length > MAX_TITLE_CHARS
    ? `${chars.slice(0, MAX_TITLE_CHARS - 1).join('')}…`
    : text
}

function initialParserState(providerId) {
  if (providerId === 'codex') {
    return {
      sessionId: '',
      cwd: '',
      currentModel: 'unknown',
      firstObservedModel: '',
      firstActivityMs: 0,
      previousCumulativeUsage: null,
      title: '',
      titleKind: '',
    }
  }
  return {
    sessionId: '',
    cwd: '',
    firstActivityMs: 0,
    seenMessageIds: dictionary(),
    title: '',
    titleKind: '',
  }
}

function parseCodexRows(rows, state, observations) {
  for (const entry of rows) {
    const payload = entry?.payload || {}
    const timeMs = timestampOf(entry)
    if (timeMs && (!state.firstActivityMs || timeMs < state.firstActivityMs)) state.firstActivityMs = timeMs
    if (entry?.type === 'session_meta') {
      state.sessionId = String(payload.id || state.sessionId || '').slice(0, 200)
      state.cwd = String(payload.cwd || state.cwd || '')
      state.currentModel = normalizeModel(payload.model || state.currentModel)
      if (!state.firstObservedModel && payload.model) state.firstObservedModel = normalizeModel(payload.model)
      continue
    }
    if (entry?.type === 'turn_context') {
      state.cwd = String(payload.cwd || state.cwd || '')
      state.currentModel = normalizeModel(payload.model || payload.collaboration_mode?.settings?.model || state.currentModel)
      if (!state.firstObservedModel && state.currentModel !== 'unknown') state.firstObservedModel = state.currentModel
      continue
    }
    if (entry?.type === 'event_msg' && payload?.type === 'user_message' && !state.title) {
      state.title = normalizeTitle(payload.message)
      if (state.title) state.titleKind = 'user'
      continue
    }
    if (entry?.type !== 'event_msg' || payload?.type !== 'token_count') continue
    const info = payload.info || {}
    const cumulative = info.total_token_usage ? extractUsage(info.total_token_usage) : null
    const last = extractUsage(info.last_token_usage || info.total_token_usage || {})
    if (last.cacheRead > 0 && last.input >= last.cacheRead) last.input -= last.cacheRead
    if (cumulative?.cacheRead > 0 && cumulative.input >= cumulative.cacheRead) cumulative.input -= cumulative.cacheRead
    let usage = last
    if (![last.input, last.output, last.cacheRead, last.cacheWrite].some(value => value > 0) && state.previousCumulativeUsage && cumulative) {
      const delta = subtractUsage(cumulative, state.previousCumulativeUsage)
      if (delta && [delta.input, delta.output, delta.cacheRead, delta.cacheWrite].some(value => value > 0)) usage = delta
      else if (delta?.tokens === 0) usage = null
    }
    if (cumulative) state.previousCumulativeUsage = cumulative
    if (!timeMs || !usage || !hasUsage(usage)) continue
    observations.push({
      timeMs,
      model: normalizeModel(state.currentModel),
      usage,
    })
  }
  if (state.firstObservedModel) {
    for (const observation of observations) {
      if (observation.model !== 'unknown') break
      observation.model = state.firstObservedModel
    }
  }
}

function parseClaudeRows(rows, state, observations) {
  const seen = state.seenMessageIds && typeof state.seenMessageIds === 'object' && !Array.isArray(state.seenMessageIds)
    ? Object.assign(dictionary(), state.seenMessageIds)
    : dictionary()
  for (const entry of rows) {
    state.sessionId = String(entry?.sessionId || state.sessionId || '').slice(0, 200)
    if (entry?.cwd) state.cwd = String(entry.cwd)
    const timeMs = timestampOf(entry)
    if (timeMs && (!state.firstActivityMs || timeMs < state.firstActivityMs)) state.firstActivityMs = timeMs
    if (entry?.type === 'custom-title') {
      const title = normalizeTitle(entry.customTitle || entry.title)
      if (title) {
        state.title = title
        state.titleKind = 'custom'
      }
      continue
    }
    if (entry?.type === 'ai-title') {
      const title = normalizeTitle(entry.aiTitle || entry.title)
      if (title && state.titleKind !== 'custom') {
        state.title = title
        state.titleKind = 'ai'
      }
      continue
    }
    if (entry?.type === 'user' && !state.titleKind) {
      const title = normalizeTitle(entry?.message?.content)
      if (title) {
        state.title = title
        state.titleKind = 'user'
      }
    }
    const message = entry?.message
    const rawUsage = message?.usage || entry?.usage
    if (!rawUsage || !timeMs) continue
    const messageId = String(message?.id || entry?.uuid || `${timeMs}:${observations.length}`).slice(0, 300)
    if (Object.hasOwn(seen, messageId)) continue
    seen[messageId] = timeMs
    const usage = extractUsage(rawUsage)
    if (!hasUsage(usage)) continue
    observations.push({
      timeMs,
      model: normalizeModel(message?.model || entry?.model || rawUsage.model),
      usage,
    })
  }
  state.seenMessageIds = seen
}

function parseRows(providerId, rows, state, observations) {
  if (providerId === 'codex') parseCodexRows(rows, state, observations)
  else if (providerId === 'claude-code') parseClaudeRows(rows, state, observations)
  else throw new Error('unsupported_provider')
}

function emptyProvider(providerId) {
  const definition = PROVIDER_DEFINITIONS[providerId]
  if (!definition) throw new Error('unsupported_provider')
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    providerId,
    name: definition.name,
    itemLabel: definition.itemLabel,
    updatedAt: '',
    coverageStartMs: 0,
    retentionMs: 0,
    files: dictionary(),
  }
}

function validateObservation(value) {
  if (!value || typeof value !== 'object') return false
  if (!Number.isFinite(value.timeMs) || value.timeMs <= 0) return false
  if (typeof value.model !== 'string' || !value.model || value.model.length > 300) return false
  if (!value.usage || typeof value.usage !== 'object') return false
  return ['tokens', 'input', 'output', 'cacheRead', 'cacheWrite']
    .every(key => Number.isFinite(Number(value.usage[key] || 0)) && Number(value.usage[key] || 0) >= 0)
}

function validateProviderLedger(value, providerId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.schemaVersion !== LEDGER_SCHEMA_VERSION || value.providerId !== providerId) return false
  if (![value.coverageStartMs, value.retentionMs].every(item => Number.isFinite(Number(item)) && Number(item) >= 0)) return false
  if (!value.files || typeof value.files !== 'object' || Array.isArray(value.files)) return false
  for (const [filePath, entry] of Object.entries(value.files)) {
    if (!path.isAbsolute(filePath) || !entry || typeof entry !== 'object') return false
    if (![entry.size, entry.offset, entry.mtimeMs, entry.dev, entry.ino, entry.nlink].every(item => Number.isFinite(Number(item)) && Number(item) >= 0)) return false
    if (!/^[a-f0-9]{64}$/.test(String(entry.prefixHash || ''))) return false
    if (!Number.isFinite(Number(entry.coverageStartMs)) || Number(entry.coverageStartMs) < 0) return false
    if (typeof entry.title !== 'string' || Array.from(entry.title).length > MAX_TITLE_CHARS) return false
    if (!Array.isArray(entry.observations) || !entry.observations.every(validateObservation)) return false
    if (!entry.parserState || typeof entry.parserState !== 'object' || Array.isArray(entry.parserState)) return false
    if (typeof entry.parserState.title !== 'string' || Array.from(entry.parserState.title).length > MAX_TITLE_CHARS) return false
    if (!['', 'user', 'ai', 'custom'].includes(String(entry.parserState.titleKind || ''))) return false
  }
  return true
}

function safeFault(providerId, category) {
  const key = `${providerId}:${category}`
  return {
    id: crypto.createHash('sha256').update(key).digest('hex').slice(0, 20),
    source: providerId,
    category,
  }
}

function providerError(providerId, category, cause) {
  const error = new Error(`local_usage_${providerId}_${category}`)
  error.code = 'LOCAL_AI_LEDGER_PROVIDER_ERROR'
  error.providerId = providerId
  error.category = category
  error.cause = cause
  return error
}

function isInsidePath(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function validateSourceRoot(root, boundaryRoot) {
  const boundary = path.resolve(boundaryRoot)
  const target = path.resolve(root)
  if (!isInsidePath(target, boundary)) throw new Error('source_root_outside_boundary')
  const boundaryStat = fs.lstatSync(boundary)
  if (boundaryStat.isSymbolicLink() || !boundaryStat.isDirectory()) throw new Error('source_boundary_unsafe')
  const boundaryReal = fs.realpathSync.native(boundary)
  let current = boundary
  for (const segment of path.relative(boundary, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    let stat
    try {
      stat = fs.lstatSync(current)
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (stat.isSymbolicLink()) throw new Error('source_path_symlink')
    if (!stat.isDirectory()) throw new Error('source_path_not_directory')
    const currentReal = fs.realpathSync.native(current)
    if (!isInsidePath(currentReal, boundaryReal)) throw new Error('source_path_escape')
  }
}

function validateSourceRoots(roots, boundaryRoot) {
  for (const root of roots) validateSourceRoot(root, boundaryRoot)
}

function ensurePrivateDirectory(directory) {
  const parent = path.dirname(directory)
  ensureDirectoryWithinRoots(parent, [path.dirname(parent)], { mode: 0o700 })
  ensureDirectoryWithinRoots(directory, [parent], { mode: 0o700 })
  const stat = fs.lstatSync(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('ledger_directory_unsafe')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('ledger_directory_owner_unsafe')
  if ((stat.mode & 0o077) !== 0) throw new Error('ledger_directory_mode_unsafe')
  return directory
}

function ledgerFilePath(directory, providerId) {
  return path.join(directory, `${providerId}.json`)
}

function readProviderLedger(directory, providerId) {
  const filePath = ledgerFilePath(directory, providerId)
  let stat
  try {
    stat = fs.lstatSync(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return { ledger: emptyProvider(providerId), rebuilt: false }
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('ledger_file_unsafe')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('ledger_file_owner_unsafe')
  if ((stat.mode & 0o177) !== 0) throw new Error('ledger_file_mode_unsafe')
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!validateProviderLedger(value, providerId)) throw new Error('invalid_ledger')
    value.files = Object.assign(dictionary(), value.files)
    return { ledger: value, rebuilt: false }
  } catch {
    return { ledger: emptyProvider(providerId), rebuilt: true }
  }
}

function writeProviderLedger(directory, ledger) {
  const filePath = ledgerFilePath(directory, ledger.providerId)
  safeAtomicWriteFileWithinRoots(
    filePath,
    `${JSON.stringify(ledger)}\n`,
    [directory],
    { mode: 0o600 },
  )
  const stat = fs.lstatSync(filePath)
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o177) !== 0) {
    throw new Error('ledger_file_write_unsafe')
  }
}

function discoverJsonlFiles(roots, maxDepth, minMtimeMs, knownPaths = new Set(), metrics) {
  const files = []
  const visit = (directory, depth) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (['node_modules', 'cache', 'file-history'].includes(entry.name)) continue
        visit(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const stat = fs.lstatSync(fullPath)
      metrics.statCount += 1
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      if (stat.mtimeMs < minMtimeMs && !knownPaths.has(fullPath)) continue
      files.push({
        path: fullPath,
        dev: Number(stat.dev) || 0,
        ino: Number(stat.ino) || 0,
        uid: Number(stat.uid) || 0,
        nlink: Number(stat.nlink) || 0,
        size: Number(stat.size) || 0,
        mtimeMs: Number(stat.mtimeMs) || 0,
      })
    }
  }
  for (const root of roots) visit(root, 0)
  return files
}

function openVerifiedFile(file, testHooks) {
  testHooks?.beforeOpen?.(file.path)
  const fd = fs.openSync(file.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const stat = fs.fstatSync(fd)
    const current = fs.lstatSync(file.path)
    if (!stat.isFile() || !current.isFile() || current.isSymbolicLink()) throw new Error('source_file_unsafe')
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('source_file_owner_unsafe')
    if (stat.nlink !== 1 || current.nlink !== 1) throw new Error('source_file_hardlink_unsafe')
    if (
      Number(stat.dev) !== file.dev
      || Number(stat.ino) !== file.ino
      || Number(current.dev) !== file.dev
      || Number(current.ino) !== file.ino
    ) throw new Error('source_file_replaced')
    return fd
  } catch (error) {
    fs.closeSync(fd)
    throw error
  }
}

function hashConsumedPrefix(fd, end, metrics) {
  const hasher = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES)
  let position = 0
  while (position < end) {
    const requested = Math.min(buffer.length, end - position)
    const count = fs.readSync(fd, buffer, 0, requested, position)
    metrics.maxReadRequestBytes = Math.max(metrics.maxReadRequestBytes || 0, requested)
    if (!count) throw new Error('source_prefix_short_read')
    metrics.verificationReadBytes = (metrics.verificationReadBytes || 0) + count
    hasher.update(buffer.subarray(0, count))
    position += count
  }
  return {
    hasher,
    digest: hasher.copy().digest('hex'),
  }
}

function streamJsonLines(fd, start, end, metrics, onRow, prefixHasher = crypto.createHash('sha256')) {
  let position = start
  let consumed = start
  let pending = Buffer.alloc(0)
  let skippingOversized = false
  const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, Math.max(1, end - start)))

  const acceptSegment = (segment) => {
    if (segment.length === 0) return
    if (skippingOversized) {
      prefixHasher.update(segment)
      return
    }
    if (pending.length + segment.length > MAX_JSONL_LINE_BYTES) {
      prefixHasher.update(pending)
      prefixHasher.update(segment)
      pending = Buffer.alloc(0)
      skippingOversized = true
      metrics.skippedOversizedLines = (metrics.skippedOversizedLines || 0) + 1
      return
    }
    pending = pending.length > 0 ? Buffer.concat([pending, segment]) : Buffer.from(segment)
  }

  const finishLine = () => {
    if (!skippingOversized) {
      prefixHasher.update(pending)
      const raw = pending.toString('utf8').trim()
      if (raw) {
        try { onRow(JSON.parse(raw)) } catch { /* ignore malformed complete line */ }
      }
    }
    prefixHasher.update('\n')
    pending = Buffer.alloc(0)
    skippingOversized = false
  }

  while (position < end) {
    const requested = Math.min(buffer.length, end - position)
    const count = fs.readSync(fd, buffer, 0, requested, position)
    metrics.maxReadRequestBytes = Math.max(metrics.maxReadRequestBytes || 0, requested)
    if (!count) break
    metrics.bodyReadBytes += count
    position += count
    let cursor = 0
    for (let index = 0; index < count; index += 1) {
      if (buffer[index] !== 0x0a) continue
      acceptSegment(buffer.subarray(cursor, index))
      finishLine()
      cursor = index + 1
      consumed = position - count + cursor
    }
    acceptSegment(buffer.subarray(cursor, count))
  }

  if (skippingOversized) {
    consumed = position
  } else if (pending.length === 0) {
    consumed = position
  } else {
    const raw = pending.toString('utf8').trim()
    if (!raw) {
      prefixHasher.update(pending)
      consumed = position
    }
    else {
      try {
        onRow(JSON.parse(raw))
        prefixHasher.update(pending)
        consumed = position
      } catch {
        // An incomplete final line is intentionally re-read after append.
      }
    }
  }
  return {
    consumed,
    prefixHash: prefixHasher.copy().digest('hex'),
  }
}

function isAppend(previous, current) {
  return previous
    && Number(previous.dev) === current.dev
    && Number(previous.ino) === current.ino
    && current.size >= Number(previous.size)
}

function sameFileState(previous, current) {
  return isAppend(previous, current)
    && current.size === Number(previous.size)
    && current.mtimeMs === Number(previous.mtimeMs)
}

function rebuildFile(providerId, file, metrics, fd, coverageStartMs) {
  const parserState = initialParserState(providerId)
  const observations = []
  metrics.bodyReadFiles.add(file.path)
  const streamed = streamJsonLines(fd, 0, file.size, metrics, row => (
    parseRows(providerId, [row], parserState, observations)
  ))
  return {
    ...file,
    offset: streamed.consumed,
    prefixHash: streamed.prefixHash,
    coverageStartMs,
    parserState,
    observations,
    sessionId: safeSessionId(parserState.sessionId, file.path),
    project: String(parserState.cwd || ''),
    firstActivityMs: Number(parserState.firstActivityMs) || 0,
    title: normalizeTitle(parserState.title),
  }
}

function appendFile(providerId, previous, file, metrics, fd, prefixHasher) {
  const parserState = structuredClone(previous.parserState)
  const observations = previous.observations.map(item => structuredClone(item))
  const start = Math.min(Number(previous.offset) || 0, file.size)
  metrics.bodyReadFiles.add(file.path)
  const streamed = streamJsonLines(fd, start, file.size, metrics, row => (
    parseRows(providerId, [row], parserState, observations)
  ), prefixHasher)
  return {
    ...file,
    offset: streamed.consumed,
    prefixHash: streamed.prefixHash,
    coverageStartMs: Number(previous.coverageStartMs) || 0,
    parserState,
    observations,
    sessionId: safeSessionId(parserState.sessionId, file.path),
    project: String(parserState.cwd || ''),
    firstActivityMs: Number(parserState.firstActivityMs) || 0,
    title: normalizeTitle(parserState.title),
  }
}

function pruneParserState(providerId, parserState, retentionStartMs) {
  if (providerId !== 'claude-code') return parserState
  const seen = parserState?.seenMessageIds
  const next = dictionary()
  if (seen && typeof seen === 'object' && !Array.isArray(seen)) {
    for (const [messageId, timeMs] of Object.entries(seen)) {
      if (Number(timeMs) >= retentionStartMs) next[messageId] = Number(timeMs)
    }
  }
  parserState.seenMessageIds = next
  return parserState
}

async function refreshProvider({
  directory,
  providerId,
  roots,
  boundaryRoot,
  maxDepth,
  retentionStartMs,
  retentionMs,
  metrics,
  testHooks,
}) {
  let loaded
  try {
    loaded = readProviderLedger(directory, providerId)
  } catch (error) {
    throw providerError(providerId, 'ledger_security', error)
  }
  const previous = loaded.ledger
  const coverageExpanded = Number(previous.coverageStartMs) > 0
    && Number(previous.coverageStartMs) > retentionStartMs
  let discovered
  try {
    validateSourceRoots(roots, boundaryRoot)
    discovered = discoverJsonlFiles(
      roots,
      maxDepth,
      coverageExpanded ? 0 : retentionStartMs,
      new Set(Object.keys(previous.files)),
      metrics,
    )
  } catch (error) {
    throw providerError(providerId, 'discovery', error)
  }
  const next = emptyProvider(providerId)
  try {
    for (const file of discovered) {
      const prior = previous.files[file.path]
      const fileCoverageInsufficient = prior
        && Number(prior.coverageStartMs) > retentionStartMs
      let current
      const fd = openVerifiedFile(file, testHooks)
      try {
        if (sameFileState(prior, file) && !fileCoverageInsufficient) {
          current = prior
        } else if (
          prior
          && !fileCoverageInsufficient
          && Number(prior.dev) === file.dev
          && Number(prior.ino) === file.ino
          && file.size >= Number(prior.offset)
        ) {
          const verified = hashConsumedPrefix(fd, Number(prior.offset) || 0, metrics)
          if (verified.digest !== prior.prefixHash) {
            current = rebuildFile(providerId, file, metrics, fd, retentionStartMs)
          } else if (file.size > Number(prior.offset)) {
            current = appendFile(providerId, prior, file, metrics, fd, verified.hasher)
          } else {
            current = { ...prior, ...file, prefixHash: verified.digest }
          }
        } else {
          current = rebuildFile(providerId, file, metrics, fd, retentionStartMs)
        }
      } finally {
        fs.closeSync(fd)
      }
      current.observations = current.observations.filter(row => row.timeMs >= retentionStartMs)
      current.parserState = pruneParserState(providerId, current.parserState, retentionStartMs)
      current.coverageStartMs = retentionStartMs
      if (current.observations.length > 0 || file.mtimeMs >= retentionStartMs) {
        next.files[file.path] = current
      }
    }
    next.updatedAt = new Date().toISOString()
    next.coverageStartMs = retentionStartMs
    next.retentionMs = retentionMs
    writeProviderLedger(directory, next)
  } catch (error) {
    throw providerError(providerId, 'refresh', error)
  }
  return { ledger: next, rebuilt: loaded.rebuilt }
}

function cloneProviderSnapshot(ledger) {
  return structuredClone(ledger)
}

export function createLocalAiUsageLedgerStore({
  ledgerDir,
  sources,
  now = () => Date.now(),
  retentionMs = 90 * 86400_000,
  metrics: externalMetrics,
  testHooks,
} = {}) {
  if (!path.isAbsolute(String(ledgerDir || ''))) throw new Error('ledger_directory_invalid')
  const sourceList = (sources || []).map(source => {
    const definition = PROVIDER_DEFINITIONS[source.id]
    if (!definition || !Array.isArray(source.roots)) throw new Error('ledger_source_invalid')
    return {
      id: source.id,
      roots: source.roots.map(root => path.resolve(root)),
      boundaryRoot: path.resolve(source.boundaryRoot || path.dirname(source.roots[0])),
      maxDepth: Number(source.maxDepth) || definition.maxDepth,
    }
  })
  if (sourceList.length === 0) throw new Error('ledger_sources_missing')
  const directory = ensurePrivateDirectory(path.resolve(ledgerDir))
  const providers = new Map()
  const faults = new Map()
  let inFlight = null
  let lastRefreshAt = 0
  let lastAttemptAt = 0

  const metricsState = externalMetrics || {
    statCount: 0,
    bodyReadBytes: 0,
    bodyReadFiles: new Set(),
    verificationReadBytes: 0,
    maxReadRequestBytes: 0,
    skippedOversizedLines: 0,
    refreshCount: 0,
  }
  metricsState.bodyReadFiles ||= new Set()
  metricsState.verificationReadBytes ||= 0
  metricsState.maxReadRequestBytes ||= 0
  metricsState.skippedOversizedLines ||= 0

  for (const source of sourceList) {
    try {
      const { ledger } = readProviderLedger(directory, source.id)
      providers.set(source.id, ledger)
    } catch (error) {
      faults.set(source.id, safeFault(source.id, 'ledger_security'))
      providers.set(source.id, emptyProvider(source.id))
    }
  }

  function snapshot() {
    return {
      providers: sourceList.map(source => cloneProviderSnapshot(
        providers.get(source.id) || emptyProvider(source.id)
      )),
      faults: [...faults.values()].map(item => ({ ...item })),
      refreshedAt: lastRefreshAt,
      attemptedAt: lastAttemptAt,
    }
  }

  async function refresh({ force = false, freshMs = 0 } = {}) {
    const currentTime = now()
    if (!force && lastRefreshAt > 0 && currentTime - lastRefreshAt < freshMs) return snapshot()
    if (inFlight) return inFlight
    metricsState.refreshCount += 1
    lastAttemptAt = currentTime
    const task = (async () => {
      const retentionStartMs = currentTime - retentionMs
      const settled = await Promise.allSettled(sourceList.map(source => refreshProvider({
        directory,
        providerId: source.id,
        roots: source.roots,
        boundaryRoot: source.boundaryRoot,
        maxDepth: source.maxDepth,
        retentionStartMs,
        retentionMs,
        metrics: metricsState,
        testHooks,
      })))
      let successful = 0
      for (let index = 0; index < sourceList.length; index += 1) {
        const source = sourceList[index]
        const result = settled[index]
        if (result.status === 'fulfilled') {
          providers.set(source.id, result.value.ledger)
          faults.delete(source.id)
          successful += 1
        } else {
          const category = result.reason?.category || 'refresh'
          faults.set(source.id, safeFault(source.id, category))
        }
      }
      const hasPrevious = [...providers.values()].some(provider => Object.keys(provider.files || {}).length > 0)
      if (successful === 0 && !hasPrevious) {
        const error = new Error('local_usage_ledger_refresh_failed')
        error.code = 'LOCAL_AI_LEDGER_REFRESH_FAILED'
        error.faults = [...faults.values()]
        throw error
      }
      lastRefreshAt = now()
      return snapshot()
    })()
    inFlight = task
    try {
      return await task
    } finally {
      if (inFlight === task) inFlight = null
    }
  }

  return {
    refresh,
    snapshot,
    metrics: metricsState,
    ledgerDir: directory,
  }
}

export const LOCAL_AI_USAGE_LEDGER_SCHEMA_VERSION = LEDGER_SCHEMA_VERSION
