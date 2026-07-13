import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createLogger, defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { getOrCreateLocalToken } from './scripts/dashboard-token.mjs'
import {
  applyTrustedCorsHeaders,
  createLocalRequestPolicy,
  isProtectedLocalPath,
  normalizeTrustedOrigin,
  sendBoundaryError,
  validateJsonWriteRequest,
  validateRequestContext,
} from './scripts/security/request-boundary.mjs'
import { formatPrivacyLog } from './src/utils/log-privacy.mjs'

// 读取 package.json 版本号
const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf-8'))

function isLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
}

function localIpv4Addresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address)
    }
  }
  return addresses
}

function loadLocalHttpsConfig(env: Record<string, string | undefined>) {
  if (env.OPENCLAW_HTTPS !== '1') return undefined

  const certDir = path.join(os.homedir(), '.openclaw', 'dashboard-certs')
  const keyPath = path.join(certDir, 'openclaw-dashboard.key')
  const certPath = path.join(certDir, 'openclaw-dashboard.crt')
  mkdirSync(certDir, { recursive: true })

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    const san = [
      'DNS:localhost',
      'IP:127.0.0.1',
      'IP:::1',
      ...localIpv4Addresses().map(ip => `IP:${ip}`),
    ].join(',')
    try {
      execFileSync('openssl', [
        'req',
        '-x509',
        '-newkey', 'rsa:2048',
        '-nodes',
        '-sha256',
        '-days', '825',
        '-subj', '/CN=AI Workbench Control Local',
        '-addext', `subjectAltName=${san}`,
        '-keyout', keyPath,
        '-out', certPath,
      ], { stdio: 'ignore', shell: false })
      console.log(formatPrivacyLog({ scope: 'vite', level: 'info', event: 'tls', args: [{ ok: true }] }))
    } catch (e: any) {
      console.warn(formatPrivacyLog({ scope: 'vite', level: 'warn', event: 'tls', args: [e] }))
      return undefined
    }
  }

  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }
}

function localRequestBoundaryPlugin(requestPolicy: ReturnType<typeof createLocalRequestPolicy>) {
  return {
    name: 'openclaw-local-request-boundary',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!isProtectedLocalPath(req.url)) return next()
        const context = validateRequestContext(req, requestPolicy)
        if (!context.ok) return sendBoundaryError(res, context)
        applyTrustedCorsHeaders(req, res, requestPolicy.allowedOrigins)
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        const content = validateJsonWriteRequest(req)
        if (!content.ok) return sendBoundaryError(res, content)
        next()
      })
    },
  }
}

function smartVoiceEntryRedirectPlugin(trustedHttpsOrigin: string) {
  let trustedHttpsHost = ''
  try { trustedHttpsHost = trustedHttpsOrigin ? new URL(trustedHttpsOrigin).hostname : '' } catch { /* invalid origin is ignored */ }
  return {
    name: 'openclaw-smart-voice-entry',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const isHttpsServer = process.env.OPENCLAW_HTTPS === '1'
        const frontendPort = process.env.FRONTEND_PORT || '31021'
        if (isHttpsServer || frontendPort !== '31021') {
          next()
          return
        }

        const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
        if (forwardedProto === 'https') {
          next()
          return
        }

        const hostHeader = String(req.headers.host || '')
        const hostname = hostHeader.replace(/^\[/, '').replace(/\].*$/, '').split(':')[0]
        if (!hostname || isLoopbackHost(hostname) || hostname === trustedHttpsHost || !trustedHttpsOrigin) {
          next()
          return
        }

        const target = `${trustedHttpsOrigin}${req.url || '/'}`
        res.statusCode = 302
        res.setHeader('Location', target)
        res.setHeader('Cache-Control', 'no-store')
        res.end(`Redirecting to ${target}`)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env: Record<string, string> = process.env.OPENCLAW_SKIP_DOTENV === '1'
    ? {}
    : loadEnv(mode, process.cwd(), ['OPENCLAW_', 'FRONTEND_', 'BACKEND_'])
  const serverEnv: Record<string, string | undefined> = { ...env, ...process.env }
  const frontendPort = parseInt(serverEnv.FRONTEND_PORT || '31021', 10)
  const backendPort = parseInt(serverEnv.BACKEND_PORT || '31022', 10)
  const https = loadLocalHttpsConfig(serverEnv)
  const localToken = getOrCreateLocalToken()
  const requestPolicy = createLocalRequestPolicy(serverEnv)
  const trustedHttpsOrigin = String(serverEnv.OPENCLAW_DASHBOARD_TRUSTED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .map(normalizeTrustedOrigin)
    .find(value => value.startsWith('https://')) || ''
  const trustedHosts = [...requestPolicy.allowedHosts].filter(host => !isLoopbackHost(host))
  const requestAllowedForProxy = (req: any) => {
    const context = validateRequestContext(req, requestPolicy)
    if (!context.ok) return context
    return validateJsonWriteRequest(req)
  }
  const backendProxy = {
    target: `http://localhost:${backendPort}`,
    changeOrigin: true,
    configure(proxy: any) {
      proxy.on('proxyReq', (proxyReq: any, req: any) => {
        const decision = requestAllowedForProxy(req)
        if (!decision.ok) return proxyReq.destroy(new Error(decision.error))
        proxyReq.setHeader('X-Dashboard-Token', localToken)
      })
      proxy.on('proxyReqWs', (proxyReq: any, req: any) => {
        const decision = validateRequestContext(req, { ...requestPolicy, allowedMethods: new Set(['GET']), websocket: true })
        if (!decision.ok) return proxyReq.destroy(new Error(decision.error))
        proxyReq.setHeader('X-Dashboard-Token', localToken)
      })
    },
  }
  console.log(formatPrivacyLog({ scope: 'vite', level: 'info', event: 'startup', args: [{ ok: true, count: 2 }] }))
  const viteLogger = createLogger()
  const originalInfo = viteLogger.info.bind(viteLogger)
  const originalWarn = viteLogger.warn.bind(viteLogger)
  const originalWarnOnce = viteLogger.warnOnce.bind(viteLogger)
  const originalError = viteLogger.error.bind(viteLogger)
  viteLogger.info = (message, options) => originalInfo(formatPrivacyLog({ scope: 'vite', level: 'info', args: [message] }), options)
  viteLogger.warn = (message, options) => originalWarn(formatPrivacyLog({ scope: 'vite', level: 'warn', args: [message] }), options)
  viteLogger.warnOnce = (message, options) => originalWarnOnce(formatPrivacyLog({ scope: 'vite', level: 'warn', args: [message] }), options)
  viteLogger.error = (message, options) => originalError(formatPrivacyLog({ scope: 'vite', level: 'error', args: [message] }), options)

  return {
    customLogger: viteLogger,
    cacheDir: serverEnv.OPENCLAW_VITE_CACHE_DIR || '.vite-cache',
    // Vite's default VITE_ namespace is deliberately disabled. Browser-visible
    // settings come only from the explicit /api/public-config response.
    envPrefix: 'DASHBOARD_PUBLIC_',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      localRequestBoundaryPlugin(requestPolicy),
      smartVoiceEntryRedirectPlugin(trustedHttpsOrigin),
      vue(),
      AutoImport({
        resolvers: [ElementPlusResolver()],
      }),
      Components({
        resolvers: [ElementPlusResolver()],
      }),
    ],
    server: {
      host: serverEnv.FRONTEND_HOST || '127.0.0.1',
      port: frontendPort,
      strictPort: true,
      https,
      allowedHosts: trustedHosts,
      proxy: {
        '/gateway-api': { ...backendProxy },
        '/gateway-ws': { ...backendProxy, ws: true },
        '/api': { ...backendProxy },
        '/reset': { ...backendProxy },
        '/uploads': { ...backendProxy },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (id.includes('element-plus')) return 'element-plus'
              if (id.includes('vue') || id.includes('pinia')) return 'vendor'
              return 'async-vendor'
            }
          },
        },
      },
    },
  }
})
