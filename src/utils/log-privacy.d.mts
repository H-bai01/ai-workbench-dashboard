export interface PrivacyLogOptions {
  scope?: string
  level?: 'debug' | 'info' | 'warn' | 'error' | string
  event?: string
  args?: unknown[]
}

export function classifyPrivacyEvent(args: unknown[], fallback?: string): string
export function classifyPrivacyError(args: unknown[], level?: string): string
export function formatPrivacyLog(options?: PrivacyLogOptions): string
export function installPrivacyConsole(
  consoleTarget?: unknown,
  options?: { scope?: string },
): () => void
export function installBrowserErrorPrivacy(
  windowTarget?: unknown,
  consoleTarget?: unknown,
  options?: { scope?: string },
): () => void
export function installProcessErrorPrivacy(
  processTarget?: unknown,
  consoleTarget?: unknown,
  options?: { scope?: string },
): () => void
