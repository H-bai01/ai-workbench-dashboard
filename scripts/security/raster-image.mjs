const IMAGE_TYPES = Object.freeze({
  'image/png': { extension: '.png' },
  'image/jpeg': { extension: '.jpg' },
  'image/gif': { extension: '.gif' },
  'image/webp': { extension: '.webp' },
})

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function canonicalMediaType(value) {
  const type = String(value || '').trim().toLowerCase()
  return type === 'image/jpg' ? 'image/jpeg' : type
}

function isPng(buffer) {
  if (buffer.length < 45) return false
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') return false
  if (buffer.readUInt32BE(16) < 1 || buffer.readUInt32BE(20) < 1) return false
  return buffer.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]))
}

function hasJpegFrame(buffer) {
  let offset = 2
  while (offset + 4 <= buffer.length - 2) {
    if (buffer[offset] !== 0xff) { offset++; continue }
    while (buffer[offset] === 0xff) offset++
    const marker = buffer[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) return false
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) return false
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return length >= 8 && buffer.readUInt16BE(offset + 3) > 0 && buffer.readUInt16BE(offset + 5) > 0
    }
    offset += length
  }
  return false
}

function isJpeg(buffer) {
  return buffer.length >= 12
    && buffer[0] === 0xff && buffer[1] === 0xd8
    && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9
    && hasJpegFrame(buffer)
}

function isGif(buffer) {
  const header = buffer.toString('ascii', 0, 6)
  return buffer.length >= 14
    && (header === 'GIF87a' || header === 'GIF89a')
    && buffer.readUInt16LE(6) > 0 && buffer.readUInt16LE(8) > 0
    && buffer.includes(0x2c) && buffer.at(-1) === 0x3b
}

function isWebp(buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return false
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) return false
  const chunkType = buffer.toString('ascii', 12, 16)
  const chunkSize = buffer.readUInt32LE(16)
  return ['VP8 ', 'VP8L', 'VP8X'].includes(chunkType) && chunkSize > 0 && 20 + chunkSize <= buffer.length
}

export function detectRasterImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return ''
  if (isPng(buffer)) return 'image/png'
  if (isJpeg(buffer)) return 'image/jpeg'
  if (isWebp(buffer)) return 'image/webp'
  if (isGif(buffer)) return 'image/gif'
  return ''
}

export function validateRasterImageBuffer(buffer, declaredType = '', { maxBytes = 5 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw invalid('图片内容为空')
  if (buffer.length > maxBytes) throw invalid('图片大小超过限制')
  const actualType = detectRasterImageType(buffer)
  if (!actualType) throw invalid('图片字节不是受支持的有效栅格图片')
  const expectedType = canonicalMediaType(declaredType)
  if (expectedType && !IMAGE_TYPES[expectedType]) throw invalid(`不支持的图片格式: ${declaredType}`)
  if (expectedType && expectedType !== actualType) throw invalid('声明的图片类型与真实字节不一致')
  return { buffer, mediaType: actualType, extension: IMAGE_TYPES[actualType].extension }
}

export function decodeAndValidateRasterImage(data, declaredType, options) {
  let payload = String(data || '')
  if (!payload) throw invalid('图片内容为空')
  if (payload.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(payload)
    if (!match) throw invalid('图片 Data URL 格式无效')
    if (canonicalMediaType(match[1]) !== canonicalMediaType(declaredType)) throw invalid('Data URL 类型与声明类型不一致')
    payload = match[2]
  }
  if (!payload || payload.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
    throw invalid('Base64 图片数据格式无效')
  }
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.toString('base64') !== payload) throw invalid('Base64 图片数据不是规范编码')
  return validateRasterImageBuffer(buffer, declaredType, options)
}
