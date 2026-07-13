export type AgentVoiceProvider = 'browser' | 'backend'

export interface AgentVoiceSettings {
  provider: AgentVoiceProvider
  browserVoiceURI: string
  backendVoiceId: string
  backendProvider: string
  clonedVoiceName: string
  cloneStatus: string
  sampleName: string
  sampleUrl: string
  sampleDataUrl: string
  rate: number
  pitch: number
  localSttPreferred: boolean
  emotion: string
}

const STORAGE_PREFIX = 'openclaw-agent-voice-settings:'

export const DEFAULT_AGENT_VOICE_SETTINGS: AgentVoiceSettings = {
  provider: 'browser',
  browserVoiceURI: '',
  backendVoiceId: '',
  backendProvider: '',
  clonedVoiceName: '',
  cloneStatus: '',
  sampleName: '',
  sampleUrl: '',
  sampleDataUrl: '',
  rate: 1,
  pitch: 1,
  localSttPreferred: true,
  emotion: '',
}

function normalizeAgentKey(agentKey?: string): string {
  return String(agentKey || 'default').trim() || 'default'
}

export function agentVoiceSettingsStorageKey(agentKey?: string): string {
  return `${STORAGE_PREFIX}${normalizeAgentKey(agentKey)}`
}

export function loadAgentVoiceSettings(agentKey?: string): AgentVoiceSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_AGENT_VOICE_SETTINGS }
  try {
    const raw = window.localStorage.getItem(agentVoiceSettingsStorageKey(agentKey))
    if (!raw) return { ...DEFAULT_AGENT_VOICE_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AgentVoiceSettings>
    return {
      ...DEFAULT_AGENT_VOICE_SETTINGS,
      ...parsed,
      rate: Number.isFinite(Number(parsed.rate)) ? Number(parsed.rate) : DEFAULT_AGENT_VOICE_SETTINGS.rate,
      pitch: Number.isFinite(Number(parsed.pitch)) ? Number(parsed.pitch) : DEFAULT_AGENT_VOICE_SETTINGS.pitch,
    }
  } catch {
    return { ...DEFAULT_AGENT_VOICE_SETTINGS }
  }
}

export function saveAgentVoiceSettings(agentKey: string | undefined, settings: AgentVoiceSettings): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(agentVoiceSettingsStorageKey(agentKey), JSON.stringify(settings))
}

export function availableBrowserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices?.() || []
}
