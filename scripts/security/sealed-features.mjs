const SEALED_EXACT_PATHS = new Map([
  ['/api/system/doctor', 'OpenClaw 诊断'],
  ['/api/system/auto-fix', '自动修复'],
  ['/api/system/auto-fix/preview', '自动修复'],
])

export function sealedFeatureForPath(pathname) {
  const path = String(pathname || '')
  if (path === '/api/file-manager' || path.startsWith('/api/file-manager/')) return '通用文件管理'
  return SEALED_EXACT_PATHS.get(path) || ''
}

export function sealedFeaturePayload(feature) {
  return {
    ok: false,
    unavailable: true,
    feature,
    error: `${feature}暂时停用`,
  }
}
