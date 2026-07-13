import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_AGENT_AVATAR_SRC,
  agentAvatarFromPresentation,
  agentIdFromPresentation,
  agentNameFromPresentation,
  buildAgentPresentationOptions,
  normalizeAgentAvatarSource,
  stableAgentColor,
} from '../src/utils/agent-presentation.mjs'
import { classifyIntent } from './cognitive-engine.mjs'

const repo = path.resolve(import.meta.dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repo, relativePath), 'utf8')
}

test('任意 Agent ID、非 ASCII 名称和多个 Agent 使用真实数据或中性回退', () => {
  const objectPrototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype)
  const sources = [
    { id: '__proto__', name: '分析助手', avatar: '/api/agent-avatar/__proto__' },
    { id: 'constructor', displayName: '构建助手' },
    { key: 'agent:prototype:session', name: '' },
    { id: 'emoji-agent', name: '協作アシスタント' },
  ]
  const options = buildAgentPresentationOptions(sources, ['extra-agent'])
  const byId = new Map(options.map(option => [option.id, option]))

  assert.equal(byId.size, 5)
  assert.equal(byId.get('__proto__').name, '分析助手')
  assert.equal(byId.get('__proto__').avatar, DEFAULT_AGENT_AVATAR_SRC)
  assert.equal(byId.get('constructor').name, '构建助手')
  assert.equal(byId.get('constructor').avatar, DEFAULT_AGENT_AVATAR_SRC)
  assert.equal(byId.get('prototype').name, 'prototype')
  assert.equal(byId.get('emoji-agent').name, '協作アシスタント')
  assert.equal(byId.get('extra-agent').name, 'extra-agent')
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), objectPrototypeBefore)
})

test('展示工具只接受受控同源头像，不猜测文件或自动访问外部地址', () => {
  assert.equal(agentIdFromPresentation({ key: 'agent:any-agent:session' }), 'any-agent')
  assert.equal(agentNameFromPresentation({}, 'any-agent'), 'any-agent')
  assert.equal(agentNameFromPresentation({}, ''), 'Agent')
  assert.equal(agentAvatarFromPresentation({ avatar: '/api/agent-avatar/any-agent?v=123' }), '/api/agent-avatar/any-agent?v=123')
  assert.equal(normalizeAgentAvatarSource('/avatars/default.svg?v=release'), '/avatars/default.svg?v=release')
  for (const unsafe of [
    'avatars/custom.png',
    'https://example.invalid/avatar.png',
    '//example.invalid/avatar.png',
    'data:image/png;base64,AAAA',
    'blob:https://example.invalid/id',
    'http://127.0.0.1:9999/avatar.png',
    '/other/avatar.png',
    '/avatars/custom.svg',
    '/api/agent-avatar/any-agent#fragment',
    '/avatars//avatar.png',
    '/avatars/%2Favatar.png',
    '/avatars/%252e%252e/avatar.png',
    '/api/agent-avatar/',
    '/api/agent-avatar/bad%2Fid',
  ]) {
    assert.equal(normalizeAgentAvatarSource(unsafe), DEFAULT_AGENT_AVATAR_SRC, unsafe)
  }
  assert.equal(agentAvatarFromPresentation({}, { fallback: false }), '')
  assert.equal(agentAvatarFromPresentation({}), DEFAULT_AGENT_AVATAR_SRC)
})

test('任意 Agent ID 使用稳定通用颜色且空 ID 使用中性回退', () => {
  const ids = ['任意助手', 'agent-a', 'agent-b', '__proto__', 'constructor', 'prototype', '协作-01', 'x.y:z']
  const colors = ids.map(id => stableAgentColor(id))
  assert.deepEqual(colors, ids.map(id => stableAgentColor(id)))
  assert.ok(colors.every(color => /^#[0-9a-f]{6}$/i.test(color)))
  assert.ok(new Set(colors).size > 1)
  assert.equal(stableAgentColor(''), '#8e8e93')
  assert.equal(stableAgentColor('   ', '#777777'), '#777777')
})

test('默认公共头像目录只分发中性回退资源', () => {
  const avatarDir = path.join(repo, 'public', 'avatars')
  const files = fs.readdirSync(avatarDir).sort()
  assert.deepEqual(files, ['default.svg'])
  assert.match(fs.readFileSync(path.join(avatarDir, 'default.svg'), 'utf8'), /<svg\b/)
})

test('运行时代码没有重新引入固定 Agent 映射或按 ID 猜头像', () => {
  const roots = ['src', 'scripts']
  const sourceFiles = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(fullPath)
      else if (/\.(?:vue|ts|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.test.mjs')) sourceFiles.push(fullPath)
    }
  }
  roots.forEach(root => visit(path.join(repo, root)))
  const combined = sourceFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n')

  assert.doesNotMatch(combined, /const\s+(?:AGENT_LABELS|MENTION_AGENTS|AGENT_AVATAR_ALIASES)\b/)
  assert.doesNotMatch(combined, /const\s+AGENT_COLORS\b/)
  assert.doesNotMatch(combined, /\/avatars\/\$\{[^}]+\}\.(?:png|jpe?g|webp|gif)/i)
})

test('默认工作流与本地秒回保持中性，不冒充部署者人格', () => {
  const workflow = JSON.parse(read('public/workflow-progress-example.json'))
  assert.equal(workflow.projectName, '项目名称')
  assert.equal(workflow.taskSummary, '任务名称')
  assert.deepEqual(workflow.steps.map(step => step.title), ['需求确认', '任务执行', '结果检查', '完成交付'])

  const greeting = classifyIntent('你好')
  const status = classifyIntent('你怎么样')
  assert.equal(greeting.type, 'greeting')
  assert.match(greeting.directResponse, /需要|请告诉/)
  assert.equal(status.type, 'status_check')
  assert.match(status.directResponse, /状态正常|已就绪/)
})
