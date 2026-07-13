const REDACTED = '[REDACTED]'
const SENSITIVE_FIELD_SUFFIX = /(?:token|secret|password|passwd|pwd|passphrase|credential|credentials|apikey|privatekey|accesskey|cookie|encryptionkey|signingkey|authorization|bearer)$/

function normalizedFieldName(value) {
  return String(value || '').replace(/[-_\s]/g, '').toLowerCase()
}

export function isSensitiveOutputField(value) {
  const normalized = normalizedFieldName(value)
  return normalized === 'auth' || SENSITIVE_FIELD_SUFFIX.test(normalized)
}

export function normalizeKnownSecrets(values) {
  return [...new Set([...values]
    .filter(value => typeof value === 'string')
    .filter(value => value.length >= 8))]
    .sort((a, b) => b.length - a.length)
}

export function redactKnownSecretText(value, secrets) {
  let output = String(value ?? '')
  for (const secret of normalizeKnownSecrets(secrets)) output = output.split(secret).join(REDACTED)
  return output
}

export function redactBrowserPayload(value, secrets = []) {
  if (typeof value === 'string') return redactKnownSecretText(value, secrets)
  if (Array.isArray(value)) return value.map(entry => redactBrowserPayload(entry, secrets))
  if (!value || typeof value !== 'object') return value
  const output = Object.create(null)
  for (const [key, child] of Object.entries(value)) {
    output[key] = isSensitiveOutputField(key) ? REDACTED : redactBrowserPayload(child, secrets)
  }
  return output
}

function isRedactableContentType(value) {
  const contentType = String(value || '').toLowerCase()
  return contentType.includes('application/json')
    || contentType.startsWith('text/') && !contentType.includes('text/event-stream')
}

function redactResponseBody(body, contentType, secrets) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '')
  if (String(contentType || '').toLowerCase().includes('application/json')) {
    try { return JSON.stringify(redactBrowserPayload(JSON.parse(text), secrets)) } catch { /* redact as text */ }
  }
  return redactKnownSecretText(text, secrets)
}

export function installBrowserOutputRedaction(res, getSecrets) {
  const originalWriteHead = typeof res.writeHead === 'function' ? res.writeHead.bind(res) : null
  const originalWrite = res.write.bind(res)
  const originalEnd = res.end.bind(res)
  let responseContentType = ''

  if (originalWriteHead) {
    res.writeHead = function redactedWriteHead(statusCode, statusMessage, headers) {
      let message = statusMessage
      let responseHeaders = headers
      if (statusMessage && typeof statusMessage === 'object') {
        responseHeaders = statusMessage
        message = undefined
      }
      const suppliedContentType = responseHeaders && !Array.isArray(responseHeaders)
        ? Object.entries(responseHeaders).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
        : ''
      responseContentType = String(suppliedContentType || res.getHeader('content-type') || '')
      if (isRedactableContentType(responseContentType)) {
        res.removeHeader?.('content-length')
        if (responseHeaders && !Array.isArray(responseHeaders)) {
          responseHeaders = Object.fromEntries(Object.entries(responseHeaders)
            .filter(([key]) => key.toLowerCase() !== 'content-length'))
        }
      }
      if (message === undefined) return originalWriteHead(statusCode, responseHeaders)
      return originalWriteHead(statusCode, message, responseHeaders)
    }
  }

  res.write = function redactedWrite(chunk, encoding, callback) {
    const contentType = responseContentType || res.getHeader('content-type')
    if (!isRedactableContentType(contentType) || chunk === undefined || chunk === null) {
      return originalWrite(chunk, encoding, callback)
    }
    const redacted = redactResponseBody(chunk, contentType, getSecrets())
    return originalWrite(redacted, encoding, callback)
  }

  res.end = function redactedEnd(chunk, encoding, callback) {
    if (typeof chunk === 'function') return originalEnd(chunk)
    if (typeof encoding === 'function') {
      callback = encoding
      encoding = undefined
    }
    const contentType = responseContentType || res.getHeader('content-type')
    if (!isRedactableContentType(contentType) || chunk === undefined || chunk === null) {
      return originalEnd(chunk, encoding, callback)
    }
    const redacted = redactResponseBody(chunk, contentType, getSecrets())
    if (!res.headersSent && res.hasHeader('content-length')) res.setHeader('content-length', Buffer.byteLength(redacted))
    return originalEnd(redacted, encoding, callback)
  }

  return res
}

export { REDACTED }
