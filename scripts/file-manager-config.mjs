import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const FILE_MANAGER_CONFIG_NAME = 'dashboard-file-manager.json'

function expandHome(value, homeDir) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text === '~') return homeDir
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(homeDir, text.slice(2))
  return text
}

export function resolveOpenClawLocations({ env = process.env, homeDir = os.homedir() } = {}) {
  const resolvedHome = path.resolve(homeDir)
  const explicitStateDir = expandHome(env.OPENCLAW_STATE_DIR, resolvedHome)
  const explicitConfigPath = expandHome(env.OPENCLAW_CONFIG_PATH, resolvedHome)
  const stateDir = path.resolve(explicitStateDir || (explicitConfigPath ? path.dirname(explicitConfigPath) : path.join(resolvedHome, '.openclaw')))
  const configPath = path.resolve(explicitConfigPath || path.join(stateDir, 'openclaw.json'))
  return { homeDir: resolvedHome, stateDir, configPath }
}

function realDirectory(value) {
  const absolute = path.resolve(String(value || ''))
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('选择的路径必须是真实目录')
  return fs.realpathSync.native(absolute)
}

function configPathForStateDir(stateDir) {
  return path.join(path.resolve(stateDir), FILE_MANAGER_CONFIG_NAME)
}

export function readManualFileRoots({ stateDir } = {}) {
  if (!stateDir) return []
  const configPath = configPathForStateDir(stateDir)
  try {
    const stat = fs.lstatSync(configPath)
    if (stat.isSymbolicLink() || !stat.isFile()) return []
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.roots)) return []
    const roots = []
    for (const value of parsed.roots) {
      try {
        const real = realDirectory(value)
        if (!roots.includes(real)) roots.push(real)
      } catch { /* missing or unsafe manual root */ }
    }
    return roots
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    return []
  }
}

export function writeManualFileRoots({ stateDir, roots } = {}) {
  if (!stateDir) throw new Error('OpenClaw 数据目录不可用')
  const absoluteStateDir = path.resolve(stateDir)
  fs.mkdirSync(absoluteStateDir, { recursive: true, mode: 0o700 })
  const stateStat = fs.lstatSync(absoluteStateDir)
  if (stateStat.isSymbolicLink() || !stateStat.isDirectory()) throw new Error('OpenClaw 数据目录无效')

  const normalized = []
  for (const value of Array.isArray(roots) ? roots : []) {
    const real = realDirectory(value)
    if (!normalized.includes(real)) normalized.push(real)
  }

  const configPath = configPathForStateDir(absoluteStateDir)
  try {
    const existing = fs.lstatSync(configPath)
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error('文件管理配置必须是普通文件')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`
  const payload = `${JSON.stringify({ schemaVersion: 1, roots: normalized }, null, 2)}\n`
  const fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)
  try {
    fs.writeFileSync(fd, payload, 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tempPath, configPath)
  fs.chmodSync(configPath, 0o600)
  return normalized
}

function shortLabel(value, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return (text || fallback).slice(0, 120)
}

function normalizeWorkspaceSource(value = {}) {
  const toolId = shortLabel(value.toolId, 'ai-tool').toLowerCase()
  const toolName = shortLabel(value.toolName, 'AI 工具')
  const contextId = shortLabel(value.contextId)
  const contextName = shortLabel(value.contextName)
  return {
    toolId,
    toolName,
    contextId,
    contextName,
    contextType: value.contextType === 'agent' ? 'agent' : 'project',
  }
}

/**
 * 文件管理只消费统一的 AI 工作目录记录，不感知具体 AI 产品。
 * aiWorkspaces: [{ path, toolId, toolName, contextId?, contextName?, contextType? }]
 */
export function discoverFileManagerRoots({ aiWorkspaces = [], manualRoots = [], agents = [] } = {}) {
  const records = []
  const byPath = new Map()
  const addAiWorkspace = (candidate) => {
    try {
      const alias = path.resolve(String(candidate.path || ''))
      const real = realDirectory(candidate.path)
      const source = normalizeWorkspaceSource(candidate)
      let record = byPath.get(real)
      if (!record) {
        record = {
          id: `ai:${real}`,
          name: path.basename(real) || source.contextName || source.toolName,
          source: 'ai',
          path: real,
          aliases: [],
          sources: [],
        }
        byPath.set(real, record)
        records.push(record)
      }
      const sourceKey = `${source.toolId}\0${source.contextId}\0${source.contextType}`
      if (!record.sources.some(existing => (
        `${existing.toolId}\0${existing.contextId}\0${existing.contextType}` === sourceKey
      ))) {
        record.sources.push(source)
      }
      if (alias !== real && !record.aliases.includes(alias)) record.aliases.push(alias)
    } catch { /* absent or unsafe root */ }
  }

  // 兼容旧调用方，但立即转换为统一 AI 工作目录协议。
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (!agent?.workspace) continue
    addAiWorkspace({
      path: agent.workspace,
      toolId: 'openclaw',
      toolName: 'OpenClaw',
      contextId: agent.id,
      contextName: agent.name || agent.id,
      contextType: 'agent',
    })
  }

  for (const workspace of Array.isArray(aiWorkspaces) ? aiWorkspaces : []) {
    if (!workspace?.path) continue
    addAiWorkspace(workspace)
  }

  for (const manualRoot of Array.isArray(manualRoots) ? manualRoots : []) {
    try {
      const real = realDirectory(manualRoot)
      if (byPath.has(real)) continue
      const record = {
        id: `manual:${real}`,
        name: path.basename(real) || '手动目录',
        source: 'manual',
        path: real,
        aliases: path.resolve(String(manualRoot || '')) === real ? [] : [path.resolve(String(manualRoot || ''))],
        sources: [],
      }
      byPath.set(real, record)
      records.push(record)
    } catch { /* absent or unsafe root */ }
  }
  return records
}

export function validateFileName(value) {
  const name = String(value || '').trim()
  if (!name || name === '.' || name === '..') throw new Error('名称不能为空')
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) throw new Error('名称不能包含路径分隔符')
  return name
}

export function pickerCommand(platform = process.platform, kind = 'folder') {
  if (platform === 'darwin') {
    const script = kind === 'file'
      ? 'POSIX path of (choose file with prompt "选择替换文件")'
      : 'POSIX path of (choose folder with prompt "选择文件管理目录")'
    return { command: 'osascript', args: ['-e', script] }
  }
  if (platform === 'win32') {
    if (kind === 'file') {
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){$d.FileName}else{exit 2}'],
      }
    }
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){$d.SelectedPath}else{exit 2}'],
    }
  }
  return {
    command: 'zenity',
    args: kind === 'file' ? ['--file-selection', '--title=选择替换文件'] : ['--file-selection', '--directory', '--title=选择文件管理目录'],
  }
}
