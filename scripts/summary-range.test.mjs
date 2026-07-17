import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dashboard = fs.readFileSync(path.join(root, 'src/views/Dashboard.vue'), 'utf8')

test('底部 Token 与费用摘要默认使用本月独立范围', () => {
  assert.match(dashboard, /DEFAULT_SUMMARY_USAGE_RANGE: SummaryUsageRangeValue = 'month'/)
  assert.match(dashboard, /SUMMARY_USAGE_RANGE_PREFERENCE_KEY = 'ai_workbench_dashboard_summary_range_v1'/)
  assert.match(dashboard, /const summaryUsageRange = ref<SummaryUsageRangeValue>\(DEFAULT_SUMMARY_USAGE_RANGE\)/)
  assert.match(dashboard, /const tokenMiniRange = ref<TokenMiniRangeValue>\(DEFAULT_TOKEN_MINI_RANGE\)/)
  assert.doesNotMatch(dashboard, /summaryUsageRange\.value\s*=\s*tokenMiniRange\.value/)
})

test('摘要范围提供常用选项并记住最后一次选择', () => {
  for (const value of ['today', '3d', '7d', '30d', 'month', 'lastMonth', 'all']) {
    assert.match(dashboard, new RegExp(`value: '${value}'`))
  }
  assert.match(dashboard, /loadSummaryUsageRangePreference\(\)/)
  assert.match(dashboard, /saveSummaryUsageRangePreference\(\)/)
  assert.match(dashboard, /localStorage\.setItem\(SUMMARY_USAGE_RANGE_PREFERENCE_KEY/)
  assert.match(dashboard, /@click="setSummaryUsageRange\(option\.value\)"/)
})

test('两张摘要卡片使用独立完整统计且点击可修改范围', () => {
  assert.match(dashboard, /async function refreshSummaryUsage\(\)/)
  assert.match(dashboard, /mergeUsageTimelines\(openClawTimeline, localTimeline\)/)
  assert.match(dashboard, /summaryUsagePublishedRange\.value = range/)
  assert.match(dashboard, /label: `\$\{summaryUsageRangeLabel\.value\} Token`/)
  assert.match(dashboard, /value: summaryUsageReady\.value \? summaryUsageTokenText\.value : '汇总中'/)
  assert.match(dashboard, /value: summaryUsageReady\.value \? summaryUsageCostText\.value : '汇总中'/)
  assert.match(dashboard, /summaryUsageDialogVisible\.value = true/)
  assert.match(dashboard, /只影响底部 Token 和费用两张卡片，不跟随页面上方时间范围。/)
})

test('三类 AI 主体统一只统计当前时间范围内有活动的对象', () => {
  assert.match(dashboard, /function hasScopedUsageActivity\(usage: UsageDatum\): boolean/)
  for (const field of ['tokens', 'cost', 'input', 'output', 'cacheRead', 'cacheWrite']) {
    assert.match(dashboard, new RegExp(`Number\\(usage\\.${field}\\) > 0`))
  }
  assert.match(dashboard, /\.filter\(\(agent\) => hasScopedUsageActivity\(getAgentScopedUsage\(agent\)\)\)/)
  assert.match(dashboard, /const codexRows = localAppRows\(codexApp, 'codex'\)/)
  assert.match(dashboard, /const claudeRows = localAppRows\(claudeApp, 'claude-code'\)/)
  assert.doesNotMatch(dashboard, /`\$\{store\.runningAgents\.length\} 个正在干活`/)
})
