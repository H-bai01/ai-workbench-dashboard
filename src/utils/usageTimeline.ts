export interface UsageDatum {
  tokens: number
  cost: number
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  inputCost?: number
  outputCost?: number
  cacheReadCost?: number
  cacheWriteCost?: number
  longContextCost?: number
  noCacheCost?: number
}

export type ModelUsageMap = Record<string, UsageDatum>
export type AgentModelUsageMap = Record<string, ModelUsageMap>

export interface TimelineDay extends UsageDatum {
  date: string
  byModel?: ModelUsageMap
  byAgentByModel?: AgentModelUsageMap
}

export function localUsageSourceId(appId: string, itemId: string): string {
  return `local:${appId}:${itemId}`
}

export function isLocalUsageSourceId(sourceId: string): boolean {
  return String(sourceId || '').startsWith('local:')
}

export function localUsageSourceAppId(sourceId: string): string {
  const parts = String(sourceId || '').split(':')
  return parts[1] || ''
}

export function localUsageSourceItemId(sourceId: string): string {
  const text = String(sourceId || '')
  const prefix = `local:${localUsageSourceAppId(text)}:`
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}

export function localUsageSourceDisplayName(sourceId: string): string {
  const appId = localUsageSourceAppId(sourceId)
  const itemId = localUsageSourceItemId(sourceId)
  const name = itemId.split('/').filter(Boolean).pop() || itemId || '未知项目'
  if (appId === 'codex') return `Codex · ${name}`
  if (appId === 'claude-code') return `Claude Code · ${name}`
  return name
}

export function localUsageSourceAvatarSrc(sourceId: string): string {
  const appId = localUsageSourceAppId(sourceId)
  if (appId === 'codex') return '/app-logos/chatgpt-white-black.svg'
  if (appId === 'claude-code') return '/app-logos/claude-app-orange.png'
  return ''
}

function emptyUsage(): UsageDatum {
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

function addUsage(target: UsageDatum, usage: Partial<UsageDatum> | undefined): void {
  if (!usage) return
  target.tokens += Number(usage.tokens) || 0
  target.cost += Number(usage.cost) || 0
  target.input = (Number(target.input) || 0) + (Number(usage.input) || 0)
  target.output = (Number(target.output) || 0) + (Number(usage.output) || 0)
  target.cacheRead = (Number(target.cacheRead) || 0) + (Number(usage.cacheRead) || 0)
  target.cacheWrite = (Number(target.cacheWrite) || 0) + (Number(usage.cacheWrite) || 0)
  target.inputCost = (Number(target.inputCost) || 0) + (Number(usage.inputCost) || 0)
  target.outputCost = (Number(target.outputCost) || 0) + (Number(usage.outputCost) || 0)
  target.cacheReadCost = (Number(target.cacheReadCost) || 0) + (Number(usage.cacheReadCost) || 0)
  target.cacheWriteCost = (Number(target.cacheWriteCost) || 0) + (Number(usage.cacheWriteCost) || 0)
  target.longContextCost = (Number(target.longContextCost) || 0) + (Number(usage.longContextCost) || 0)
  target.noCacheCost = (Number(target.noCacheCost) || 0) + (Number(usage.noCacheCost) || 0)
}

function ensureModel(map: ModelUsageMap, model: string): UsageDatum {
  return ensureSafeValue(map, model, emptyUsage)
}

function ensureDay(map: Map<string, TimelineDay>, date: string): TimelineDay {
  let day = map.get(date)
  if (!day) {
    day = { date, ...emptyUsage(), byModel: createSafeRecord(), byAgentByModel: createSafeRecord() }
    map.set(date, day)
  }
  if (!day.byModel) day.byModel = createSafeRecord()
  if (!day.byAgentByModel) day.byAgentByModel = createSafeRecord()
  return day
}

export function mergeUsageTimelines(...sources: Array<TimelineDay[] | undefined>): TimelineDay[] {
  const byDate = new Map<string, TimelineDay>()

  for (const timeline of sources) {
    for (const row of timeline || []) {
      if (!row?.date) continue
      const target = ensureDay(byDate, row.date)
      addUsage(target, row)

      for (const [model, usage] of Object.entries(row.byModel || {})) {
        addUsage(ensureModel(target.byModel || {}, model), usage)
      }

      for (const [sourceId, modelMap] of Object.entries(row.byAgentByModel || {})) {
        ensureSafeValue(target.byAgentByModel!, sourceId, createSafeRecord)
        for (const [model, usage] of Object.entries(modelMap || {})) {
          addUsage(ensureModel(target.byAgentByModel![sourceId], model), usage)
        }
      }
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
import { createSafeRecord, ensureSafeValue } from './safe-record.mjs'
