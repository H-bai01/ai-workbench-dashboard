import type { ProjectTokenScope } from '../types/project-token-scope'

export function normalizeProjectPath(value?: string): string
export function projectFolderName(value?: string): string
export function createProjectTokenScope(options: {
  appId: string
  appName: string
  projectPath?: string
  sources: Array<{
    id: string
    sessionId?: string
    name?: string
    lastActivityMs?: number
    status?: string
    label?: string
  }>
}): ProjectTokenScope
export function filterTimelineBySourceIds<T>(timeline: T[], sourceIds: Set<string> | string[]): T[]
