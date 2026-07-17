const DEFAULT_CAPABILITIES = Object.freeze({
  monitor: false,
  usage: false,
  details: false,
  sessions: false,
  files: false,
  tasks: false,
  messages: false,
  skills: false,
  version: false,
  nativeUi: false,
  search: false,
  timeline: false,
})

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeCapabilities(value) {
  const source = value && typeof value === 'object' ? value : {}
  return Object.freeze(Object.fromEntries(
    Object.keys(DEFAULT_CAPABILITIES).map(key => [key, source[key] === true]),
  ))
}

export function normalizeAiToolDescriptor(value) {
  if (!value || typeof value !== 'object') throw new TypeError('AI tool descriptor is required')
  const id = text(value.id)
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new TypeError('AI tool id is invalid')
  const name = text(value.name, id)
  return Object.freeze({
    id,
    name,
    iconSrc: text(value.iconSrc, '/avatars/default.svg'),
    objectLabel: text(value.objectLabel, '对象'),
    capabilities: normalizeCapabilities(value.capabilities),
  })
}

export function createAiToolRegistry(initial = []) {
  const descriptors = new Map()

  const register = (value) => {
    const descriptor = normalizeAiToolDescriptor(value)
    descriptors.set(descriptor.id, descriptor)
    return descriptor
  }

  for (const value of initial) register(value)

  return Object.freeze({
    register,
    get(id) {
      return descriptors.get(String(id || ''))
    },
    has(id) {
      return descriptors.has(String(id || ''))
    },
    list() {
      return [...descriptors.values()]
    },
  })
}

export const DEFAULT_AI_TOOLS = Object.freeze([
  normalizeAiToolDescriptor({
    id: 'openclaw',
    name: 'OpenClaw',
    iconSrc: '/app-logos/openclaw-lobster.png',
    objectLabel: 'Agent',
    capabilities: {
      monitor: true,
      usage: true,
      details: true,
      sessions: true,
      files: true,
      tasks: true,
      messages: true,
      skills: true,
      version: true,
      nativeUi: true,
      search: true,
      timeline: true,
    },
  }),
  normalizeAiToolDescriptor({
    id: 'codex',
    name: 'Codex',
    iconSrc: '/app-logos/codex-app.png',
    objectLabel: '项目',
    capabilities: {
      monitor: true,
      usage: true,
      details: true,
      sessions: true,
      files: true,
      search: true,
      timeline: true,
    },
  }),
  normalizeAiToolDescriptor({
    id: 'claude-code',
    name: 'Claude Code',
    iconSrc: '/app-logos/claude-app-orange.png',
    objectLabel: '项目',
    capabilities: {
      monitor: true,
      usage: true,
      details: true,
      sessions: true,
      files: true,
      search: true,
      timeline: true,
    },
  }),
])
