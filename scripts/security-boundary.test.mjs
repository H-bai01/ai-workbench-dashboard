import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { JSDOM } from 'jsdom'
import { marked } from 'marked'
import WebSocket, { WebSocketServer } from 'ws'
import { getOrCreateLocalToken } from './dashboard-token.mjs'
import {
  createLocalRequestPolicy,
  normalizeTrustedOrigin,
  validateJsonWriteRequest,
  validateLocalToken,
  validateRequestContext,
} from './security/request-boundary.mjs'
import {
  assertSecureSecretFile,
  normalizeGatewayUrl,
  readGatewayCredentials,
} from './security/gateway-credentials.mjs'
import {
  assertAgentId,
  assertCronId,
  assertSkillId,
  optionValue,
  openClawControlCapability,
  parseCommandTemplate,
  runFileCommand,
} from './security/command-runner.mjs'
import {
  resolvePathWithinRoots,
  safeWriteFileWithinRoots,
} from './security/path-boundary.mjs'
import {
  createReadOnlyDoctorSandbox,
  collectSensitiveValues,
  directoryFingerprint,
  doctorCommand,
  redactDiagnosticResult,
  redactSensitiveText,
} from './security/diagnostics.mjs'
import { attachGatewayWebSocketRelay } from './security/gateway-websocket-relay.mjs'
import { proxyGatewayControlRequest } from './security/gateway-control-proxy.mjs'
import { sensitiveFileReason } from './security/sensitive-files.mjs'
import { normalizeGithubProxy, publicElectricityPerHour } from './security/public-settings.mjs'
import { sealedFeatureForPath, sealedFeaturePayload } from './security/sealed-features.mjs'
import { decodeAndValidateRasterImage, detectRasterImageType, validateRasterImageBuffer } from './security/raster-image.mjs'
import {
  findManagedSkillPaths,
  managedSkillParents,
  resolveSkillReference,
} from './security/skill-paths.mjs'
import { createSafeContentSanitizer, normalizeControlledImageSource, normalizeSafeRasterDataUrl, renderSafeMarkdown } from '../src/utils/safe-content.mjs'
import { GIF_1X1, JPEG_1X1, PNG_1X1, WEBP_1X1 } from './fixtures/raster-images.mjs'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-security-fix1-'))
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

const requestPolicy = createLocalRequestPolicy({ FRONTEND_PORT: '31021' })
const localToken = 'test-local-token-1234567890'

function request(method = 'GET', headers = {}) {
  return { method, headers: { host: '127.0.0.1:31021', 'sec-fetch-site': 'same-origin', ...headers } }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function closeServer(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

function httpRequest(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method: options.method || 'GET' }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

test('同源请求、HEAD、正确 token 与 JSON 写请求通过', () => {
  const req = request('POST', {
    origin: 'http://127.0.0.1:31021',
    'content-type': 'application/json; charset=utf-8',
    'x-dashboard-token': localToken,
  })
  assert.equal(validateRequestContext(req, requestPolicy).ok, true)
  assert.equal(validateRequestContext(request('HEAD'), requestPolicy).ok, true)
  assert.equal(validateLocalToken(req, localToken).ok, true)
  assert.equal(validateJsonWriteRequest(req).ok, true)
})

test('HTTP/2 authority 与 Host 使用同一套严格主机校验', () => {
  const policy = createLocalRequestPolicy({ FRONTEND_PORT: '31021' })
  assert.equal(validateRequestContext({
    method: 'GET',
    headers: { ':authority': '127.0.0.1:31021', origin: 'http://127.0.0.1:31021' },
  }, policy).ok, true)
  assert.equal(validateRequestContext({
    method: 'GET',
    headers: { ':authority': 'evil.example:31021', origin: 'http://127.0.0.1:31021' },
  }, policy).ok, false)
})

test('错误 token、恶意 Origin/Host、跨站表单、非法方法与非 JSON 写入被拒绝', () => {
  assert.equal(validateLocalToken(request(), localToken).status, 401)
  assert.equal(validateLocalToken(request('GET', { 'x-dashboard-token': 'wrong' }), localToken).status, 401)
  assert.equal(validateRequestContext(request('GET', { origin: 'http://evil.example' }), requestPolicy).status, 403)
  assert.equal(validateRequestContext(request('GET', { host: 'evil.example:31021' }), requestPolicy).status, 403)
  assert.equal(validateRequestContext(request('POST', { 'sec-fetch-site': 'cross-site' }), requestPolicy).status, 403)
  assert.equal(validateRequestContext(request('TRACE'), requestPolicy).status, 405)
  assert.equal(validateJsonWriteRequest(request('POST', { 'content-type': 'text/plain' })).status, 415)
  assert.equal(validateJsonWriteRequest(request('POST', { 'content-type': 'application/x-www-form-urlencoded' })).status, 415)
})

test('可信 Origin 只接受规范 origin，拒绝凭据、路径、查询和片段', () => {
  assert.equal(normalizeTrustedOrigin('https://dashboard.example'), 'https://dashboard.example')
  for (const value of [
    'https://user:pass@dashboard.example',
    'https://dashboard.example/path',
    'https://dashboard.example?token=x',
    'https://dashboard.example/#fragment',
    'https://dashboard.example/%2e',
    ' https://dashboard.example',
  ]) assert.equal(normalizeTrustedOrigin(value), '')
})

test('第三方 GitHub 代理默认关闭，电费 0 保留且非法值回退', () => {
  assert.equal(normalizeGithubProxy(undefined), '')
  assert.equal(normalizeGithubProxy(''), '')
  assert.equal(normalizeGithubProxy('https://gh-proxy.example/path/'), 'https://gh-proxy.example/path')
  assert.equal(normalizeGithubProxy('http://gh-proxy.example'), '')
  assert.equal(normalizeGithubProxy('https://user:pass@gh-proxy.example'), '')
  assert.equal(publicElectricityPerHour('0'), 0)
  assert.equal(publicElectricityPerHour(''), 2)
  assert.equal(publicElectricityPerHour('   '), 2)
  assert.equal(publicElectricityPerHour('-1'), 2)
  assert.equal(publicElectricityPerHour('not-a-number'), 2)
})

test('通用文件管理、诊断和自动修复统一标记为暂时停用', () => {
  for (const path of [
    '/api/file-manager/tree', '/api/file-manager/read', '/api/file-manager/write',
    '/api/file-manager/reveal', '/api/file-manager/backups', '/api/file-manager/restore',
    '/api/system/doctor', '/api/system/auto-fix', '/api/system/auto-fix/preview',
  ]) {
    const feature = sealedFeatureForPath(path)
    assert.ok(feature, path)
    assert.deepEqual(sealedFeaturePayload(feature), {
      ok: false,
      unavailable: true,
      feature,
      error: `${feature}暂时停用`,
    })
  }
  assert.equal(sealedFeatureForPath('/api/projects/file'), '')
  assert.equal(sealedFeatureForPath('/api/upload-image'), '')
})

test('图片 Base64、真实类型和最低栅格结构必须一致', () => {
  for (const [mediaType, extension, buffer] of [
    ['image/png', '.png', PNG_1X1], ['image/jpeg', '.jpg', JPEG_1X1],
    ['image/webp', '.webp', WEBP_1X1], ['image/gif', '.gif', GIF_1X1],
  ]) {
    assert.equal(detectRasterImageType(buffer), mediaType)
    const validated = decodeAndValidateRasterImage(buffer.toString('base64'), mediaType)
    assert.equal(validated.mediaType, mediaType)
    assert.equal(validated.extension, extension)
    assert.deepEqual(validated.buffer, buffer)
  }
  assert.throws(() => decodeAndValidateRasterImage('', 'image/png'), /为空/)
  assert.throws(() => decodeAndValidateRasterImage('%%%%', 'image/png'), /Base64/)
  assert.throws(() => decodeAndValidateRasterImage(Buffer.from('random text').toString('base64'), 'image/png'), /有效栅格/)
  assert.throws(() => decodeAndValidateRasterImage(Buffer.from('<svg/>').toString('base64'), 'image/png'), /有效栅格/)
  assert.throws(() => decodeAndValidateRasterImage(JPEG_1X1.toString('base64'), 'image/png'), /不一致/)
  assert.throws(() => validateRasterImageBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'), /有效栅格/)
})

test('敏感文件原名、备份轮转、会话日志和私有祖先目录都被识别', () => {
  const blocked = [
    'openclaw.json.bak', 'openclaw.json.bak.1', 'openclaw.json.old', 'openclaw.json.orig',
    'openclaw.json-backup-20260711', 'auth-profiles.json.20260711.bak', 'auth-state.json.old',
    'device.json.bak', 'paired.json.orig', 'models.json.bak-2', 'sessions.json.bak.1',
    'session.jsonl.gz', 'session.jsonl.1', 'gateway.log.2', '.npmrc', '.netrc', 'id_rsa',
    'id_ed25519', 'server-private-key.pem', 'certificate.key',
    'id_ecdsa', 'id_dsa', 'id_xmss', 'client.pem', 'identity.p12', '.envrc',
    'api-key.txt', 'openclaw.backup.json', 'settings.json.bak.12345', 'search-index.db-shm',
    '/tmp/home/.openclaw/browser/openclaw/user-data/Local State',
    '/tmp/home/.openclaw/logs/config-health.json.bak-20260711',
    '/tmp/home/.openclaw/memory/index.db', '/tmp/home/.openclaw/state/runtime.json',
    '/tmp/home/.openclaw/service-env/runtime.env',
    '/tmp/home/.openclaw/agents/main/agent/models.json',
    '/tmp/home/.openclaw/agents/main/sessions/session.jsonl',
  ]
  for (const value of blocked) assert.ok(sensitiveFileReason(value), value)
  assert.equal(sensitiveFileReason('/tmp/workspace/README.md'), '')
})

test('Gateway 与 Dashboard token 文件必须为本人 0600 普通文件且不能是符号链接', () => {
  const home = path.join(tmpRoot, 'credential-home')
  const openclawDir = path.join(home, '.openclaw')
  fs.mkdirSync(openclawDir, { recursive: true })
  const tokenFile = path.join(openclawDir, 'dashboard-gateway-token')
  fs.writeFileSync(tokenFile, 'file-secret-value', { mode: 0o600 })
  const fromFile = readGatewayCredentials({ env: {}, homeDir: home })
  assert.equal(fromFile.token, 'file-secret-value')
  assert.equal(fromFile.source, 'token-file')
  assert.equal(assertSecureSecretFile(tokenFile), tokenFile)

  fs.chmodSync(tokenFile, 0o644)
  assert.throws(() => readGatewayCredentials({ env: {}, homeDir: home }), /0600/)
  fs.chmodSync(tokenFile, 0o600)
  assert.throws(() => assertSecureSecretFile(tokenFile, { expectedUid: (process.getuid?.() || 0) + 1 }), /当前用户/)

  const linked = path.join(openclawDir, 'linked-token')
  fs.symlinkSync(tokenFile, linked)
  assert.throws(() => readGatewayCredentials({ env: { OPENCLAW_GATEWAY_TOKEN_FILE: linked }, homeDir: home }), /符号链接/)

  const dashboardFile = path.join(openclawDir, 'dashboard-local-token')
  fs.writeFileSync(dashboardFile, 'a'.repeat(64), { mode: 0o600 })
  assert.equal(getOrCreateLocalToken({ tokenFile: dashboardFile }), 'a'.repeat(64))
  fs.chmodSync(dashboardFile, 0o644)
  assert.throws(() => getOrCreateLocalToken({ tokenFile: dashboardFile }), /0600/)
})

test('本机模式拒绝非回环 Gateway 和 URL 内嵌凭据', () => {
  assert.equal(normalizeGatewayUrl('http://127.0.0.1:18789'), 'http://127.0.0.1:18789')
  assert.throws(() => normalizeGatewayUrl('http://192.168.1.2:18789'), /回环/)
  assert.throws(() => normalizeGatewayUrl('https://example.com'), /回环/)
  assert.throws(() => normalizeGatewayUrl('http://user:pass@127.0.0.1:18789'), /凭据/)
})

test('无关子进程拿不到 Gateway token，参数与技能 ID 不能注入额外选项', async () => {
  const marker = path.join(tmpRoot, 'command-injection-marker')
  const maliciousArgument = `safe; touch ${marker}`
  const result = await runFileCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', maliciousArgument], 5000, {
    baseEnv: { ...process.env, OPENCLAW_GATEWAY_TOKEN: 'synthetic-child-secret' },
  })
  assert.equal(result.success, true)
  assert.equal(result.stdout, maliciousArgument)
  assert.equal(fs.existsSync(marker), false)
  const envResult = await runFileCommand(process.execPath, ['-e', 'process.stdout.write(process.env.OPENCLAW_GATEWAY_TOKEN||"missing")'], 5000, {
    baseEnv: { ...process.env, OPENCLAW_GATEWAY_TOKEN: 'synthetic-child-secret' },
  })
  assert.equal(envResult.stdout, 'missing')

  assert.throws(() => assertAgentId('main;touch-pwned'))
  assert.throws(() => assertCronId('--help'))
  for (const value of ['__proto__', 'prototype', 'constructor', '--help', '../skill', '/tmp/skill', 'Owner/Skill']) {
    assert.throws(() => assertSkillId(value))
  }
  assert.equal(assertSkillId('safe-skill'), 'safe-skill')
  assert.equal(assertSkillId('@scope/safe-skill'), '@scope/safe-skill')
  assert.equal(optionValue('--message', '--help'), '--message=--help')
  const parsed = parseCommandTemplate('["tool","--value","{input}"]', { '{input}': maliciousArgument })
  assert.deepEqual(parsed, { command: 'tool', args: ['--value', maliciousArgument] })
})

test('路径边界拒绝穿越、前缀兄弟、现有/目录/悬空链接，并允许安全的新文件', () => {
  const root = path.join(tmpRoot, 'allowed-root')
  const sibling = path.join(tmpRoot, 'allowed-root-copy')
  const outside = path.join(tmpRoot, 'outside-root')
  fs.mkdirSync(root, { recursive: true })
  fs.mkdirSync(sibling, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  const insideFile = path.join(root, 'safe.txt')
  const outsideFile = path.join(outside, 'secret.txt')
  fs.writeFileSync(insideFile, 'safe')
  fs.writeFileSync(outsideFile, 'secret')
  assert.equal(resolvePathWithinRoots(insideFile, [root], { mustExist: true }), fs.realpathSync(insideFile))
  assert.throws(() => resolvePathWithinRoots(`${root}/../outside-root/secret.txt`, [root], { mustExist: true }))
  assert.throws(() => resolvePathWithinRoots(path.join(sibling, 'file.txt'), [root]))

  fs.symlinkSync(outsideFile, path.join(root, 'file-link'))
  fs.symlinkSync(outside, path.join(root, 'dir-link'))
  fs.symlinkSync(path.join(outside, 'missing.txt'), path.join(root, 'dangling-link'))
  assert.throws(() => resolvePathWithinRoots(path.join(root, 'file-link'), [root], { mustExist: true }), /符号链接/)
  assert.throws(() => resolvePathWithinRoots(path.join(root, 'dir-link', 'secret.txt'), [root], { mustExist: true }), /符号链接/)
  assert.throws(() => resolvePathWithinRoots(path.join(root, 'dangling-link', 'child.txt'), [root]), /符号链接/)

  const newFile = path.join(root, 'new-file.md')
  safeWriteFileWithinRoots(newFile, '# safe\n', [root], { encoding: 'utf8' })
  assert.equal(fs.readFileSync(newFile, 'utf8'), '# safe\n')
  assert.throws(() => safeWriteFileWithinRoots(path.join(root, 'file-link'), 'pwned', [root], { encoding: 'utf8' }))
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'secret')
})

test('技能根、references、叶子及悬空符号链接全部关闭失败', () => {
  const home = path.join(tmpRoot, 'skill-home')
  const managedRoot = path.join(home, '.openclaw', 'skills')
  const outside = path.join(tmpRoot, 'skill-outside')
  fs.mkdirSync(managedRoot, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'SKILL.md'), '# outside')
  fs.symlinkSync(outside, path.join(managedRoot, 'linked-root'))
  const roots = managedSkillParents(home)
  assert.equal(findManagedSkillPaths('linked-root', roots), null)

  const skillDir = path.join(managedRoot, 'safe-skill')
  fs.mkdirSync(skillDir)
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# safe')
  const record = findManagedSkillPaths('safe-skill', roots)
  assert.ok(record)
  fs.symlinkSync(outside, path.join(skillDir, 'references'))
  assert.throws(() => resolveSkillReference(record, 'outside'), /符号链接/)
  fs.rmSync(path.join(skillDir, 'references'))
  fs.mkdirSync(path.join(skillDir, 'references'))
  fs.symlinkSync(path.join(outside, 'SKILL.md'), path.join(skillDir, 'references', 'leaf.md'))
  fs.symlinkSync(path.join(outside, 'missing.md'), path.join(skillDir, 'references', 'dangling.md'))
  assert.throws(() => resolveSkillReference(record, 'leaf'), /符号链接/)
  assert.throws(() => resolveSkillReference(record, 'dangling'), /符号链接/)
})

test('XSS、危险链接和 Markdown 解析异常都只产生安全内容', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const safe = createSafeContentSanitizer(dom.window)
  const highlight = safe.sanitizeHighlightHtml('<mark>命中</mark><img src=x onerror="globalThis.pwned=1"><script>alert(1)</script>')
  assert.equal(highlight, '<mark>命中</mark>')
  const markdownHtml = marked.parse('[危险](javascript:alert(1)) <img src=x onerror="alert(1)"> **安全文字**')
  const rich = safe.sanitizeRichHtml(markdownHtml)
  assert.equal(/script|onerror|javascript:/i.test(rich), false)
  assert.match(rich, /安全文字/)
  const safePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const media = safe.sanitizeRichHtml([
    '<img id="external-image" alt="查看来源图片" src="https://evil.example/pixel.png">',
    '<img src="//evil.example/pixel.png">',
    '<img src="http://127.0.0.1:9999/private">',
    '<img src="http://192.168.1.2/private">',
    '<audio autoplay src="https://evil.example/a.mp3"></audio>',
    '<video autoplay><source src="https://evil.example/v.mp4"></video>',
    '<picture><source srcset="https://evil.example/x"><img src="https://evil.example/x"></picture>',
    '<img src="/uploads/safe.png">',
    `<img id="inline-png" src="${safePng}">`,
  ].join(''))
  assert.equal(/<img[^>]+(?:evil\.example|127\.0\.0\.1|192\.168\.1\.2)/i.test(media), false)
  assert.equal(/audio|video|source|picture/i.test(media), false)
  assert.match(media, /\/uploads\/safe\.png/)
  assert.match(media, /data:image\/png;base64/)
  assert.match(media, /id="external-image"/)
  assert.match(media, /href="https:\/\/evil\.example\/pixel\.png"/)
  assert.match(media, /查看来源图片/)
  for (const source of [
    'http:uploads/safe.png', 'http:avatars/a.png', 'http:api/agent-avatar/a',
    '//evil.example/a.png', 'https://evil.example/a.png', 'http://127.0.0.1:9999/a.png',
    'http://192.168.1.2/a.png', 'data:image/svg+xml,<svg/>', 'blob:https://dashboard.invalid/id',
    '/uploads/../secret.png', '/uploads/a.svg', '/uploads/a.png#fragment', '/uploads\\a.png',
  ]) assert.equal(normalizeControlledImageSource(source), '', source)
  assert.equal(normalizeSafeRasterDataUrl(safePng), safePng)
  assert.equal(normalizeSafeRasterDataUrl('data:image/svg+xml;base64,PHN2Zz4='), '')
  assert.equal(normalizeSafeRasterDataUrl('data:image/png;base64,PHN2Zz4='), '')
  assert.equal(normalizeSafeRasterDataUrl(`data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`), '')
  assert.equal(normalizeControlledImageSource('/uploads/safe.png?v=abc-123&evil=1'), '/uploads/safe.png?v=abc-123')
  const safeLink = safe.sanitizeRichHtml('<a href="https://docs.example/path?q=1">文档</a>')
  assert.match(safeLink, /href="https:\/\/docs\.example\/path\?q=1"/)
  assert.match(safeLink, /rel="noopener noreferrer"/)
  const fallback = renderSafeMarkdown('<img src=x onerror="pwned()">', () => { throw new Error('parser failed') })
  assert.equal(fallback, '<pre>&lt;img src=x onerror=&quot;pwned()&quot;&gt;</pre>')
})

test('doctor 只允许 --lint --json 隔离计划，JSON 与文本密钥均被脱敏', () => {
  const monitored = path.join(tmpRoot, 'doctor-monitored')
  fs.mkdirSync(monitored, { recursive: true })
  const config = path.join(monitored, 'openclaw.json')
  fs.writeFileSync(config, '{"gateway":{"auth":{"token":"json-secret"}},"apiKey":"key-secret"}\n', { mode: 0o600 })
  const before = directoryFingerprint(monitored)
  const plan = doctorCommand('darwin')
  assert.deepEqual(plan.args, ['doctor', '--lint', '--json'])
  assert.equal(plan.readOnly, true)
  assert.equal(plan.args.includes('--fix'), false)
  const sandbox = createReadOnlyDoctorSandbox({ configPath: config, tempRoot: tmpRoot })
  assert.notEqual(sandbox.home, monitored)
  assert.equal(path.relative(sandbox.home, sandbox.env.AI_WORKBENCH_HOME).startsWith('..'), false)
  assert.equal(path.relative(sandbox.home, sandbox.env.AI_WORKBENCH_LOCAL_TOKEN_FILE).startsWith('..'), false)
  assert.deepEqual(directoryFingerprint(monitored), before)
  sandbox.cleanup()
  const linkedConfig = path.join(monitored, 'linked-config.json')
  fs.symlinkSync(config, linkedConfig)
  const sandboxesBefore = fs.readdirSync(tmpRoot).filter(name => name.startsWith('openclaw-doctor-readonly-')).sort()
  assert.throws(() => createReadOnlyDoctorSandbox({ configPath: linkedConfig, tempRoot: tmpRoot }), /普通文件/)
  const sandboxesAfter = fs.readdirSync(tmpRoot).filter(name => name.startsWith('openclaw-doctor-readonly-')).sort()
  assert.deepEqual(sandboxesAfter, sandboxesBefore)
  const secrets = ['abc12345', 'def67890', 'ghi12345', 'access123', 'refresh123', 'client123', 'private123', 'pass1234']
  const redacted = redactSensitiveText(JSON.stringify({
    apiKey: secrets[0], token: secrets[1], nested: { secret: secrets[2], accessToken: secrets[3] },
    items: [{ refresh_token: secrets[4], 'client-secret': secrets[5], privateKey: secrets[6], passwd: secrets[7] }],
  }))
  assert.equal(secrets.some(secret => redacted.includes(secret)), false)
  const textRedacted = redactSensitiveText('accessToken=access123 refresh-token: refresh123 clientSecret="client123" private_key=private123 passwd=pass1234')
  assert.equal(secrets.slice(3).some(secret => textRedacted.includes(secret)), false)
  const result = redactDiagnosticResult({
    stdout: 'Authorization: Basic basic-secret\nauthorization=Token token-secret',
    stderr: 'refresh-token=refresh123 clientSecret=client123\npassword=two word password',
    error: '-----BEGIN PRIVATE KEY-----\nprivate123\nremaining-half\n-----END PRIVATE KEY-----',
  })
  for (const secret of ['basic-secret', 'token-secret', 'refresh123', 'client123', 'two word password', 'private123', 'remaining-half']) {
    assert.equal(JSON.stringify(result).includes(secret), false)
  }
  const compound = {
    botToken: 'bot-secret', appSecret: 'app-secret', nested: [{ session_token: 'session-secret' }],
    webhookSecret: 'webhook-secret', secretAccessKey: 'access-key-secret', publicValue: 'keep-me',
  }
  assert.deepEqual([...collectSensitiveValues(compound)].sort(), ['access-key-secret', 'app-secret', 'bot-secret', 'session-secret', 'webhook-secret'].sort())
  const compoundRedacted = redactSensitiveText(JSON.stringify(compound))
  for (const secret of collectSensitiveValues(compound)) assert.equal(compoundRedacted.includes(secret), false)
  assert.match(compoundRedacted, /keep-me/)
  assert.match(redacted, /\[REDACTED\]/)
})

test('Windows 安全控制能力明确返回不可用，不能虚假报告发送成功', () => {
  assert.deepEqual(openClawControlCapability('win32'), {
    supported: false,
    error: 'Windows 的安全 OpenClaw 控制入口尚未接入，消息未发送',
  })
  assert.equal(openClawControlCapability('darwin').supported, true)
})

test('WebSocket 拒绝非法来源，协议 4 握手成功且不兼容协议由模拟 Gateway 主动拒绝', async () => {
  const upstreamHttp = http.createServer()
  const upstreamWss = new WebSocketServer({ server: upstreamHttp, path: '/ws' })
  const upstreamPort = await listen(upstreamHttp)
  const connectMessages = []
  upstreamWss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'test' } }))
    socket.on('message', data => {
      const message = JSON.parse(data.toString())
      connectMessages.push(message)
      const min = Number(message?.params?.minProtocol)
      const max = Number(message?.params?.maxProtocol)
      if (min <= 4 && max >= 4) socket.send(JSON.stringify({ type: 'res', id: message.id, ok: true, payload: { type: 'hello-ok', protocol: 4 } }))
      else socket.send(JSON.stringify({ type: 'res', id: message.id, ok: false, error: { message: 'protocol mismatch' } }))
    })
  })

  const relayHttp = http.createServer((_req, res) => { res.writeHead(404); res.end() })
  const relayWss = attachGatewayWebSocketRelay(relayHttp, {
    gatewayUrl: `http://127.0.0.1:${upstreamPort}`,
    gatewayToken: 'server-only-gateway-secret',
    localToken,
    requestPolicy,
    maxConnections: 2,
  })
  const relayPort = await listen(relayHttp)

  const missingTokenStatus = await new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}/gateway-ws`, {
      origin: 'http://127.0.0.1:31021',
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    client.once('unexpected-response', (_request, response) => resolve(response.statusCode))
    client.once('open', () => reject(new Error('缺失 token 的 WebSocket 不应连接成功')))
    client.once('error', () => {})
  })
  assert.equal(missingTokenStatus, 401)

  const rejectedStatus = await new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}/gateway-ws`, {
      origin: 'http://evil.example',
      headers: { 'x-dashboard-token': localToken, 'sec-fetch-site': 'cross-site' },
    })
    client.once('unexpected-response', (_request, response) => resolve(response.statusCode))
    client.once('open', () => reject(new Error('恶意 WebSocket 不应连接成功')))
    client.once('error', () => {})
  })
  assert.equal(rejectedStatus, 403)

  const connect = async (maxProtocol) => {
    const browser = new WebSocket(`ws://127.0.0.1:${relayPort}/gateway-ws`, {
      origin: 'http://127.0.0.1:31021',
      headers: { 'x-dashboard-token': localToken, 'sec-fetch-site': 'same-origin' },
    })
    await new Promise((resolve, reject) => { browser.once('open', resolve); browser.once('error', reject) })
    return new Promise((resolve, reject) => {
      browser.on('message', data => {
        const message = JSON.parse(data.toString())
        if (message.event === 'connect.challenge') {
          browser.send(JSON.stringify({ type: 'req', id: `p${maxProtocol}`, method: 'connect', params: { minProtocol: 3, maxProtocol, auth: {} } }))
        } else if (message.type === 'res') {
          browser.close()
          resolve(message)
        }
      })
      browser.once('error', reject)
    })
  }
  assert.equal((await connect(4)).ok, true)
  assert.equal((await connect(3)).ok, false)
  assert.equal(connectMessages[0].params.auth.token, 'server-only-gateway-secret')

  for (const client of upstreamWss.clients) client.terminate()
  relayWss.close()
  upstreamWss.close()
  await closeServer(relayHttp)
  await closeServer(upstreamHttp)
})

test('WebSocket 中继限制并发、消息大小、等待队列和上游握手时间', async () => {
  const upstreamHttp = http.createServer()
  const upstreamWss = new WebSocketServer({ server: upstreamHttp, path: '/ws' })
  const upstreamPort = await listen(upstreamHttp)
  const relayHttp = http.createServer((_req, res) => { res.writeHead(404); res.end() })
  const relayWss = attachGatewayWebSocketRelay(relayHttp, {
    gatewayUrl: `http://127.0.0.1:${upstreamPort}`,
    gatewayToken: 'server-only-gateway-secret',
    localToken,
    requestPolicy,
    maxConnections: 1,
    maxMessageBytes: 64,
  })
  const relayPort = await listen(relayHttp)
  const options = {
    origin: 'http://127.0.0.1:31021',
    headers: { 'x-dashboard-token': localToken, 'sec-fetch-site': 'same-origin' },
  }
  const first = new WebSocket(`ws://127.0.0.1:${relayPort}/gateway-ws`, options)
  await new Promise((resolve, reject) => { first.once('open', resolve); first.once('error', reject) })
  const secondStatus = await new Promise((resolve, reject) => {
    const second = new WebSocket(`ws://127.0.0.1:${relayPort}/gateway-ws`, options)
    second.once('unexpected-response', (_request, response) => resolve(response.statusCode))
    second.once('open', () => reject(new Error('connection limit was not enforced')))
    second.once('error', () => {})
  })
  assert.equal(secondStatus, 429)
  const closeCode = new Promise(resolve => first.once('close', resolve))
  first.send('x'.repeat(128))
  assert.equal(await closeCode, 1009)
  for (const client of upstreamWss.clients) client.terminate()
  relayWss.close()
  upstreamWss.close()
  await closeServer(relayHttp)
  await closeServer(upstreamHttp)

  class StalledUpstream extends EventEmitter {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 3
    constructor() {
      super()
      this.readyState = StalledUpstream.CONNECTING
    }
    send() {}
    close() { this.readyState = StalledUpstream.CLOSED; this.emit('close') }
    terminate() { this.readyState = StalledUpstream.CLOSED; this.emit('close') }
  }

  const queueHttp = http.createServer((_req, res) => { res.writeHead(404); res.end() })
  const queueRelay = attachGatewayWebSocketRelay(queueHttp, {
    gatewayUrl: 'http://127.0.0.1:18789',
    gatewayToken: 'server-only-gateway-secret',
    localToken,
    requestPolicy,
    WebSocketImpl: StalledUpstream,
    maxQueueMessages: 1,
    maxQueueBytes: 128,
    upstreamHandshakeTimeoutMs: 1000,
  })
  const queuePort = await listen(queueHttp)
  const queuedBrowser = new WebSocket(`ws://127.0.0.1:${queuePort}/gateway-ws`, options)
  await new Promise((resolve, reject) => { queuedBrowser.once('open', resolve); queuedBrowser.once('error', reject) })
  const queueClose = new Promise(resolve => queuedBrowser.once('close', resolve))
  queuedBrowser.send('{"one":1}')
  queuedBrowser.send('{"two":2}')
  assert.equal(await queueClose, 1013)
  queueRelay.close()
  await closeServer(queueHttp)

  const timeoutHttp = http.createServer((_req, res) => { res.writeHead(404); res.end() })
  const timeoutRelay = attachGatewayWebSocketRelay(timeoutHttp, {
    gatewayUrl: 'http://127.0.0.1:18789',
    gatewayToken: 'server-only-gateway-secret',
    localToken,
    requestPolicy,
    WebSocketImpl: StalledUpstream,
    upstreamHandshakeTimeoutMs: 20,
  })
  const timeoutPort = await listen(timeoutHttp)
  const timeoutBrowser = new WebSocket(`ws://127.0.0.1:${timeoutPort}/gateway-ws`, options)
  await new Promise((resolve, reject) => { timeoutBrowser.once('open', resolve); timeoutBrowser.once('error', reject) })
  assert.equal(await new Promise(resolve => timeoutBrowser.once('close', resolve)), 1013)
  timeoutRelay.close()
  await closeServer(timeoutHttp)
})

test('Gateway 控制台 HTTP 代理注入服务端凭据、桥接脚本不含密钥且深链/资源正常', async () => {
  const upstreamAuth = []
  const upstream = http.createServer((req, res) => {
    upstreamAuth.push(req.headers.authorization || '')
    if (req.url === '/assets/app.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' })
      res.end('window.gatewayAppLoaded=true')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "script-src 'self'" })
    res.end('<!doctype html><html><head><title>Mock Control</title><script type="module" src="./assets/app.js"></script></head><body>ok</body></html>')
  })
  const upstreamPort = await listen(upstream)
  const proxy = http.createServer((req, res) => proxyGatewayControlRequest(req, res, {
    gatewayUrl: `http://127.0.0.1:${upstreamPort}`,
    gatewayToken: 'proxy-only-secret',
  }))
  const proxyPort = await listen(proxy)
  const root = await httpRequest(proxyPort, '/gateway-api/')
  assert.equal(root.status, 200)
  assert.match(root.body, /__dashboard_bridge__\.js/)
  assert.equal(root.body.includes('proxy-only-secret'), false)
  const bridge = await httpRequest(proxyPort, '/gateway-api/__dashboard_bridge__.js')
  assert.equal(bridge.status, 200)
  assert.match(bridge.body, /\/gateway-ws/)
  assert.equal(bridge.body.includes('proxy-only-secret'), false)
  assert.equal((await httpRequest(proxyPort, '/gateway-api/assets/app.js')).status, 200)
  assert.equal((await httpRequest(proxyPort, '/gateway-api/chat?session=main')).status, 200)
  assert.ok(upstreamAuth.every(value => value === 'Bearer proxy-only-secret'))
  await closeServer(proxy)
  await closeServer(upstream)
})

test('浏览器源码无动态环境读取、密钥或直连后端，Service Worker 私有路由 network-only', () => {
  const repo = path.resolve(import.meta.dirname, '..')
  const browserFiles = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (/\.(?:ts|vue|mjs)$/.test(entry.name)) browserFiles.push(full)
    }
  }
  visit(path.join(repo, 'src'))
  const source = browserFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n')
  assert.equal(/import\.meta\.env(?!\.DEV\b)/.test(source), false)
  assert.equal(/VITE_GATEWAY_TOKEN|VITE_BACKEND_URL|getAuthToken|https?:\/\/(?:127\.0\.0\.1|localhost):31022/.test(source), false)
  assert.equal(/[?#&]token=/.test(source), false)
  assert.match(source, /\/gateway-api/)
  assert.match(source, /\/gateway-ws/)
  const fileManager = fs.readFileSync(path.join(repo, 'src', 'components', 'FileManagerDialog.vue'), 'utf8')
  const markdownBlock = fileManager.match(/const renderedMarkdown[\s\S]*?const prettifiedJson/)?.[0] || ''
  assert.match(markdownBlock, /renderSafeMarkdown/)
  assert.equal(/catch\s*\{[\s\S]*?return\s+content\.value\.content/.test(markdownBlock), false)

  const sw = fs.readFileSync(path.join(repo, 'public', 'sw.js'), 'utf8')
  assert.match(sw, /openclaw-dashboard/)
  for (const route of ['/gateway-api', '/gateway-ws', '/api', '/uploads']) assert.ok(sw.includes(`'${route}'`))
  assert.match(sw, /cache:\s*'no-store'/)
  assert.equal(/const CACHE = 'openclaw-dashboard/.test(sw), false)
})

test('Service Worker 激活时清除全部旧缓存，私有路由实际执行 network-only', async () => {
  const repo = path.resolve(import.meta.dirname, '..')
  const source = fs.readFileSync(path.join(repo, 'public', 'sw.js'), 'utf8')
  const handlers = {}
  const deleted = []
  const fetchCalls = []
  let cacheMatchCalls = 0
  const context = {
    URL,
    Promise,
    self: {
      location: { origin: 'http://127.0.0.1:31021' },
      clients: { claim: async () => true },
      skipWaiting() {},
      addEventListener(name, handler) { handlers[name] = handler },
    },
    caches: {
      async keys() { return ['openclaw-dashboard-v1', 'openclaw-dashboard-v3', 'ai-workbench-static-v3', 'unrelated-cache'] },
      async delete(key) { deleted.push(key); return true },
      async match() { cacheMatchCalls++; return null },
      async open() { throw new Error('private route must not open a cache') },
    },
    async fetch(request, options) { fetchCalls.push({ request, options }); return { status: 200 } },
  }
  vm.runInNewContext(source, context)
  let activation
  handlers.activate({ waitUntil(promise) { activation = promise } })
  await activation
  assert.deepEqual(deleted.sort(), ['ai-workbench-static-v3', 'openclaw-dashboard-v1', 'openclaw-dashboard-v3'])

  for (const pathname of ['/api/usage', '/gateway-api/', '/gateway-ws', '/uploads/test.png']) {
    let responsePromise
    const requestObject = { method: 'GET', url: `http://127.0.0.1:31021${pathname}`, headers: { get() { return '' } } }
    handlers.fetch({ request: requestObject, respondWith(promise) { responsePromise = promise } })
    await responsePromise
  }
  assert.equal(fetchCalls.length, 4)
  assert.ok(fetchCalls.every(call => call.options?.cache === 'no-store'))
  assert.equal(cacheMatchCalls, 0)
})
