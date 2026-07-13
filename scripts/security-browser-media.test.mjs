import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'
import { resolveTestBrowserExecutable } from './test-browser-executable.mjs'
import { GIF_1X1, JPEG_1X1, PNG_1X1, WEBP_1X1 } from './fixtures/raster-images.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const temporaryRoots = []
let backend
let frontend
let tracker
let browser
let context
let page
let home
let frontendPort
let backendPort
let trackerPort
let maliciousMarker
const observedRequests = []

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

function requestHttp(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      timeout: 1500,
    }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.once('timeout', () => req.destroy(new Error('request timeout')))
    req.once('error', reject)
  })
}

async function waitForFrontend(requestPath = '/', timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await requestHttp(frontendPort, requestPath)
      if (response.status === 200) return response
    } catch { /* startup in progress */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`temporary frontend did not serve ${requestPath}`)
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 4000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

before(async () => {
  const executablePath = resolveTestBrowserExecutable()
  assert.ok(executablePath, '真实 Chrome/Chromium 是媒体安全测试的必要条件')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-browser-media-'))
  temporaryRoots.push(root)
  home = path.join(root, 'home')
  const openclawDir = path.join(home, '.openclaw')
  const workspace = path.join(root, 'workspace')
  const avatarDir = path.join(workspace, 'avatars')
  const dataRoot = path.join(root, 'dashboard-data')
  const uploads = path.join(dataRoot, 'uploads')
  fs.mkdirSync(openclawDir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(avatarDir, { recursive: true })
  fs.mkdirSync(uploads, { recursive: true })
  fs.writeFileSync(path.join(openclawDir, 'dashboard-local-token'), 'e'.repeat(64), { mode: 0o600 })

  frontendPort = await freePort()
  backendPort = await freePort()
  trackerPort = await freePort()
  maliciousMarker = `svg-executed-${Date.now()}`
  const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><script>localStorage.setItem('svg-executed','${maliciousMarker}');fetch('http://127.0.0.1:${trackerPort}/svg-script')</script><image href="http://127.0.0.1:${trackerPort}/svg-image" onload="localStorage.setItem('svg-onload','yes')"/></svg>`
  fs.writeFileSync(path.join(avatarDir, 'malicious.svg'), maliciousSvg)
  fs.writeFileSync(path.join(openclawDir, 'openclaw.json'), JSON.stringify({
    agents: {
      defaults: { workspace },
      list: [{ id: 'test-agent', workspace, identity: { name: 'Test Agent', avatar: 'avatars/malicious.svg' } }],
    },
  }), { mode: 0o600 })
  fs.writeFileSync(path.join(uploads, 'safe.png'), PNG_1X1)
  fs.writeFileSync(path.join(uploads, 'safe.jpg'), JPEG_1X1)
  fs.writeFileSync(path.join(uploads, 'safe.webp'), WEBP_1X1)
  fs.writeFileSync(path.join(uploads, 'safe.gif'), GIF_1X1)

  tracker = http.createServer((req, res) => {
    observedRequests.push(req.url || '/')
    res.writeHead(204)
    res.end()
  })
  await new Promise((resolve, reject) => {
    tracker.once('error', reject)
    tracker.listen(trackerPort, '127.0.0.1', resolve)
  })

  const commonEnv = createIsolatedProcessEnv({
    isolationRoot: root,
    homeDir: home,
    overrides: {
      FRONTEND_HOST: '127.0.0.1',
      BACKEND_HOST: '127.0.0.1',
      FRONTEND_PORT: String(frontendPort),
      BACKEND_PORT: String(backendPort),
      OPENCLAW_DASHBOARD_DATA_ROOT: dataRoot,
      OPENCLAW_DASHBOARD_TRUSTED_ORIGINS: `http://127.0.0.1:${frontendPort}`,
      OPENCLAW_VITE_CACHE_DIR: path.join(root, 'vite-cache'),
    },
  })
  backend = spawn(process.execPath, ['scripts/unified-service.js'], {
    cwd: repo,
    env: commonEnv,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const backendDeadline = Date.now() + 20000
  while (Date.now() < backendDeadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`)
      if (response.ok) break
    } catch { /* startup in progress */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const viteBin = path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js')
  frontend = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort', '--force'], {
    cwd: repo,
    env: commonEnv,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForFrontend()

  browser = await chromium.launch({ headless: true, executablePath })
  context = await browser.newContext()
  context.on('request', request => observedRequests.push(request.url()))
  page = await context.newPage()
  await page.goto(`http://127.0.0.1:${frontendPort}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.dashboard', { timeout: 15000 })
})

after(async () => {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await stop(frontend)
  await stop(backend)
  tracker?.closeAllConnections?.()
  await new Promise(resolve => tracker?.close(() => resolve()) || resolve())
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true })
})

test('真实页面拒绝畸形及外部媒体，但保留受控位图和普通 HTTPS 链接', async () => {
  const directImage = await requestHttp(frontendPort, '/uploads/safe.png?v=fixture')
  assert.equal(directImage.status, 200)
  assert.equal(directImage.headers['content-type'], 'image/png')
  const imageFailures = []
  const imageResponses = []
  const consoleMessages = []
  const recordFailure = request => imageFailures.push(`${request.url()}: ${request.failure()?.errorText || 'unknown'}`)
  const recordResponse = response => {
    if (response.url().includes('/uploads/safe.png')) imageResponses.push(`${response.status()} ${response.headers()['content-type'] || ''}`)
  }
  const recordConsole = message => consoleMessages.push(message.text())
  page.on('requestfailed', recordFailure)
  page.on('response', recordResponse)
  page.on('console', recordConsole)
  const result = await page.evaluate(async ({ trackerPort }) => {
    const probe = await fetch('/uploads/safe.png?v=probe')
    if (!probe.ok) throw new Error(`受控 PNG 探测失败: ${probe.status} ${await probe.text()}`)
    const { sanitizeRichHtml } = await import('/src/utils/safe-content.mjs')
    const html = sanitizeRichHtml([
      '<img id="bad-relative" src="http:uploads/leak.png">',
      '<img id="bad-avatar" src="http:avatars/leak.png">',
      '<img id="bad-agent" src="http:api/agent-avatar/leak">',
      '<img id="bad-network" src="//example.invalid/leak.png">',
      `<img id="bad-local" src="http://127.0.0.1:${trackerPort}/local.png">`,
      '<img id="bad-data" src="data:image/svg+xml,<svg onload=alert(1)>">',
      '<img id="safe-inline" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">',
      '<img id="external-manual" alt="手动查看外部图片" src="https://example.invalid/manual.png">',
      '<audio autoplay src="https://example.invalid/audio.mp3"></audio>',
      '<video autoplay src="https://example.invalid/video.mp4"></video>',
      '<picture><source srcset="https://example.invalid/picture.webp"><img src="https://example.invalid/fallback.png"></picture>',
      '<img id="safe-image" src="/uploads/safe.png?v=fixture">',
      '<img id="safe-jpeg" src="/uploads/safe.jpg">',
      '<img id="safe-webp" src="/uploads/safe.webp">',
      '<img id="safe-gif" src="/uploads/safe.gif">',
      '<a id="safe-link" href="https://docs.example.com/guide">文档</a>',
    ].join(''))
    const holder = document.createElement('div')
    holder.innerHTML = html
    document.body.append(holder)
    const safeImage = holder.querySelector('#safe-image')
    const inlineImage = holder.querySelector('#safe-inline')
    const waitForImage = (image, label) => new Promise((resolve, reject) => {
      if (image.complete && image.naturalWidth > 0) return resolve()
      image.addEventListener('load', resolve, { once: true })
      image.addEventListener('error', () => reject(new Error(`${label} 未加载: ${image.currentSrc || image.src}`)), { once: true })
    })
    await Promise.all([
      waitForImage(safeImage, '受控 PNG'),
      waitForImage(holder.querySelector('#safe-jpeg'), '受控 JPEG'),
      waitForImage(holder.querySelector('#safe-webp'), '受控 WebP'),
      waitForImage(holder.querySelector('#safe-gif'), '受控 GIF'),
    ])
    await new Promise((resolve, reject) => {
      if (inlineImage.complete && inlineImage.naturalWidth > 0) return resolve()
      inlineImage.addEventListener('load', resolve, { once: true })
      inlineImage.addEventListener('error', () => reject(new Error('合法 base64 PNG 未显示')), { once: true })
    })
    const link = holder.querySelector('#safe-link')
    return {
      html: holder.innerHTML,
      imageSrc: safeImage.getAttribute('src'),
      imageWidth: safeImage.naturalWidth,
      inlineSource: holder.querySelector('#safe-inline')?.getAttribute('src') || '',
      inlineWidth: inlineImage.naturalWidth,
      externalTag: holder.querySelector('#external-manual')?.tagName || '',
      externalHref: holder.querySelector('#external-manual')?.getAttribute('href') || '',
      externalText: holder.querySelector('#external-manual')?.textContent || '',
      href: link.getAttribute('href'),
      target: link.getAttribute('target'),
      rel: link.getAttribute('rel'),
      mediaCount: holder.querySelectorAll('audio,video,source,track,picture').length,
      imageCount: holder.querySelectorAll('img').length,
    }
  }, { trackerPort }).catch(error => {
    throw new Error(`${error.message}; responses=${imageResponses.join(' | ') || 'none'}; request failures=${imageFailures.join(' | ') || 'none'}; console=${consoleMessages.join(' | ') || 'none'}`)
  }).finally(() => {
    page.off('requestfailed', recordFailure)
    page.off('response', recordResponse)
    page.off('console', recordConsole)
  })
  assert.equal(result.imageCount, 5)
  assert.equal(result.mediaCount, 0)
  assert.equal(result.imageSrc, '/uploads/safe.png?v=fixture')
  assert.equal(result.imageWidth, 1)
  assert.match(result.inlineSource, /^data:image\/png;base64,/)
  assert.equal(result.inlineWidth, 1)
  assert.equal(result.externalTag, 'A')
  assert.equal(result.externalHref, 'https://example.invalid/manual.png')
  assert.equal(result.externalText, '手动查看外部图片')
  assert.equal(result.href, 'https://docs.example.com/guide')
  assert.equal(result.target, '_blank')
  assert.match(result.rel, /noopener/)
  assert.match(result.rel, /noreferrer/)
  await page.waitForTimeout(300)
  assert.equal(observedRequests.some(value => String(value).includes(`127.0.0.1:${trackerPort}`)), false)
  assert.equal(observedRequests.some(value => /example\.invalid\/(?:leak|audio|video|picture|fallback)/.test(String(value))), false)
  assert.equal(observedRequests.some(value => /example\.invalid\/manual\.png/.test(String(value))), false)
})

test('配置的恶意 SVG 头像被拒绝，直接导航不执行脚本或外部资源', async () => {
  const avatarResponse = await requestHttp(frontendPort, '/api/agent-avatar/test-agent')
  assert.equal(avatarResponse.status, 200)
  assert.equal(avatarResponse.body.includes(Buffer.from(maliciousMarker)), false)
  assert.match(String(avatarResponse.headers['content-security-policy']), /script-src 'none'/)
  assert.match(String(avatarResponse.headers['content-security-policy']), /sandbox/)
  assert.equal(avatarResponse.headers['x-content-type-options'], 'nosniff')
  assert.equal(avatarResponse.headers['referrer-policy'], 'no-referrer')

  await page.goto(`http://127.0.0.1:${frontendPort}/api/agent-avatar/test-agent`, { waitUntil: 'load' })
  await page.waitForTimeout(300)
  await page.goto(`http://127.0.0.1:${frontendPort}/`, { waitUntil: 'domcontentloaded' })
  const storage = await page.evaluate(() => ({
    script: localStorage.getItem('svg-executed'),
    onload: localStorage.getItem('svg-onload'),
  }))
  assert.deepEqual(storage, { script: null, onload: null })
  assert.equal(observedRequests.some(value => String(value).includes(`127.0.0.1:${trackerPort}`)), false)
})
