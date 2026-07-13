/**
 * 记忆树模块（直接读写龙虾真正的 MEMORY.md）
 * - MEMORY.md 本身就是一棵树：## = 主干, ### = 分支, - = 叶子
 * - 本模块解析它用于可视化展示，并支持「外科手术式」插入新记忆（不重写整份文件，避免破坏表格/链接）
 * - 每次写入前自动备份到 ~/.openclaw/backups/MEMORY-{时间戳}.md
 * 默认读取 OpenClaw 配置中的主工作空间 MEMORY.md；兼容旧版 ~/clawd/MEMORY.md
 */

import path from 'path'
import os from 'os'
import { ensureDirectoryWithinRoots, resolvePathWithinRoots, safeWriteFileWithinRoots } from './security/path-boundary.mjs'

const HOME = os.homedir()
const OPENCLAW_DIR = path.join(HOME, '.openclaw')
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json')
const BACKUP_DIR = path.join(HOME, '.openclaw', 'backups')

function expandHome(value) {
  const text = String(value || '').trim()
  if (text === '~') return HOME
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(HOME, text.slice(2))
  return text
}

function readOpenClawConfig(fsSync) {
  try {
    return JSON.parse(fsSync.readFileSync(OPENCLAW_CONFIG, 'utf8'))
  } catch {
    return {}
  }
}

function resolveMemoryFile(fsSync) {
  const cfg = readOpenClawConfig(fsSync)
  const candidates = []
  if (cfg?.agents?.defaults?.workspace) {
    const root = expandHome(cfg.agents.defaults.workspace)
    candidates.push({ root, file: path.join(root, 'MEMORY.md') })
  }
  for (const agent of Array.isArray(cfg?.agents?.list) ? cfg.agents.list : []) {
    if (agent?.workspace) {
      const root = expandHome(agent.workspace)
      candidates.push({ root, file: path.join(root, 'MEMORY.md') })
    }
  }
  candidates.push({ root: path.join(HOME, 'clawd'), file: path.join(HOME, 'clawd', 'MEMORY.md') })
  candidates.push({ root: OPENCLAW_DIR, file: path.join(OPENCLAW_DIR, 'MEMORY.md') })

  for (const candidate of candidates) {
    let entryExists = false
    try {
      fsSync.lstatSync(candidate.file)
      entryExists = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (entryExists) {
      return resolvePathWithinRoots(candidate.file, [candidate.root], { mustExist: true })
    }
  }
  for (const candidate of candidates) {
    if (!fsSync.existsSync(candidate.root)) continue
    resolvePathWithinRoots(candidate.root, [path.dirname(candidate.root)], { mustExist: true })
    return resolvePathWithinRoots(candidate.file, [candidate.root])
  }
  throw new Error('没有可用的 MEMORY.md 根目录')
}

function readMemory(fsSync) {
  const memoryFile = resolveMemoryFile(fsSync)
  try {
    return fsSync.readFileSync(memoryFile, 'utf8')
  } catch {
    return ''
  }
}

function backup(fsSync, content) {
  try {
    ensureDirectoryWithinRoots(BACKUP_DIR, [OPENCLAW_DIR])
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFile = resolvePathWithinRoots(path.join(BACKUP_DIR, `MEMORY-${ts}.md`), [BACKUP_DIR])
    safeWriteFileWithinRoots(backupFile, content, [BACKUP_DIR], { encoding: 'utf8', mode: 0o600 })
  } catch {}
}

// 把 MEMORY.md 解析成 trunk / branch / leaf 树（用于展示）
function parseTree(content) {
  const lines = content.split('\n')
  const nodes = []
  let id = 0
  let lastTrunk = null
  let lastBranch = null

  lines.forEach((line, idx) => {
    const trunkM = line.match(/^##\s+(.+)/)
    const branchM = line.match(/^###\s+(.+)/)
    const leafM = line.match(/^[-*]\s+(.+)/)

    if (trunkM) {
      const node = { id: ++id, line: idx, content: trunkM[1].trim(), type: 'trunk', parentId: null }
      nodes.push(node)
      lastTrunk = node
      lastBranch = null
    } else if (branchM) {
      const node = { id: ++id, line: idx, content: branchM[1].trim(), type: 'branch', parentId: lastTrunk?.id ?? null }
      nodes.push(node)
      lastBranch = node
    } else if (leafM) {
      const parent = lastBranch || lastTrunk
      // 只收一级列表项（开头无缩进），嵌套的子项归入上一个叶子文本里太碎，这里只展示顶层叶子
      if (!/^\s/.test(line)) {
        nodes.push({ id: ++id, line: idx, content: leafM[1].trim().slice(0, 120), type: 'leaf', parentId: parent?.id ?? null })
      }
    }
  })
  return nodes
}

// 找某个标题所在 section 的「结束行」（下一个同级或更高级标题前），用于在末尾插入
function findSectionEnd(lines, headingLine, headingLevel) {
  for (let i = headingLine + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,3})\s+/)
    if (m && m[1].length <= headingLevel) return i
  }
  return lines.length
}

function buildResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

// ── HTTP 路由处理 ────────────────────────────────────────────────────────────

export function handleMemoryTree(req, res, fsSync) {
  const url = new URL(req.url, 'http://x')
  const pathname = url.pathname

  // GET /api/memory-tree → 解析 MEMORY.md 返回树
  if (req.method === 'GET' && pathname === '/api/memory-tree') {
    try {
      const memoryFile = resolveMemoryFile(fsSync)
      const content = readMemory(fsSync)
      const nodes = parseTree(content)
      return buildResponse(res, { ok: true, nodes, file: memoryFile, exists: !!content })
    } catch (error) {
      return buildResponse(res, { ok: false, nodes: [], file: '', exists: false, error: error.message }, 400)
    }
  }

  // POST /api/memory-tree → 插入新记忆（外科手术式，不重写全文）
  // body: { content, type: 'trunk'|'branch'|'leaf', parentContent? }
  if (req.method === 'POST' && pathname === '/api/memory-tree') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { content: text, type = 'leaf', parentContent = null } = JSON.parse(body)
        if (!text?.trim()) return buildResponse(res, { ok: false, error: '内容不能为空' }, 400)

        const memoryFile = resolveMemoryFile(fsSync)
        const original = readMemory(fsSync)
        const lines = original.split('\n')
        const clean = text.trim()
        resolvePathWithinRoots(path.dirname(memoryFile), [path.dirname(memoryFile)], { mustExist: true })

        if (type === 'trunk') {
          // 新主干 → 追加到文件末尾
          const block = `\n## ${clean}\n`
          backup(fsSync, original)
          safeWriteFileWithinRoots(memoryFile, original.replace(/\n*$/, '') + '\n' + block, [path.dirname(memoryFile)], { encoding: 'utf8', mode: 0o600 })
          return buildResponse(res, { ok: true, inserted: `## ${clean}`, mode: 'trunk-append' })
        }

        // branch / leaf 都需要父标题定位
        if (!parentContent) {
          return buildResponse(res, { ok: false, error: `新建${type === 'branch' ? '分支' : '叶子'}需要选择父节点` }, 400)
        }
        // 找父标题行
        const pIdx = lines.findIndex(l => {
          const m = l.match(/^(#{2,3})\s+(.+)/)
          return m && m[2].trim() === parentContent.trim()
        })
        if (pIdx === -1) {
          return buildResponse(res, { ok: false, error: `没找到父节点「${parentContent}」` }, 404)
        }
        const pLevel = lines[pIdx].match(/^(#{2,3})/)[1].length

        // 在父 section 末尾（下一个同级/更高级标题前、跳过尾部空行）插入
        const end = findSectionEnd(lines, pIdx, pLevel)
        let ins = end
        while (ins > pIdx + 1 && lines[ins - 1].trim() === '') ins--

        if (type === 'branch') {
          lines.splice(ins, 0, '', `### ${clean}`)
          backup(fsSync, original)
          safeWriteFileWithinRoots(memoryFile, lines.join('\n'), [path.dirname(memoryFile)], { encoding: 'utf8', mode: 0o600 })
          return buildResponse(res, { ok: true, inserted: `### ${clean}`, parent: parentContent, mode: 'branch-insert' })
        } else {
          lines.splice(ins, 0, `- ${clean}`)
          backup(fsSync, original)
          safeWriteFileWithinRoots(memoryFile, lines.join('\n'), [path.dirname(memoryFile)], { encoding: 'utf8', mode: 0o600 })
          return buildResponse(res, { ok: true, inserted: `- ${clean}`, parent: parentContent, mode: 'leaf-insert' })
        }
      } catch (e) {
        buildResponse(res, { ok: false, error: e.message }, 400)
      }
    })
    return
  }

  buildResponse(res, { ok: false, error: 'Not found' }, 404)
}
