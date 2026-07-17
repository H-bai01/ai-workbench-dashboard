const SEALED_EXACT_PATHS = new Map([
  ['/api/system/doctor', 'OpenClaw 诊断'],
  ['/api/system/auto-fix', '自动修复'],
  ['/api/system/auto-fix/preview', '自动修复'],
])

export function sealedFeatureForPath(pathname) {
  const path = String(pathname || '')
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
