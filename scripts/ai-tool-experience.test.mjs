import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8')

test('监控对象统一进入通用详情并保留工具专属入口', () => {
  const dashboard = read('src/views/Dashboard.vue')
  const detail = read('src/components/MonitorObjectDetailDialog.vue')
  assert.match(dashboard, /MonitorObjectDetailDialog/)
  assert.match(dashboard, /selectedMonitorDetailObject/)
  assert.match(dashboard, /openSelectedMonitorExecution/)
  assert.match(detail, /查看执行记录/)
  assert.match(detail, /打开工具专属详情/)
})

test('活动时间线读取全部受支持来源的只读会话索引', () => {
  const service = read('scripts/unified-service.js')
  const timeline = read('src/components/UnifiedActivityTimeline.vue')
  const api = read('src/api/session-observation.ts')
  assert.match(service, /pathname === '\/api\/session-observation\/index'/)
  assert.match(service, /SESSION_OBSERVATION_STORE\.indexSnapshot/)
  assert.match(api, /fetchObservedSessionIndex/)
  assert.match(timeline, /AI 工具活动时间线/)
  assert.match(timeline, /fetchObservedSessionIndex\(\)/)
  assert.doesNotMatch(timeline, /OpenClaw 活动时间线/)
})

test('全局搜索直接消费通用监控对象而不是只认识 Agent', () => {
  const dashboard = read('src/views/Dashboard.vue')
  const palette = read('src/components/CommandPaletteDialog.vue')
  const messages = read('src/i18n/messages.ts')
  assert.match(dashboard, /:monitor-objects="monitorAllRows"/)
  assert.match(palette, /monitorObjectResults/)
  assert.match(palette, /open-monitor-object/)
  assert.match(palette, /AI 工具活动时间线/)
  assert.match(palette, /dialogs\.searchPlaceholder/)
  assert.match(messages, /搜索功能、AI 工具对象、项目、会话和历史消息/)
  assert.match(messages, /Search features, AI tool objects, projects, sessions, and messages/)
})

test('首页概览只有内容超出时才接管滚轮', () => {
  const dashboard = read('src/views/Dashboard.vue')
  assert.match(dashboard, /\.dashboard\s*\{[\s\S]*height:\s*100dvh[\s\S]*overflow-y:\s*scroll[\s\S]*scrollbar-gutter:\s*stable/)
  assert.match(dashboard, /\.dashboard\s*>\s*\*[\s\S]*flex-shrink:\s*0/)
  assert.match(dashboard, /\.dashboard::\-webkit-scrollbar-thumb[\s\S]*min-height:\s*48px/)
  assert.match(dashboard, /model-share-scroll:not\(\.is-expanded\)[\s\S]*overflow-y:\s*hidden/)
  assert.match(dashboard, /contribution-scroll:not\(\.is-expanded\)[\s\S]*overflow-y:\s*hidden/)
  assert.match(dashboard, /'is-scrollable': selectedPulseRows\.length > 8/)
  assert.match(dashboard, /agent-pulse-grid--two-level\.is-scrollable[\s\S]*overflow-y:\s*auto/)
})

test('Agent 详情把新增视口宽度优先交给中间消息区', () => {
  const drawer = read('src/components/AgentDetailDrawer.vue')
  const voice = read('src/components/AgentVoiceStage.vue')

  assert.match(drawer, /if \(width <= 1380\) return 0/)
  assert.match(drawer, /getComputedStyle\(document\.body\).*getPropertyValue\('zoom'\)/)
  assert.match(drawer, /const voicePanelVisualWidth = computed/)
  assert.match(drawer, /Math\.min\(500, Math\.max\(400, width \* 0\.25\)\)/)
  assert.match(drawer, /voicePanelVisualWidth\.value \/ viewportScale\.value/)
  assert.match(drawer, /availableVisualWidth \/ viewportScale\.value/)
  assert.match(drawer, /:panel-width="voicePanelWidth"/)
  assert.match(drawer, /\.drawer-left\s*\{[\s\S]*flex:\s*1;[\s\S]*min-width:\s*0;/)
  assert.match(drawer, /\.drawer-right\s*\{[\s\S]*width:\s*340px;[\s\S]*flex-shrink:\s*0;/)
  assert.match(voice, /panelWidth:\s*number/)
  assert.match(voice, /width:\s*clamp\(400px, 25vw, 500px\)/)
})
