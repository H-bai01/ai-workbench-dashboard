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
  assert.match(dashboard, /:monitor-objects="monitorAllRows"/)
  assert.match(palette, /monitorObjectResults/)
  assert.match(palette, /open-monitor-object/)
  assert.match(palette, /AI 工具活动时间线/)
  assert.match(palette, /搜索功能、AI 工具对象、项目、会话和历史消息/)
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
