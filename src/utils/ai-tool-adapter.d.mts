import type {
  AiToolCapability,
  AiToolDescriptor,
  AiToolDescriptorInput,
  AiToolRegistry,
} from './ai-tool-registry.mjs'

export type AiToolProviderName =
  | 'listObjects'
  | 'getUsage'
  | 'getObjectDetail'
  | 'listSessions'
  | 'listFileRoots'
  | 'listTasks'
  | 'listAutomations'
  | 'sendMessage'
  | 'listSkills'
  | 'getVersion'
  | 'getNativeUiUrl'
  | 'search'
  | 'listActivity'

export type AiToolProvider = (...args: unknown[]) => unknown | Promise<unknown>

export interface AiToolAdapterInput {
  descriptor: AiToolDescriptorInput
  providers: Partial<Record<AiToolProviderName, AiToolProvider>>
}

export interface AiToolAdapter {
  descriptor: AiToolDescriptor
  providers: Readonly<Partial<Record<AiToolProviderName, AiToolProvider>>>
}

export const AI_TOOL_CAPABILITY_PROVIDERS:
  Readonly<Record<AiToolCapability, AiToolProviderName>>
export function normalizeAiToolAdapter(value: AiToolAdapterInput): AiToolAdapter
export function registerAiToolAdapter(
  registry: AiToolRegistry,
  value: AiToolAdapterInput,
): AiToolAdapter
