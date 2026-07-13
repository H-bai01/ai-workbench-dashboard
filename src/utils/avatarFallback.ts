import { DEFAULT_AGENT_AVATAR_SRC } from './agent-presentation.mjs'

export const DEFAULT_AVATAR_SRC = DEFAULT_AGENT_AVATAR_SRC

export function defaultAvatarSrc(src?: string): string {
  const value = String(src || '').trim()
  return value || DEFAULT_AVATAR_SRC
}

export function setDefaultAvatar(event: Event): void {
  const img = event.target as HTMLImageElement | null
  if (!img || img.dataset.defaultAvatarApplied === '1') return
  img.dataset.defaultAvatarApplied = '1'
  img.src = DEFAULT_AVATAR_SRC
}
