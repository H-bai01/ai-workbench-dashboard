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

export function discoverFileManagerRoots({ agents = [], manualRoots = [] } = {}) {
  const records = []
  const seen = new Set()
  const add = (candidate, record) => {
    try {
      const real = realDirectory(candidate)
      if (seen.has(real)) return
      seen.add(real)
      records.push({ ...record, path: real })
    } catch { /* absent or unsafe root */ }
  }

  for (const agent of Array.isArray(agents) ? agents : []) {
    if (!agent?.workspace) continue
    add(agent.workspace, {
      id: `agent:${String(agent.id || agent.name || 'unknown')}`,
      name: String(agent.name || agent.id || 'Agent 工作目录'),
      source: 'agent',
      agentId: String(agent.id || ''),
    })
  }
  for (const manualRoot of Array.isArray(manualRoots) ? manualRoots : []) {
    add(manualRoot, {
      id: `manual:${records.length}`,
      name: path.basename(String(manualRoot)) || '手动目录',
      source: 'manual',
      agentId: '',
    })
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
