<template>
  <el-dialog
    v-model="visible"
    :title="$t('dialogs.projects')"
    width="92vw"
    top="4vh"
    :close-on-click-modal="true"
    class="project-board-dialog"
    destroy-on-close
  >
    <!-- 工具栏 -->
    <div class="pb-toolbar">
      <div class="pb-toolbar-left">
        <el-input
          v-model="searchText"
          placeholder="搜索 OpenClaw 项目名称..."
          prefix-icon="Search"
          clearable
          size="small"
          style="width: 200px"
        />
        <el-tag
          v-for="col in columns"
          :key="col.id"
          class="pb-col-filter"
          :class="{ active: activeFilter === col.id }"
          size="small"
          effect="plain"
          :style="{ borderColor: col.color, color: col.color, cursor: 'pointer' }"
          @click="toggleFilter(col.id)"
        >
          {{ col.label }} ({{ getProjects(col.id).length }})
        </el-tag>
      </div>
      <el-button size="small" :loading="loading" @click="loadProjects">
        <el-icon><Refresh /></el-icon> 刷新
      </el-button>
    </div>

    <!-- 看板列 -->
    <div class="pb-board" v-loading="loading">
      <div
        v-for="col in visibleColumns"
        :key="col.id"
        class="pb-column"
        :style="{ '--col-color': col.color }"
      >
        <div class="pb-col-header">
          <span class="col-dot" :style="{ backgroundColor: col.color }"></span>
          <span class="pb-col-label">{{ col.label }}</span>
          <el-badge :value="getProjects(col.id).length" :type="col.badgeType" class="pb-col-badge" />
        </div>

        <div class="pb-col-body">
          <div v-if="getProjects(col.id).length === 0" class="pb-empty">
            <span>{{ col.emptyText }}</span>
          </div>

          <div
            v-for="proj in getProjects(col.id)"
            :key="proj.id"
            class="pb-card"
            :class="getCardClass(proj)"
            @click="openDetail(proj)"
          >
            <!-- 卡片头 -->
            <div class="pb-card-header">
              <span class="pb-card-name">{{ proj.displayName || proj.name }}</span>
              <el-tag size="small" :style="phaseTagStyle(proj.phase)" effect="dark" round>
                {{ phaseLabel(proj.phase) }}
              </el-tag>
            </div>

            <div v-if="proj.displayName" class="pb-card-id mono">{{ proj.name }}</div>

            <!-- 发起方 -->
            <div v-if="proj.initiator" class="pb-card-agent">
              <el-icon :size="12"><User /></el-icon>
              <span>发起: {{ proj.initiator }}</span>
            </div>

            <!-- 负责 agent -->
            <div v-if="proj.responsible_agent" class="pb-card-agent">
              <el-icon :size="12"><User /></el-icon>
              <span>{{ agentLabel(proj.responsible_agent) }}</span>
            </div>

            <!-- 卡住时长 -->
            <div v-if="getStuckDuration(proj)" class="pb-card-stuck" :class="getStuckClass(proj)">
              <el-icon :size="12"><Clock /></el-icon>
              <span>{{ getStuckDuration(proj) }}</span>
            </div>

            <!-- 阻塞原因 -->
            <div v-if="proj.blocked_reason" class="pb-card-blocked">
              <el-icon :size="12"><Warning /></el-icon>
              <span class="pb-blocked-text">{{ proj.blocked_reason }}</span>
            </div>

            <!-- 重试次数警告 -->
            <div v-if="proj.retry_count >= 3" class="pb-card-retry">
              <el-icon :size="12"><RefreshRight /></el-icon>
              <span>已重试 {{ proj.retry_count }} 次</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <el-drawer
      v-model="detailVisible"
      :title="selectedProject?.displayName || selectedProject?.name || '项目详情'"
      direction="rtl"
      size="500px"
      :append-to-body="true"
    >
      <div v-if="selectedProject" class="pb-detail">
        <!-- 基本信息 -->
        <div class="pb-detail-section">
          <div class="pb-detail-title">基本信息</div>
          <div class="pb-detail-row">
            <span class="pb-detail-key">中文名称</span>
            <span class="pb-detail-val">
              {{ selectedProject.displayName || '（未设置）' }}
              <button class="pb-edit-btn" @click="renameProject"><el-icon :size="11"><EditPen /></el-icon>修改</button>
            </span>
          </div>
          <div class="pb-detail-row">
            <span class="pb-detail-key">发起方</span>
            <span class="pb-detail-val">
              {{ selectedProject.initiator || '未记录' }}
              <button class="pb-edit-btn" @click="editInitiator"><el-icon :size="11"><EditPen /></el-icon>修改</button>
            </span>
          </div>
          <div class="pb-detail-row">
            <span class="pb-detail-key">项目 ID</span>
            <span class="pb-detail-val mono">{{ selectedProject.id }}</span>
          </div>
          <div class="pb-detail-row">
            <span class="pb-detail-key">当前阶段</span>
            <el-tag size="small" :style="phaseTagStyle(selectedProject.phase)" effect="dark" round>
              {{ phaseLabel(selectedProject.phase) }}
            </el-tag>
          </div>
          <div class="pb-detail-row" v-if="selectedProject.responsible_agent">
            <span class="pb-detail-key">负责 Agent</span>
            <span class="pb-detail-val">{{ agentLabel(selectedProject.responsible_agent) }}</span>
          </div>
          <div class="pb-detail-row" v-if="selectedProject.retry_count">
            <span class="pb-detail-key">重试次数</span>
            <span class="pb-detail-val" :style="{ color: selectedProject.retry_count >= 3 ? '#ff453a' : 'inherit' }">
              {{ selectedProject.retry_count }}
            </span>
          </div>
          <div class="pb-detail-row" v-if="selectedProject.updated_at">
            <span class="pb-detail-key">最后更新</span>
            <span class="pb-detail-val">{{ formatTime(selectedProject.updated_at) }}</span>
          </div>
          <div class="pb-detail-row" v-if="selectedProject.blocked_reason">
            <span class="pb-detail-key">阻塞原因</span>
            <span class="pb-detail-val" style="color: #ff9f0a;">{{ selectedProject.blocked_reason }}</span>
          </div>
        </div>

        <!-- 操作 -->
        <div class="pb-detail-section">
          <div class="pb-detail-title">操作</div>
          <el-button
            v-if="selectedProject.responsible_agent"
            size="small"
            type="primary"
            plain
            @click="atAgent(selectedProject)"
          >
            <el-icon><ChatDotRound /></el-icon>
            @ 负责人 {{ agentLabel(selectedProject.responsible_agent) }}
          </el-button>
        </div>

        <!-- 项目档案(state.json 中文化) -->
        <div class="pb-detail-section">
          <div class="pb-detail-title">项目档案</div>
          <div class="pb-detail-row" v-if="rawField('test_result')">
            <span class="pb-detail-key">测试结果</span>
            <span class="pb-detail-val" :style="{ color: rawField('test_result') === 'pass' ? 'var(--success)' : 'var(--danger)' }">
              {{ rawField('test_result') === 'pass' ? '通过' : rawField('test_result') === 'fail' ? '未通过' : rawField('test_result') }}
            </span>
          </div>
          <div class="pb-detail-row" v-if="selectedProject.created_at">
            <span class="pb-detail-key">创建时间</span>
            <span class="pb-detail-val">{{ formatTime(selectedProject.created_at) }}</span>
          </div>
          <div class="pb-detail-row" v-if="projectFiles.length > 0">
            <span class="pb-detail-key">产出文件</span>
            <span class="pb-detail-val">
              <button v-for="f in projectFiles" :key="f.key" class="pb-file-chip pb-file-btn" @click="openProjectFile(f)">{{ f.label }}</button>
            </span>
          </div>
          <el-button link size="small" class="pb-raw-toggle" @click="showRawJson = !showRawJson">
            {{ showRawJson ? '收起原始数据' : '查看原始数据(英文)' }}
          </el-button>
          <pre v-if="showRawJson" class="pb-json-view">{{ JSON.stringify(selectedProject.raw, null, 2) }}</pre>
        </div>
      </div>
    </el-drawer>

    <!-- 产出文件查看(叠放在详情抽屉之上) -->
    <el-dialog
      v-model="fileViewVisible"
      :title="fileViewTitle"
      width="720px"
      top="6vh"
      :append-to-body="true"
      class="pb-file-dialog"
    >
      <div v-if="fileViewLoading" class="pb-file-loading">正在读取文件…</div>
      <el-scrollbar v-else max-height="68vh">
        <div class="pb-file-md" v-html="fileViewHtml"></div>
      </el-scrollbar>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Refresh, User, Warning, RefreshRight, Clock, ChatDotRound, EditPen } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { marked } from 'marked'
import { renderSafeMarkdown } from '../utils/safe-content.mjs'
import { ownValue } from '../utils/safe-record.mjs'
import { useAgentStore } from '../stores/agent'
import { buildAgentPresentationOptions } from '../utils/agent-presentation.mjs'

const visible = defineModel<boolean>('visible', { default: false })
const agentStore = useAgentStore()

interface Project {
  id: string
  name: string
  displayName?: string
  initiator?: string
  phase: string
  responsible_agent: string | null
  blocked_reason: string | null
  retry_count: number
  updated_at: string | null
  created_at: string | null
  file_mtime: number
  raw: Record<string, unknown>
}

const loading = ref(false)
const projects = ref<Project[]>([])
const searchText = ref('')
const activeFilter = ref<string | null>(null)
const detailVisible = ref(false)
const selectedProject = ref<Project | null>(null)

// 列定义
const columns = [
  { id: 'pending',    label: '待启动',  color: '#98989d', badgeType: 'info'    as const, emptyText: '暂无待启动项目', phases: ['pending', 'waiting', 'init', '待启动'] },
  { id: 'in_progress',label: '进行中',  color: '#0a84ff', badgeType: 'primary' as const, emptyText: '暂无进行中项目', phases: ['in_progress', 'running', 'active', 'planning', 'developing', 'testing', '进行中'] },
  { id: 'blocked',    label: '阻塞',    color: '#ff9f0a', badgeType: 'warning' as const, emptyText: '暂无阻塞项目', phases: ['blocked', 'paused', '阻塞'] },
  { id: 'done',       label: '已完成',  color: '#30d158', badgeType: 'success' as const, emptyText: '暂无已完成项目', phases: ['done', 'completed', 'finished', '已完成'] },
  { id: 'archived',   label: '已归档',  color: '#8e8e93', badgeType: 'info'    as const, emptyText: '暂无已归档项目', phases: ['archived', '已归档'] },
]

const visibleColumns = computed(() => {
  if (!activeFilter.value) return columns
  return columns.filter(c => c.id === activeFilter.value)
})

function toggleFilter(id: string) {
  activeFilter.value = activeFilter.value === id ? null : id
}

function mapPhaseToColumn(phase: string): string {
  const p = (phase || '').toLowerCase()
  for (const col of columns) {
    if (col.phases.some(ph => p.includes(ph.toLowerCase()) || ph.toLowerCase().includes(p))) {
      return col.id
    }
  }
  return 'in_progress' // 默认归入进行中
}

function getProjects(colId: string): Project[] {
  return projects.value.filter(proj => {
    const matchSearch = !searchText.value || proj.name.toLowerCase().includes(searchText.value.toLowerCase())
    const matchCol = mapPhaseToColumn(proj.phase) === colId
    return matchSearch && matchCol
  })
}

function getCardClass(proj: Project) {
  const classes: string[] = []
  const stuckMs = getStuckMs(proj)
  if (stuckMs > 24 * 3600_000) classes.push('card-critical')
  else if (stuckMs > 2 * 3600_000) classes.push('card-warning')
  if (proj.blocked_reason) classes.push('card-blocked')
  if (proj.retry_count >= 3) classes.push('card-retry-warn')
  return classes.join(' ')
}

function getStuckMs(proj: Project): number {
  if (!proj.updated_at) return 0
  const phase = mapPhaseToColumn(proj.phase)
  if (phase === 'done' || phase === 'archived') return 0
  const updatedMs = new Date(proj.updated_at).getTime()
  if (isNaN(updatedMs)) return 0
  return Date.now() - updatedMs
}

function getStuckDuration(proj: Project): string {
  const ms = getStuckMs(proj)
  if (ms < 2 * 3600_000) return ''
  const h = Math.floor(ms / 3600_000)
  if (h < 24) return `卡住 ${h}h`
  return `卡住 ${Math.floor(h / 24)}天${h % 24}h`
}

function getStuckClass(proj: Project): string {
  const ms = getStuckMs(proj)
  if (ms > 24 * 3600_000) return 'stuck-critical'
  if (ms > 2 * 3600_000) return 'stuck-warning'
  return ''
}

const phaseColors: Record<string, string> = {
  done: '#30d158', completed: '#30d158', finished: '#30d158', 已完成: '#30d158',
  archived: '#8e8e93', 已归档: '#8e8e93',
  blocked: '#ff9f0a', paused: '#ff9f0a', 阻塞: '#ff9f0a',
  in_progress: '#0a84ff', running: '#0a84ff', active: '#0a84ff', developing: '#0a84ff', testing: '#0a84ff',
}

const PHASE_LABELS: Record<string, string> = {
  pending: '待启动', waiting: '等待中', init: '初始化',
  in_progress: '进行中', running: '运行中', active: '进行中',
  planning: '规划中', developing: '开发中', testing: '测试中',
  pm_reviewing: '验收中', reviewing: '评审中',
  blocked: '阻塞', paused: '已暂停',
  done: '已完成', completed: '已完成', finished: '已完成', pass: '通过',
  archived: '已归档',
}
function phaseLabel(phase: string): string {
  const p = (phase || '').toLowerCase()
  return ownValue(PHASE_LABELS, p) || Object.entries(PHASE_LABELS).find(([k]) => p.includes(k))?.[1] || phase
}

const projectAgentIds = computed(() => projects.value
  .map(project => String(project.responsible_agent || '').trim())
  .filter(Boolean))
const projectAgentOptions = computed(() => buildAgentPresentationOptions(agentStore.agents, projectAgentIds.value))
function agentLabel(id: string | null): string {
  if (!id) return '-'
  return projectAgentOptions.value.find(agent => agent.id === id)?.name || id
}

function phaseTagStyle(phase: string) {
  const p = (phase || '').toLowerCase()
  const color = Object.entries(phaseColors).find(([k]) => p.includes(k.toLowerCase()))?.[1] || '#8e8e93'
  return { background: color, borderColor: color }
}

const showRawJson = ref(false)

const fileViewVisible = ref(false)
const fileViewTitle = ref('')
const fileViewLoading = ref(false)
const fileViewContent = ref('')
const fileViewHtml = computed(() => {
  if (!fileViewContent.value) return ''
  return renderSafeMarkdown(fileViewContent.value, source => marked.parse(source, { async: false }) as string)
})

async function openProjectFile(f: { key: string; label: string }): Promise<void> {
  const proj = selectedProject.value
  if (!proj) return
  fileViewTitle.value = `${proj.displayName || proj.name} · ${f.label}`
  fileViewVisible.value = true
  fileViewLoading.value = true
  fileViewContent.value = ''
  try {
    const resp = await fetch(`/api/projects/file?id=${encodeURIComponent(proj.id)}&key=${encodeURIComponent(f.key)}`)
    const j = await resp.json()
    if (resp.ok && j.content !== undefined) fileViewContent.value = j.content
    else fileViewContent.value = `读取失败: ${j.error || '未知错误'}`
  } catch (e: any) {
    fileViewContent.value = `读取失败: ${e.message}`
  } finally {
    fileViewLoading.value = false
  }
}

async function editInitiator(): Promise<void> {
  const proj = selectedProject.value
  if (!proj) return
  try {
    const { value } = await ElMessageBox.prompt(
      '输入这个项目的发起方（例如：用户、需求方）',
      '修改发起方',
      { confirmButtonText: '保存', cancelButtonText: '取消', inputValue: proj.initiator || '' }
    )
    const resp = await fetch('/api/projects/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: proj.id, initiator: value || '' }),
    })
    const j = await resp.json()
    if (resp.ok && j.ok) {
      proj.initiator = j.initiator
      ElMessage.success(j.initiator ? `发起方已记录为「${j.initiator}」` : '已清空发起方')
      loadProjects()
    } else {
      ElMessage.error(`保存失败: ${j.error || '未知错误'}`)
    }
  } catch { /* 用户取消 */ }
}

async function renameProject(): Promise<void> {
  const proj = selectedProject.value
  if (!proj) return
  try {
    const { value } = await ElMessageBox.prompt(
      '输入项目的中文显示名（留空则恢复显示英文 ID）',
      '修改项目名称',
      { confirmButtonText: '保存', cancelButtonText: '取消', inputValue: proj.displayName || '' }
    )
    const resp = await fetch('/api/projects/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: proj.id, displayName: value || '' }),
    })
    const j = await resp.json()
    if (resp.ok && j.ok) {
      proj.displayName = j.displayName
      ElMessage.success(j.displayName ? `已更名为「${j.displayName}」` : '已恢复默认名称')
      loadProjects()
    } else {
      ElMessage.error(`保存失败: ${j.error || '未知错误'}`)
    }
  } catch { /* 用户取消 */ }
}

function rawField(key: string): string {
  const v = selectedProject.value?.raw?.[key]
  return typeof v === 'string' ? v : ''
}

const FILE_LABELS: Record<string, string> = {
  pm_plan: '产品方案', dev_output: '开发产出', test_report: '测试报告', decisions: '决策记录',
}
const projectFiles = computed(() => {
  const files = selectedProject.value?.raw?.files
  if (!files || typeof files !== 'object') return []
  return Object.keys(files as Record<string, unknown>).map(k => ({ key: k, label: ownValue(FILE_LABELS, k) || k }))
})

function formatTime(t: string): string {
  if (!t) return '-'
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function openDetail(proj: Project) {
  selectedProject.value = proj
  detailVisible.value = true
}

function atAgent(proj: Project) {
  if (!proj.responsible_agent) return
  ElMessage.info(`可在飞书群 @ ${proj.responsible_agent} 了解项目 "${proj.name}" 的进度`)
}

async function loadProjects() {
  loading.value = true
  try {
    const res = await fetch('/api/projects/list')
    if (res.ok) {
      const data = await res.json()
      projects.value = data.projects || []
    } else {
      ElMessage.error('加载项目列表失败')
    }
  } catch (e) {
    ElMessage.error('网络错误，无法加载项目')
  } finally {
    loading.value = false
  }
}

watch(visible, (val) => {
  if (val) loadProjects()
})
</script>

<style scoped>
.project-board-dialog :deep(.el-dialog__body) {
  padding: 12px 16px;
  overflow: hidden;
}

/* 工具栏 */
.pb-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
  flex-wrap: wrap;
}
.pb-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pb-col-filter {
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}
.pb-col-filter.active {
  opacity: 1;
  font-weight: 700;
}
.pb-col-filter:not(.active) {
  opacity: 0.5;
}
.pb-col-filter:hover {
  opacity: 1;
}

/* 看板 */
.pb-board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  height: calc(80vh - 120px);
  min-height: 400px;
  padding-bottom: 8px;
}

.pb-column {
  flex: 1 1 0;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-top: 3px solid var(--col-color, #8e8e93);
  border-radius: 8px;
  overflow: hidden;
}

.pb-col-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: var(--fill-subtle);
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: 700;
}
.pb-col-label { color: var(--col-color, #e5e5ea); flex: 1; }
.pb-col-badge { flex-shrink: 0; }


.pb-col-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pb-empty {
  text-align: center;
  padding: 24px 8px;
  color: var(--text-secondary);
  font-size: 12px;
}
.pb-card-id {
  font-size: 10.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 卡片 */
.pb-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.pb-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--col-color, #8e8e93);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.pb-card.card-warning { border-left: 3px solid #ff9f0a; }
.pb-card.card-critical { border-left: 3px solid #ff453a; }
.pb-card.card-blocked { border-left: 3px solid #ff9f0a; }
.pb-card.card-retry-warn { border-left: 3px solid #ff453a; }

.pb-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
}
.pb-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e5e5ea);
  line-height: 1.3;
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.pb-card-agent,
.pb-card-stuck,
.pb-card-blocked,
.pb-card-retry {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary, #98989d);
}
.stuck-warning { color: #ff9f0a; }
.stuck-critical { color: #ff453a; }
.pb-card-blocked { color: #ff9f0a; }
.pb-card-retry { color: #ff453a; }
.pb-blocked-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

/* 详情 drawer */
.pb-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.pb-detail-section {
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
}
.pb-detail-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary, #98989d);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.pb-detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid var(--border-color);
  gap: 12px;
}
.pb-detail-row:last-child { border-bottom: none; }
.pb-detail-key {
  font-size: 12px;
  color: var(--text-secondary, #98989d);
  flex-shrink: 0;
}
.pb-detail-val {
  font-size: 12px;
  color: var(--text-primary, #e5e5ea);
  text-align: right;
  word-break: break-all;
}
.pb-detail-val.mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
}

.pb-file-chip {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  margin: 0 4px 4px 0;
  border-radius: 5px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}
.pb-raw-toggle { margin-top: 6px; }
.pb-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 8px;
  padding: 2px 9px;
  font-size: 11px;
  font-family: inherit;
  color: var(--accent);
  background: var(--accent-glow);
  border: 1px solid var(--accent);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s;
  vertical-align: middle;
}
.pb-edit-btn:hover {
  background: var(--accent);
  color: #ffffff;
}
.pb-file-btn {
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.pb-file-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-glow);
}
.pb-file-loading {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}
.pb-file-md {
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--text-primary);
  padding: 4px 8px 12px;
}
.pb-file-md :deep(h1), .pb-file-md :deep(h2), .pb-file-md :deep(h3) {
  margin: 18px 0 8px;
  font-weight: 600;
}
.pb-file-md :deep(h1) { font-size: 18px; }
.pb-file-md :deep(h2) { font-size: 16px; }
.pb-file-md :deep(h3) { font-size: 14px; }
.pb-file-md :deep(code) {
  background: var(--fill-subtle);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.pb-file-md :deep(pre) {
  background: var(--code-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
}
.pb-file-md :deep(ul), .pb-file-md :deep(ol) { padding-left: 22px; }
.pb-file-md :deep(table) { border-collapse: collapse; }
.pb-file-md :deep(th), .pb-file-md :deep(td) {
  border: 1px solid var(--border-color);
  padding: 4px 10px;
  font-size: 12.5px;
}
.pb-json-view {
  background: var(--code-bg);
  border-radius: 6px;
  padding: 12px;
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: var(--text-secondary);
  overflow: auto;
  max-height: 400px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
.col-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

:global(html.light-theme .project-board-dialog .pb-column) {
  background:
    linear-gradient(180deg, rgba(0, 122, 255, 0.035), rgba(48, 209, 88, 0.018)),
    #fbfdff;
  border-color: rgba(0, 122, 255, 0.13);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

:global(html.light-theme .project-board-dialog .pb-col-header) {
  background:
    linear-gradient(180deg, rgba(0, 122, 255, 0.07), rgba(0, 122, 255, 0.025)),
    #f8fbff;
  border-bottom-color: rgba(0, 122, 255, 0.12);
}

:global(html.light-theme .project-board-dialog .pb-col-body) {
  background: rgba(255, 255, 255, 0.34);
}

:global(html.light-theme .project-board-dialog .pb-card) {
  background: rgba(255, 255, 255, 0.92);
  border-color: rgba(31, 41, 55, 0.1);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
}

:global(html.light-theme .project-board-dialog .pb-card:hover) {
  background: #ffffff;
  border-color: color-mix(in srgb, var(--col-color, #0a84ff) 45%, rgba(0, 122, 255, 0.18));
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
}

:global(html.light-theme .project-board-dialog .pb-empty) {
  color: rgba(31, 41, 55, 0.56);
}

:global(html.light-theme .pb-detail-section) {
  background:
    linear-gradient(180deg, rgba(0, 122, 255, 0.03), rgba(255, 255, 255, 0.96)),
    #ffffff;
  border-color: rgba(0, 122, 255, 0.13);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
}

:global(html.light-theme .pb-detail-row) {
  border-bottom-color: rgba(31, 41, 55, 0.1);
}

:global(html.light-theme .pb-file-chip) {
  background: rgba(0, 122, 255, 0.055);
  border-color: rgba(0, 122, 255, 0.16);
}

:global(html.light-theme .pb-json-view),
:global(html.light-theme .pb-file-md :is(pre, code)) {
  background: rgba(0, 122, 255, 0.045);
  border-color: rgba(0, 122, 255, 0.12);
}
</style>
