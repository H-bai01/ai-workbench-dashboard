/**
 * useTheme — 暗色/亮色主题切换（Dark/Light Theme Toggle）
 *
 * 使用方式：
 *   const { isDark, toggleTheme, theme } = useTheme()
 *
 * 主题偏好持久化到 localStorage（key: 'openclaw-theme'）
 * 通过在 <html> 元素添加/移除 'light-theme' class 来切换
 */

import { ref, onMounted } from 'vue'

// ─── 单例状态（全局共享）─────────────────────────────────────────────────────
const STORAGE_KEY = 'openclaw-theme'
const isDark = ref(true) // 默认深色

function applyTheme(dark: boolean): void {
  if (dark) {
    document.documentElement.classList.remove('light-theme')
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.add('light-theme')
    // Element Plus 的 dark 模式必须跟着主题走，否则表格悬停/下拉等组件在浅色下仍是黑的
    document.documentElement.classList.remove('dark')
  }
}

function initTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY)
  // 读取用户偏好；若没有保存过，检查系统偏好
  if (saved === 'light') {
    isDark.value = false
  } else if (saved === 'dark') {
    isDark.value = true
  } else {
    // 未保存过：跟随系统偏好
    isDark.value = !window.matchMedia?.('(prefers-color-scheme: light)').matches
  }
  applyTheme(isDark.value)
}

function toggleTheme(): void {
  isDark.value = !isDark.value
  localStorage.setItem(STORAGE_KEY, isDark.value ? 'dark' : 'light')
  applyTheme(isDark.value)
}

// ─── Composable 导出 ─────────────────────────────────────────────────────────
export function useTheme() {
  // 首次调用时初始化（后续调用复用状态）
  onMounted(initTheme)

  return {
    isDark,
    toggleTheme,
    theme: isDark, // 别名，方便 v-bind
  }
}
