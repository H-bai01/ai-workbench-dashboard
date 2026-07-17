import type { AiToolCapability, AiToolDescriptor } from './ai-tool-registry.mjs'

export type AiToolManagementActionId =
  | 'monitor'
  | 'usage'
  | 'sessions'
  | 'files'
  | 'tasks'
  | 'automation'
  | 'messages'
  | 'skills'
  | 'version'
  | 'nativeUi'
  | 'search'
  | 'timeline'

export interface AiToolManagementAction {
  id: AiToolManagementActionId
  capability: AiToolCapability
  label: string
  description: string
}

export const AI_TOOL_MANAGEMENT_ACTIONS: readonly AiToolManagementAction[]
export function getAiToolManagementAction(
  id: string,
): AiToolManagementAction | undefined
export function buildAiToolManagementActions(
  descriptor: AiToolDescriptor,
): AiToolManagementAction[]
