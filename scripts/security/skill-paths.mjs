import fs from 'node:fs'
import path from 'node:path'
import { resolvePathWithinRoots } from './path-boundary.mjs'

function assertDirectory(value, label) {
  const stat = fs.lstatSync(value)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label}必须是无符号链接的真实目录`)
  return value
}

export function resolveNoSymlinkDirectory(candidate, label = '技能根目录') {
  const absolute = path.resolve(String(candidate || ''))
  assertDirectory(absolute, label)
  return assertDirectory(fs.realpathSync.native(absolute), label)
}

export function managedSkillParents(homeDir, extraRoots = []) {
  const candidates = [
    path.join(homeDir, '.openclaw', 'skills'),
    path.join(homeDir, '.openclaw', 'plugin-skills'),
    ...extraRoots,
  ]
  const roots = []
  for (const candidate of candidates) {
    try {
      const root = resolveNoSymlinkDirectory(candidate)
      if (!roots.includes(root)) roots.push(root)
    } catch { /* absent or linked roots are unavailable */ }
  }
  return roots
}

export function findManagedSkillPaths(skillName, roots) {
  for (const trustedRoot of roots) {
    try {
      const skillDir = resolvePathWithinRoots(path.join(trustedRoot, skillName), [trustedRoot], { mustExist: true })
      assertDirectory(skillDir, '技能目录')
      const skillMdPath = resolvePathWithinRoots(path.join(skillDir, 'SKILL.md'), [trustedRoot], { mustExist: true })
      if (path.basename(skillMdPath) !== 'SKILL.md' || path.dirname(skillMdPath) !== skillDir) continue
      return { trustedRoot, skillDir, skillMdPath }
    } catch { /* try the next trusted root */ }
  }
  return null
}

export function validateCliSkillPaths({ skillDir, skillMdPath }) {
  const trustedRoot = resolveNoSymlinkDirectory(skillDir, 'CLI 返回的技能目录')
  const safeReadme = resolvePathWithinRoots(skillMdPath, [trustedRoot], { mustExist: true })
  if (path.basename(safeReadme) !== 'SKILL.md' || path.dirname(safeReadme) !== trustedRoot) {
    throw new Error('CLI 返回的技能说明路径无效')
  }
  return { trustedRoot, skillDir: trustedRoot, skillMdPath: safeReadme }
}

export function revalidateSkillPaths(record) {
  if (!record?.trustedRoot || !record?.skillDir || !record?.skillMdPath) throw new Error('技能路径记录无效')
  const trustedRoot = resolveNoSymlinkDirectory(record.trustedRoot)
  const skillDir = resolvePathWithinRoots(record.skillDir, [trustedRoot], { mustExist: true })
  assertDirectory(skillDir, '技能目录')
  const skillMdPath = resolvePathWithinRoots(record.skillMdPath, [trustedRoot], { mustExist: true })
  if (path.basename(skillMdPath) !== 'SKILL.md' || path.dirname(skillMdPath) !== skillDir) {
    throw new Error('技能说明路径无效')
  }
  return { trustedRoot, skillDir, skillMdPath }
}

export function resolveSkillReference(record, refName) {
  const current = revalidateSkillPaths(record)
  const referencesDir = resolvePathWithinRoots(
    path.join(current.skillDir, 'references'),
    [current.trustedRoot],
    { mustExist: true },
  )
  assertDirectory(referencesDir, '技能 references 目录')
  const referencePath = resolvePathWithinRoots(
    path.join(referencesDir, `${refName}.md`),
    [current.trustedRoot],
    { mustExist: true },
  )
  const relative = path.relative(referencesDir, referencePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('技能参考资料路径无效')
  return referencePath
}
