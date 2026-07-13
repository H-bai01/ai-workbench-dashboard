export interface RequestDecision {
  ok: boolean
  status: number
  code?: string
  error?: string
  origin?: string
}

export interface RequestPolicy {
  allowedOrigins: Set<string>
  allowedHosts: Set<string>
}

export function normalizeTrustedOrigin(value: string | undefined): string
export function createLocalRequestPolicy(env?: Record<string, string | undefined>): RequestPolicy
export function validateRequestContext(req: any, options?: RequestPolicy & {
  allowedMethods?: Set<string> | string[]
  websocket?: boolean
}): RequestDecision
export function validateJsonWriteRequest(req: any): RequestDecision
export function validateLocalToken(req: any, expectedToken: string): RequestDecision
export function applyTrustedCorsHeaders(req: any, res: any, allowedOrigins: Set<string>): void
export function sendBoundaryError(res: any, decision: RequestDecision): void
export function isProtectedLocalPath(value: string | undefined): boolean
export function isLoopbackHostname(value: string | undefined): boolean
