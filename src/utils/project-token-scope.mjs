import { createSafeRecord, ensureSafeValue } from './safe-record.mjs'

function emptyUsage() {
  return {
    tokens: 0,
    cost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    longContextCost: 0,
    noCacheCost: 0,
  }
}

function addUsage(target, source) {
  if (!source) return
  target.tokens += Number(source.tokens) || 0
  target.cost += Number(source.cost) || 0
  target.input += Number(source.input) || 0
  target.output += Number(source.output) || 0
  target.cacheRead += Number(source.cacheRead) || 0
  target.cacheWrite += Number(source.cacheWrite) || 0
  target.inputCost += Number(source.inputCost) || 0
  target.outputCost += Number(source.outputCost) || 0
  target.cacheReadCost += Number(source.cacheReadCost) || 0
  target.cacheWriteCost += Number(source.cacheWriteCost) || 0
  target.longContextCost += Number(source.longContextCost) || 0
  target.noCacheCost += Number(source.noCacheCost) || 0
}

export function normalizeProjectPath(value) {
  let text = String(value || '').trim()
  if (!text) return ''
  try { text = decodeURIComponent(text) } catch { /* preserve non-URI paths */ }
  return text.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function projectFolderName(value) {
  const normalized = normalizeProjectPath(value)
  if (!normalized) return '对话'
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || '对话'
}

export function createProjectTokenScope({ appId, appName, projectPath, sources }) {
  const uniqueSources = new Map()
  for (const source of sources || []) {
    const id = String(source?.id || '').trim()
    if (!id || uniqueSources.has(id)) continue
    uniqueSources.set(id, {
      id,
      sessionId: String(source?.sessionId || '').trim(),
      name: String(source?.name || '').trim() || '未命名对话',
      lastActivityMs: Math.max(0, Number(source?.lastActivityMs) || 0),
      status: String(source?.status || 'idle'),
      label: String(source?.label || '没干活'),
    })
  }
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  return {
    appId: String(appId || ''),
    appName: String(appName || ''),
    projectName: projectFolderName(normalizedProjectPath),
    projectPath: normalizedProjectPath,
    sources: [...uniqueSources.values()].sort((a, b) => (
      b.lastActivityMs - a.lastActivityMs || a.name.localeCompare(b.name, 'zh-CN')
    )),
  }
}

export function filterTimelineBySourceIds(timeline, sourceIds) {
  const allowed = sourceIds instanceof Set ? sourceIds : new Set(sourceIds || [])
  return (timeline || []).map((day) => {
    const byModel = createSafeRecord()
    const byAgentByModel = createSafeRecord()
    const total = emptyUsage()

    for (const [sourceId, modelMap] of Object.entries(day?.byAgentByModel || {})) {
      if (!allowed.has(sourceId)) continue
      const safeModelMap = ensureSafeValue(byAgentByModel, sourceId, createSafeRecord)
      for (const [model, usage] of Object.entries(modelMap || {})) {
        const sourceUsage = { ...emptyUsage(), ...usage }
        safeModelMap[model] = sourceUsage
        addUsage(ensureSafeValue(byModel, model, emptyUsage), sourceUsage)
        addUsage(total, sourceUsage)
      }
    }

    return {
      ...day,
      ...total,
      byModel,
      byAgentByModel,
    }
  })
}
