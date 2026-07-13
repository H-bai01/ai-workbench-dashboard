import fs from 'node:fs'
import path from 'node:path'
import { resolvePathWithinRoots } from './path-boundary.mjs'

function directoryRecord(projectsDir, authorizationRoot, source) {
  const resolvedProjects = resolvePathWithinRoots(projectsDir, [authorizationRoot], { mustExist: true })
  if (!fs.lstatSync(resolvedProjects).isDirectory()) throw new Error('项目根不是目录')
  return { projectsDir: resolvedProjects, authorizationRoot: path.resolve(authorizationRoot), source }
}

export function discoverAuthorizedProjectRoots({ explicitProjectsDir = '', workspaces = [], legacyRoot = '' } = {}) {
  const records = []
  const add = (record) => {
    if (!records.some(item => item.projectsDir === record.projectsDir)) records.push(record)
  }

  if (explicitProjectsDir) {
    try {
      const explicitRoot = resolvePathWithinRoots(explicitProjectsDir, [explicitProjectsDir], { mustExist: true })
      add(directoryRecord(explicitRoot, explicitRoot, 'explicit'))
    } catch { /* optional configured root is unavailable */ }
  }

  for (const workspace of workspaces) {
    try {
      const workspaceRoot = resolvePathWithinRoots(workspace, [workspace], { mustExist: true })
      for (const relative of [path.join('admin', 'projects'), 'projects']) {
        try { add(directoryRecord(path.join(workspaceRoot, relative), workspaceRoot, 'workspace')) } catch { /* absent or linked */ }
      }
    } catch { /* invalid workspace */ }
  }

  if (legacyRoot) {
    try {
      const stat = fs.lstatSync(legacyRoot)
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        const realLegacyRoot = resolvePathWithinRoots(legacyRoot, [legacyRoot], { mustExist: true })
        add(directoryRecord(path.join(realLegacyRoot, 'admin', 'projects'), realLegacyRoot, 'legacy'))
      }
    } catch { /* optional legacy root */ }
  }

  return records
}

export function assertProjectId(value) {
  const id = String(value || '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('项目 ID 格式无效')
  return id
}

export function resolveAuthorizedProject(rootRecord, projectId) {
  const id = assertProjectId(projectId)
  const projectDir = resolvePathWithinRoots(path.join(rootRecord.projectsDir, id), [rootRecord.authorizationRoot], { mustExist: true })
  if (path.dirname(projectDir) !== rootRecord.projectsDir || !fs.lstatSync(projectDir).isDirectory()) throw new Error('项目目录无效')
  const stateFile = resolvePathWithinRoots(path.join(projectDir, 'state.json'), [rootRecord.authorizationRoot], { mustExist: true })
  if (path.dirname(stateFile) !== projectDir || !fs.lstatSync(stateFile).isFile()) throw new Error('项目状态文件无效')
  return { ...rootRecord, id, projectDir, stateFile }
}

export function findAuthorizedProject(projectRoots, projectId) {
  assertProjectId(projectId)
  for (const root of projectRoots || []) {
    try { return resolveAuthorizedProject(root, projectId) } catch { /* try next authorized root */ }
  }
  return null
}

export function resolveAuthorizedProjectOutput(project, filename) {
  const name = String(filename || '')
  if (!name || name !== path.basename(name) || /[\0\/\\]/.test(name)) throw new Error('项目产出文件名无效')
  const file = resolvePathWithinRoots(path.join(project.projectDir, name), [project.authorizationRoot], { mustExist: true })
  if (path.dirname(file) !== project.projectDir || !fs.lstatSync(file).isFile()) throw new Error('项目产出文件无效')
  return file
}

export function resolveProjectDisplayNamesFile(rootRecord, { mustExist = false } = {}) {
  const file = resolvePathWithinRoots(path.join(rootRecord.projectsDir, 'display-names.json'), [rootRecord.authorizationRoot], { mustExist })
  if (path.dirname(file) !== rootRecord.projectsDir) throw new Error('项目显示名文件无效')
  return file
}
