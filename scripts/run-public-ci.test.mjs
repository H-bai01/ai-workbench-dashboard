import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
const roots = []

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-ci-guard-')))
  roots.push(root)
  const temp = path.join(root, 'tmp')
  fs.mkdirSync(temp, { mode: 0o700 })
  return { root, temp }
}

function runner(args, environment) {
  return spawnSync(process.execPath, ['scripts/run-public-ci.mjs', ...args], {
    cwd: repo,
    env: environment,
    shell: false,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

function fingerprint(root) {
  if (!fs.existsSync(root)) return []
  const records = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute)
      const stat = fs.lstatSync(absolute)
      if (entry.isDirectory()) {
        records.push({ relative, type: 'directory', mtimeMs: stat.mtimeMs })
        visit(absolute)
      } else if (entry.isFile()) {
        records.push({
          relative,
          type: 'file',
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
        })
      } else {
        records.push({ relative, type: 'other', mtimeMs: stat.mtimeMs })
      }
    }
  }
  visit(root)
  return records
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

test('无效显式浏览器路径失败且不创建公共 CI 临时根', () => {
  const { root, temp } = fixture()
  const result = runner([], {
    ...process.env,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    OPENCLAW_TEST_BROWSER: path.join(root, 'missing-browser'),
  })
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '[public-ci] preflight_failed\n')
  assert.doesNotMatch(result.stderr, /missing-browser|ai-workbench-ci-guard|Error:|at file:/)
  assert.deepEqual(fs.readdirSync(temp), [])
})

test('公共 CI 子进程只看到窄白名单与隔离路径', () => {
  const { temp } = fixture()
  const hostile = {
    NPM_CONFIG__AUTH: 'synthetic-auth',
    SSH_AUTH_SOCK: '/synthetic/ssh-agent',
    GIT_ASKPASS: '/synthetic/askpass',
    AWS_ACCESS_KEY_ID: 'synthetic-access',
    AWS_SECRET_ACCESS_KEY: 'synthetic-secret',
    AWS_PROFILE: 'synthetic-profile',
    DOCKER_CONFIG: '/synthetic/docker',
    GITHUB_TOKEN: 'synthetic-github',
    GH_TOKEN: 'synthetic-gh',
    NPM_TOKEN: 'synthetic-npm',
    OPENCLAW_GATEWAY_TOKEN: 'synthetic-gateway',
    VITE_GATEWAY_TOKEN: 'synthetic-vite',
  }
  const result = runner(['--pure', '--probe-environment'], {
    ...process.env,
    ...hostile,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    present: [],
    homeMatchesUserProfile: true,
    workbenchInsideHome: true,
    tokenInsideWorkbench: true,
    dotenvSkipped: true,
  })
  assert.deepEqual(fs.readdirSync(temp), [])
})

test('隔离构建不新增或修改候选工作树中的 TypeScript 增量文件', () => {
  const { temp } = fixture()
  const repositoryCache = path.join(repo, 'node_modules', '.tmp')
  const before = fingerprint(repositoryCache)
  const result = runner(['--pure', '--build-only'], {
    ...process.env,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fingerprint(repositoryCache), before)
  assert.match(result.stdout, /\[public-ci\] typecheck-app/)
  assert.match(result.stdout, /\[public-ci\] typecheck-node/)
  assert.deepEqual(fs.readdirSync(temp), [])
})
