export type ProjectTokenAppId = 'codex' | 'claude-code'

export interface ProjectTokenSource {
  id: string
  sessionId?: string
  name: string
  lastActivityMs: number
  status: string
  label: string
}

export interface ProjectTokenScope {
  appId: ProjectTokenAppId
  appName: string
  projectName: string
  projectPath: string
  sources: ProjectTokenSource[]
}
