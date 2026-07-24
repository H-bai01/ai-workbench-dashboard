<template>
  <el-dropdown trigger="click" placement="bottom-end" @command="changeLanguage">
    <button class="language-switcher" type="button" :aria-label="t('header.language')">
      <el-icon :size="14"><ChatDotSquare /></el-icon>
      <span>{{ locale === 'zh-CN' ? '中文' : 'EN' }}</span>
      <el-icon :size="11"><ArrowDown /></el-icon>
    </button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="zh-CN" :disabled="locale === 'zh-CN'">中文</el-dropdown-item>
        <el-dropdown-item command="en" :disabled="locale === 'en'">English</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { ArrowDown, ChatDotSquare } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import 'dayjs/locale/en'
import 'dayjs/locale/zh-cn'
import { useI18n } from 'vue-i18n'
import { applyDocumentLocale, type SupportedLocale } from '../i18n'

const { locale, t } = useI18n()

function changeLanguage(command: string | number | object): void {
  if (command !== 'zh-CN' && command !== 'en') return
  const nextLocale = command as SupportedLocale
  locale.value = nextLocale
  dayjs.locale(nextLocale === 'zh-CN' ? 'zh-cn' : 'en')
  applyDocumentLocale(nextLocale)
}
</script>

<style scoped>
.language-switcher {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 11px;
  border: 1px solid var(--border-color);
  border-radius: 9px;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease;
}

.language-switcher:hover {
  color: var(--accent-blue);
  border-color: color-mix(in srgb, var(--accent-blue) 55%, var(--border-color));
  background: color-mix(in srgb, var(--accent-blue) 8%, var(--bg-elevated));
}
</style>
