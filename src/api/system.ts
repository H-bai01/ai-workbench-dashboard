import axios from 'axios'

/** 技能信息接口 (REC-005) */
export interface SkillInfo {
  name: string
  description: string
  icon?: string
  status?: string
  installed?: boolean
  enabled?: boolean
  // REC-011: 统计信息
  updatedAt?: string
  stars?: number
  downloads?: number
  // REC-018: 技能来源标识
  source?: 'builtin' | 'clawhub'
  sourceRaw?: string
  sourceLabel?: string
  sourceMaintainer?: string
  sourceTrust?: '官方' | '社区' | '本地' | '项目' | '个人' | '未知' | string
  sourceKind?: 'official' | 'community' | 'workspace' | 'managed' | 'project' | 'personal' | 'unknown' | string
  homepage?: string
  author?: string
  [key: string]: unknown
}

/** 技能列表响应接口 (REC-005) */
export interface SkillsResponse {
  success: boolean
  total: number
  ready: number
  skills: SkillInfo[]
}

/**
 * 获取系统版本号 (REC-066)
 * 后端接口: GET /api/system/version → 端口 31022
 * 始终通过同源本地代理转发。
 * 返回: { version: string }
 */
export async function getVersion(): Promise<{ version: string } | null> {
  try {
    const resp = await axios.get('/api/system/version', { timeout: 10000 })
    return resp.data as { version: string }
  } catch {
    return null
  }
}

/**
 * 网关诊断修复 (REC-003)
 * 后端接口: GET /api/system/doctor → 在一次性隔离目录执行 openclaw doctor --lint --json
 * 返回: { success: boolean, stdout: string, stderr: string, command: string, platform: string, error?: string }
 */
export interface DoctorResult {
  success: boolean
  stdout: string
  stderr: string
  command: string
  platform: string
  error?: string
}

export async function runDoctor(): Promise<DoctorResult> {
  // 诊断命令本身约 30 秒，超时设 180s 留余量
  try {
    const resp = await axios.get('/api/system/doctor', { timeout: 180000 })
    return resp.data as DoctorResult
  } catch (e: any) {
    console.error('[System] read-only diagnosis failed')
    // 把真实错误信息抛出去，让 UI 显示原因（而不是吞掉返回 null）
    const detail = e?.code === 'ECONNABORTED'
      ? `请求超时（>180秒）：隔离的 openclaw doctor --lint 检查时间过长`
      : e?.response
        ? `后端返回 HTTP ${e.response.status}: ${JSON.stringify(e.response.data || {}).slice(0, 200)}`
        : e?.message || String(e)
    throw new Error(detail)
  }
}

/**
 * 获取 OpenClaw 技能列表 (REC-005)
 * 后端接口: GET /api/system/skills → 端口 31022
 * 返回: { success, total, ready, skills: [{ name, description, icon, status, ... }] }
 */
export async function getSkills(): Promise<SkillsResponse | null> {
  try {
    const resp = await axios.get('/api/system/skills', { timeout: 15000 })
    return resp.data as SkillsResponse
  } catch {
    console.error('[System] skills request failed')
    return null
  }
}

/**
 * 安装技能 (REC-012 第二阶段)
 * 后端接口: POST /api/system/skills/install → 端口 31022
 * 请求体: { name: string }
 * 返回: { success: boolean, message: string, stdout?: string, stderr?: string }
 */
export interface InstallSkillResult {
  success: boolean
  message: string
  stdout?: string
  stderr?: string
}

export async function installSkill(name: string, source?: 'builtin' | 'clawhub'): Promise<InstallSkillResult | null> {
  try {
    const body: Record<string, string> = { name }
    if (source) body.source = source
    const resp = await axios.post('/api/system/skills/install', body, { timeout: 60000 })
    return resp.data as InstallSkillResult
  } catch (e: unknown) {
    console.error('[System] skill installation failed')
    const message = (e instanceof Error ? e.message : '安装失败')
    return { success: false, message }
  }
}

/**
 * 搜索 ClawHub 技能 (REC-008)
 * 后端接口: GET /api/system/skills/search?q=关键词 → 端口 31022
 * 返回: { success: boolean, total: number, skills: SkillInfo[] }
 */
export interface SearchSkillsResult {
  success: boolean
  total: number
  skills: SkillInfo[]
}

export async function searchClawHubSkills(query: string): Promise<SearchSkillsResult | null> {
  try {
    const resp = await axios.get('/api/system/skills/search', { params: { q: query }, timeout: 60000 }) // REC-013: 30s → 60s
    return resp.data as SearchSkillsResult
  } catch {
    console.error('[System] skill search failed')
    return null
  }
}

/**
 * 获取项目任务进度 (REC-027)
 * 后端接口: GET /api/tasks/current → 端口 31022
 * 返回: { taskId, projectName, taskName, progress, currentStage, totalStages, agents, startedAt, runningMinutes }
 */
export interface TaskProgress {
  taskId: string | null
  projectName: string | null
  taskName: string | null
  progress: number
  currentStage: string | null
  totalStages: number
  agents: string[]
  startedAt: string | null
  runningMinutes: number
}

export async function getTaskProgress(): Promise<TaskProgress | null> {
  try {
    const resp = await axios.get('/api/tasks/current', { timeout: 10000 })
    return resp.data as TaskProgress
  } catch {
    return null
  }
}

/**
 * 切换技能启用/禁用状态 (REC-022)
 * 后端接口: POST /api/system/skills/toggle → 端口 31022
 * 请求体: { name: string, enabled: boolean }
 * 返回: { success: boolean, message: string, stdout?: string, stderr?: string }
 */
export interface ToggleSkillResult {
  success: boolean
  message: string
  stdout?: string
  stderr?: string
}

export async function toggleSkill(name: string, enabled: boolean): Promise<ToggleSkillResult | null> {
  try {
    const resp = await axios.post('/api/system/skills/toggle', { name, enabled }, { timeout: 60000 })
    return resp.data as ToggleSkillResult
  } catch (e: unknown) {
    console.error('[System] skill toggle failed')
    const message = (e instanceof Error ? e.message : '切换失败')
    return { success: false, message }
  }
}
