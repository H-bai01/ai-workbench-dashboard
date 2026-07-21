import test from 'node:test'
import assert from 'node:assert/strict'

import {
  modelCompanyName,
  modelDisplayName,
  modelLogoKey,
  modelLogoSrc,
  modelLogoText,
} from '../src/utils/model-presentation.ts'

test('模型名称在总览和详情中保持原有显示规则', () => {
  assert.equal(modelDisplayName('deepseek-v4-flash'), 'DeepSeek')
  assert.equal(modelDisplayName('deepseek-v4-flash', 'detailed'), 'DeepSeek V4 Flash')
  assert.equal(modelDisplayName('provider/custom-model'), 'custom-model')
  assert.equal(modelDisplayName('provider/custom-model', 'detailed'), 'provider/custom-model')
})

test('模型品牌图标和公司信息保持统一映射', () => {
  assert.equal(modelLogoKey('claude-sonnet-5'), 'anthropic')
  assert.equal(modelLogoText('claude-sonnet-5'), 'A')
  assert.equal(modelLogoSrc('claude-sonnet-5'), '/model-logos/anthropic.svg')
  assert.equal(modelCompanyName('claude-sonnet-5'), 'Anthropic / Claude')
  assert.equal(modelCompanyName('provider/custom-model', 'detailed'), 'provider/custom-model')
})

test('本地模型与未知模型安全回退', () => {
  assert.equal(modelDisplayName('qwen3.5:9b'), '本地千问 Qwen3.5:9b')
  assert.equal(modelDisplayName('qwen3.5:9b', 'detailed'), '本地千问 Qwen3.5 9B')
  assert.equal(modelLogoKey('ollama/local-model'), 'local')
  assert.equal(modelLogoSrc('ollama/local-model'), '')
  assert.equal(modelLogoText('unknown-model'), 'M')
})
