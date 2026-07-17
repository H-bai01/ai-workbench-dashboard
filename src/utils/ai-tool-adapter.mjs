import { normalizeAiToolDescriptor } from './ai-tool-registry.mjs'

const CAPABILITY_PROVIDER = Object.freeze({
  monitor: 'listObjects',
  usage: 'getUsage',
  details: 'getObjectDetail',
  sessions: 'listSessions',
  files: 'listFileRoots',
  tasks: 'listTasks',
  automation: 'listAutomations',
  messages: 'sendMessage',
  skills: 'listSkills',
  version: 'getVersion',
  nativeUi: 'getNativeUiUrl',
  search: 'search',
  timeline: 'listActivity',
})

const PROVIDER_NAMES = Object.freeze(Object.values(CAPABILITY_PROVIDER))

function normalizeProviders(value) {
  if (!value || typeof value !== 'object') throw new TypeError('AI tool adapter providers are required')
  const providers = Object.create(null)
  for (const name of Object.keys(value)) {
    if (!PROVIDER_NAMES.includes(name)) throw new TypeError(`AI tool adapter provider is unknown: ${name}`)
    if (typeof value[name] !== 'function') throw new TypeError(`AI tool adapter provider must be a function: ${name}`)
    providers[name] = value[name]
  }
  return Object.freeze(providers)
}

export function normalizeAiToolAdapter(value) {
  if (!value || typeof value !== 'object') throw new TypeError('AI tool adapter is required')
  const descriptor = normalizeAiToolDescriptor(value.descriptor)
  const providers = normalizeProviders(value.providers)

  for (const [capability, provider] of Object.entries(CAPABILITY_PROVIDER)) {
    const enabled = descriptor.capabilities[capability] === true
    const implemented = typeof providers[provider] === 'function'
    if (enabled && !implemented) {
      throw new TypeError(`AI tool adapter capability requires provider: ${capability} -> ${provider}`)
    }
    if (!enabled && implemented) {
      throw new TypeError(`AI tool adapter provider requires declared capability: ${provider} -> ${capability}`)
    }
  }

  return Object.freeze({
    descriptor,
    providers,
  })
}

export function registerAiToolAdapter(registry, value) {
  if (!registry || typeof registry.register !== 'function') {
    throw new TypeError('AI tool registry is required')
  }
  const adapter = normalizeAiToolAdapter(value)
  registry.register(adapter.descriptor)
  return adapter
}

export const AI_TOOL_CAPABILITY_PROVIDERS = CAPABILITY_PROVIDER
