import './log-privacy-bootstrap'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
// 设置 dayjs 中文 locale
dayjs.locale('zh-cn')

import App from './App.vue'
import router from './router'
import { clearLegacyGatewayCredential } from './config/auth'
import { loadDashboardPublicConfig } from './config/public'

clearLegacyGatewayCredential()
await loadDashboardPublicConfig()

// 初始主题：按用户保存的偏好决定 Element 的 dark 模式（useTheme 接管后续切换）
import './style.css'
if (localStorage.getItem('openclaw-theme') !== 'light') {
  document.documentElement.classList.add('dark')
}

const app = createApp(App)
const pinia = createPinia()

// Register all Element Plus icons globally
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(pinia)
app.use(router)
app.use(ElementPlus, {
  locale: zhCn,
})

app.mount('#app')

const APP_CHROME_TITLE_TEXT = 'AI 工作台总控'

function normalizeInjectedTitlebarText(text: string | null | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function findInjectedTitlebarHost(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element
  let best: HTMLElement | null = null

  while (node && node !== document.body) {
    const rect = node.getBoundingClientRect()
    if (
      rect.top <= 80 &&
      rect.bottom >= 0 &&
      rect.height > 0 &&
      rect.height <= 96 &&
      rect.width >= Math.min(window.innerWidth * 0.4, 480)
    ) {
      best = node
    }
    node = node.parentElement
  }

  if (best) {
    return best
  }

  let directChild: HTMLElement | null = element
  while (directChild.parentElement && directChild.parentElement !== document.body) {
    directChild = directChild.parentElement
  }

  return directChild.id === 'app' ? null : directChild
}

function hideInjectedAppTitlebar(): void {
  if (!document.body) {
    return
  }

  for (const element of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (element.closest('#app')) {
      continue
    }

    const tagName = element.tagName.toLowerCase()
    if (['script', 'style', 'link', 'meta', 'noscript'].includes(tagName)) {
      continue
    }

    const text = normalizeInjectedTitlebarText(element.textContent)
    if (!text.includes(APP_CHROME_TITLE_TEXT) || text.length > 48) {
      continue
    }

    const host = findInjectedTitlebarHost(element)
    if (!host || host.id === 'app' || host.closest('#app')) {
      continue
    }

    const rect = host.getBoundingClientRect()
    if (rect.top > 96 || rect.height > 120) {
      continue
    }

    host.setAttribute('data-openclaw-hidden-app-titlebar', 'true')
    host.style.setProperty('display', 'none', 'important')
  }
}

function installInjectedTitlebarGuard(): void {
  const run = () => requestAnimationFrame(hideInjectedAppTitlebar)

  run()
  window.addEventListener('load', run, { once: true })

  const observer = new MutationObserver(run)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  window.setTimeout(() => observer.disconnect(), 20000)
}

installInjectedTitlebarGuard()

async function uninstallDevelopmentServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [])
  await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)))
  if ('caches' in window) {
    const keys = await caches.keys().catch(() => [])
    await Promise.all(keys.filter((key) => key.startsWith('openclaw-dashboard')).map((key) => caches.delete(key)))
  }
}

// PWA：只在生产构建注册 Service Worker。开发服务要主动注销旧 SW，
// 否则 Vite 的 /src 与 /.vite-cache 资源可能被旧缓存拦截，页面会继续跑旧组件。
if (import.meta.env.DEV) {
  void uninstallDevelopmentServiceWorkers()
} else if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      console.warn('[PWA] Service Worker registration failed')
    })
  })
}
