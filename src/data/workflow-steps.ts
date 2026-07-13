export interface WorkflowStep {
  title: string
  description?: string
  status?: string
}

export interface WorkflowData {
  projectName?: string
  taskSummary?: string
  mode?: string
  activeStep: number
  steps: WorkflowStep[]
}
