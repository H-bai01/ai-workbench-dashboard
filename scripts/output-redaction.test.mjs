import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  installBrowserOutputRedaction,
  redactBrowserPayload,
  redactKnownSecretText,
} from './security/output-redaction.mjs'
import { collectSensitiveValues } from './security/diagnostics.mjs'

const gatewaySecret = 'synthetic-gateway-secret'
const dashboardSecret = 'a'.repeat(64)
const apiSecret = 'synthetic-api-key'
const secrets = [gatewaySecret, dashboardSecret, apiSecret]

test('浏览器 JSON 输出只遮蔽敏感字段与已知秘密，保留正常对话', () => {
  const input = {
    text: `修复 token 统计，不是秘密；实际值=${gatewaySecret}`,
    nested: [{ apiKey: apiSecret, result: `dashboard=${dashboardSecret}` }],
    ordinaryTokenCount: 42,
  }
  const output = redactBrowserPayload(input, secrets)
  assert.equal(output.text, '修复 token 统计，不是秘密；实际值=[REDACTED]')
  assert.equal(output.nested[0].apiKey, '[REDACTED]')
  assert.equal(output.nested[0].result, 'dashboard=[REDACTED]')
  assert.equal(output.ordinaryTokenCount, 42)
})

test('文本输出精确替换已知值，不按关键词删除正常内容', () => {
  assert.equal(
    redactKnownSecretText(`token 统计正常；secret 这个单词也正常；值=${apiSecret}`, secrets),
    'token 统计正常；secret 这个单词也正常；值=[REDACTED]',
  )
})

test('嵌套凭据容器递归收集字符串秘密且忽略布尔、数字和普通短词', () => {
  const nestedSecrets = {
    credentials: {
      primary: {
        accessToken: 'nested-access-token-value',
        refresh_token: 'nested-refresh-token-value',
        auth: { clientSecret: 'nested-client-secret-value', enabled: true, retries: 3 },
      },
    },
    providers: [{ api_key: 'nested-api-key-value', cookie: 'nested-session-cookie-value' }],
    password: 'short',
  }
  assert.deepEqual(
    [...collectSensitiveValues(nestedSecrets)].sort(),
    [
      'nested-access-token-value', 'nested-api-key-value', 'nested-client-secret-value',
      'nested-refresh-token-value', 'nested-session-cookie-value',
    ].sort(),
  )
})

test('所有常见敏感字段格式在浏览器 JSON 中被遮蔽', () => {
  const fields = {
    accessToken: 'a', refresh_token: 'b', apiKey: 'c', client_secret: 'd', privateKey: 'e',
    password: 'f', passwd: 'g', pwd: 'h', passphrase: 'i', cookie: 'j', sessionCookie: 'k',
    encryptionKey: 'l', signing_key: 'm', authorization: 'n', bearer: 'o', secret: 'p',
  }
  assert.deepEqual(new Set(Object.values(redactBrowserPayload(fields))), new Set(['[REDACTED]']))
})

test('响应层只处理 JSON/文本，不改写二进制响应', () => {
  class FakeResponse extends EventEmitter {
    headers = new Map()
    chunks = []
    setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value) }
    getHeader(name) { return this.headers.get(String(name).toLowerCase()) }
    hasHeader(name) { return this.headers.has(String(name).toLowerCase()) }
    write(chunk) { this.chunks.push(Buffer.from(chunk)); return true }
    end(chunk) { if (chunk !== undefined) this.chunks.push(Buffer.from(chunk)); return this }
  }
  const json = new FakeResponse()
  json.setHeader('content-type', 'application/json')
  json.setHeader('content-length', '1')
  installBrowserOutputRedaction(json, () => secrets)
  json.end(JSON.stringify({ toolResult: gatewaySecret, authorization: dashboardSecret }))
  const parsed = JSON.parse(Buffer.concat(json.chunks).toString('utf8'))
  assert.equal(parsed.toolResult, '[REDACTED]')
  assert.equal(parsed.authorization, '[REDACTED]')

  const binary = new FakeResponse()
  binary.setHeader('content-type', 'image/png')
  installBrowserOutputRedaction(binary, () => secrets)
  binary.end(Buffer.from(gatewaySecret))
  assert.equal(Buffer.concat(binary.chunks).toString('utf8'), gatewaySecret)
})
