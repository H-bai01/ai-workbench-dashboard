import fs from 'node:fs'
import {
  findAuthorizedProject,
  resolveAuthorizedProject,
  resolveAuthorizedProjectOutput,
  resolveProjectDisplayNamesFile,
} from '../security/project-paths.mjs'
import { safeAtomicWriteFileWithinRoots } from '../security/path-boundary.mjs'

const SAFE_PROJECT_VALUE = /^[A-Za-z0-9_-]{1,128}$/

function createDictionary() {
  return Object.create(null)
}

function dictionaryFrom(value) {
  const output = createDictionary()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output
  for (const [key, child] of Object.entries(value)) output[key] = child
  return output
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : '操作失败'
}

export async function handleProjectRoute({
  req,
  res,
  url,
  pathname,
  getProjectRoots,
  displayPath,
  sendJson,
}) {
  if (pathname === '/api/projects/list' && req.method === 'GET') {
    try {
      const projects = []
      const projectRoots = getProjectRoots()
      for (const projectRoot of projectRoots) {
        let displayNames = createDictionary()
        try {
          const namesFile = resolveProjectDisplayNamesFile(projectRoot, { mustExist: true })
          displayNames = dictionaryFrom(JSON.parse(fs.readFileSync(namesFile, 'utf8')))
        } catch { /* 无安全映射文件 */ }
        const entries = fs.readdirSync(projectRoot.projectsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          try {
            const project = resolveAuthorizedProject(projectRoot, entry.name)
            const state = JSON.parse(fs.readFileSync(project.stateFile, 'utf8'))
            const stat = fs.statSync(project.stateFile)
            projects.push({
              id: entry.name,
              name: state.name || state.project_name || entry.name,
              displayName: (typeof displayNames[entry.name] === 'string' ? displayNames[entry.name] : displayNames[entry.name]?.displayName) || '',
              initiator: (typeof displayNames[entry.name] === 'object' ? displayNames[entry.name]?.initiator : '') || state.initiator || state.created_by || '',
              phase: state.phase || 'unknown',
              responsible_agent: state.responsible_agent || state.agent || null,
              blocked_reason: state.blocked_reason || null,
              retry_count: state.retry_count || 0,
              updated_at: state.updated_at || null,
              created_at: state.created_at || null,
              file_mtime: stat.mtimeMs,
              project_root: displayPath(project.projectDir),
              raw: state,
            })
          } catch { /* 跳过无法解析的项目 */ }
        }
      }
      sendJson(res, 200, {
        projects,
        total: projects.length,
        projectDirs: projectRoots.map(root => displayPath(root.projectsDir)),
        checkedAt: Date.now(),
      })
    } catch (error) {
      sendJson(res, 500, { error: errorMessage(error), projects: [] })
    }
    return true
  }

  if (pathname === '/api/projects/file' && req.method === 'GET') {
    try {
      const id = String(url.searchParams.get('id') || '')
      const fileKey = String(url.searchParams.get('key') || '')
      if (!SAFE_PROJECT_VALUE.test(id) || !SAFE_PROJECT_VALUE.test(fileKey)) {
        sendJson(res, 400, { error: 'invalid id/key' })
        return true
      }
      const project = findAuthorizedProject(getProjectRoots(), id)
      if (!project) throw new Error('project directory not found')
      const state = JSON.parse(fs.readFileSync(project.stateFile, 'utf8'))
      const filename = String((state.files || {})[fileKey] || `${fileKey}.md`)
      const file = resolveAuthorizedProjectOutput(project, filename)
      sendJson(res, 200, {
        content: fs.readFileSync(file, 'utf8'),
        filename,
        mtime: fs.statSync(file).mtimeMs,
      })
    } catch (error) {
      sendJson(res, 404, { error: `文件不存在或无法读取: ${errorMessage(error)}` })
    }
    return true
  }

  if (pathname === '/api/projects/rename' && req.method === 'POST') {
    try {
      const { id, displayName, initiator } = JSON.parse(await readRequestBody(req) || '{}')
      if (!SAFE_PROJECT_VALUE.test(String(id || ''))) {
        sendJson(res, 400, { error: 'invalid id' })
        return true
      }
      const project = findAuthorizedProject(getProjectRoots(), id)
      if (!project) throw new Error('未找到安全的 OpenClaw 项目目录')
      const mapFile = resolveProjectDisplayNamesFile(project)
      let names = createDictionary()
      try { names = dictionaryFrom(JSON.parse(fs.readFileSync(mapFile, 'utf8'))) } catch { /* 首次 */ }
      const previousValue = Object.hasOwn(names, id) ? names[id] : undefined
      const previous = typeof previousValue === 'string' ? { displayName: previousValue } : (previousValue || {})
      const entry = { ...previous }
      if (displayName !== undefined) entry.displayName = String(displayName || '').trim()
      if (initiator !== undefined) entry.initiator = String(initiator || '').trim()
      if (!entry.displayName && !entry.initiator) delete names[id]
      else names[id] = entry
      safeAtomicWriteFileWithinRoots(mapFile, JSON.stringify(names, null, 2), [project.authorizationRoot])
      sendJson(res, 200, {
        ok: true,
        displayName: entry.displayName || '',
        initiator: entry.initiator || '',
      })
    } catch (error) {
      sendJson(res, 500, { error: errorMessage(error) })
    }
    return true
  }

  if (pathname === '/api/projects/state' && req.method === 'GET') {
    try {
      const id = String(url.searchParams.get('id') || '')
      if (!SAFE_PROJECT_VALUE.test(id)) {
        sendJson(res, 400, { error: 'Invalid id' })
        return true
      }
      const project = findAuthorizedProject(getProjectRoots(), id)
      if (!project) throw new Error('project directory not found')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(fs.readFileSync(project.stateFile, 'utf8'))
    } catch (error) {
      sendJson(res, 404, { error: errorMessage(error) })
    }
    return true
  }

  return false
}
