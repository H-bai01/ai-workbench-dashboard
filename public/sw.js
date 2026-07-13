// AI 工作台总控 — 轻量 Service Worker
// 目的：满足 PWA 可安装条件（程序坞启动），同时绝不缓存出过期数据
// 策略：/api 永远走网络；HTML 导航 network-first（离线才回退缓存）；
//       带 hash 的静态资源 cache-first（Vite 产物名带 hash，安全）
const CACHE = 'ai-workbench-static-v4-security'
const PRIVATE_PREFIXES = ['/api', '/gateway-api', '/gateway-ws', '/uploads', '/reset']

function pathMatchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) =>
        k.startsWith('openclaw-dashboard') || (k.startsWith('ai-workbench-static-') && k !== CACHE)
      ).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // 私有接口、Gateway、上传内容：network-only，绝不读取或写入缓存。
  if (PRIVATE_PREFIXES.some(prefix => pathMatchesPrefix(url.pathname, prefix))) {
    event.respondWith(fetch(req, { cache: 'no-store' }))
    return
  }

  // 开发资源与热更新：一律走网络，绝不缓存
  if (url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/src') || url.pathname.startsWith('/.vite-cache') ||
      url.pathname.startsWith('/node_modules') || url.pathname.includes('vite') ||
      url.pathname.startsWith('/ws')) {
    return
  }

  // HTML 导航：network-first（拿最新页面，离线才回退缓存）
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/')))
    )
    return
  }

  // 其它静态资源：cache-first + 后台更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
