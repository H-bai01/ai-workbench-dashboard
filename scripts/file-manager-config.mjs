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

const EXACT_FILE_DESCRIPTIONS = new Map([
  ['agents.md', 'AI 在这个目录中遵循的工作规则和协作说明'],
  ['claude.md', 'Claude Code 在这个项目中读取的工作说明'],
  ['gemini.md', 'Gemini CLI 在这个项目中读取的工作说明'],
  ['identity.md', 'AI 助手的身份、名称和角色信息'],
  ['soul.md', 'AI 助手的核心原则和行为风格'],
  ['user.md', 'AI 助手使用的用户偏好和背景说明'],
  ['memory.md', 'AI 助手保存的长期记忆'],
  ['heartbeat.md', 'AI 助手定期检查的事项或待办说明'],
  ['tools.md', 'AI 助手可使用的工具和注意事项'],
  ['readme.md', '项目介绍、安装方法或使用说明'],
  ['readme', '项目介绍、安装方法或使用说明'],
  ['changelog.md', '项目版本更新记录'],
  ['license', '项目许可证和使用条件'],
  ['license.md', '项目许可证和使用条件'],
  ['notice', '第三方来源、版权或使用通知'],
  ['notice.md', '第三方来源、版权或使用通知'],
  ['package.json', 'Node.js 项目信息、运行命令和依赖配置'],
  ['package-lock.json', '锁定 Node.js 依赖的准确版本，保证安装结果一致'],
  ['pyproject.toml', 'Python 项目、工具和依赖配置'],
  ['requirements.txt', 'Python 项目需要安装的依赖列表'],
  ['cargo.toml', 'Rust 项目和依赖配置'],
  ['go.mod', 'Go 项目模块和依赖配置'],
  ['dockerfile', '用于构建 Docker 运行环境'],
  ['docker-compose.yml', '多个 Docker 服务的组合运行配置'],
  ['docker-compose.yaml', '多个 Docker 服务的组合运行配置'],
  ['.gitignore', '指定哪些文件不进入 Git 版本记录'],
  ['.env', '项目运行环境配置，可能包含本机地址或敏感信息'],
  ['.env.example', '环境配置示例，用于说明部署时需要填写的项目'],
  ['openclaw.json', 'OpenClaw 的本机配置'],
])

const DIRECTORY_DESCRIPTIONS = new Map([
  ['.git', 'Git 版本历史和仓库状态数据'],
  ['.github', 'GitHub 自动化流程和仓库配置'],
  ['.vscode', 'Visual Studio Code 的项目设置'],
  ['.idea', 'JetBrains 系列编辑器的项目设置'],
  ['.openclaw', 'OpenClaw 的本机状态和配置目录'],
  ['.codex', 'Codex 的本机状态和会话目录'],
  ['.claude', 'Claude Code 的本机状态和会话目录'],
  ['src', '项目的主要源代码'],
  ['source', '项目的主要源代码'],
  ['app', '应用程序的主要代码'],
  ['public', '网页可直接使用的公共静态资源'],
  ['static', '图片、字体等静态资源'],
  ['assets', '项目使用的图片、图标、字体等资源'],
  ['docs', '项目说明和使用文档'],
  ['documentation', '项目说明和使用文档'],
  ['test', '自动测试代码和测试数据'],
  ['tests', '自动测试代码和测试数据'],
  ['__tests__', '自动测试代码和测试数据'],
  ['scripts', '开发、构建、测试或运维脚本'],
  ['bin', '可直接运行的命令或脚本'],
  ['config', '项目配置文件'],
  ['configs', '项目配置文件'],
  ['data', '项目使用或生成的数据'],
  ['logs', '程序运行日志'],
  ['log', '程序运行日志'],
  ['memory', 'AI 助手的记忆资料'],
  ['memories', 'AI 助手的记忆资料'],
  ['sessions', 'AI 会话或执行记录'],
  ['skills', 'AI 工具或助手使用的技能'],
  ['uploads', '用户上传或替换的文件'],
  ['backups', '项目或数据的备份'],
  ['node_modules', 'Node.js 已安装依赖，通常不需要手动修改'],
  ['dist', '项目构建后生成的发布文件'],
  ['build', '项目构建后生成的文件'],
  ['out', '程序生成的输出文件'],
])

const EXTENSION_DESCRIPTIONS = new Map([
  ['.md', 'Markdown 文档，通常用于说明、记录或工作指令'],
  ['.txt', '普通文本文件'],
  ['.json', '结构化配置或数据文件'],
  ['.jsonl', '按行记录的结构化数据，常用于会话或事件记录'],
  ['.yaml', 'YAML 配置文件'],
  ['.yml', 'YAML 配置文件'],
  ['.toml', 'TOML 配置文件'],
  ['.ini', '程序配置文件'],
  ['.conf', '程序配置文件'],
  ['.config', '程序配置文件'],
  ['.js', 'JavaScript 源代码'],
  ['.mjs', 'JavaScript 模块源代码'],
  ['.cjs', 'CommonJS 模块源代码'],
  ['.ts', 'TypeScript 源代码'],
  ['.tsx', 'TypeScript 界面组件源代码'],
  ['.jsx', 'JavaScript 界面组件源代码'],
  ['.vue', 'Vue 界面组件源代码'],
  ['.py', 'Python 源代码或脚本'],
  ['.sh', 'Shell 命令脚本'],
  ['.zsh', 'Zsh 命令脚本'],
  ['.bash', 'Bash 命令脚本'],
  ['.ps1', 'PowerShell 命令脚本'],
  ['.bat', 'Windows 批处理脚本'],
  ['.cmd', 'Windows 命令脚本'],
  ['.html', '网页页面文件'],
  ['.css', '网页样式文件'],
  ['.scss', '网页样式源文件'],
  ['.less', '网页样式源文件'],
  ['.png', 'PNG 图片'],
  ['.jpg', 'JPEG 图片'],
  ['.jpeg', 'JPEG 图片'],
  ['.webp', 'WebP 图片'],
  ['.gif', 'GIF 图片或动画'],
  ['.svg', 'SVG 矢量图片'],
  ['.mp4', '视频文件，可使用系统程序打开'],
  ['.mov', '视频文件，可使用系统程序打开'],
  ['.webm', '视频文件，可使用系统程序打开'],
  ['.mp3', '音频文件，可使用系统程序打开'],
  ['.wav', '音频文件，可使用系统程序打开'],
  ['.zip', '压缩包，可使用系统程序打开'],
  ['.tar', '归档文件，可使用系统程序打开'],
  ['.gz', '压缩文件，可使用系统程序打开'],
  ['.7z', '压缩包，可使用系统程序打开'],
  ['.rar', '压缩包，可使用系统程序打开'],
  ['.pdf', 'PDF 文档，可预览或使用系统程序打开'],
  ['.doc', 'Word 文档，可使用系统程序打开'],
  ['.docx', 'Word 文档，可使用系统程序打开'],
  ['.xls', 'Excel 表格，可使用系统程序打开'],
  ['.xlsx', 'Excel 表格，可使用系统程序打开'],
  ['.csv', '表格数据文件'],
  ['.tsv', '制表符分隔的表格数据'],
  ['.ppt', 'PowerPoint 演示文稿，可使用系统程序打开'],
  ['.pptx', 'PowerPoint 演示文稿，可使用系统程序打开'],
  ['.db', '数据库文件，不在工作台中直接编辑'],
  ['.sqlite', 'SQLite 数据库文件，不在工作台中直接编辑'],
  ['.sqlite3', 'SQLite 数据库文件，不在工作台中直接编辑'],
  ['.sql', '数据库查询或结构脚本'],
  ['.log', '程序运行日志'],
  ['.lock', '依赖或进程状态锁定文件'],
  ['.pem', '证书或密钥文件，可能包含敏感信息'],
  ['.key', '密钥文件，属于敏感信息'],
  ['.crt', '数字证书文件'],
  ['.cer', '数字证书文件'],
])

export function describeManagedEntry({ name, isDir = false } = {}) {
  const fileName = String(name || '').trim()
  const lowerName = fileName.toLowerCase()
  if (!fileName) return isDir ? '项目目录' : '项目文件'
  if (isDir) return DIRECTORY_DESCRIPTIONS.get(lowerName) || '项目子目录；进入后可查看其中的文件'
  const exact = EXACT_FILE_DESCRIPTIONS.get(lowerName)
  if (exact) return exact
  return EXTENSION_DESCRIPTIONS.get(path.extname(lowerName)) || '项目文件；具体用途需结合所属项目确认'
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
