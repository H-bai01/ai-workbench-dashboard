<template>
  <el-dialog
    top="4vh"
    v-model="visible"
    title="自定义布局"
    width="860px"
    :close-on-click-modal="true"
    class="layout-settings-dialog"
  >
    <div class="layout-intro">
      <el-icon><InfoFilled /></el-icon>
      <span>调整 2.x 工作台模块、顶栏工具、操作区按钮和统计卡片的显示顺序。点击 ↑ ↓ 重排，或拖拽条目。配置自动保存到浏览器本地。</span>
    </div>

    <div class="ls-section">
      <div class="ls-section-title">
        <span>页面模块顺序</span>
        <el-button link size="small" @click="resetPageModules">恢复默认</el-button>
      </div>
      <div class="ls-list">
        <div
          v-for="(id, i) in localPageModules"
          :key="id"
          class="ls-item ls-item-module"
          draggable="true"
          @dragstart="onDragStart('pageModules', i)"
          @dragover.prevent
          @drop="onDrop('pageModules', i)"
          @dragend="onDragEnd"
        >
          <span class="ls-handle" aria-hidden="true"></span>
          <span class="ls-item-icon" :class="pageModulesMeta[id]?.tone || 'tone-default'">
            <el-icon><component :is="pageModulesMeta[id]?.icon || Grid" /></el-icon>
          </span>
          <span class="ls-item-label">{{ pageModulesMeta[id]?.label || id }}</span>
          <span class="ls-item-desc">{{ pageModulesMeta[id]?.desc || '' }}</span>
          <div class="ls-item-actions">
            <el-button
              link size="small" :icon="SortUp"
              :disabled="i === 0"
              @click="moveItem('pageModules', i, -1)"
            />
            <el-button
              link size="small" :icon="SortDown"
              :disabled="i === localPageModules.length - 1"
              @click="moveItem('pageModules', i, 1)"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="ls-section">
      <div class="ls-section-title">
        <span>顶栏工具顺序</span>
        <el-button link size="small" @click="resetTopBarControls">恢复默认</el-button>
      </div>
      <div class="ls-list">
        <div
          v-for="(id, i) in localTopBarControls"
          :key="id"
          class="ls-item"
          draggable="true"
          @dragstart="onDragStart('topBarControls', i)"
          @dragover.prevent
          @drop="onDrop('topBarControls', i)"
          @dragend="onDragEnd"
        >
          <span class="ls-handle" aria-hidden="true"></span>
          <span class="ls-item-icon" :class="topBarMeta[id]?.tone || 'tone-default'">
            <el-icon><component :is="topBarMeta[id]?.icon || Grid" /></el-icon>
          </span>
          <span class="ls-item-label">{{ topBarMeta[id]?.label || id }}</span>
          <span class="ls-item-desc">{{ topBarMeta[id]?.desc || '' }}</span>
          <div class="ls-item-actions">
            <el-button
              link size="small" :icon="SortUp"
              :disabled="i === 0"
              @click="moveItem('topBarControls', i, -1)"
            />
            <el-button
              link size="small" :icon="SortDown"
              :disabled="i === localTopBarControls.length - 1"
              @click="moveItem('topBarControls', i, 1)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 功能区按钮 -->
    <div class="ls-section">
      <div class="ls-section-title">
        <span>功能区按钮顺序</span>
        <el-button link size="small" @click="resetStatusBar">恢复默认</el-button>
      </div>
      <div class="ls-list">
        <div
          v-for="(id, i) in localStatusBar"
          :key="id"
          class="ls-item"
          draggable="true"
          @dragstart="onDragStart('statusBar', i)"
          @dragover.prevent
          @drop="onDrop('statusBar', i)"
          @dragend="onDragEnd"
        >
          <span class="ls-handle" aria-hidden="true"></span>
          <span class="ls-item-icon" :class="statusBarMeta[id]?.tone || 'tone-default'">
            <el-icon><component :is="statusBarMeta[id]?.icon || Grid" /></el-icon>
          </span>
          <span class="ls-item-label">{{ statusBarMeta[id]?.label || id }}</span>
          <span class="ls-item-desc">{{ statusBarMeta[id]?.desc || '' }}</span>
          <div class="ls-item-actions">
            <el-button
              link size="small" :icon="SortUp"
              :disabled="i === 0"
              @click="moveItem('statusBar', i, -1)"
            />
            <el-button
              link size="small" :icon="SortDown"
              :disabled="i === localStatusBar.length - 1"
              @click="moveItem('statusBar', i, 1)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="ls-section">
      <div class="ls-section-title">
        <span>统计卡片顺序</span>
        <el-button link size="small" @click="resetStatsCards">恢复默认</el-button>
      </div>
      <div class="ls-list">
        <div
          v-for="(id, i) in localStatsCards"
          :key="id"
          class="ls-item"
          draggable="true"
          @dragstart="onDragStart('statsCards', i)"
          @dragover.prevent
          @drop="onDrop('statsCards', i)"
          @dragend="onDragEnd"
        >
          <span class="ls-handle" aria-hidden="true"></span>
          <span class="ls-item-icon" :class="statsCardsMeta[id]?.tone || 'tone-default'">
            <el-icon><component :is="statsCardsMeta[id]?.icon || Grid" /></el-icon>
          </span>
          <span class="ls-item-label">{{ statsCardsMeta[id]?.label || id }}</span>
          <span class="ls-item-desc">{{ statsCardsMeta[id]?.desc || '' }}</span>
          <div class="ls-item-actions">
            <el-button
              link size="small" :icon="SortUp"
              :disabled="i === 0"
              @click="moveItem('statsCards', i, -1)"
            />
            <el-button
              link size="small" :icon="SortDown"
              :disabled="i === localStatsCards.length - 1"
              @click="moveItem('statsCards', i, 1)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 第三模块：内嵌视图可见性（Inline Section Visibility）-->
    <div class="ls-section">
      <div class="ls-section-title">
        <span>内嵌视图显示</span>
        <el-button link size="small" @click="resetSections">恢复默认</el-button>
      </div>
      <div class="ls-list">
        <div v-for="item in sectionsMeta" :key="item.id" class="ls-item ls-item-toggle">
          <span class="ls-item-icon" :class="item.tone">
            <el-icon><component :is="item.icon" /></el-icon>
          </span>
          <span class="ls-item-label">{{ item.label }}</span>
          <span class="ls-item-desc">{{ item.desc }}</span>
          <el-switch
            v-model="localSections[item.id]"
            size="small"
            style="margin-left: auto"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="ls-footer">
        <el-button @click="resetAll" type="danger" plain>全部恢复默认</el-button>
        <div>
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" @click="saveAndClose">保存</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Component } from 'vue'
import {
  AlarmClock,
  Bell,
  Box,
  CircleClose,
  Clock,
  Coin,
  Connection,
  DataAnalysis,
  DataLine,
  DocumentChecked,
  FolderOpened,
  Grid,
  InfoFilled,
  Link,
  Money,
  Monitor,
  Operation,
  Search,
  Setting,
  SortDown,
  SortUp,
  Sunny,
  SuitcaseLine,
  Tickets,
  TrendCharts,
  VideoPause,
  VideoPlay,
  Warning,
} from '@element-plus/icons-vue'
import { useLayoutSettings } from '../composables/useLayoutSettings'

const visible = defineModel<boolean>('visible', { default: false })
const {
  config,
  setPageModulesOrder,
  setTopBarControlsOrder,
  setStatusBarOrder,
  setStatsCardsOrder,
  setSectionVisible,
  DEFAULT_PAGE_MODULES,
  DEFAULT_TOP_BAR_CONTROLS,
  DEFAULT_STATUS_BAR,
  DEFAULT_STATS_CARDS,
  DEFAULT_SECTIONS,
} = useLayoutSettings()

const localPageModules = ref<string[]>([])
const localTopBarControls = ref<string[]>([])
const localStatusBar = ref<string[]>([])
const localStatsCards = ref<string[]>([])
const localSections = ref<Record<string, boolean>>({})
type IconTone =
  | 'tone-blue'
  | 'tone-sky'
  | 'tone-cyan'
  | 'tone-teal'
  | 'tone-green'
  | 'tone-amber'
  | 'tone-orange'
  | 'tone-red'
  | 'tone-purple'
  | 'tone-violet'
  | 'tone-gray'
  | 'tone-default'
type IconMeta = { icon: Component; tone: IconTone; label: string; desc: string }

// 打开时同步当前配置
watch(visible, (val) => {
  if (val) {
    localPageModules.value = [...config.value.pageModules]
    localTopBarControls.value = [...config.value.topBarControls]
    localStatusBar.value = [...config.value.statusBar]
    localStatsCards.value = [...config.value.statsCards]
    localSections.value = { ...config.value.sections }
  }
})

const pageModulesMeta: Record<string, IconMeta> = {
  cockpit:     { icon: DataAnalysis, tone: 'tone-sky', label: '首屏指挥舱', desc: 'Token、APP/Agent 脉冲、贡献排行' },
  controlDock: { icon: Operation, tone: 'tone-teal', label: '操作区', desc: '运行摘要 + 功能入口' },
  workflow:    { icon: TrendCharts, tone: 'tone-green', label: '工作流进度', desc: '当前项目步骤和执行进度' },
  taskBoard:   { icon: Tickets, tone: 'tone-blue', label: 'OpenClaw Agent 任务区', desc: '按状态展开查看 OpenClaw Agent' },
  timeline:    { icon: DataLine, tone: 'tone-purple', label: 'OpenClaw 活动时间线', desc: 'OpenClaw session 趋势和 Gantt' },
  changelog:   { icon: DocumentChecked, tone: 'tone-amber', label: '版本说明', desc: '2.x 版本记录和回退' },
}

const topBarMeta: Record<string, IconMeta> = {
  version:       { icon: Box, tone: 'tone-blue', label: 'OpenClaw 版本', desc: '切换 / 查看网关版本' },
  gateway:       { icon: Connection, tone: 'tone-green', label: '网关状态', desc: '诊断网关健康' },
  notifications: { icon: Bell, tone: 'tone-amber', label: '通知中心', desc: '查看未读和告警' },
  search:        { icon: Search, tone: 'tone-violet', label: '搜索', desc: '全局搜索入口' },
  theme:         { icon: Sunny, tone: 'tone-orange', label: '主题切换', desc: '亮色 / 暗色模式' },
  layout:        { icon: Setting, tone: 'tone-purple', label: '自定义布局', desc: '打开当前面板' },
}

// ── 元数据：每个 id 对应的 icon + label + desc（功能区可排序项，已移除 GPU）──
const statusBarMeta: Record<string, IconMeta> = {
  fileManager: { icon: FolderOpened, tone: 'tone-sky', label: '文件管理', desc: '查看系统所有文件' },
  billing:     { icon: Money, tone: 'tone-cyan', label: '计费配置', desc: '按模型自定义 OpenClaw / Codex / Claude Code 计费' },
  skills:      { icon: SuitcaseLine, tone: 'tone-blue', label: 'OpenClaw 技能库', desc: '管理 OpenClaw Agent 技能' },
  webui:       { icon: Link, tone: 'tone-teal', label: 'WebUI', desc: '跳转 OpenClaw 原生界面' },
  projects:    { icon: Grid, tone: 'tone-green', label: 'OpenClaw 项目看板', desc: '5 列看板跟踪 OpenClaw 项目进度' },
  cron:        { icon: AlarmClock, tone: 'tone-violet', label: '定时任务', desc: 'Cron 任务中心' },
}

const statsCardsMeta: Record<string, IconMeta> = {
  total:   { icon: DataAnalysis, tone: 'tone-blue', label: '总计', desc: 'Agent 总数' },
  running: { icon: VideoPlay, tone: 'tone-green', label: '运行中', desc: '运行中的 Agent 数' },
  idle:    { icon: VideoPause, tone: 'tone-amber', label: '空闲', desc: '空闲的 Agent 数' },
  aborted: { icon: CircleClose, tone: 'tone-gray', label: '已终止', desc: '终止的 Agent 数' },
  error:   { icon: Warning, tone: 'tone-red', label: '错误', desc: '出错的 Agent 数' },
  uptime:  { icon: Monitor, tone: 'tone-purple', label: '本次运行时间', desc: '工作台本次运行时间' },
  tokens:  { icon: Clock, tone: 'tone-orange', label: '当前口径 Token', desc: '随全局口径变化' },
  cost:    { icon: Coin, tone: 'tone-green', label: '当前口径费用', desc: '随全局口径变化' },
}

// ── 第三模块元数据 ──
const sectionsMeta = [
  { id: 'timeline',  icon: DataLine, tone: 'tone-purple', label: 'OpenClaw 活动时间线', desc: 'OpenClaw session Gantt 图内嵌展示（可折叠）' },
  { id: 'changelog', icon: DocumentChecked, tone: 'tone-amber', label: '版本迭代说明', desc: 'Changelog 版本历史 + 回退（可折叠）' },
]

// ── 排序 ──
type SortGroup = 'pageModules' | 'topBarControls' | 'statusBar' | 'statsCards'

function getLocalList(group: SortGroup): string[] {
  if (group === 'pageModules') return localPageModules.value
  if (group === 'topBarControls') return localTopBarControls.value
  if (group === 'statusBar') return localStatusBar.value
  return localStatsCards.value
}

function moveItem(group: SortGroup, index: number, delta: number) {
  const list = getLocalList(group)
  const newIndex = index + delta
  if (newIndex < 0 || newIndex >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(newIndex, 0, item)
}

// ── 拖拽 ──
let dragSource: { group: string; index: number } | null = null
function onDragStart(group: string, index: number) {
  dragSource = { group, index }
}
function onDrop(group: string, targetIndex: number) {
  if (!dragSource || dragSource.group !== group) return
  const list = getLocalList(group as SortGroup)
  const sourceIndex = dragSource.index
  if (sourceIndex === targetIndex) return
  const [item] = list.splice(sourceIndex, 1)
  list.splice(targetIndex, 0, item)
  dragSource = null
}
function onDragEnd() {
  dragSource = null
}

// ── 重置 ──
function resetPageModules() {
  localPageModules.value = [...DEFAULT_PAGE_MODULES]
}
function resetTopBarControls() {
  localTopBarControls.value = [...DEFAULT_TOP_BAR_CONTROLS]
}
function resetStatusBar() {
  localStatusBar.value = [...DEFAULT_STATUS_BAR]
}
function resetStatsCards() {
  localStatsCards.value = [...DEFAULT_STATS_CARDS]
}
function resetSections() {
  localSections.value = { ...DEFAULT_SECTIONS }
}
function resetAll() {
  resetPageModules()
  resetTopBarControls()
  resetStatusBar()
  resetStatsCards()
  resetSections()
}

function saveAndClose() {
  setPageModulesOrder(localPageModules.value)
  setTopBarControlsOrder(localTopBarControls.value)
  setStatusBarOrder(localStatusBar.value)
  setStatsCardsOrder(localStatsCards.value)
  // 保存内嵌视图可见性
  for (const [id, vis] of Object.entries(localSections.value)) {
    setSectionVisible(id, vis)
  }
  visible.value = false
}
</script>

<style scoped>
.layout-intro {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background:
    linear-gradient(135deg, rgba(10, 132, 255, 0.11), rgba(175, 82, 222, 0.06));
  border: 1px solid rgba(10, 132, 255, 0.18);
  border-radius: 10px;
  font-size: 12px;
  color: var(--text-secondary, #98989d);
  margin-bottom: 18px;
  line-height: 1.65;
}
.layout-intro .el-icon {
  color: var(--accent);
  flex-shrink: 0;
  margin-top: 3px;
}

.ls-section {
  margin-bottom: 18px;
}
.ls-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
  padding: 4px 0 8px;
  border-bottom: 1px solid var(--border-color);
}

.ls-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ls-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 9px 12px 9px 10px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.018)),
    var(--fill-subtle);
  border: 1px solid var(--glass-card-border, var(--border-color));
  border-radius: 10px;
  cursor: grab;
  user-select: none;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
}
.ls-item:hover {
  background:
    linear-gradient(135deg, rgba(10, 132, 255, 0.085), rgba(255, 255, 255, 0.024)),
    var(--fill-subtle);
  border-color: rgba(10, 132, 255, 0.28);
  box-shadow: 0 10px 28px rgba(10, 132, 255, 0.08);
  transform: translateY(-1px);
}
.ls-item:active { cursor: grabbing; }

.ls-handle {
  width: 12px;
  height: 32px;
  flex: 0 0 12px;
  opacity: 0.5;
  border-radius: 999px;
  background-image: radial-gradient(circle, var(--text-muted, #8b98aa) 1.15px, transparent 1.25px);
  background-size: 6px 6px;
  background-position: center;
}
.ls-item:hover .ls-handle { opacity: 0.82; }

.ls-item-icon {
  --icon-color: #93a4b8;
  --icon-bg: rgba(148, 163, 184, 0.14);
  --icon-border: rgba(148, 163, 184, 0.24);
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--icon-color);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.018)),
    var(--icon-bg);
  border: 1px solid var(--icon-border);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.ls-item-icon .el-icon {
  font-size: 18px;
}
.tone-blue { --icon-color: #64b5ff; --icon-bg: rgba(10, 132, 255, 0.12); --icon-border: rgba(10, 132, 255, 0.24); }
.tone-sky { --icon-color: #64b5ff; --icon-bg: rgba(10, 132, 255, 0.11); --icon-border: rgba(10, 132, 255, 0.22); }
.tone-cyan { --icon-color: #5ac8fa; --icon-bg: rgba(90, 200, 250, 0.11); --icon-border: rgba(90, 200, 250, 0.22); }
.tone-teal { --icon-color: #5de1d4; --icon-bg: rgba(90, 200, 250, 0.1); --icon-border: rgba(90, 200, 250, 0.2); }
.tone-green { --icon-color: #67d783; --icon-bg: rgba(48, 209, 88, 0.12); --icon-border: rgba(48, 209, 88, 0.24); }
.tone-amber { --icon-color: #ffd166; --icon-bg: rgba(255, 159, 10, 0.12); --icon-border: rgba(255, 159, 10, 0.24); }
.tone-orange { --icon-color: #ffb366; --icon-bg: rgba(255, 159, 10, 0.11); --icon-border: rgba(255, 159, 10, 0.22); }
.tone-red { --icon-color: #ff7a70; --icon-bg: rgba(255, 69, 58, 0.11); --icon-border: rgba(255, 69, 58, 0.22); }
.tone-purple { --icon-color: #d5a6ff; --icon-bg: rgba(191, 90, 242, 0.11); --icon-border: rgba(191, 90, 242, 0.22); }
.tone-violet { --icon-color: #d5a6ff; --icon-bg: rgba(191, 90, 242, 0.1); --icon-border: rgba(191, 90, 242, 0.2); }
.tone-gray { --icon-color: #94a3b8; --icon-bg: rgba(100, 116, 139, 0.15); --icon-border: rgba(148, 163, 184, 0.28); }
.tone-default { --icon-color: #93a4b8; --icon-bg: rgba(148, 163, 184, 0.14); --icon-border: rgba(148, 163, 184, 0.24); }

.ls-item-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 128px;
  white-space: nowrap;
}
.ls-item-desc {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ls-item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.ls-item-actions :deep(.el-button) {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: var(--text-secondary);
}
.ls-item-actions :deep(.el-button:not(.is-disabled):hover) {
  background: rgba(56, 189, 248, 0.12);
  color: #38bdf8;
}
.ls-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
/* 切换型条目（内嵌视图模块）不需要拖拽手柄 */
.ls-item-toggle {
  cursor: default;
  padding-left: 12px;
}
.ls-item-toggle:hover {
  background: var(--fill-subtle);
  border-color: var(--border-color);
  box-shadow: none;
  transform: none;
}
</style>
