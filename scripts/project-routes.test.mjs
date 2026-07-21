import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { handleProjectRoute } from './routes/project-routes.mjs'

function createFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'project-routes-')))
  const projectsDir = path.join(root, 'projects')
  const projectDir = path.join(projectsDir, 'demo')
  fs.mkdirSync(projectDir, { recursive: true })
  const state = {
    name: 'Demo project',
    phase: 'working',
    responsible_agent: 'Eko',
    files: { plan: 'plan.md' },
  }
  fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify(state))
  fs.writeFileSync(path.join(projectDir, 'plan.md'), '# Plan')
  return {
    root,
    projectDir,
    projectRoot: { projectsDir: fs.realpathSync(projectsDir), authorizationRoot: root, source: 'test' },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

async function request(fixture, pathname, { search = '', method = 'GET', body = '' } = {}) {
  const responses = []
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(payload = '') { this.payload = payload },
  }
  const req = Readable.from(body ? [body] : [])
  req.method = method
  const url = new URL(`http://localhost${pathname}${search}`)
  const handled = await handleProjectRoute({
    req,
    res,
    url,
    pathname,
    getProjectRoots: () => [fixture.projectRoot],
    displayPath: value => `<display>${path.basename(value)}`,
    sendJson: (_res, status, payload) => {
      responses.push({ status, payload })
      res.status = status
      res.payload = JSON.stringify(payload)
    },
  })
  return { handled, status: res.status, payload: res.payload, responses }
}

test('项目列表保留状态、显示名和安全展示路径', async () => {
  const fixture = createFixture()
  try {
    fs.writeFileSync(path.join(fixture.projectRoot.projectsDir, 'display-names.json'), JSON.stringify({
      demo: { displayName: '演示项目', initiator: '用户' },
    }))
    const result = await request(fixture, '/api/projects/list')
    const payload = JSON.parse(result.payload)
    assert.equal(result.handled, true)
    assert.equal(result.status, 200)
    assert.equal(payload.total, 1)
    assert.equal(payload.projects[0].displayName, '演示项目')
    assert.equal(payload.projects[0].project_root, '<display>demo')
    assert.equal(payload.projectDirs[0], '<display>projects')
  } finally {
    fixture.cleanup()
  }
})

test('项目产出文件仅从授权项目目录读取', async () => {
  const fixture = createFixture()
  try {
    const result = await request(fixture, '/api/projects/file', { search: '?id=demo&key=plan' })
    assert.deepEqual(JSON.parse(result.payload), {
      content: '# Plan',
      filename: 'plan.md',
      mtime: fs.statSync(path.join(fixture.projectDir, 'plan.md')).mtimeMs,
    })
    const invalid = await request(fixture, '/api/projects/file', { search: '?id=../demo&key=plan' })
    assert.equal(invalid.status, 400)
  } finally {
    fixture.cleanup()
  }
})

test('项目显示名写入独立映射且不改动状态文件', async () => {
  const fixture = createFixture()
  try {
    const stateBefore = fs.readFileSync(path.join(fixture.projectDir, 'state.json'), 'utf8')
    const result = await request(fixture, '/api/projects/rename', {
      method: 'POST',
      body: JSON.stringify({ id: 'demo', displayName: ' 新名称 ', initiator: ' Jason ' }),
    })
    assert.deepEqual(JSON.parse(result.payload), {
      ok: true,
      displayName: '新名称',
      initiator: 'Jason',
    })
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(fixture.projectRoot.projectsDir, 'display-names.json'), 'utf8')),
      { demo: { displayName: '新名称', initiator: 'Jason' } },
    )
    assert.equal(fs.readFileSync(path.join(fixture.projectDir, 'state.json'), 'utf8'), stateBefore)
  } finally {
    fixture.cleanup()
  }
})

test('项目状态接口保持原始 JSON 响应', async () => {
  const fixture = createFixture()
  try {
    const result = await request(fixture, '/api/projects/state', { search: '?id=demo' })
    assert.equal(result.status, 200)
    assert.equal(result.payload, fs.readFileSync(path.join(fixture.projectDir, 'state.json'), 'utf8'))
  } finally {
    fixture.cleanup()
  }
})

test('未知项目路由不接管，非法项目标识关闭失败', async () => {
  const fixture = createFixture()
  try {
    const unknown = await request(fixture, '/api/projects/other')
    assert.equal(unknown.handled, false)
    const invalid = await request(fixture, '/api/projects/state', { search: '?id=../../secret' })
    assert.equal(invalid.handled, true)
    assert.equal(invalid.status, 400)
  } finally {
    fixture.cleanup()
  }
})
