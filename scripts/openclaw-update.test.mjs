import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  compareOpenClawVersions,
  createOpenClawUpdateStatus,
  latestStableOpenClawVersion,
  parseOpenClawVersion,
} from '../src/utils/openclaw-version.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('OpenClaw 日期版本可正确解析和比较', () => {
  assert.deepEqual(parseOpenClawVersion('v2026.7.10')?.parts, [2026, 7, 10, 0])
  assert.equal(compareOpenClawVersions('2026.7.10', '2026.6.11'), 1)
  assert.equal(compareOpenClawVersions('2026.7.10', '2026.7.10'), 0)
  assert.equal(compareOpenClawVersions('2026.7.10-beta.1', '2026.7.10'), -1)
})

test('只选择最新稳定版，不把草稿或预发布版当作更新', () => {
  const latest = latestStableOpenClawVersion([
    { version: '2026.8.1-beta.1', prerelease: true },
    { version: '2026.7.10', prerelease: false },
    { version: '2026.6.11', prerelease: false },
  ])
  assert.equal(latest?.version, '2026.7.10')
})

test('只在最新稳定版高于当前版本时提示更新', () => {
  const releases = [
    { version: '2026.7.10', prerelease: false },
    { version: '2026.6.11', prerelease: false },
  ]
  assert.equal(createOpenClawUpdateStatus('2026.6.11', releases).updateAvailable, true)
  assert.equal(createOpenClawUpdateStatus('2026.7.10', releases).updateAvailable, false)
  assert.equal(createOpenClawUpdateStatus('unknown', releases).updateAvailable, false)
})

test('更新检查、顶部提示、通知和手动更新均已接入', () => {
  const service = fs.readFileSync(path.join(root, 'scripts/unified-service.js'), 'utf8')
  const dashboard = fs.readFileSync(path.join(root, 'src/views/Dashboard.vue'), 'utf8')
  const dialog = fs.readFileSync(path.join(root, 'src/components/VersionDialog.vue'), 'utf8')
  assert.match(service, /\/api\/system\/openclaw-update-status/)
  assert.match(service, /VERSION_SYNC_TTL_MS/)
  assert.match(dashboard, /OpenClaw 可更新/)
  assert.match(dashboard, /发现新版本/)
  assert.match(dialog, /`确认\$\{isUpdate \? '更新' : '切换'\} OpenClaw`/)
  assert.match(dialog, /class="prerelease-version-badge">测试版/)
  assert.match(dialog, /parsed && !parsed\.prerelease/)
  assert.match(dialog, /switchVersion\(version\)/)
})
