import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  createAiToolRegistry,
  DEFAULT_AI_TOOLS,
  normalizeAiToolDescriptor,
} from '../src/utils/ai-tool-registry.mjs'
import { buildAiToolManagementActions } from '../src/utils/ai-tool-actions.mjs'

const repo = path.resolve(import.meta.dirname, '..')

test('默认工具通过同一描述结构声明能力', () => {
  assert.deepEqual(DEFAULT_AI_TOOLS.map(tool => tool.id), ['openclaw', 'codex', 'claude-code'])
  for (const tool of DEFAULT_AI_TOOLS) {
    assert.ok(tool.name)
    assert.ok(tool.iconSrc)
    assert.equal(tool.capabilities.monitor, true)
    assert.equal(tool.capabilities.usage, true)
  }
})

test('后续 AI 工具无需修改注册器即可加入', () => {
  const registry = createAiToolRegistry(DEFAULT_AI_TOOLS)
  registry.register({
    id: 'future-ai',
    name: 'Future AI',
    iconSrc: '/avatars/default.svg',
    objectLabel: '工作区',
    capabilities: { monitor: true, files: true, sessions: true },
  })
  assert.equal(registry.get('future-ai')?.name, 'Future AI')
  assert.equal(registry.get('future-ai')?.capabilities.files, true)
  assert.equal(registry.get('future-ai')?.capabilities.version, false)
  assert.equal(registry.list().length, 4)
})

test('工具描述拒绝不安全标识并使用中性默认值', () => {
  assert.throws(() => normalizeAiToolDescriptor({ id: '../bad' }), /invalid/)
  const descriptor = normalizeAiToolDescriptor({ id: 'safe-tool' })
  assert.equal(descriptor.name, 'safe-tool')
  assert.equal(descriptor.iconSrc, '/avatars/default.svg')
  assert.equal(descriptor.objectLabel, '对象')
})

test('任务看板消费通用监控对象而不是 OpenClaw Agent 专属列表', () => {
  const dashboard = fs.readFileSync(path.join(repo, 'src/views/Dashboard.vue'), 'utf8')
  assert.match(dashboard, /MonitorObjectCard/)
  assert.match(dashboard, /monitorBoardRows/)
  assert.doesNotMatch(dashboard, /store\.(?:idle|running|aborted|error|unknown)Agents/)
  assert.doesNotMatch(dashboard, /OpenClaw Agent 任务区/)
})

test('管理入口严格按每个工具声明的能力生成', () => {
  const registry = createAiToolRegistry(DEFAULT_AI_TOOLS)
  const future = registry.register({
    id: 'future-ai',
    name: 'Future AI',
    capabilities: {
      monitor: true,
      files: true,
      automation: true,
      nativeUi: false,
    },
  })
  assert.deepEqual(
    buildAiToolManagementActions(future).map(action => action.id),
    ['monitor', 'files', 'automation'],
  )
  assert.equal(
    buildAiToolManagementActions(future).some(action => action.id === 'nativeUi'),
    false,
  )
})

test('首页的工具专属功能先进入统一能力入口', () => {
  const dashboard = fs.readFileSync(path.join(repo, 'src/views/Dashboard.vue'), 'utf8')
  const dialog = fs.readFileSync(path.join(repo, 'src/components/ToolManagementDialog.vue'), 'utf8')
  assert.match(dashboard, /<ToolManagementDialog/)
  assert.match(dashboard, /openToolManagement\('skills'\)/)
  assert.match(dashboard, /openToolManagement\('nativeUi'\)/)
  assert.match(dashboard, /openToolManagement\('tasks'\)/)
  assert.match(dashboard, /openToolManagement\('automation'\)/)
  assert.match(dialog, /每个工具只显示自身真实支持的功能/)
  assert.doesNotMatch(dashboard, /<div class="action-label">OpenClaw 技能<\/div>/)
  assert.doesNotMatch(dashboard, /<div class="action-label">OpenClaw 项目<\/div>/)
})
