import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  AI_TOOL_CAPABILITY_PROVIDERS,
  normalizeAiToolAdapter,
  registerAiToolAdapter,
} from '../src/utils/ai-tool-adapter.mjs'
import { createAiToolRegistry } from '../src/utils/ai-tool-registry.mjs'

const repo = path.resolve(import.meta.dirname, '..')

function futureAdapter() {
  return {
    descriptor: {
      id: 'future-ai',
      name: 'Future AI',
      iconSrc: '/avatars/default.svg',
      objectLabel: '工作区',
      capabilities: {
        monitor: true,
        usage: true,
        files: true,
      },
    },
    providers: {
      listObjects: async () => [],
      getUsage: async () => ({ tokens: 0, cost: 0 }),
      listFileRoots: async () => [],
    },
  }
}

test('未来工具通过统一适配器注册且不修改默认工具清单', () => {
  const registry = createAiToolRegistry()
  const adapter = registerAiToolAdapter(registry, futureAdapter())
  assert.equal(adapter.descriptor.id, 'future-ai')
  assert.equal(registry.get('future-ai')?.capabilities.files, true)
})

test('声明能力但缺少接口时关闭失败', () => {
  const value = futureAdapter()
  delete value.providers.listFileRoots
  assert.throws(() => normalizeAiToolAdapter(value), /files -> listFileRoots/)
})

test('未声明能力不能偷偷携带操作接口', () => {
  const value = futureAdapter()
  value.providers.sendMessage = async () => undefined
  assert.throws(() => normalizeAiToolAdapter(value), /sendMessage -> messages/)
})

test('未知接口和不安全工具标识被拒绝', () => {
  const unknown = futureAdapter()
  unknown.providers.executeAnything = async () => undefined
  assert.throws(() => normalizeAiToolAdapter(unknown), /unknown/)

  const unsafe = futureAdapter()
  unsafe.descriptor.id = '../future-ai'
  assert.throws(() => normalizeAiToolAdapter(unsafe), /invalid/)
})

test('每项通用能力都有唯一对应接口并进入机器可读描述', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repo, 'release/ai-tool-adapter.schema.json'), 'utf8'))
  assert.deepEqual(
    Object.keys(schema.properties.capabilities.properties).sort(),
    Object.keys(AI_TOOL_CAPABILITY_PROVIDERS).sort(),
  )
  assert.equal(new Set(Object.values(AI_TOOL_CAPABILITY_PROVIDERS)).size, Object.keys(AI_TOOL_CAPABILITY_PROVIDERS).length)
})

test('适配指南明确禁止从用户目录动态执行第三方代码', () => {
  const guide = fs.readFileSync(path.join(repo, 'docs/AI工具适配器开发指南.md'), 'utf8')
  assert.match(guide, /不从用户目录动态执行第三方代码/)
  assert.match(guide, /不需要在首页、任务看板、搜索、时间线或管理入口中增加工具名称判断/)
})
