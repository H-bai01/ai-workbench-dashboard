export interface AgentPresentationSource {
  id?: unknown
  key?: unknown
  displayName?: unknown
  name?: unknown
  label?: unknown
  avatar?: unknown
  emoji?: unknown
}

export interface AgentPresentationOption {
  id: string
  name: string
  avatar: string
  emoji: string
}

export const DEFAULT_AGENT_AVATAR_SRC: string

export function agentIdFromPresentation(source?: AgentPresentationSource | null): string

export function agentNameFromPresentation(
  source?: AgentPresentationSource | null,
  fallbackId?: string,
): string

export function normalizeAgentAvatarSource(
  value?: unknown,
  options?: { fallback?: boolean },
): string

export function stableAgentColor(value?: unknown, fallback?: string): string

export function agentAvatarFromPresentation(
  source?: AgentPresentationSource | null,
  options?: { fallback?: boolean },
): string

export function buildAgentPresentationOptions(
  sources?: readonly AgentPresentationSource[] | null,
  referencedIds?: readonly unknown[] | null,
): AgentPresentationOption[]
