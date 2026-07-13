import fs from 'node:fs'
import path from 'node:path'

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function boundaryError(label, detail) {
  const suffix = detail ? `：${detail}` : ''
  return new Error(`${label}无法通过测试隔离物理路径边界校验${suffix}`)
}

function snapshotEnvironment(baseEnv, overrides) {
  const snapshot = Object.create(null)
  for (const source of [baseEnv, overrides]) {
    if (!source || (typeof source !== 'object' && typeof source !== 'function')) continue
    for (const key of Object.keys(source)) snapshot[key] = source[key]
  }
  return snapshot
}

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null
}

function validateIsolationRoot(input) {
  if (!input || !path.isAbsolute(input)) throw new Error('测试 isolationRoot 必须是绝对路径')
  const lexical = path.resolve(input)
  let stat
  try {
    stat = fs.lstatSync(lexical)
  } catch (error) {
    throw boundaryError('测试 isolationRoot', error?.code === 'ENOENT' ? '目录必须由调用方预先创建' : error?.message)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw boundaryError('测试 isolationRoot', '必须是已存在且最终项不是符号链接的目录')
  }
  const uid = currentUid()
  if (uid !== null && stat.uid !== uid) throw boundaryError('测试 isolationRoot', '目录不属于当前用户')
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700) {
    throw boundaryError('测试 isolationRoot', '目录权限必须为 0700')
  }
  let physical
  try {
    physical = fs.realpathSync(lexical)
  } catch (error) {
    throw boundaryError('测试 isolationRoot', error?.message)
  }
  return { lexical, physical, stat }
}

function inspectPathWithinAnchor(target, anchor, {
  label,
  mustExist = false,
  existingType = 'directory',
} = {}) {
  if (!target || !path.isAbsolute(target)) throw new Error(`${label}必须是绝对路径`)
  const lexical = path.resolve(target)
  if (!isInside(anchor.lexical, lexical)) throw boundaryError(label, '词法路径位于 isolationRoot 外')

  const relative = path.relative(anchor.lexical, lexical)
  const segments = relative === '' ? [] : relative.split(path.sep)
  let currentLexical = anchor.lexical
  let currentPhysical = anchor.physical

  if (segments.length === 0) {
    if (existingType === 'file') throw boundaryError(label, '目标必须是普通文件')
    return { lexical, physical: anchor.physical, exists: true, stat: anchor.stat }
  }

  for (let index = 0; index < segments.length; index += 1) {
    currentLexical = path.join(currentLexical, segments[index])
    const isFinal = index === segments.length - 1
    let stat
    try {
      stat = fs.lstatSync(currentLexical)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw boundaryError(label, error?.message)
      if (mustExist) throw boundaryError(label, '目标必须由调用方预先创建')
      const projected = path.resolve(currentPhysical, ...segments.slice(index))
      if (!isInside(anchor.physical, projected)) throw boundaryError(label, '不存在路径的物理投影位于 isolationRoot 外')
      return { lexical, physical: projected, exists: false, stat: null }
    }

    if (stat.isSymbolicLink()) throw boundaryError(label, '路径包含符号链接')
    if (!isFinal && !stat.isDirectory()) throw boundaryError(label, '中间祖先不是目录')
    if (isFinal && existingType === 'directory' && !stat.isDirectory()) {
      throw boundaryError(label, '目标不是目录')
    }
    if (isFinal && existingType === 'file' && !stat.isFile()) {
      throw boundaryError(label, '目标不是普通文件')
    }

    try {
      currentPhysical = fs.realpathSync(currentLexical)
    } catch (error) {
      throw boundaryError(label, error?.message)
    }
    if (!isInside(anchor.physical, currentPhysical)) throw boundaryError(label, '真实路径位于 isolationRoot 外')
    if (isFinal) return { lexical, physical: currentPhysical, exists: true, stat }
  }

  throw boundaryError(label, '无法解析路径')
}

function assertInsidePhysical(parent, candidate, label) {
  if (!isInside(parent, candidate)) throw boundaryError(label, '真实路径越过父级边界')
}

function validateStableDataRoots(home, anchor) {
  for (const name of ['.openclaw', '.codex', '.claude']) {
    const info = inspectPathWithinAnchor(path.join(home.lexical, name), anchor, {
      label: `稳定测试数据根 ${name}`,
      existingType: 'directory',
    })
    assertInsidePhysical(home.physical, info.physical, `稳定测试数据根 ${name}`)
  }
}

function validateLocalToken(token, workbench, anchor) {
  const info = inspectPathWithinAnchor(token, anchor, {
    label: '隔离工作台本地 token',
    existingType: 'file',
  })
  assertInsidePhysical(workbench.physical, info.physical, '隔离工作台本地 token')
  if (!info.exists) return info

  const uid = currentUid()
  if (uid !== null && info.stat.uid !== uid) throw boundaryError('隔离工作台本地 token', '文件不属于当前用户')
  if (info.stat.nlink !== 1) throw boundaryError('隔离工作台本地 token', '文件存在多个硬链接')
  return info
}

// This helper fences test HOME, stable client data roots, and AI Workbench path
// variables against inherited path pollution and pre-existing links beneath a
// caller-created random 0700 isolation root. It does not claim to defeat a
// malicious same-UID process that swaps filesystem entries after this preflight
// (TOCTOU); stronger guarantees require handle-based or OS-level isolation.
// Individual tests remain responsible for other OPENCLAW_* and VITE_* variables.
export function createIsolatedProcessEnv(options = {}) {
  const baseEnv = options.baseEnv ?? process.env
  const overrides = options.overrides ?? {}
  const environment = snapshotEnvironment(baseEnv, overrides)

  const isolationRoot = options.isolationRoot
  const homeDir = options.homeDir
  const workbenchRoot = options.workbenchRoot
  const localTokenFile = options.localTokenFile

  const anchor = validateIsolationRoot(isolationRoot)
  const home = inspectPathWithinAnchor(homeDir, anchor, {
    label: '隔离测试 HOME',
    mustExist: true,
    existingType: 'directory',
  })
  validateStableDataRoots(home, anchor)

  const normalizedRoot = path.resolve(workbenchRoot || path.join(home.lexical, '.ai-workbench-test'))
  if (!isInside(home.lexical, normalizedRoot)) throw boundaryError('隔离工作台根目录', '路径必须位于测试 HOME 内')
  const workbench = inspectPathWithinAnchor(normalizedRoot, anchor, {
    label: '隔离工作台根目录',
    existingType: 'directory',
  })
  assertInsidePhysical(home.physical, workbench.physical, '隔离工作台根目录')

  const normalizedToken = path.resolve(localTokenFile || path.join(workbench.lexical, 'secrets', 'dashboard-local-token'))
  if (!isInside(workbench.lexical, normalizedToken)) {
    throw boundaryError('隔离工作台本地 token', '路径必须位于隔离工作台根目录内')
  }
  validateLocalToken(normalizedToken, workbench, anchor)

  environment.HOME = home.lexical
  environment.USERPROFILE = home.lexical
  environment.AI_WORKBENCH_HOME = workbench.lexical
  environment.AI_WORKBENCH_LOCAL_TOKEN_FILE = normalizedToken
  environment.OPENCLAW_SKIP_DOTENV = '1'
  return environment
}
