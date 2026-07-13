/**
 * 人格演化引擎（直接微调 OpenClaw Agent 的 SOUL.md）
 * - 读取近期对话 → 本地 Ollama 分析用户的沟通偏好 → 生成「沟通风格观察」
 * - 把观察写进 SOUL.md 的一段带标记、可回退的区块（不破坏原有灵魂内容）
 * - SOUL.md 规定「改了灵魂要告诉 用户」，所以接口会把改动返回给前端展示
 * - 轻量状态（上次演化时间 / 历史观察）存 ~/.openclaw/personality-{id}.json，仅供时间线展示
 * 默认读取 OpenClaw 配置中的各 Agent 工作空间 SOUL.md；兼容旧版 ~/clawd/agents/{id}/SOUL.md
 */

import path from 'path'
import os from 'os'
import {
  ensureDirectoryWithinRoots,
  resolvePathWithinRoots,
  safeAtomicWriteFileWithinRoots,
  safeWriteFileWithinRoots,
} from './security/path-boundary.mjs'

const HOME = os.homedir()
const OPENCLAW_DIR = path.join(HOME, '.openclaw')
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents')
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json')
const CLAWD_DIR = path.join(HOME, 'clawd')
const BACKUP_DIR = path.join(OPENCLAW_DIR, 'backups')
const OLLAMA_URL = String(process.env.OPENCLAW_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')

const SOUL_MARK_START = '<!-- PERSONALITY_EVOLUTION_START -->'
const SOUL_MARK_END = '<!-- PERSONALITY_EVOLUTION_END -->'

function expandHome(value) {
  const text = String(value || '').trim()
  if (text === '~') return HOME
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(HOME, text.slice(2))
  return text
}

function validAgentId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(String(value || ''))
}

function readOpenClawConfig(fsSync) {
  try {
    return JSON.parse(fsSync.readFileSync(OPENCLAW_CONFIG, 'utf8'))
  } catch {
    return {}
  }
}

function buildAgentMap(fsSync) {
  const cfg = readOpenClawConfig(fsSync)
  const out = Object.create(null)
  const configured = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : []
  for (const agent of configured) {
    const id = String(agent?.id || '').trim()
    if (!validAgentId(id)) continue
    const workspace = expandHome(agent?.workspace || cfg?.agents?.defaults?.workspace || '')
    const root = workspace || path.join(CLAWD_DIR, 'agents', id)
    const candidateSoul = path.join(root, 'SOUL.md')
    let soulPath = candidateSoul
    try {
      if (fsSync.existsSync(root)) {
        soulPath = resolvePathWithinRoots(candidateSoul, [root], { mustExist: fsSync.existsSync(candidateSoul) })
      }
    } catch { continue }
    out[id] = {
      name: String(agent?.identity?.name || agent?.name || id),
      soulPath,
      workspace,
      root,
    }
  }

  if (Object.keys(out).length === 0) {
    const legacyRoots = []
    const rootSoul = path.join(CLAWD_DIR, 'SOUL.md')
    if (fsSync.existsSync(rootSoul)) legacyRoots.push({ id: 'main', root: CLAWD_DIR, soulPath: rootSoul })
    const legacyAgentsDir = path.join(CLAWD_DIR, 'agents')
    try {
      for (const entry of fsSync.readdirSync(legacyAgentsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !validAgentId(entry.name)) continue
        const root = path.join(legacyAgentsDir, entry.name)
        const soulPath = path.join(root, 'SOUL.md')
        if (fsSync.existsSync(soulPath)) legacyRoots.push({ id: entry.name, root, soulPath })
      }
    } catch { /* legacy directory absent */ }

    for (const info of legacyRoots) {
      try {
        out[info.id] = {
          name: info.id,
          root: info.root,
          workspace: info.root,
          soulPath: resolvePathWithinRoots(info.soulPath, [info.root], { mustExist: true }),
        }
      } catch { /* symlink escape */ }
    }
  }

  return out
}

function stateFile(agentId) {
  if (!validAgentId(agentId)) throw new Error('Agent ID 格式无效')
  return path.join(OPENCLAW_DIR, `personality-${agentId}.json`)
}

function loadState(fsSync, agentId) {
  try {
    const candidate = stateFile(agentId)
    if (fsSync.existsSync(candidate)) {
      const safeStateFile = resolvePathWithinRoots(candidate, [OPENCLAW_DIR], { mustExist: true })
      return JSON.parse(fsSync.readFileSync(safeStateFile, 'utf8'))
    }
  } catch {}
  return { agentId, lastEvolved: null, observations: [], history: [] }
}

function saveState(fsSync, state) {
  const target = resolvePathWithinRoots(stateFile(state.agentId), [OPENCLAW_DIR])
  safeAtomicWriteFileWithinRoots(target, `${JSON.stringify(state, null, 2)}\n`, [OPENCLAW_DIR])
}

// 读 SOUL.md 里当前的演化区块内容（用于展示）
function readCurrentEvolution(fsSync, agentId) {
  const info = buildAgentMap(fsSync)[agentId]
  if (!info || !fsSync.existsSync(info.soulPath)) return null
  const soulPath = resolvePathWithinRoots(info.soulPath, [info.root], { mustExist: true })
  const soul = fsSync.readFileSync(soulPath, 'utf8')
  const s = soul.indexOf(SOUL_MARK_START)
  const e = soul.indexOf(SOUL_MARK_END)
  if (s >= 0 && e > s) return soul.slice(s + SOUL_MARK_START.length, e).trim()
  return null
}

// 读最近 N 条用户消息（从 sessions JSONL 里提取 user turn）
function readRecentUserMessages(fsSync, agentId, limit = 50) {
  if (!validAgentId(agentId)) return []
  const agentRoot = path.join(AGENTS_DIR, agentId)
  const sessDir = path.join(agentRoot, 'sessions')
  if (!fsSync.existsSync(sessDir)) return []
  let safeSessDir
  try { safeSessDir = resolvePathWithinRoots(sessDir, [agentRoot], { mustExist: true }) } catch { return [] }

  const files = fsSync.readdirSync(safeSessDir)
    .filter(f => f.endsWith('.jsonl'))
    .flatMap(f => {
      try {
        const safeFile = resolvePathWithinRoots(path.join(safeSessDir, f), [safeSessDir], { mustExist: true })
        return [{ f, mtime: fsSync.statSync(safeFile).mtime }]
      } catch { return [] }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 10)
    .map(x => x.f)

  const messages = []
  for (const file of files) {
    try {
      const sessionFile = resolvePathWithinRoots(path.join(safeSessDir, file), [safeSessDir], { mustExist: true })
      const lines = fsSync.readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const event = JSON.parse(line)
          if (event.type === 'message' && event.role === 'user') {
            const content = typeof event.content === 'string' ? event.content
              : Array.isArray(event.content) ? event.content.filter(c => c.type === 'text').map(c => c.text).join(' ')
              : ''
            if (content.trim()) messages.push(content.trim())
          } else if (event.message?.role === 'user') {
            const content = event.message.content
            const text = typeof content === 'string' ? content
              : Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text).join(' ')
              : ''
            if (text.trim()) messages.push(text.trim())
          }
        } catch {}
      }
    } catch {}
    if (messages.length >= limit) break
  }
  return messages.slice(-limit)
}

// 通过本地 Ollama 分析用户的沟通偏好 → 返回 2-4 条沟通风格观察
async function analyzeWithOllama(messages, agentInfo) {
  const sample = messages.slice(-25).join('\n- ')
  const prompt = `你在帮 AI 助手「${agentInfo.name}」复盘它和用户最近的对话，目的是微调「${agentInfo.name}」的沟通风格，让它更贴合用户的偏好。

下面是用户最近的消息样本：
- ${sample}

请基于样本，总结出 2 到 4 条「${agentInfo.name}」应该调整的沟通风格观察。要求：
- 每条都是具体、可执行的风格建议，不要空泛
- 聚焦：回复详略、语气温度、是否主动建议、表情/语气习惯
- 用中文，每条一句话，像写给助手自己看的备忘

只输出 JSON，格式：{"observations":["观察1","观察2"],"summary":"一句话总结用户的沟通特点"}
不要输出其他内容。`

  try {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma3:12b',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.4, num_predict: 320 },
      }),
      signal: AbortSignal.timeout(40000),
    })
    const data = await resp.json()
    const text = data.message?.content || data.response || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (Array.isArray(parsed.observations) && parsed.observations.length) return parsed
    }
  } catch {}
  return null
}

// 把观察写进 SOUL.md 的带标记区块（替换上一次的，可回退）
function applyEvolutionToSoul(fsSync, agentId, observations, summary) {
  const info = buildAgentMap(fsSync)[agentId]
  if (!info || !fsSync.existsSync(info.soulPath)) return false

  const soulPath = resolvePathWithinRoots(info.soulPath, [info.root], { mustExist: true })
  const original = fsSync.readFileSync(soulPath, 'utf8')
  // 备份
  try {
    ensureDirectoryWithinRoots(BACKUP_DIR, [OPENCLAW_DIR])
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFile = resolvePathWithinRoots(path.join(BACKUP_DIR, `SOUL-${agentId}-${ts}.md`), [BACKUP_DIR])
    safeWriteFileWithinRoots(backupFile, original, [BACKUP_DIR], { encoding: 'utf8', mode: 0o600 })
  } catch {}

  // 移除上一次的演化区块
  const sIdx = original.indexOf(SOUL_MARK_START)
  const eIdx = original.indexOf(SOUL_MARK_END)
  let base = original
  if (sIdx >= 0 && eIdx > sIdx) {
    base = (original.slice(0, sIdx) + original.slice(eIdx + SOUL_MARK_END.length)).trimEnd()
  } else {
    base = original.trimEnd()
  }

  const obsLines = observations.map(o => `- ${o}`).join('\n')
  const block = `

${SOUL_MARK_START}
## 沟通风格 · 近期观察（自动演化，${new Date().toLocaleDateString('zh-CN')}）

基于最近对话，对沟通风格的微调建议：
${obsLines}
${summary ? `\n> 用户沟通特点：${summary}` : ''}

> 这段是系统自动生成的演化观察，可以随时手动修改或整段删除（删 ${SOUL_MARK_START} 到 ${SOUL_MARK_END} 之间即可）
${SOUL_MARK_END}`

  safeWriteFileWithinRoots(soulPath, base + block + '\n', [info.root], { encoding: 'utf8', mode: 0o600 })
  return true
}

// ── HTTP 处理器 ───────────────────────────────────────────────────────────────

export async function handlePersonality(req, res, fsSync) {
  const url = new URL(req.url, 'http://x')
  const pathname = url.pathname
  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
  }

  // GET /api/personality → 所有 agent 概况
  if (req.method === 'GET' && pathname === '/api/personality') {
    const agentMap = buildAgentMap(fsSync)
    const agents = Object.keys(agentMap).map(id => {
      const st = loadState(fsSync, id)
      return {
        agentId: id,
        name: agentMap[id].name,
        lastEvolved: st.lastEvolved,
        observations: st.observations || [],
        soulExists: fsSync.existsSync(agentMap[id].soulPath),
        soulPath: agentMap[id].soulPath,
        currentEvolution: readCurrentEvolution(fsSync, id),
      }
    })
    return json({ ok: true, agents, agentMap })
  }

  // GET /api/personality/:agentId
  if (req.method === 'GET' && pathname.startsWith('/api/personality/') && pathname.split('/').length === 4) {
    const agentId = decodeURIComponent(pathname.split('/')[3])
    const agentMap = buildAgentMap(fsSync)
    if (!agentMap[agentId]) return json({ ok: false, error: 'Agent 不存在' }, 404)
    const st = loadState(fsSync, agentId)
    return json({
      ok: true,
      agentId,
      name: agentMap[agentId].name,
      lastEvolved: st.lastEvolved,
      observations: st.observations || [],
      history: st.history || [],
      soulPath: agentMap[agentId].soulPath,
      currentEvolution: readCurrentEvolution(fsSync, agentId),
    })
  }

  // POST /api/personality/:agentId/evolve → 触发一次演化
  if (req.method === 'POST' && pathname.match(/^\/api\/personality\/[^/]+\/evolve$/)) {
    const agentId = decodeURIComponent(pathname.split('/')[3])
    const agentMap = buildAgentMap(fsSync)
    if (!agentMap[agentId]) return json({ ok: false, error: 'Agent 不存在' }, 404)
    if (!fsSync.existsSync(agentMap[agentId].soulPath)) {
      return json({ ok: false, error: `找不到 ${agentMap[agentId].name} 的 SOUL.md` })
    }

    const messages = readRecentUserMessages(fsSync, agentId, 50)
    if (messages.length < 3) {
      return json({ ok: false, error: `对话样本不足（当前 ${messages.length} 条，至少需要 3 条）` })
    }

    const result = await analyzeWithOllama(messages, agentMap[agentId])
    if (!result) {
      return json({ ok: false, error: 'Ollama 分析失败，请检查 gemma3:12b 是否在运行' })
    }

    const applied = applyEvolutionToSoul(fsSync, agentId, result.observations, result.summary)

    const st = loadState(fsSync, agentId)
    st.lastEvolved = new Date().toISOString()
    st.observations = result.observations
    st.history = [...(st.history || []).slice(-9), {
      ts: st.lastEvolved,
      observations: result.observations,
      summary: result.summary || '',
      sampleCount: messages.length,
    }]
    saveState(fsSync, st)

    return json({
      ok: true,
      agentId,
      name: agentMap[agentId].name,
      observations: result.observations,
      summary: result.summary || '',
      soulUpdated: applied,
      sampleCount: messages.length,
    })
  }

  json({ ok: false, error: 'Not found' }, 404)
}
