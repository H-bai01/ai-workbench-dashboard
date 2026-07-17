import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dashboardPublicConfig } from '../config/public'
import { sessionsList, sessionStatus, health, sessionsHistory, agentsList, getGpuVramUsage, sessionsSend, deleteSession as deleteSessionApi, resetSession as resetSessionApi } from '../api/gateway'
import { getUsageStats } from '../api/usage-stats'
import { getVersion } from '../api/system'
import { getDashboardHealth } from '../api/dashboard'
import { createSafeRecord, ownValue, safeRecordFrom } from '../utils/safe-record.mjs'
import { formatUptime } from '../utils/uptime.mjs'
import {
  clearPersistedNotifications,
  loadPersistedNotifications,
  normalizeNotification,
  persistNotifications,
  type NotificationInput,
  type NotificationItem,
} from '../utils/notification-center.mjs'

// Constants
const AGENT_STATUS_FOREGROUND_INTERVAL = 1000 // 1s: 前台持续刷新，及时发现外部任务
const USAGE_POLL_INTERVAL = 60000 // 60s: Token / 费用统计
const HEALTH_CHECK_INTERVAL = 10000 // 10s: 网关健康
const GPU_POLL_INTERVAL = 15000 // 15s: GPU / 系统资源
const MESSAGE_POLL_INTERVAL = 3000 // 3s: 新消息提醒
const BACKGROUND_AGENT_STATUS_INTERVAL = 30000 // 后台页降速
const BACKGROUND_USAGE_POLL_INTERVAL = 5 * 60 * 1000
const BACKGROUND_HEALTH_CHECK_INTERVAL = 30000
const BACKGROUND_GPU_POLL_INTERVAL = 60000
const BACKGROUND_MESSAGE_POLL_INTERVAL = 15000
const BUBBLE_DURATION = 20000 // 20s 气泡自动消失
// const STORAGE_KEY = 'openclaw_dashboard_agent_filter'  // reserved for future use

function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

function notificationStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function modelToString(model: unknown): string {
  if (typeof model === 'string') return model
  if (!model || typeof model !== 'object') return ''

  const data = model as Record<string, unknown>
  const primary = data.primary ?? data.model ?? data.id ?? data.name ?? data.label
  if (typeof primary === 'string') return primary

  return ''
}

// Types
export type AgentStatus = 'running' | 'idle' | 'error' | 'aborted' | 'unknown'
export type FilterStatus = 'all' | 'running' | 'idle' | 'error' | 'aborted'

export interface AgentInfo {
  key: string
  name: string
  status: AgentStatus
  lastActivity: number
  tokenUsage?: {
    current: number
    max: number
    percentage: number
  }
  model?: string
  contextTokens?: number
  totalTokens?: number
  createdAt?: string
  label?: string
  displayName?: string
  kind?: string
  channel?: string
  sessionId?: string
  startedAt?: number
  endedAt?: number
  runtimeMs?: number
  elapsedMs?: number
  systemSent?: boolean
  abortedLastRun?: boolean
  lastChannel?: string
  transcriptPath?: string
  error?: any
  lastError?: any
  errorMessage?: string
  state?: string
  status_api?: string
  emoji?: string
  avatar?: string
  statusSource?: string
  statusReason?: string
  historicalTokens?: number  // 从 byAgent 统计的历史总 token
  details?: Record<string, unknown>  // raw agent details (optional)
}

export interface ModelUsage {
  tokens: number
  cost: number
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface GlobalUsage {
  totalTokens: number
  totalCost: number
  totalInputTokens?: number
  totalOutputTokens?: number
  totalCacheReadTokens?: number
  totalCacheWriteTokens?: number
  updatedAt: string
  startTime?: string
  uptimeMs?: number
  byModel?: Record<string, ModelUsage>
  byAgentByModel?: Record<string, Record<string, ModelUsage>>
  byAgent?: Record<string, ModelUsage & { sessionCount: number }>
}

export interface ImageAttachment {
  mediaType: string
  data: string
}

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<AgentInfo[]>([])
  const globalUsage = ref<GlobalUsage>({ totalTokens: 0, totalCost: 0, updatedAt: '' })
  const healthStatus = ref<'healthy' | 'degraded' | 'unhealthy' | 'unknown'>('unknown')
  const dashboardUptimeMs = ref<number>(0)
  const gatewayVersion = ref<string>('')
  const gpuVramPercentage = ref<number | null>(null) // GPU 显存使用占比 (REC-091)
  const gpuVramUsedMb = ref<number>(0) // GPU 已用显存 MB (REC-096)
  const gpuVramTotalMb = ref<number>(0) // GPU 总显存 MB (REC-096)
  const filterStatus = ref<FilterStatus>('all')
  const isPolling = ref(false)
  const lastUpdateTime = ref(0)

  // ============================================
  // 通知中心 (Sprint 1)
  // ============================================
  const notifications = ref<NotificationItem[]>(loadPersistedNotifications(notificationStorage()))
  const unreadNotifications = computed(() => notifications.value.filter(n => !n.read).length)

  function saveNotifications(): void {
    persistNotifications(notificationStorage(), notifications.value)
  }

  function addNotification(n: NotificationInput): boolean {
    const notification = normalizeNotification({
      ...n,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      read: false,
    })
    if (!notification) return false
    notifications.value.unshift(notification)
    // 上限 50 条
    if (notifications.value.length > 50) notifications.value = notifications.value.slice(0, 50)
    saveNotifications()
    return true
  }

  function addNotificationOnce(
    n: NotificationInput,
    options: { dedupeWindowMs?: number; now?: number } = {},
  ): boolean {
    const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
    const dedupeWindowMs = Number.isFinite(options.dedupeWindowMs)
      ? Math.max(0, Number(options.dedupeWindowMs))
      : 10 * 60 * 1000
    const persisted = loadPersistedNotifications(notificationStorage(), now)
    const merged = new Map<string, NotificationItem>()
    for (const item of [...persisted, ...notifications.value]) merged.set(item.id, item)
    notifications.value = [...merged.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50)

    const duplicate = notifications.value.some(item => (
      item.errorCode === n.errorCode
      && item.source === n.source
      && item.timeRange === n.timeRange
      && now - item.timestamp >= 0
      && now - item.timestamp <= dedupeWindowMs
    ))
    if (duplicate) {
      saveNotifications()
      return false
    }

    const notification = normalizeNotification({
      ...n,
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: now,
      read: false,
    }, { now })
    if (!notification) return false
    notifications.value.unshift(notification)
    if (notifications.value.length > 50) notifications.value = notifications.value.slice(0, 50)
    saveNotifications()
    return true
  }
  function markNotificationRead(id: string) {
    let changed = false
    notifications.value = notifications.value.map((n) => {
      if (n.id !== id || n.read) return n
      changed = true
      return { ...n, read: true }
    })
    if (changed) saveNotifications()
  }
  function markAllNotificationsRead() {
    notifications.value = notifications.value.map(n => ({ ...n, read: true }))
    saveNotifications()
  }
  function clearNotifications() {
    notifications.value = []
    clearPersistedNotifications(notificationStorage())
  }

  function checkStatusTransitions(oldList: AgentInfo[], newList: AgentInfo[]) {
    if (oldList.length === 0) return  // 初次加载不报警
    const oldMap = new Map(oldList.map(a => [a.key, a.status]))
    for (const cur of newList) {
      const prev = oldMap.get(cur.key)
      if (!prev) continue  // 新出现的 agent 不算状态变化
      if (prev !== 'error' && cur.status === 'error') {
        addNotification({
          type: 'error',
          agentId: cur.key.split(':')[1] || cur.key,
          agentName: cur.name,
          message: 'Agent 进入错误状态',
          source: 'Agent 状态',
          detail: '检测到该 Agent 的运行状态由其他状态变为错误。',
          errorCode: 'agent_status_error',
          impact: '该 Agent 当前可能无法继续处理任务。',
          currentResult: '其他 Agent 和工作台功能不受影响。',
        })
      } else if (prev !== 'aborted' && cur.status === 'aborted') {
        addNotification({
          type: 'aborted',
          agentId: cur.key.split(':')[1] || cur.key,
          agentName: cur.name,
          message: '会话被中断',
          source: 'Agent 状态',
          detail: '检测到该 Agent 的最近一次会话已中断。',
          errorCode: 'agent_session_aborted',
          impact: '本次会话未继续执行。',
          currentResult: '工作台继续监控该 Agent 的后续状态。',
        })
      }
    }
  }

  // ============================================
  // REC-071: Agent 消息气泡状态
  // ============================================
  interface MessageBubbleData {
    content: string
    timestamp: number
    contentType: string  // 'text' | 'thinking' | 'toolUse' | 'toolResult' | 'image'
    isError?: boolean    // for toolResult errors
  }
  const messageBubbles = ref<Record<string, MessageBubbleData[]>>(createSafeRecord())
  const lastMessageCount = ref<Record<string, number>>(createSafeRecord())
  let bubbleTimers: Record<string, ReturnType<typeof setTimeout>> = createSafeRecord()

  // ============================================
  // Agent 名称映射：API 为主，原始 key 为保守降级。
  // ============================================
  const envFallbackMap: Record<string, string> = createSafeRecord()
  // 动态 Agent 名称映射：初始使用 .env 降级，API 成功后覆盖
  const agentNameMap = ref<Record<string, string>>(safeRecordFrom(envFallbackMap))
  const agentNameMapLoaded = ref(false)

  // Computed
  const runningAgents = computed(() => agents.value.filter((a) => a.status === 'running'))
  const idleAgents = computed(() => agents.value.filter((a) => a.status === 'idle'))
  const errorAgents = computed(() => agents.value.filter((a) => a.status === 'error'))
  const abortedAgents = computed(() => agents.value.filter((a) => a.status === 'aborted'))
  const unknownAgents = computed(() => agents.value.filter((a) => a.status === 'unknown'))

  const totalAgents = computed(() => agents.value.length)
  const activeAgents = computed(() => runningAgents.value.length + idleAgents.value.length)

  // Filtered agents based on status
  const filteredAgents = computed(() => {
    if (filterStatus.value === 'all') return agents.value
    return agents.value.filter((a) => a.status === filterStatus.value)
  })

  // ============================================
  // 核心指标计算 - 统一维度:本次工作台服务启动至今
  // ============================================

  // 1. 运行时间 (uptime) - 仅使用同源后端 /api/health 的明确值。
  // 健康请求失败时保留最后一次有效值，不退回历史会话时间。
  const uptimeMs = computed(() => dashboardUptimeMs.value)

  // 2. 总 Token 用量 - Gateway 从启动至今的累计
  // 数据来源:usage-stats 服务统计的全局用量
  const totalTokensUsed = computed(() => {
    // Priority 1: usage-stats 服务的全局用量(Gateway 启动至今的累计)
    if (globalUsage.value.totalTokens > 0) {
      return globalUsage.value.totalTokens
    }
    // Fallback: 累加当前所有会话的用量(降级方案)
    return agents.value.reduce((sum, s) => {
      const t = Number(s.totalTokens) || 0
      return sum + t
    }, 0)
  })

  // 3. 总费用 - 按 billing-config.json 的每模型规则计算（v1.6+）
  // 计费配置从后端 /api/billing-config 读取（JSON 文件），UI 可编辑
  // 兼容旧 env 的 fallback：未配置时按 electricity 模式（API + 电费）
  const ELECTRICITY_PER_HOUR = dashboardPublicConfig.electricityPerHour
  const HOURS_PER_MONTH = 30 * 24

  // 计费配置（从后端拉取）
  interface ModelBillingConfig {
    mode: 'subscription_monthly' | 'per_token' | 'use_default' | 'free'
    monthlyCNY?: number
    quotaTokensPerMonth?: number
    overTokenPriceCNYPerMillion?: number
    inputPriceCNYPerMillion?: number
    outputPriceCNYPerMillion?: number
    cacheReadPriceCNYPerMillion?: number
    cacheWritePriceCNYPerMillion?: number
    discountFactor?: number
    discountStartHour?: number
    discountEndHour?: number
    note?: string
  }
  interface BillingConfig {
    version: number
    models: Record<string, ModelBillingConfig>
    fallback: ModelBillingConfig
    globalAddons?: {
      electricityPerHour?: number   // 全局电费叠加
    }
  }
  const billingConfig = ref<BillingConfig | null>(null)

  async function fetchBillingConfig(): Promise<void> {
    try {
      const resp = await fetch('/api/billing-config')
      if (resp.ok) billingConfig.value = await resp.json()
    } catch {
      console.warn('[AgentStore] billing config unavailable; using defaults')
    }
  }

  // 费用摘要：今日 / 本月 / 本月预估
  const costSummary = ref<{ todayCNY: number; monthCNY: number; monthForecastCNY: number } | null>(null)
  async function fetchCostSummary(): Promise<void> {
    try {
      const resp = await fetch('/api/cost-summary')
      if (resp.ok) costSummary.value = await resp.json()
    } catch {
      console.warn('[AgentStore] cost summary unavailable')
    }
  }

  async function saveBillingConfig(cfg: BillingConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const resp = await fetch('/api/billing-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const data = await resp.json()
      if (data.success) {
        billingConfig.value = cfg
        return { success: true }
      }
      return { success: false, error: data.error || '保存失败' }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  /**
   * 按当前时段是否在折扣窗口内，返回折扣系数（1.0 = 原价）
   */
  function getCurrentDiscountFactor(cfg: ModelBillingConfig): number {
    if (cfg.discountFactor === undefined) return 1
    if (cfg.discountStartHour === undefined || cfg.discountEndHour === undefined) return 1
    const hour = new Date().getHours()
    const start = cfg.discountStartHour
    const end = cfg.discountEndHour
    const inWindow = start < end
      ? (hour >= start && hour < end)
      : (hour >= start || hour < end)  // 跨日
    return inWindow ? cfg.discountFactor : 1
  }

  /**
   * 单模型成本计算（按 token 用量 + 计费配置）
   * 优先使用后端采集到的 input/output/cache 拆分；只有缺少拆分字段时才按 7/3 兜底。
   */
  function resolveModelBillingConfig(modelId: string): ModelBillingConfig | undefined {
    const models = billingConfig.value?.models || {}
    const direct = ownValue(models, modelId)
    if (direct) return direct

    const lower = modelId.toLowerCase()
    if (lower.includes('qwen')) {
      return ownValue(models, 'qwen3.5') || ownValue(models, 'qwen3.5:9b') || ownValue(models, 'Qwen3.5-4B-OptiQ-4bit') || billingConfig.value?.fallback
    }
    if (lower.includes('gemma') || lower.includes('google')) {
      return ownValue(models, 'gemma3') || ownValue(models, 'gemma3:12b') || billingConfig.value?.fallback
    }

    return billingConfig.value?.fallback
  }

  function calcModelCost(modelId: string, usage: ModelUsage): number {
    const tokens = Number(usage.tokens) || 0
    const rawCost = Number(usage.cost) || 0
    const cfg = resolveModelBillingConfig(modelId)
    if (!cfg) return rawCost  // 没有配置 → 用 OpenClaw 算的
    switch (cfg.mode) {
      case 'free':
        return 0
      case 'use_default':
        return rawCost
      case 'subscription_monthly': {
        // 月费按本次运行时长比例分摊；超过配额部分按超额单价
        const uptimeHours = uptimeMs.value / (1000 * 60 * 60)
        const baseCost = ((cfg.monthlyCNY ?? 0) * uptimeHours) / HOURS_PER_MONTH
        let overCost = 0
        if (cfg.quotaTokensPerMonth && tokens > cfg.quotaTokensPerMonth) {
          const over = tokens - cfg.quotaTokensPerMonth
          overCost = (over / 1_000_000) * (cfg.overTokenPriceCNYPerMillion ?? 0)
        }
        return baseCost + overCost
      }
      case 'per_token': {
        let inputTokens = Number(usage.input) || 0
        let outputTokens = Number(usage.output) || 0
        const cacheReadTokens = Number(usage.cacheRead) || 0
        const cacheWriteTokens = Number(usage.cacheWrite) || 0

        if (!inputTokens && !outputTokens && tokens) {
          inputTokens = tokens * 0.7
          outputTokens = tokens * 0.3
        }

        const inputPrice = cfg.inputPriceCNYPerMillion ?? 0
        const outputPrice = cfg.outputPriceCNYPerMillion ?? 0
        const cacheReadPrice = cfg.cacheReadPriceCNYPerMillion ?? 0
        const cacheWritePrice = cfg.cacheWritePriceCNYPerMillion ?? 0
        const factor = getCurrentDiscountFactor(cfg)
        return (
          (inputTokens / 1_000_000) * inputPrice +
          (outputTokens / 1_000_000) * outputPrice +
          (cacheReadTokens / 1_000_000) * cacheReadPrice +
          (cacheWriteTokens / 1_000_000) * cacheWritePrice
        ) * factor
      }
      default:
        return rawCost
    }
  }

  /** 各模型计算后的 cost 明细 */
  const computedCostByModel = computed<Record<string, { tokens: number; cost: number; rawCost: number }>>(() => {
    const out: Record<string, { tokens: number; cost: number; rawCost: number }> = createSafeRecord()
    const byModel = globalUsage.value.byModel || {}
    for (const [model, data] of Object.entries(byModel)) {
      out[model] = {
        tokens: data.tokens,
        cost: calcModelCost(model, data),
        rawCost: data.cost,
      }
    }
    return out
  })

  const totalCostCny = computed(() => {
    const openclawCost = globalUsage.value.totalCost || 0
    const uptimeHours = uptimeMs.value / (1000 * 60 * 60)

    if (billingConfig.value) {
      const modelTotal = Object.values(computedCostByModel.value).reduce((s, d) => s + d.cost, 0)
      const electricityAddon = billingConfig.value?.globalAddons?.electricityPerHour ?? 0
      return modelTotal + uptimeHours * electricityAddon
    }

    if (openclawCost > 0) {
      return openclawCost
    }

    // 兼容旧逻辑：未拉到配置时用 electricity 模式
    return openclawCost + uptimeHours * ELECTRICITY_PER_HOUR
  })

  const costModeLabel = computed<string>(() => {
    if (!billingConfig.value) return '本地部署（API + 电费）'
    const modelCount = Object.keys(billingConfig.value.models).length
    return `按模型计费（已配置 ${modelCount} 个）`
  })

  // Methods
  function setFilterStatus(status: FilterStatus): void {
    filterStatus.value = status
  }

  /**
   * Format duration (elapsed time) in milliseconds to human-readable string
   */
  function formatDuration(ms: number): string {
    if (!ms || ms <= 0) return '-'

    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}小时${minutes}分${seconds}秒`
    } else if (minutes > 0) {
      return `${minutes}分${seconds}秒`
    } else {
      return `${seconds}秒`
    }
  }

  /**
   * Format cost to CNY currency string
   */
  function formatCost(cost: number): string {
    if (cost < 0.01) return '<¥0.01'
    return '¥' + cost.toFixed(2)
  }

  // Helpers
  function normalizeAgent(item: Record<string, unknown>): AgentInfo {
    if (!item || typeof item !== 'object') return { key: '', name: 'Unknown', status: 'unknown', lastActivity: 0 }

    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

    const rawKey = str(item.key ?? item.sessionKey ?? item.id)

    // 名称映射：API 数据优先，.env 配置化降级（REC-091）
    const map = agentNameMap.value

    // Step 1: Try direct lookup (rawKey might be "main", "recorder", etc.)
    let agentName = ownValue(map, rawKey) || ''

    // Step 2: If not found, try extract from "agent:main:default" format
    if (!agentName && rawKey.includes(':')) {
      const parts = rawKey.split(':')
      // "agent:main:default" -> parts[1] = "main"
      if (parts.length >= 2 && parts[0] === 'agent') {
        agentName = ownValue(map, parts[1]) || parts[1]
      } else if (parts.length >= 1) {
        // Try first part or last part
        agentName = ownValue(map, parts[0]) || ownValue(map, parts[parts.length - 1]) || parts[parts.length - 1]
      }
    }

    // Step 3: Handle cron sessions
    if (!agentName && rawKey.includes('cron:')) {
      const cronMatch = rawKey.match(/cron:(.+?)$/)
      agentName = cronMatch ? '定时任务:' + cronMatch[1] : '定时任务'
    }

    // Step 4: Final fallback
    if (!agentName) {
      agentName = str(item.label) || str(item.name) || rawKey || 'Unnamed'
    }

    // Get status: API returns a 'status' field!
    // Possible values: "running", "done", "error", "aborted", etc.
    // Map these to our AgentStatus type
    const apiStatus = str(item.status || item.state || '').toLowerCase()
    let derivedStatus: AgentStatus = 'unknown'

    // 1) Check if aborted (most reliable)
    const abortedRaw = String(item.abortedLastRun ?? '').toLowerCase()
    const aborted = abortedRaw === 'true' || item.abortedLastRun === true
    if (aborted) {
      derivedStatus = 'aborted'
    }
    // 2) Check if error
    else if (item.error || item.lastError || item.errorMessage) {
      derivedStatus = 'error'
    }
    // 3) Use API status field
    else if (apiStatus) {
      if (apiStatus === 'running' || apiStatus === 'active' || apiStatus === 'in_progress') {
        derivedStatus = 'running'
      } else if (apiStatus === 'done' || apiStatus === 'completed' || apiStatus === 'finished') {
        derivedStatus = 'idle'
      } else if (apiStatus === 'error' || apiStatus === 'failed') {
        derivedStatus = 'error'
      } else if (apiStatus === 'aborted' || apiStatus === 'cancelled') {
        derivedStatus = 'aborted'
      } else {
        const updatedAt = num(item.updatedAt)
        if (updatedAt > 0) {
          const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
          derivedStatus = secondsSinceUpdate < 600 ? 'running' : 'idle'
        }
      }
    }
    // 4) Fallback to updatedAt if no status field
    else {
      const updatedAt = num(item.updatedAt)
      if (updatedAt > 0) {
        const secondsSinceUpdate = (Date.now() - updatedAt) / 1000
        derivedStatus = secondsSinceUpdate < 600 ? 'running' : 'idle'
      }
    }

    // Token usage - API returns: totalTokens (used), contextTokens (max)
    const totalTokens = num(item.totalTokens)
    const contextTokens = num(item.contextTokens)
    let tokenUsage: AgentInfo['tokenUsage'] | undefined

    if (totalTokens > 0 && contextTokens > 0) {
      tokenUsage = {
        current: totalTokens,
        max: contextTokens,
        percentage: Math.round((totalTokens / contextTokens) * 100),
      }
    } else {
      // Fallback: check details/metadata
      const contextRaw = item.context ?? item.contextWindow ?? item.usage
      if (contextRaw && typeof contextRaw === 'object') {
        const ctx = contextRaw as Record<string, unknown>
        const current = num(ctx.currentTokens ?? ctx.tokensUsed ?? ctx.totalTokens ?? 0)
        const max = num(ctx.maxTokens ?? ctx.maxContext ?? ctx.contextWindow ?? ctx.contextTokens ?? 1)
        if (current > 0 && max > 0) {
          tokenUsage = {
            current,
            max,
            percentage: Math.round((current / max) * 100),
          }
        }
      }
    }

    // Get createdAt from startedAt or other fields
    const startedAt = item.startedAt
    const createdAt = typeof startedAt === 'number' ? new Date(startedAt).toISOString() : str(startedAt)

    return {
      key: rawKey,
      name: agentName,
      status: derivedStatus,
      lastActivity: num(item.updatedAt),
      tokenUsage,
      model: modelToString(item.model),
      contextTokens: contextTokens || undefined,
      totalTokens: totalTokens || undefined,
      createdAt,
      label: str(item.label),
      displayName: str(item.displayName),
      avatar: str(item.avatar),
      kind: str(item.kind),
      channel: str(item.channel),
      sessionId: str(item.sessionId),
      startedAt: typeof startedAt === 'number' ? startedAt : undefined,
      endedAt: typeof item.endedAt === 'number' ? item.endedAt : undefined,
      runtimeMs: typeof item.runtimeMs === 'number' ? item.runtimeMs : undefined,
      elapsedMs: typeof item.elapsedMs === 'number' ? item.elapsedMs : (typeof item.runtimeMs === 'number' ? item.runtimeMs : undefined),
      systemSent: Boolean(item.systemSent),
      abortedLastRun: Boolean(item.abortedLastRun),
      lastChannel: str(item.lastChannel),
      transcriptPath: str(item.transcriptPath),
      error: item.error,
      lastError: item.lastError,
      errorMessage: str(item.errorMessage),
      state: str(item.state),
      status_api: str(item.status),
    }
  }

  async function fetchAgents(): Promise<void> {
    try {
      // 同时拉四个数据源：活跃会话 + 已配置 agent 列表 + UI 状态源 + 文件 mtime 兜底
      const [sessionsData, configuredResp, uiStatusResp, runningResp] = await Promise.all([
        sessionsList(),
        fetch('/api/agents-configured').then(r => r.ok ? r.json() : { agents: [] }).catch(() => ({ agents: [] })),
        fetch('/api/agent-ui-status').then(r => r.ok ? r.json() : { agents: [] }).catch(() => ({ agents: [] })),
        fetch('/api/agent-running-status').then(r => r.ok ? r.json() : { agents: [] }).catch(() => ({ agents: [] })),
      ])

      const sessions = Array.isArray((sessionsData as any).sessions) ? (sessionsData as any).sessions : []
      const configuredAgents = Array.isArray(configuredResp?.agents) ? configuredResp.agents : []

      // 构建 UI 状态 map（按客户端会话事件源判断），mtime 只作为兜底。
      const uiStatusMap = new Map<string, any>()
      for (const item of (Array.isArray(uiStatusResp?.agents) ? uiStatusResp.agents : [])) {
        if (item.id) uiStatusMap.set(String(item.id), item)
      }

      // 构建运行状态 map（基于 session 文件 mtime，仅兜底使用）
      const runningStatusMap = new Map<string, AgentStatus>()
      const runningLastActivityMap = new Map<string, number>()
      for (const ra of (Array.isArray(runningResp?.agents) ? runningResp.agents : [])) {
        if (ra.id && ra.status) runningStatusMap.set(ra.id as string, ra.status as AgentStatus)
        if (ra.id && typeof ra.lastModifiedMs === 'number' && ra.lastModifiedMs > 0) {
          runningLastActivityMap.set(ra.id as string, ra.lastModifiedMs)
        }
      }

      // 构建 emoji map（从 agents-configured，用于补全 session agents 的头像）
      const configuredEmojiMap = new Map<string, string>()
      const configuredModelMap = new Map<string, string>()
      const configuredNameMap = new Map<string, string>()
      const configuredAvatarMap = new Map<string, string>()
      for (const c of configuredAgents) {
        if (c.id) {
          if (c.name) configuredNameMap.set(c.id, c.name)
          if (c.emoji) configuredEmojiMap.set(c.id, c.emoji)
          if (c.avatar) configuredAvatarMap.set(c.id, c.avatar)
          const model = modelToString(c.model)
          if (model) configuredModelMap.set(c.id, model)
        }
      }

      // 规范化 sessions_list 返回的会话；首页当前状态以 mtime 实时检测为准，
      // abortedLastRun 只表示上一轮结果，不能覆盖当前空闲状态。
      // 同时从 configuredAgents 补全 emoji（normalizeAgent 不携带 emoji）
      const sessionAgents = sessions.map((s: any) => {
        const agent = normalizeAgent(s)
        const agentId = (agent.key || '').split(':')[1] || ''
        const uiStatus = uiStatusMap.get(agentId)
        const currentStatus = (uiStatus?.status || runningStatusMap.get(agentId)) as AgentStatus | undefined
        if (currentStatus) {
          agent.status = currentStatus
        }
        const currentLastActivity = Number(uiStatus?.lastActivityMs || 0) || runningLastActivityMap.get(agentId) || 0
        if (currentLastActivity > (agent.lastActivity || 0)) {
          agent.lastActivity = currentLastActivity
        }
        if (uiStatus?.source) agent.statusSource = String(uiStatus.source)
        if (uiStatus?.reason) agent.statusReason = String(uiStatus.reason)
        // 补全 emoji（configured 数据有，session 数据没有）
        if (!agent.emoji && configuredEmojiMap.has(agentId)) {
          agent.emoji = configuredEmojiMap.get(agentId)
        }
        // 补全 model（若 session 没返回 model，用配置中的默认）
        if (!agent.model && configuredModelMap.has(agentId)) {
          agent.model = configuredModelMap.get(agentId)
        }
        if (configuredNameMap.has(agentId)) {
          const configuredName = configuredNameMap.get(agentId)
          agent.name = configuredName || agent.name
          agent.displayName = configuredName || agent.displayName
        }
        if (configuredAvatarMap.has(agentId)) {
          agent.avatar = configuredAvatarMap.get(agentId) || agent.avatar
        }
        return agent
      })

      // 按 agentId 去重（同一 agent 可能有多个 session 条目，保留最近活跃的那个）
      const agentIdMap = new Map<string, AgentInfo>()
      for (const agent of sessionAgents) {
        const agentId = (agent.key || '').split(':')[1] || agent.key
        const existing = agentIdMap.get(agentId)
        if (!existing || (agent.lastActivity ?? 0) >= (existing.lastActivity ?? 0)) {
          agentIdMap.set(agentId, agent)
        }
      }
      const deduplicatedSessionAgents = [...agentIdMap.values()]

      const sessionAgentIds = new Set(deduplicatedSessionAgents.map((a: AgentInfo) => {
        // session key 格式: agent:{agentId}:{sessionId}
        const parts = (a.key || '').split(':')
        return parts[1] || ''
      }).filter(Boolean))

      // 已配置但无 webchat 会话的 agent → 使用文件 mtime 实时状态
      // 注意：不预先设置 historicalTokens，让 AgentCard 通过响应式 getAgentHistoricalTokens()
      // 读取，避免 globalUsage 并行加载时竞争条件导致永远为 0
      const configuredOnlyAgents: AgentInfo[] = configuredAgents
        .filter((c: any) => !sessionAgentIds.has(c.id))
        .map((c: any) => {
          const uiStatus = uiStatusMap.get(c.id)
          return {
            key: `agent:${c.id}:main`,
            name: c.name || c.id,
            displayName: c.name || c.id,
            status: (uiStatus?.status || runningStatusMap.get(c.id) || 'idle') as AgentStatus,
            lastActivity: Number(uiStatus?.lastActivityMs || 0) || runningLastActivityMap.get(c.id) || 0,
            model: modelToString(c.model),
            kind: 'configured',
            channel: 'none',
            emoji: c.emoji || '',
            avatar: c.avatar || '',
            statusSource: uiStatus?.source ? String(uiStatus.source) : undefined,
            statusReason: uiStatus?.reason ? String(uiStatus.reason) : undefined,
            // historicalTokens 故意不设置，走 AgentCard 的响应式 computed 路径
          }
        })

      const newAgents = [...deduplicatedSessionAgents, ...configuredOnlyAgents]
      // 检测状态变化：进入 error / aborted 时推通知
      checkStatusTransitions(agents.value, newAgents)
      agents.value = newAgents
      lastUpdateTime.value = Date.now()
      const runningCount = [...runningStatusMap.values()].filter(value => value === 'running').length
      console.log('[AgentStore] agents refreshed', { count: agents.value.length, runningCount })
    } catch {
      console.error('[AgentStore] agents refresh failed')
      agents.value = []
    }
  }

  async function fetchAgentStatus(sessionKey: string): Promise<AgentInfo | null> {
    try {
      const data = await sessionStatus(sessionKey)
      return normalizeAgent(data as Record<string, unknown>)
    } catch {
      console.error('[AgentStore] agent status refresh failed')
      return null
    }
  }

  async function fetchGlobalUsage(): Promise<void> {
    try {
      const data = await getUsageStats()
      globalUsage.value = {
        totalTokens: data.totalTokens || 0,
        totalCost: data.totalCost || 0,
        totalInputTokens: data.totalInputTokens || 0,
        totalOutputTokens: data.totalOutputTokens || 0,
        totalCacheReadTokens: data.totalCacheReadTokens || 0,
        totalCacheWriteTokens: data.totalCacheWriteTokens || 0,
        updatedAt: data.updatedAt || '',
        startTime: (data as any).startTime,
        uptimeMs: (data as any).uptimeMs,
        byModel: data.byModel,
        byAgentByModel: data.byAgentByModel,
        byAgent: data.byAgent,
      }
      console.log('[AgentStore] global usage loaded')

    } catch {
      console.warn('[AgentStore] global usage unavailable')
    }
  }

  async function fetchHealth(): Promise<void> {
    try {
      const data = await health()
      const typed = data as Record<string, unknown>
      // /health 返回 { ok: true, status: "live", version: "2026.3.13" }
      // 映射 Gateway 的 status/ok 值到 UI 期望的值
      const raw = String(typed.status ?? '')
      const isOk = typed.ok === true || typed.ok === 'true'
      if (raw === 'degraded') {
        healthStatus.value = 'degraded'
      } else if (isOk || raw === 'ok' || raw === 'live') {
        healthStatus.value = 'healthy'
      } else if (raw === 'error') {
        healthStatus.value = 'unhealthy'
      } else {
        healthStatus.value = 'unknown'
      }
      // 提取版本号；缺失时保留上一次服务端结果，不读取浏览器环境变量。
      const version = typed.version
      if (typeof version === 'string' && version) {
        gatewayVersion.value = version
      }
    } catch {
      console.warn('[AgentStore] gateway health unavailable')
      healthStatus.value = 'unhealthy' // 请求失败视为不健康
    }

    // 工作台运行时间使用独立的同源健康接口；失败时不覆盖上一次有效值。
    try {
      const dashboardHealth = await getDashboardHealth()
      if (Number.isFinite(dashboardHealth.uptimeMs) && dashboardHealth.uptimeMs >= 0) {
        dashboardUptimeMs.value = dashboardHealth.uptimeMs
      }
    } catch {
      console.warn('[AgentStore] dashboard health unavailable')
    }

    // REC-066: 从后端 /api/system/version 获取版本号
    try {
      const versionData = await getVersion()
      if (versionData && versionData.version) {
        gatewayVersion.value = versionData.version
      }
    } catch {
      console.warn('[AgentStore] version unavailable')
      // 不覆盖已有版本号，保持 /health 或 env 的值
    }
  }

  /**
   * 获取 GPU 显存使用占比 (REC-091 / REC-096)
   * 通过 /api/gpu-vram 后端 API 获取
   * 返回: { usedPct, usedMb, totalMb }
   */
  async function fetchGpuVram(): Promise<void> {
    try {
      const data = await getGpuVramUsage()
      if (data) {
        gpuVramPercentage.value = data.usedPct
        gpuVramUsedMb.value = data.usedMb
        gpuVramTotalMb.value = data.totalMb
        console.log('[AgentStore] GPU status loaded')
      }
    } catch {
      console.warn('[AgentStore] GPU status unavailable')
    }
  }

  /**
   * 动态获取 Agent 名称映射(agentsList API)
   * API 成功 → 覆盖为 API 数据；失败 → 保留 .env 配置化降级（REC-091）
   */
  async function fetchAgentNames(): Promise<void> {
    if (agentNameMapLoaded.value) return // 只调用一次
    try {
      const data = await agentsList()
      if (Array.isArray(data)) {
        const dynamicMap: Record<string, string> = createSafeRecord()
        for (const item of data) {
          const typed = item as Record<string, unknown>
          const id = String(typed.id ?? typed.agentId ?? typed.key ?? '')
          const name = String(typed.name ?? typed.label ?? typed.displayName ?? '')
          if (id && name) {
            dynamicMap[id] = name
          }
        }
        agentNameMap.value = dynamicMap
        agentNameMapLoaded.value = true
        console.log('[AgentStore] Agent names loaded', { count: Object.keys(dynamicMap).length })
      }
    } catch {
      try {
        const resp = await fetch('/api/agents-configured')
        const data = await resp.json().catch(() => ({}))
        const configuredAgents = Array.isArray(data?.agents) ? data.agents : []
        const configuredMap: Record<string, string> = createSafeRecord()
        for (const item of configuredAgents) {
          const id = String(item?.id || '')
          const name = String(item?.name || '')
          if (id && name) configuredMap[id] = name
        }
        if (Object.keys(configuredMap).length > 0) {
          agentNameMap.value = safeRecordFrom({ ...agentNameMap.value, ...configuredMap })
          agentNameMapLoaded.value = true
          console.log('[AgentStore] configured Agent names loaded', { count: Object.keys(configuredMap).length })
          return
        }
      } catch {
        // keep .env fallback
      }
      console.warn('[AgentStore] Agent names unavailable; using configured fallback')
    }
  }

  async function resetSession(sessionKey: string): Promise<void> {
    try {
      // REC-005 fix: 提取 agentId，通过 POST /reset API 重置（替代 WebSocket chat.send）
      const agentId = extractAgentId(sessionKey)
      console.log('[AgentStore] session reset requested')
      await resetSessionApi(agentId)
      console.log('[AgentStore] session reset completed', { ok: true })
    } catch (e: any) {
      console.error('[AgentStore] session reset failed')
      throw e
    }
  }

  /**
   * 删除会话（REC-125）
   * 调用 API 层 deleteSession → 成功后刷新列表
   */
  async function deleteSession(sessionKey: string): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const result = await deleteSessionApi(sessionKey)
      if (result.success) {
        // 删除成功后重新请求 sessions_list（F-22）
        await fetchAgents()
      }
      return result as { success: boolean; error?: string }
    } catch (e: any) {
      return { success: false, error: e?.message || '删除失败' }
    }
  }

  /** 从 sessionKey 提取 agentId（与 resetSession 共用） */
  function extractAgentId(sessionKey: string): string {
    if (sessionKey.includes(':')) {
      const parts = sessionKey.split(':')
      if (parts[0] === 'agent' && parts.length >= 2) {
        return parts[1]
      }
    }
    return sessionKey
  }

  /**
   * 发送消息到 Agent 会话
   * 改用本地 unified-service 的 /api/agent-send-message → openclaw CLI
   * （Gateway 的 sessions_send 是 agent 内部 tool，不能从外部 /tools/invoke 调用）
   */
  async function sendAgentMessage(sessionKey: string, message: string): Promise<void> {
    try {
      const agentId = extractAgentId(sessionKey)
      console.log('[AgentStore] message dispatch requested')
      const resp = await fetch('/api/agent-send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, message }),
      })
      const result = await resp.json()
      if (!result.success) throw new Error(result.error || '发送失败')
      console.log('[AgentStore] message dispatch completed', { ok: true })
    } catch (e: any) {
      console.error('[AgentStore] message dispatch failed')
      throw e
    }
  }

  /**
   * 发送消息到 Agent 会话（支持图片附件）
   * 方案 B：图片 base64 先写入 Agent workspace，再发送文件路径
   */
  async function sendAgentMessageWithImages(
    sessionKey: string,
    text: string,
    images: ImageAttachment[],
  ): Promise<void> {
    try {
      const agentId = extractAgentId(sessionKey)
      // Step 1: 将所有图片写入 Agent workspace
      const filePaths: string[] = []
      for (const img of images) {
        const response = await fetch('/api/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, mediaType: img.mediaType, data: img.data }),
        })
        const result = await response.json()
        if (result.success) {
          filePaths.push(result.filePath)
          console.log('[AgentStore] image upload completed', { ok: true })
        } else {
          throw new Error(`上传图片失败: ${result.error}`)
        }
      }

      // Step 2: 构建消息 — 文本 + Markdown 图片
      let fullMessage = text
      for (const fp of filePaths) {
        fullMessage += `\n\n![image](${window.location.origin}${fp})`
      }

      // Step 3: 发送消息
      console.log('[AgentStore] attachment message dispatch requested', { count: filePaths.length })
      await sessionsSend(sessionKey, fullMessage, 0)
      console.log('[AgentStore] attachment message dispatch completed', { ok: true })
    } catch (e: any) {
      console.error('[AgentStore] attachment message dispatch failed')
      throw e
    }
  }

  function getAgentByKey(key: string): AgentInfo | null {
    const agent = agents.value.find((a) => a.key === key)
    return agent || null
  }

  /** 获取指定 agent 的历史总 token 用量 */
  function getAgentHistoricalTokens(agentId: string): number {
    return ownValue(globalUsage.value.byAgent, agentId)?.tokens || 0
  }

  // 聚合某 agent 的全部历史 session 文件（跨 session），用于抽屉「全部历史聊天记录」
  // 返回 { messages, total, truncated, sessionCount }
  async function fetchAgentFullHistory(agentKey: string, limit: number = 1500): Promise<{
    messages: Record<string, unknown>[]
    total: number
    truncated: boolean
    sessionCount: number
  }> {
    const agentId = (agentKey || '').split(':')[1] || ''
    const empty = { messages: [], total: 0, truncated: false, sessionCount: 0 }
    if (!agentId) return empty
    try {
      const resp = await fetch(`/api/agent-full-history?agentId=${encodeURIComponent(agentId)}&limit=${limit}`)
      if (!resp.ok) return empty
      const data = await resp.json()
      return {
        messages: Array.isArray(data?.messages) ? data.messages as Record<string, unknown>[] : [],
        total: Number(data?.total || 0),
        truncated: Boolean(data?.truncated),
        sessionCount: Number(data?.sessionCount || 0),
      }
    } catch {
      console.error('[AgentStore] Agent history unavailable')
      return empty
    }
  }

  async function fetchSessionHistory(sessionKey: string, limit: number = 100): Promise<Record<string, unknown>[]> {
    try {
      const data = await sessionsHistory(sessionKey, { limit, includeTools: true })
      if (Array.isArray(data)) return data as Record<string, unknown>[]
      if (data && typeof data === 'object') {
        const typed = data as Record<string, unknown>
        if (Array.isArray(typed.messages)) return typed.messages as Record<string, unknown>[]
        if (Array.isArray(typed.data)) return typed.data as Record<string, unknown>[]
      }
      return []
    } catch {
      console.error('[AgentStore] session history unavailable')
      return []
    }
  }

  // ============================================
  // REC-071: Agent 消息气泡管理
  // ============================================

  /**
   * 追加一条 Agent 消息气泡（每个 content part 独立气泡）
   * 按 part 逐条追加，每条独立计时自动消失
   */
  function updateAgentBubble(
    agentKey: string,
    content: string,
    contentType: string = 'text',
    isError?: boolean,
  ): void {
    if (!Object.hasOwn(messageBubbles.value, agentKey)) {
      messageBubbles.value[agentKey] = []
    }

    const entry: MessageBubbleData = {
      content,
      timestamp: Date.now(),
      contentType,
      isError,
    }
    messageBubbles.value[agentKey].push(entry)
    // REC-123: 强制触发 Vue 响应式（新增 key 时 ref 对象引用不变）
    messageBubbles.value = safeRecordFrom(messageBubbles.value)

    // 单条定时自动消失
    setTimeout(() => {
      const arr = ownValue(messageBubbles.value, agentKey)
      if (arr) {
        const idx = arr.indexOf(entry)
        if (idx !== -1) arr.splice(idx, 1)
        if (arr.length === 0) delete messageBubbles.value[agentKey]
        // REC-123: 强制触发 Vue 响应式
        messageBubbles.value = safeRecordFrom(messageBubbles.value)
      }
    }, BUBBLE_DURATION)
  }

  /**
   * 轮询检测 Agent 新消息（增量检测）
   * REC-076: 只显示 running 状态 + 显示所有内容类型（含思考过程、工具调用）
   */
  async function checkNewMessages(): Promise<void> {
    console.log('[AgentStore] new message poll started', { count: agents.value.length })

    // 提取消息的各个 content part（不合并，每条独立返回），用于逐条显示气泡
    function extractContentParts(msg: Record<string, unknown>): { content: string; contentType: string; isError?: boolean }[] {
      if (typeof msg?.content === 'string') {
        const c = msg.content as string
        return c ? [{ content: c, contentType: 'text' }] : []
      }
      if (typeof msg?.content === 'object' && msg.content !== null && !Array.isArray(msg.content)) {
        const c = msg.content as Record<string, unknown>
        const text = typeof c.text === 'string' ? c.text : ''
        return text ? [{ content: text, contentType: 'text' }] : []
      }
      if (Array.isArray(msg?.content)) {
        const items = msg.content as Array<Record<string, unknown>>
        const parts = items.map(item => {
          if (!item || typeof item !== 'object') return null
          const t = String(item.type ?? '')
          if (t === 'text') {
            const text = (item.text as string) ?? ''
            return text ? { content: text, contentType: 'text' as const } : null
          }
          if (t === 'thinking') {
            const thinking = (item.thinking as string) ?? ''
            return thinking ? { content: thinking, contentType: 'thinking' as const } : null
          }
          if (t === 'tool_use') {
            const name = String(item.name ?? '')
            if (name) return { content: name, contentType: 'toolUse' as const }
            const input = item.input
            if (typeof input === 'string' && input) return { content: '工具调用', contentType: 'toolUse' as const }
            if (typeof input === 'object' && input !== null) return { content: '工具调用', contentType: 'toolUse' as const }
            return null
          }
          if (t === 'tool_result') {
            const name = String(item.name ?? '')
            const isError = item.is_error === true
            const resultContent = item.content
            let text = ''
            if (isError) {
              if (typeof item.error === 'string' && item.error) text = item.error
              else if (typeof resultContent === 'string' && resultContent) text = resultContent
              else if (Array.isArray(resultContent)) {
                const textParts = resultContent
                  .filter((r: any) => r?.type === 'text' && typeof r.text === 'string')
                  .map((r: any) => r.text)
                if (textParts.length > 0) text = textParts.join('\n')
              }
            }
            if (!text && Array.isArray(resultContent)) {
              const textParts = resultContent
                .filter((r: any) => r?.type === 'text' && typeof r.text === 'string')
                .map((r: any) => r.text)
              if (textParts.length > 0) {
                text = textParts.join('\n').slice(0, 200)
              }
            }
            if (!text && typeof item.text === 'string' && item.text) text = item.text
            if (!text) text = '[工具结果]'

            const displayContent = (name ? `${name}\n` : '') + text
            return { content: displayContent, contentType: 'toolResult' as const, isError }
          }
          return null
        }).filter(s => s !== null)
        return parts as { content: string; contentType: string; isError?: boolean }[]
      }
      return []
    }

    // 过滤系统消息或不应展示的内容
    function isSystemMessage(content: string): boolean {
      return content.includes('巡检异常通知')
        || content.includes('巡检提醒')
        || content.includes('HEARTBEAT_OK')
        || content.includes('HEARTBEAT')
        || content.startsWith('收到巡检报告')
        || content.includes('巡检异常汇报')
        || content.includes('heartbeat')
        || content.includes('Heartbeat')
    }

    for (const agent of agents.value) {
      if (agent.key.includes(':cron:')) continue
      if (agent.status !== 'running') continue

      try {
        const history = await fetchSessionHistory(agent.key, 50)
        const currentCount = history.length

        const prevCount = ownValue(lastMessageCount.value, agent.key) || 0
        // 仅处理会话重置（消息数变少）：重新初始化计数器
        if (prevCount > currentCount) {
          lastMessageCount.value[agent.key] = currentCount
          continue
        }

        if (currentCount > prevCount) {
          // 找最新一条 assistant/agent 消息（而非 user 消息）
          const newCount = currentCount - prevCount
          const newMessages = history.slice(-Math.min(newCount, 20)).reverse()

          let found = false
          for (const raw of newMessages) {
            const msg = (raw && typeof raw === 'object'
              ? ((raw.message && typeof raw.message === 'object' ? raw.message : raw) as Record<string, unknown>)
              : {}) as Record<string, unknown>

            const role = String(msg?.role ?? '')
            // 显示所有角色的消息（包含 user、assistant、tool 等）
            // 每条消息的多个 content part 分别独立显示为单独气泡（不合并）
            if (role === 'user' || role === 'assistant' || role === 'agent' || role === 'tool') {
              const parts = extractContentParts(msg)
              for (const part of parts) {
                // thinking 是模型内部推理，不展示给用户
                if (part.contentType === 'thinking') continue
                if (part.content && !isSystemMessage(part.content)) {
                  updateAgentBubble(agent.key, part.content, part.contentType, part.isError)
                  found = true
                }
              }
              if (found) break // 一条消息处理完就跳出（不跨消息循环）
            }
          }

          if (!found) {
            console.log('[AgentStore] no displayable message in update', { count: newCount })
          }

          lastMessageCount.value[agent.key] = currentCount
        }
      } catch {
        console.warn('[AgentStore] new message poll failed')
      }
    }
  }

  /**
   * 获取指定 Agent 的全部气泡消息数组
   */
  function getAgentBubbles(agentKey: string): MessageBubbleData[] {
    const arr = ownValue(messageBubbles.value, agentKey)
    return arr ? arr.map(e => ({ content: e.content, contentType: e.contentType, isError: e.isError, timestamp: e.timestamp })) : []
  }

  /**
   * 获取指定 Agent 的最新一条气泡内容（兼容旧调用方）
   */
  function getAgentBubble(agentKey: string): string | null {
    const arr = ownValue(messageBubbles.value, agentKey)
    if (arr && arr.length > 0) {
      return arr[arr.length - 1].content
    }
    return null
  }

  /**
   * 清除指定 Agent 的所有气泡
   */
  function clearAgentBubble(agentKey: string): void {
    const timer = ownValue(bubbleTimers, agentKey)
    if (timer) {
      clearTimeout(timer)
      delete bubbleTimers[agentKey]
    }
    delete messageBubbles.value[agentKey]
  }

  function currentAgentStatusPollInterval(): number {
    if (isPageHidden()) return BACKGROUND_AGENT_STATUS_INTERVAL
    return AGENT_STATUS_FOREGROUND_INTERVAL
  }

  function startAdaptivePoll(task: () => void | Promise<void>, foregroundMs: number, backgroundMs: number): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const schedule = () => {
      if (stopped || !isPolling.value) return
      timer = setTimeout(run, isPageHidden() ? backgroundMs : foregroundMs)
    }

    const run = () => {
      if (stopped || !isPolling.value) return
      Promise.resolve(task())
        .catch(() => console.warn('[AgentStore] adaptive poll failed'))
        .finally(schedule)
    }

    schedule()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }

  function startDynamicPoll(task: () => void | Promise<void>, getDelayMs: () => number): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const schedule = () => {
      if (stopped || !isPolling.value) return
      timer = setTimeout(run, getDelayMs())
    }

    const run = () => {
      if (stopped || !isPolling.value) return
      Promise.resolve(task())
        .catch(() => console.warn('[AgentStore] dynamic poll failed'))
        .finally(schedule)
    }

    schedule()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }

  async function subscribeAgents(): Promise<() => void> {
    isPolling.value = true

    // Agent 状态是首页最敏感的信息，先启动轮询，避免被费用/配置等初始化接口拖慢。
    const pollCleanups = [
      startDynamicPoll(fetchAgents, currentAgentStatusPollInterval),
      startAdaptivePoll(fetchHealth, HEALTH_CHECK_INTERVAL, BACKGROUND_HEALTH_CHECK_INTERVAL),
      startAdaptivePoll(fetchGpuVram, GPU_POLL_INTERVAL, BACKGROUND_GPU_POLL_INTERVAL),
      startAdaptivePoll(checkNewMessages, MESSAGE_POLL_INTERVAL, BACKGROUND_MESSAGE_POLL_INTERVAL),
      startAdaptivePoll(() => {
        fetchGlobalUsage()
        fetchCostSummary()
      }, USAGE_POLL_INTERVAL, BACKGROUND_USAGE_POLL_INTERVAL),
    ]

    await Promise.all([fetchAgents(), fetchGlobalUsage(), fetchAgentNames(), fetchGpuVram(), fetchBillingConfig(), fetchCostSummary()])

    // REC-071: 首次加载时静默初始化消息计数器
    // 注意：limit 必须与 checkNewMessages 轮询用的 50 一致，否则基线(1)和当前计数(50)
    // 永远对不上，agent 一变"工作中"就会把历史里最后一条旧回复误判为新消息弹出来。
    for (const agent of agents.value) {
      if (agent.key.includes(':cron:')) continue
      if (Object.hasOwn(lastMessageCount.value, agent.key)) continue
      try {
        const h = await fetchSessionHistory(agent.key, 50)
        lastMessageCount.value[agent.key] = h.length
      } catch { /* ignore */ }
    }
    console.log('[AgentStore] message counters initialized', { count: Object.keys(lastMessageCount.value).length })

    const handleVisibilityChange = () => {
      if (!isPolling.value || isPageHidden()) return
      fetchAgents()
      fetchHealth()
      fetchGpuVram()
      checkNewMessages()
      fetchGlobalUsage()
      fetchCostSummary()
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      isPolling.value = false
      pollCleanups.forEach((cleanup) => cleanup())
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      // 清理所有气泡定时器
      Object.values(bubbleTimers).forEach(clearTimeout)
      bubbleTimers = createSafeRecord()
    }
  }

  function stopPolling(): void {
    isPolling.value = false
  }

  return {
    // State
    agents,
    globalUsage,
    healthStatus,
    dashboardUptimeMs,
    gatewayVersion,
    gpuVramPercentage,
    gpuVramUsedMb,
    gpuVramTotalMb,
    filterStatus,
    agentNameMap,
    messageBubbles,
    isPolling,
    lastUpdateTime,
    // Computed
    runningAgents,
    idleAgents,
    errorAgents,
    abortedAgents,
    unknownAgents,
    totalAgents,
    activeAgents,
    filteredAgents,
    uptimeMs,
    totalTokensUsed,
    totalCostCny,
    costModeLabel,
    billingConfig,
    fetchBillingConfig,
    saveBillingConfig,
    computedCostByModel,
    costSummary,
    fetchCostSummary,
    // Notifications (Sprint 1)
    notifications,
    unreadNotifications,
    addNotification,
    addNotificationOnce,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications,
    // Methods
    setFilterStatus,
    formatUptime,
    formatDuration,
    formatCost,
    getAgentByKey,
    getAgentHistoricalTokens,
    fetchAgents,
    fetchAgentStatus,
    fetchGlobalUsage,
    fetchHealth,
    fetchAgentNames,
    fetchGpuVram,
    resetSession,
    sendAgentMessage,
    sendAgentMessageWithImages,
    fetchSessionHistory,
    fetchAgentFullHistory,
    deleteSession,
    subscribeAgents,
    stopPolling,
    // REC-071: 消息气泡
    updateAgentBubble,
    getAgentBubble,
    getAgentBubbles,
    clearAgentBubble,
  }
})
