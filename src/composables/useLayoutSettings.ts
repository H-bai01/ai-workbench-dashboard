import { ref, watch } from 'vue'

const DEFAULT_PAGE_MODULES: string[] = [
  'cockpit',
  'controlDock',
  'workflow',
  'taskBoard',
  'timeline',
  'changelog',
]

const DEFAULT_TOP_BAR_CONTROLS: string[] = [
  'version',
  'gateway',
  'notifications',
  'search',
  'theme',
  'layout',
]

// ── 操作区按钮默认顺序。GPU 显存不在排序列表（条件显示，无需排序）──
const DEFAULT_STATUS_BAR: string[] = [
  'fileManager', // 文件管理
  'billing',     // 计费配置
  'skills',      // 技能库
  'webui',       // WebUI
  'projects',    // 项目看板
  'cron',        // Cron 任务中心
]

const DEFAULT_STATS_CARDS: string[] = [
  'total',    // 总计
  'running',  // 运行中
  'idle',     // 空闲
  'aborted',  // 已终止
  'error',    // 错误
  'uptime',   // 本次运行时间
  'tokens',   // 历史消耗 Token
  'cost',     // 本次运行费用
]

// ── 第三模块：内嵌视图可见性（Inline Section Visibility）──
const DEFAULT_SECTIONS: Record<string, boolean> = {
  timeline:  true, // 活动时间线 Gantt 图（默认下沉并折叠）
  changelog: true, // 版本迭代说明 Changelog（默认下沉并折叠）
}

const STORAGE_KEY = 'openclaw_dashboard_layout_v4'
const LAYOUT_SCHEMA_VERSION = 5

interface LayoutConfig {
  schemaVersion: number
  pageModules: string[]
  topBarControls: string[]
  statusBar: string[]
  statsCards: string[]
  sections: Record<string, boolean>
  timelineCollapsed: boolean
  changelogCollapsed: boolean
}

function loadFromStorage(): LayoutConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // 也检查旧 key（v1 升级迁移）
    const rawV1 = localStorage.getItem('openclaw_dashboard_layout_v1')
    const source = raw ? JSON.parse(raw) : (rawV1 ? JSON.parse(rawV1) : null)
    if (!source) {
      return {
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        pageModules: [...DEFAULT_PAGE_MODULES],
        topBarControls: [...DEFAULT_TOP_BAR_CONTROLS],
        statusBar: [...DEFAULT_STATUS_BAR],
        statsCards: [...DEFAULT_STATS_CARDS],
        sections: { ...DEFAULT_SECTIONS },
        timelineCollapsed: true,
        changelogCollapsed: true,
      }
    }
    const pm = mergeWithDefault(source.pageModules, DEFAULT_PAGE_MODULES)
    const tc = mergeWithDefault(source.topBarControls, DEFAULT_TOP_BAR_CONTROLS)
    const sb = mergeWithDefault(source.statusBar, DEFAULT_STATUS_BAR)
    const sc = normalizeStatsCardsOrder(
      mergeWithDefault(source.statsCards, DEFAULT_STATS_CARDS),
      Number(source.schemaVersion) || 0,
    )
    const sec = { ...DEFAULT_SECTIONS, ...(source.sections || {}) }
    return {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      pageModules: pm,
      topBarControls: tc,
      statusBar: sb,
      statsCards: sc,
      sections: sec,
      timelineCollapsed: source.timelineCollapsed ?? true,
      changelogCollapsed: source.changelogCollapsed ?? true,
    }
  } catch {
    return {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      pageModules: [...DEFAULT_PAGE_MODULES],
      topBarControls: [...DEFAULT_TOP_BAR_CONTROLS],
      statusBar: [...DEFAULT_STATUS_BAR],
      statsCards: [...DEFAULT_STATS_CARDS],
      sections: { ...DEFAULT_SECTIONS },
      timelineCollapsed: true,
      changelogCollapsed: true,
    }
  }
}

function mergeWithDefault(saved: string[] | undefined, defaults: string[]): string[] {
  if (!Array.isArray(saved)) return [...defaults]
  const validSet = new Set(defaults)
  const result = saved.filter(id => validSet.has(id))
  for (const id of defaults) {
    if (result.includes(id)) continue
    const nextDefault = defaults.slice(defaults.indexOf(id) + 1).find(next => result.includes(next))
    const insertAt = nextDefault ? result.indexOf(nextDefault) : -1
    if (insertAt >= 0) result.splice(insertAt, 0, id)
    else result.push(id)
  }
  return result
}

function normalizeStatsCardsOrder(order: string[], schemaVersion: number): string[] {
  void schemaVersion
  return order.filter(id => id !== 'monitored')
}

const config = ref<LayoutConfig>(loadFromStorage())
const editMode = ref(false)

// 持久化
watch(config, (val) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
  } catch {
    console.warn('[layout] save failed')
  }
}, { deep: true })

function setPageModulesOrder(order: string[]) {
  config.value.pageModules = mergeWithDefault(order, DEFAULT_PAGE_MODULES)
}

function setTopBarControlsOrder(order: string[]) {
  config.value.topBarControls = mergeWithDefault(order, DEFAULT_TOP_BAR_CONTROLS)
}

function setStatusBarOrder(order: string[]) {
  config.value.statusBar = mergeWithDefault(order, DEFAULT_STATUS_BAR)
}

function setStatsCardsOrder(order: string[]) {
  config.value.statsCards = mergeWithDefault(order, DEFAULT_STATS_CARDS)
}

function setSectionVisible(id: string, visible: boolean) {
  config.value.sections = { ...config.value.sections, [id]: visible }
}

function toggleTimelineCollapsed() {
  config.value.timelineCollapsed = !config.value.timelineCollapsed
}

function toggleChangelogCollapsed() {
  config.value.changelogCollapsed = !config.value.changelogCollapsed
}

function resetToDefault() {
  config.value = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    pageModules: [...DEFAULT_PAGE_MODULES],
    topBarControls: [...DEFAULT_TOP_BAR_CONTROLS],
    statusBar: [...DEFAULT_STATUS_BAR],
    statsCards: [...DEFAULT_STATS_CARDS],
    sections: { ...DEFAULT_SECTIONS },
    timelineCollapsed: true,
    changelogCollapsed: true,
  }
}

function toggleEditMode() {
  editMode.value = !editMode.value
}

export function useLayoutSettings() {
  return {
    config,
    editMode,
    setPageModulesOrder,
    setTopBarControlsOrder,
    setStatusBarOrder,
    setStatsCardsOrder,
    setSectionVisible,
    toggleTimelineCollapsed,
    toggleChangelogCollapsed,
    resetToDefault,
    toggleEditMode,
    DEFAULT_PAGE_MODULES,
    DEFAULT_TOP_BAR_CONTROLS,
    DEFAULT_STATUS_BAR,
    DEFAULT_STATS_CARDS,
    DEFAULT_SECTIONS,
  }
}
