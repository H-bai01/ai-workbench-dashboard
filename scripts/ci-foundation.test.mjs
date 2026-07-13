import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
const workflowPath = path.join(repo, '.github', 'workflows', 'ci.yml')
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
const workflowText = JSON.stringify(workflow)

function step(job, name) {
  return job.steps.find(item => item.name === name)
}

function runnerPlan(args = []) {
  const result = spawnSync(process.execPath, ['scripts/run-public-ci.mjs', ...args, '--plan'], {
    cwd: repo,
    env: { ...process.env },
    shell: false,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('Actions候选使用可解析语法和最小只读权限', () => {
  assert.equal(workflow.name, 'Public CI')
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch'])
  assert.doesNotMatch(workflowText, /upload-artifact|pages:|packages:|id-token:|pull-requests:\s*write/)
  for (const job of Object.values(workflow.jobs)) {
    assert.deepEqual(job.permissions, { contents: 'read' })
    const checkout = step(job, 'Checkout')
    assert.equal(checkout.uses, 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5')
    assert.equal(checkout.with['persist-credentials'], false)
    assert.equal(step(job, 'Set up Node').uses, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020')
  }
})

test('Linux与macOS固定双Node矩阵并显式安装受控Chromium', () => {
  const job = workflow.jobs['unix-isolated']
  assert.deepEqual(job.strategy.matrix.os, ['ubuntu-latest', 'macos-latest'])
  assert.deepEqual(job.strategy.matrix.node, ['22.13.0', '24.x'])
  assert.equal(step(job, 'Install locked dependencies').run, 'npm ci --ignore-scripts')
  assert.match(step(job, 'Install Chromium system dependencies').run, /playwright install --with-deps chromium/)
  assert.match(step(job, 'Install Chromium').run, /playwright install chromium/)
  assert.match(step(job, 'Select controlled browser').run, /OPENCLAW_TEST_BROWSER/)
  assert.equal(step(job, 'Run isolated public CI').run, 'npm run test:ci')
})

test('Windows只执行纯测试与构建而不承诺浏览器运行', () => {
  const job = workflow.jobs['windows-compile']
  assert.equal(job['runs-on'], 'windows-latest')
  assert.deepEqual(job.strategy.matrix.node, ['22.13.0', '24.x'])
  assert.equal(step(job, 'Run pure tests and build').run, 'npm run test:ci:pure')
  assert.doesNotMatch(JSON.stringify(job), /playwright install|OPENCLAW_TEST_BROWSER|test:ci"/)
})

test('公共CI计划只含隔离合成阶段并明确排除真实测试', () => {
  const full = runnerPlan()
  const pure = runnerPlan(['--pure'])
  assert.deepEqual({ isolated: full.isolated, realGateway: full.realGateway, realSessions: full.realSessions }, {
    isolated: true,
    realGateway: false,
    realSessions: false,
  })
  assert.ok(full.stages.includes('unit') && full.stages.includes('stage2') && full.stages.includes('stage3a'))
  assert.deepEqual(pure.stages, ['pure-unit', 'lint', 'secret-scan', 'build'])
  assert.equal(packageJson.scripts['test:ci'], 'node scripts/run-public-ci.mjs')
  assert.equal(packageJson.scripts['test:ci:pure'], 'node scripts/run-public-ci.mjs --pure')
  assert.match(packageJson.scripts['test:stage4c:ci'], /scripts\/run-public-ci\.test\.mjs/)
  const source = fs.readFileSync(path.join(repo, 'scripts', 'run-public-ci.mjs'), 'utf8')
  assert.equal((source.match(/'scripts\/ci-foundation\.test\.mjs'/g) || []).length, 2)
  assert.doesNotMatch(source, /security-real-gateway|stage3-session-observation-real/)
  assert.doesNotMatch(source, /\.\.\.process\.env/)
  assert.match(source, /const environment = Object\.create\(null\)/)
})

test('所有浏览器测试入口共享安全解析器且不保留私有查找函数', () => {
  const files = [
    'browser-secret-exposure.test.mjs',
    'security-browser-media.test.mjs',
    'security-browser-dynamic-keys.test.mjs',
    'stage2-project-details-browser.test.mjs',
    'stage3-session-observation-browser.test.mjs',
    'security-real-gateway.test.mjs',
  ]
  for (const file of files) {
    const source = fs.readFileSync(path.join(repo, 'scripts', file), 'utf8')
    assert.match(source, /resolveTestBrowserExecutable/)
    assert.doesNotMatch(source, /function\s+system(?:ChromePath|BrowserExecutable)/)
  }
})

test('公开文档准确说明平台与真实测试边界', () => {
  const documentation = fs.readFileSync(path.join(repo, 'docs', '持续集成.md'), 'utf8')
  assert.match(documentation, /macOS.*正式支持方向/)
  assert.match(documentation, /Linux.*实验性支持/)
  assert.match(documentation, /Windows.*不代表运行支持/)
  assert.match(documentation, /test:security:real/)
  assert.match(documentation, /test:stage3a:real/)
  assert.match(documentation, /不会读取正式 Chrome用户数据|不会读取正式 Chrome 用户数据/)
  assert.match(documentation, /不是不可绕过的安全证明/)
})

test('封存的自动发布边界没有被CI重新接入', () => {
  assert.equal(fs.existsSync(path.join(repo, 'release', 'publication-boundary.json')), false)
  assert.equal(fs.existsSync(path.join(repo, 'scripts', 'release-boundary.test.mjs')), false)
  assert.equal(Object.hasOwn(packageJson.scripts, 'test:stage4c:boundary'), false)
})
