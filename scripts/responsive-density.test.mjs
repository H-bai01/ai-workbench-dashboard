import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const globalStyle = fs.readFileSync(path.join(repo, 'src/style.css'), 'utf8')
const dashboard = fs.readFileSync(path.join(repo, 'src/views/Dashboard.vue'), 'utf8')

test('页面缩放与可视高度补偿由同一组变量管理', () => {
  assert.match(globalStyle, /zoom:\s*var\(--workbench-page-zoom\)/)
  assert.match(globalStyle, /min-height:\s*var\(--workbench-app-height-vh\)/)
  assert.match(globalStyle, /min-height:\s*var\(--workbench-app-height-dvh\)/)
  assert.match(dashboard, /height:\s*var\(--workbench-dashboard-height-vh,\s*100vh\)/)
  assert.match(dashboard, /height:\s*var\(--workbench-dashboard-height-dvh,\s*100dvh\)/)
})

test('既有三档桌面密度与1400到1499补偿保持不变', () => {
  assert.match(globalStyle, /min-width:\s*920px[\s\S]*?max-width:\s*1099px[\s\S]*?--workbench-page-zoom:\s*0\.9[\s\S]*?--workbench-dashboard-height-dvh:\s*111\.112dvh/)
  assert.match(globalStyle, /min-width:\s*1100px[\s\S]*?max-width:\s*1399px[\s\S]*?--workbench-page-zoom:\s*0\.8[\s\S]*?--workbench-dashboard-height-dvh:\s*125dvh/)
  assert.match(globalStyle, /min-width:\s*1400px[\s\S]*?max-width:\s*1799px[\s\S]*?--workbench-page-zoom:\s*0\.9[\s\S]*?--workbench-dashboard-height-dvh:\s*111\.112dvh/)
  assert.match(globalStyle, /min-width:\s*1400px[\s\S]*?max-width:\s*1499px[\s\S]*?--workbench-dashboard-height-dvh:\s*125dvh/)
})

test('Dashboard不再维护第二套缩放补偿数值', () => {
  assert.doesNotMatch(dashboard, /height:\s*(?:111\.112|125)d?vh/)
})
