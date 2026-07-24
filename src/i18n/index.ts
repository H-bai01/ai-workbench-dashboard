import { createI18n } from 'vue-i18n'
import { messages, type SupportedLocale } from './messages'

export type { SupportedLocale } from './messages'

export const LANGUAGE_STORAGE_KEY = 'ai-workbench-language'
export const DEFAULT_LOCALE: SupportedLocale = 'en'

export function resolveLocale(saved: string | null, browserLanguage: string): SupportedLocale {
  if (saved === 'zh-CN' || saved === 'en') return saved
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : DEFAULT_LOCALE
}

export function detectInitialLocale(): SupportedLocale {
  return resolveLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY), navigator.language)
}

export const i18n = createI18n({
  legacy: false,
  locale: detectInitialLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages,
  missingWarn: false,
  fallbackWarn: false,
})

export function applyDocumentLocale(locale: SupportedLocale): void {
  document.documentElement.lang = locale
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
}

applyDocumentLocale(i18n.global.locale.value as SupportedLocale)
