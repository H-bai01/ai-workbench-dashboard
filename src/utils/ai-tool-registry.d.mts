export type AiToolCapability =
  | 'monitor'
  | 'usage'
  | 'details'
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

export interface AiToolDescriptor {
  id: string
  name: string
  iconSrc: string
  objectLabel: string
  capabilities: Readonly<Record<AiToolCapability, boolean>>
}

export interface AiToolRegistry {
  register(value: AiToolDescriptorInput): AiToolDescriptor
  get(id: string): AiToolDescriptor | undefined
  has(id: string): boolean
  list(): AiToolDescriptor[]
}

export type AiToolDescriptorInput =
  Omit<Partial<AiToolDescriptor>, 'capabilities'>
  & Pick<AiToolDescriptor, 'id'>
  & { capabilities?: Partial<Record<AiToolCapability, boolean>> }

export function normalizeAiToolDescriptor(
  value: AiToolDescriptorInput,
): AiToolDescriptor
export function createAiToolRegistry(
  initial?: readonly AiToolDescriptorInput[],
): AiToolRegistry
export const DEFAULT_AI_TOOLS: readonly AiToolDescriptor[]
