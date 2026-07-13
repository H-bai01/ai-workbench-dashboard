import fs from 'node:fs'
import path from 'node:path'

function isInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function hasTraversalSegment(value) {
  return String(value || '').split(/[\\/]+/).some(segment => segment === '..')
}

function rootDescriptors(roots) {
  const descriptors = []
  for (const root of roots || []) {
    if (typeof root !== 'string' || !root.trim()) continue
    const input = path.resolve(root)
    let stat
    try { stat = fs.lstatSync(input) } catch { continue }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) continue
    const real = fs.realpathSync.native(input)
    const realStat = fs.lstatSync(real)
    if (!realStat.isDirectory()) continue
    if (!descriptors.some(item => item.real === real)) descriptors.push({ input, real })
  }
  return descriptors
}

function lstatIfPresent(value) {
  try {
    return fs.lstatSync(value)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function assertNoSymlinkSegments(root, relative) {
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = lstatIfPresent(current)
    if (!stat) continue
    if (stat.isSymbolicLink()) throw new Error('路径包含不允许的符号链接')
  }
}

function candidateForRoot(absolute, descriptor) {
  const base = isInside(absolute, descriptor.input)
    ? descriptor.input
    : (isInside(absolute, descriptor.real) ? descriptor.real : '')
  if (!base) return null
  const relative = path.relative(base, absolute)
  assertNoSymlinkSegments(descriptor.real, relative)
  return path.resolve(descriptor.real, relative)
}

export function resolvePathWithinRoots(candidate, roots, { mustExist = false } = {}) {
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.includes('\0')) throw new Error('路径格式无效')
  if (hasTraversalSegment(candidate)) throw new Error('路径包含禁止的 .. 段')
  const descriptors = rootDescriptors(roots)
  if (descriptors.length === 0) throw new Error('没有可用的文件根目录')

  const absolute = path.resolve(candidate)
  for (const descriptor of descriptors) {
    const resolved = candidateForRoot(absolute, descriptor)
    if (!resolved) continue
    const stat = lstatIfPresent(resolved)
    if (mustExist && !stat) throw new Error('路径不存在')
    if (stat?.isSymbolicLink()) throw new Error('路径包含不允许的符号链接')
    return resolved
  }

  throw new Error('路径超出允许范围')
}

export function ensureDirectoryWithinRoots(candidate, roots, { mode = 0o700 } = {}) {
  const target = resolvePathWithinRoots(candidate, roots)
  const descriptors = rootDescriptors(roots)
  const root = descriptors.map(item => item.real).find(item => isInside(target, item))
  if (!root) throw new Error('目录超出允许范围')
  const relative = path.relative(root, target)
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    let stat = lstatIfPresent(current)
    if (!stat) {
      fs.mkdirSync(current, { mode })
      stat = fs.lstatSync(current)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('目录路径包含符号链接或非目录项')
  }
  return resolvePathWithinRoots(target, roots, { mustExist: true })
}

export function safeWriteFileWithinRoots(candidate, data, roots, {
  encoding,
  mode = 0o600,
  createParents = false,
} = {}) {
  const target = resolvePathWithinRoots(candidate, roots)
  const parent = path.dirname(target)
  if (createParents) ensureDirectoryWithinRoots(parent, roots)
  else resolvePathWithinRoots(parent, roots, { mustExist: true })

  const existing = lstatIfPresent(target)
  if (existing?.isSymbolicLink()) throw new Error('目标文件不能是符号链接')
  if (existing && !existing.isFile()) throw new Error('目标必须是普通文件')
  resolvePathWithinRoots(parent, roots, { mustExist: true })

  const noFollow = fs.constants.O_NOFOLLOW || 0
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | noFollow, mode)
  try {
    fs.writeFileSync(fd, data, encoding ? { encoding } : undefined)
  } finally {
    fs.closeSync(fd)
  }
  return resolvePathWithinRoots(target, roots, { mustExist: true })
}

export function safeAtomicWriteFileWithinRoots(candidate, data, roots, { encoding = 'utf8', mode = 0o600 } = {}) {
  const target = resolvePathWithinRoots(candidate, roots)
  const parent = resolvePathWithinRoots(path.dirname(target), roots, { mustExist: true })
  const tempName = `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`
  const tempPath = path.join(parent, tempName)
  const noFollow = fs.constants.O_NOFOLLOW || 0
  const fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, mode)
  try {
    fs.writeFileSync(fd, data, { encoding })
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
    resolvePathWithinRoots(parent, roots, { mustExist: true })
    const existing = lstatIfPresent(target)
    if (existing?.isSymbolicLink()) throw new Error('目标文件不能是符号链接')
    fs.renameSync(tempPath, target)
  } catch (error) {
    try { fs.unlinkSync(tempPath) } catch { /* best effort */ }
    throw error
  }
  return resolvePathWithinRoots(target, roots, { mustExist: true })
}

export function canonicalizeRoots(roots) {
  return rootDescriptors(roots).map(item => item.real)
}
