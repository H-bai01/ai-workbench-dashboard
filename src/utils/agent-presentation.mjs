import { normalizeControlledImageSource } from './safe-content.mjs'

export const DEFAULT_AGENT_AVATAR_SRC = '/avatars/default.svg'
const AGENT_COLOR_PALETTE = Object.freeze([
  '#5e5ce6', '#ff9f0a', '#30d158', '#0a84ff', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a',
])

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function agentIdFromPresentation(source) {
  const explicitId = text(source?.id)
  if (explicitId) return explicitId

  const key = text(source?.key)
  if (!key) return ''
  const parts = key.split(':')
  return parts[0] === 'agent' && parts.length >= 2 ? parts[1] : parts[0]
}

export function agentNameFromPresentation(source, fallbackId = '') {
  return text(source?.displayName)
    || text(source?.name)
    || text(source?.label)
    || text(fallbackId)
    || agentIdFromPresentation(source)
    || 'Agent'
}

export function normalizeAgentAvatarSource(value, { fallback = true } = {}) {
  const controlledSource = normalizeControlledImageSource(text(value))
  return controlledSource || (fallback ? DEFAULT_AGENT_AVATAR_SRC : '')
}

export function stableAgentColor(value, fallback = '#8e8e93') {
  const id = text(value)
  if (!id) return fallback
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return AGENT_COLOR_PALETTE[(hash >>> 0) % AGENT_COLOR_PALETTE.length]
}

export function agentAvatarFromPresentation(source, { fallback = true } = {}) {
  return normalizeAgentAvatarSource(source?.avatar, { fallback })
}

export function buildAgentPresentationOptions(sources, referencedIds = []) {
  const byId = new Map()
  for (const source of Array.isArray(sources) ? sources : []) {
    const id = agentIdFromPresentation(source)
    if (!id) continue
    byId.set(id, {
      id,
      name: agentNameFromPresentation(source, id),
      avatar: agentAvatarFromPresentation(source),
      emoji: text(source?.emoji),
    })
  }
  for (const value of Array.isArray(referencedIds) ? referencedIds : []) {
    const id = text(value)
    if (!id || byId.has(id)) continue
    byId.set(id, { id, name: id, avatar: DEFAULT_AGENT_AVATAR_SRC, emoji: '' })
  }
  return [...byId.values()]
}
