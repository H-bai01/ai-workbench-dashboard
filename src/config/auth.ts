const LEGACY_STORAGE_KEY = 'gateway-token'

/** 清除旧版本曾写入浏览器的 Gateway 凭据。新版本只使用服务端凭据。 */
export function clearLegacyGatewayCredential(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    sessionStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // localStorage may be unavailable in privacy-restricted contexts.
  }
}
