import { ownValue, safeRecordFrom } from './safe-record.mjs'

export type ModelLabelStyle = 'compact' | 'detailed' | 'billing'

const COMPACT_NAMES: Record<string, string> = safeRecordFrom({
  'deepseek-v4-flash': 'DeepSeek',
  'deepseek-v4-pro': 'DeepSeek',
  'deepseek-v3': 'DeepSeek',
  'deepseek-chat': 'DeepSeek',
  'deepseek-reasoner': 'DeepSeek',
  'MiniMax-M2.7': 'MiniMax',
  'claude-fable-5': 'Claude',
  'claude-opus-4-8': 'Claude',
  'claude-sonnet-5': 'Claude',
  'claude-haiku-4-5': 'Claude',
  'claude-sonnet-4-6': 'Claude',
  'claude-sonnet-4-5': 'Claude',
  'claude-opus-4': 'Claude',
  'claude-opus-4-6': 'Claude',
  'claude-opus-4-7': 'Claude',
  'claude-opus-4-5': 'Claude',
  'chat-latest': 'ChatGPT',
  'gpt-5.3-codex': 'Codex',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.4-nano': 'GPT-5.4 Nano',
  'gpt-5.4-pro': 'GPT-5.4 Pro',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.5-pro': 'GPT-5.5 Pro',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'Qwen3.5-4B-OptiQ-4bit': '本地 Qwen3.5 4B',
  'qwen3.5': '本地 Qwen3.5',
  'qwen3.5:9b': '本地 Qwen3.5 9B',
  'qwen2.5': '本地 Qwen2.5',
  'gemma3:12b': '本地 Gemma 3 12B',
})

const DETAILED_NAMES: Record<string, string> = safeRecordFrom({
  ...COMPACT_NAMES,
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v3': 'DeepSeek V3',
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
  'MiniMax-M2.7': 'MiniMax M2.7',
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-opus-4': 'Claude Opus 4',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-5': 'Claude Opus 4.5',
  'chat-latest': 'ChatGPT Latest',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'Qwen3.5-4B-OptiQ-4bit': '本地千问 Qwen3.5 4B',
  'qwen3.5': '本地千问 Qwen3.5',
  'qwen3.5:9b': '本地千问 Qwen3.5 9B',
  'qwen2.5': '本地千问 Qwen2.5',
  'gemma3:12b': '本地 Google Gemma 3 12B',
})

const BILLING_NAMES: Record<string, string> = safeRecordFrom({
  ...DETAILED_NAMES,
  unknown: '未知模型',
})

export function modelDisplayName(model: string, style: ModelLabelStyle = 'compact'): string {
  const value = String(model || '')
  const names = style === 'compact'
    ? COMPACT_NAMES
    : style === 'billing'
      ? BILLING_NAMES
      : DETAILED_NAMES
  const lower = value.toLowerCase()
  if (style !== 'detailed') {
    if (lower.includes('qwen')) return `本地千问 ${value.replace(/^.*qwen/i, 'Qwen')}`
    if (lower.includes('gemma')) return `本地 Google ${value.replace(/^.*gemma/i, 'Gemma')}`
  }
  const configured = ownValue(names, value)
  if (configured) return configured
  if (lower.includes('qwen')) return `本地千问 ${value.replace(/^.*qwen/i, 'Qwen')}`
  if (lower.includes('gemma')) return `本地 Google ${value.replace(/^.*gemma/i, 'Gemma')}`
  return style === 'compact' ? (value.split('/').pop() || value) : value
}

export function modelLogoKey(model: string): string {
  const value = String(model || '').toLowerCase()
  if (value.includes('deepseek')) return 'deepseek'
  if (value.includes('minimax')) return 'minimax'
  if (value.includes('claude') || value.includes('anthropic')) return 'anthropic'
  if (value.includes('gpt') || value.includes('openai')) return 'openai'
  if (value.includes('qwen')) return 'qwen'
  if (value.includes('gemma') || value.includes('google')) return 'google'
  if (value.includes('ollama') || value.includes('local') || value.includes('本地')) return 'local'
  return 'generic'
}

export function modelLogoText(model: string): string {
  const labels: Record<string, string> = {
    deepseek: 'DS',
    minimax: 'MM',
    anthropic: 'A',
    openai: 'AI',
    qwen: '千',
    google: 'G',
    local: '本',
  }
  return labels[modelLogoKey(model)] || 'M'
}

export function modelLogoSrc(model: string): string {
  const key = modelLogoKey(model)
  return ['deepseek', 'minimax', 'anthropic', 'openai', 'qwen', 'google'].includes(key)
    ? `/model-logos/${key}.svg`
    : ''
}

export function modelCompanyName(model: string, style: ModelLabelStyle = 'compact'): string {
  const companies: Record<string, string> = {
    deepseek: 'DeepSeek',
    minimax: 'MiniMax',
    anthropic: 'Anthropic / Claude',
    openai: 'OpenAI',
    qwen: 'Alibaba Qwen',
    google: 'Google',
    local: '本地模型',
  }
  return companies[modelLogoKey(model)] || modelDisplayName(model, style)
}
