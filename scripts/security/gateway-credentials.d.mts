export interface GatewayCredentials {
  gatewayUrl: string
  token: string
  source: string
  tokenFile?: string
  configPath?: string
}

export function readGatewayCredentials(options?: {
  env?: Record<string, string | undefined>
  homeDir?: string
}): GatewayCredentials

export function gatewayWebSocketUrl(gatewayUrl: string): string
