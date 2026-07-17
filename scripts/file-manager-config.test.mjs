import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  discoverFileManagerRoots,
  pickerCommand,
  readManualFileRoots,
  resolveOpenClawLocations,
  validateFileName,
  writeManualFileRoots,
} from './file-manager-config.mjs'

test('OpenClaw 配置位置跟随当前用户及显式配置', () => {
  const home = path.join(path.sep, 'home', 'sample')
  assert.deepEqual(resolveOpenClawLocations({ env: {}, homeDir: home }), {
    homeDir: home,
    stateDir: path.join(home, '.openclaw'),
    configPath: path.join(home, '.openclaw', 'openclaw.json'),
  })
  assert.equal(resolveOpenClawLocations({ env: { OPENCLAW_STATE_DIR: '~/state' }, homeDir: home }).configPath, path.join(home, 'state', 'openclaw.json'))
  assert.equal(resolveOpenClawLocations({ env: { OPENCLAW_CONFIG_PATH: '~/custom/config.json' }, homeDir: home }).stateDir, path.join(home, 'custom'))
})

test('手动目录配置独立保存并过滤失效目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-manager-config-'))
  const stateDir = path.join(root, '.openclaw')
  const first = path.join(root, 'first')
  const second = path.join(root, 'second')
  fs.mkdirSync(first)
  fs.mkdirSync(second)
  const realFirst = fs.realpathSync.native(first)
  const realSecond = fs.realpathSync.native(second)
  assert.deepEqual(writeManualFileRoots({ stateDir, roots: [first, second, first] }), [realFirst, realSecond])
  assert.deepEqual(readManualFileRoots({ stateDir }), [realFirst, realSecond])
  fs.rmSync(second, { recursive: true })
  assert.deepEqual(readManualFileRoots({ stateDir }), [realFirst])
  assert.equal(fs.statSync(path.join(stateDir, 'dashboard-file-manager.json')).mode & 0o777, 0o600)
  fs.rmSync(root, { recursive: true, force: true })
})

test('多个 AI 工具按统一协议提供工作目录并合并相同路径', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-manager-roots-'))
  const first = path.join(root, 'shared-project')
  const second = path.join(root, 'manual')
  fs.mkdirSync(first)
  fs.mkdirSync(second)
  const records = discoverFileManagerRoots({
    aiWorkspaces: [
      { path: first, toolId: 'openclaw', toolName: 'OpenClaw', contextId: 'main', contextName: 'Main', contextType: 'agent' },
      { path: first, toolId: 'codex', toolName: 'Codex', contextId: 'project-a', contextType: 'project' },
      { path: first, toolId: 'future-ai', toolName: 'Future AI', contextId: 'project-a', contextType: 'project' },
    ],
    manualRoots: [first, second],
  })
  assert.equal(records.length, 2)
  assert.equal(records[0].source, 'ai')
  assert.deepEqual(records[0].sources.map(source => source.toolName), ['OpenClaw', 'Codex', 'Future AI'])
  assert.equal(records[1].source, 'manual')
  fs.rmSync(root, { recursive: true, force: true })
})

test('旧 Agent 输入会转换为统一 AI 工作目录记录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-manager-agent-compat-'))
  const workspace = path.join(root, 'agent')
  fs.mkdirSync(workspace)
  const [record] = discoverFileManagerRoots({
    agents: [{ id: 'main', name: 'Main', workspace }],
  })
  assert.equal(record.source, 'ai')
  assert.deepEqual(record.sources[0], {
    toolId: 'openclaw',
    toolName: 'OpenClaw',
    contextId: 'main',
    contextName: 'Main',
    contextType: 'agent',
  })
  fs.rmSync(root, { recursive: true, force: true })
})

test('重命名只接受单个安全名称', () => {
  assert.equal(validateFileName('renamed.md'), 'renamed.md')
  for (const value of ['', '.', '..', '../x', 'a/b', 'a\\b']) assert.throws(() => validateFileName(value))
})

test('系统选择器命令不拼接用户输入', () => {
  assert.equal(pickerCommand('darwin', 'folder').command, 'osascript')
  assert.equal(pickerCommand('darwin', 'file').command, 'osascript')
  assert.equal(pickerCommand('win32', 'folder').command, 'powershell.exe')
  assert.deepEqual(pickerCommand('linux', 'file').args.slice(0, 1), ['--file-selection'])
})
