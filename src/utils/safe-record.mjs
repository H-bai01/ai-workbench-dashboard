export function createSafeRecord() {
  return Object.create(null)
}

export function safeRecordFrom(source) {
  const output = createSafeRecord()
  for (const [key, value] of Object.entries(source || {})) output[key] = value
  return output
}

export function ownValue(source, key) {
  return source && Object.hasOwn(source, key) ? source[key] : undefined
}

export function ensureSafeValue(source, key, factory) {
  if (!Object.hasOwn(source, key)) source[key] = factory()
  return source[key]
}
