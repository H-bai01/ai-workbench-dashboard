import createDOMPurify from 'dompurify'

const SAFE_URI = /^(?:(?:https?:\/\/|mailto:)|(?:\.{0,2}\/|\/(?!\/)|#))/i
const CONTROLLED_IMAGE_PATHS = ['/avatars/', '/api/agent-avatar/', '/uploads/']
const SAFE_RASTER_EXTENSION = /\.(?:png|jpe?g|webp|gif)$/i
const SAFE_BUILTIN_SVG = '/avatars/default.svg'
const MAX_INLINE_RASTER_BYTES = 2 * 1024 * 1024
const RICH_POLICY = Object.freeze({
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: SAFE_URI,
  FORBID_TAGS: [
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
    'textarea', 'select', 'option', 'link', 'meta', 'base', 'svg', 'math',
    'audio', 'video', 'source', 'track', 'picture',
  ],
  FORBID_ATTR: ['style', 'srcset', 'formaction'],
  ADD_DATA_URI_TAGS: ['img'],
})
const HIGHLIGHT_POLICY = Object.freeze({
  ALLOWED_TAGS: ['mark'],
  ALLOWED_ATTR: [],
  ALLOW_DATA_ATTR: false,
})

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeLinkHref(value) {
  const href = String(value || '')
  if (!href || /[\\\u0000-\u001f\u007f]/.test(href) || href.startsWith('//')) return ''
  return SAFE_URI.test(href) ? href : ''
}

export function normalizeControlledImageSource(value) {
  const source = String(value || '')
  if (source !== source.trim() || !source.startsWith('/') || source.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(source)) return ''
  const rawPath = source.split(/[?#]/, 1)[0]
  if (!rawPath || rawPath.includes('//')) return ''
  let parsed
  try { parsed = new URL(source, 'https://dashboard.invalid') } catch { return '' }
  if (parsed.origin !== 'https://dashboard.invalid' || parsed.hash) return ''
  let decodedPath
  try { decodedPath = decodeURIComponent(rawPath) } catch { return '' }
  if (decodedPath.includes('%') || /[\\\u0000-\u001f\u007f]/.test(decodedPath)) return ''
  const segments = decodedPath.split('/')
  if (segments[0] !== '' || segments.slice(1).some(segment => !segment || segment === '.' || segment === '..')) return ''
  const allowedPrefix = CONTROLLED_IMAGE_PATHS.find(prefix => decodedPath.startsWith(prefix))
  if (!allowedPrefix) return ''
  if (allowedPrefix === '/api/agent-avatar/') {
    const agentId = decodedPath.slice(allowedPrefix.length)
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(agentId)) return ''
  }
  if (allowedPrefix !== '/api/agent-avatar/' && decodedPath !== SAFE_BUILTIN_SVG && !SAFE_RASTER_EXTENSION.test(decodedPath)) return ''
  const safeSearch = new URLSearchParams()
  for (const [key, entry] of parsed.searchParams) {
    if (key === 'v' && /^[A-Za-z0-9._-]{1,64}$/.test(entry)) safeSearch.set(key, entry)
  }
  const query = safeSearch.toString()
  return `${decodedPath}${query ? `?${query}` : ''}`
}

export function normalizeSafeRasterDataUrl(value, decodeBase64 = globalThis.atob?.bind(globalThis)) {
  const source = String(value || '')
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source)
  if (!match || typeof decodeBase64 !== 'function') return ''
  const mediaType = match[1].toLowerCase()
  const payload = match[2]
  if (payload.length % 4 !== 0 || /=[^=]/.test(payload)) return ''
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  const byteLength = (payload.length / 4) * 3 - padding
  if (byteLength <= 0 || byteLength > MAX_INLINE_RASTER_BYTES) return ''
  let header
  try { header = decodeBase64(payload.slice(0, Math.min(payload.length, 32))) } catch { return '' }
  const bytes = [...header].map(character => character.charCodeAt(0))
  const matchesMagic = mediaType === 'png'
    ? bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
    : mediaType === 'jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mediaType === 'gif'
        ? header.startsWith('GIF87a') || header.startsWith('GIF89a')
        : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP'
  return matchesMagic ? `data:image/${mediaType};base64,${payload}` : ''
}

function externalImageHref(value) {
  const source = String(value || '')
  if (!/^https?:\/\//i.test(source)) return ''
  return safeLinkHref(source)
}

export function createSafeContentSanitizer(windowLike) {
  const purifier = createDOMPurify(windowLike)
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName?.toLowerCase() !== 'a') return
    const href = node.getAttribute('href') || ''
    const safeHref = safeLinkHref(href)
    if (safeHref) node.setAttribute('href', safeHref)
    else node.removeAttribute('href')
    node.setAttribute('rel', 'noopener noreferrer')
    if (node.getAttribute('href')) node.setAttribute('target', '_blank')
  })
  return {
    sanitizeRichHtml(value) {
      const clean = purifier.sanitize(String(value || ''), RICH_POLICY)
      const template = windowLike.document.createElement('template')
      template.innerHTML = clean
      for (const image of template.content.querySelectorAll('img')) {
        const originalSource = image.getAttribute('src') || ''
        const safeSource = normalizeControlledImageSource(originalSource)
          || normalizeSafeRasterDataUrl(originalSource, windowLike.atob?.bind(windowLike))
        if (safeSource) {
          image.setAttribute('src', safeSource)
          continue
        }
        const externalHref = externalImageHref(originalSource)
        if (!externalHref) {
          image.remove()
          continue
        }
        const link = windowLike.document.createElement('a')
        link.href = externalHref
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.className = 'safe-external-image-link'
        if (image.id) link.id = image.id
        link.textContent = image.getAttribute('alt')?.trim() || '查看外部图片（需手动打开）'
        image.replaceWith(link)
      }
      return template.innerHTML
    },
    sanitizeHighlightHtml(value) {
      return purifier.sanitize(String(value || ''), HIGHLIGHT_POLICY)
    },
  }
}

const browserSanitizer = typeof window === 'undefined' ? null : createSafeContentSanitizer(window)

export function sanitizeRichHtml(value) {
  return browserSanitizer ? browserSanitizer.sanitizeRichHtml(value) : escapeHtml(value)
}

export function sanitizeHighlightHtml(value) {
  return browserSanitizer ? browserSanitizer.sanitizeHighlightHtml(value) : escapeHtml(value)
}

export function renderSafeMarkdown(value, parse, sanitize = sanitizeRichHtml) {
  const source = String(value || '')
  try {
    return sanitize(parse(source))
  } catch {
    return `<pre>${escapeHtml(source)}</pre>`
  }
}
