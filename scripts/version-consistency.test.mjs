import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
const readText = file => fs.readFileSync(path.join(repo, file), 'utf8')
const readJson = file => JSON.parse(readText(file))

test('发布版本在包、锁文件和更新说明中保持一致', () => {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  const changelog = readJson('src/changelog.json')

  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages?.['']?.version, pkg.version)
  assert.equal(changelog.versions?.[0]?.version, pkg.version)
  assert.equal(changelog.versions?.[0]?.channel, 'stable')
})

test('页面版本由 package.json 注入且发布说明标明当前版本', () => {
  const { version } = readJson('package.json')
  const viteConfig = readText('vite.config.ts')
  const dashboard = readText('src/views/Dashboard.vue')
  const changelogPanel = readText('src/components/ChangelogPanel.vue')
  const readme = readText('README.md')

  assert.match(viteConfig, /__APP_VERSION__:\s*JSON\.stringify\(pkg\.version\)/)
  assert.match(dashboard, /const APP_VERSION:\s*string\s*=\s*__APP_VERSION__/)
  assert.match(changelogPanel, /currentVersion\.value\s*=\s*__APP_VERSION__/)
  assert.ok(readme.includes(`当前本地正式版本：\`v${version}\``))
})
