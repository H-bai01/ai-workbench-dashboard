import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const ROOT = new URL('../', import.meta.url)

async function read(path) {
  return readFile(new URL(path, ROOT), 'utf8')
}

async function loadMessages() {
  const source = await read('src/i18n/messages.ts')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

function flattenKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' ? flattenKeys(child, path) : [path]
  })
}

test('Chinese and English catalogs expose the same UI keys', async () => {
  const { messages } = await loadMessages()
  assert.deepEqual(flattenKeys(messages['zh-CN']).sort(), flattenKeys(messages.en).sort())
  assert.ok(flattenKeys(messages.en).length >= 90)
})

test('locale detection is remembered and browser-aware', async () => {
  const source = await read('src/i18n/index.ts')
  assert.match(source, /ai-workbench-language/)
  assert.match(source, /saved === 'zh-CN' \|\| saved === 'en'/)
  assert.match(source, /browserLanguage\.toLowerCase\(\)\.startsWith\('zh'\)/)
  assert.match(source, /document\.documentElement\.lang = locale/)
})

test('the global shell exposes a visible language control', async () => {
  const [dashboard, switcher, app] = await Promise.all([
    read('src/views/Dashboard.vue'), read('src/components/LanguageSwitcher.vue'), read('src/App.vue'),
  ])
  assert.match(dashboard, /<LanguageSwitcher\s*\/>/)
  assert.match(switcher, /command="zh-CN"/)
  assert.match(switcher, /command="en"/)
  assert.match(app, /<el-config-provider :locale="elementLocale">/)
})

test('major second-level surfaces use translated titles', async () => {
  const files = [
    'BillingConfigDialog.vue', 'FileManagerDialog.vue', 'CronCenterDialog.vue',
    'GatewayDoctorDialog.vue', 'ProjectBoardDialog.vue', 'SkillsDialog.vue',
    'NotificationDetailDialog.vue', 'LayoutSettingsDialog.vue',
  ]
  for (const file of files) {
    const source = await read(`src/components/${file}`)
    assert.match(source, /\$t\('dialogs\./, `${file} must use a translated dialog title`)
  }
})
