<template>
  <el-dialog
    top="4vh"
    v-model="visible"
    title="任务中心"
    width="860px"
    :close-on-click-modal="true"
    class="cron-center-dialog"
    destroy-on-close
  >
    <!-- 工具栏 -->
    <div class="cc-toolbar">
      <div class="cc-toolbar-left">
        <el-input
          v-model="searchText"
          placeholder="搜索任务名称 / Agent..."
          clearable
          size="small"
          style="width: 220px"
        />
        <el-select
          v-model="agentFilter"
          size="small"
          placeholder="全部 Agent"
          clearable
          style="width: 180px"
        >
          <el-option
            v-for="agent in agentOptions"
            :key="agent.id"
            :label="agent.name"
            :value="agent.id"
          >
            <span class="cc-agent-option">
              <img class="cc-agent-option-avatar" :src="agent.avatar" :alt="agent.name" @error="setDefaultAvatar" />
              <span>{{ agent.name }}</span>
            </span>
          </el-option>
        </el-select>
        <el-tag v-if="failJobs > 0" type="danger" size="small" effect="dark">
          {{ failJobs }} 个任务失败 ≥3 次
        </el-tag>
      </div>
      <div class="cc-toolbar-actions">
        <el-tooltip content="收起当前已展开的任务详情" placement="top">
          <el-button size="small" @click="collapseAll">
            全部折叠
          </el-button>
        </el-tooltip>
        <el-tooltip content="重新读取最新的定时任务列表" placement="top">
          <el-button size="small" :loading="loading" @click="loadJobs">
            <el-icon><Refresh /></el-icon> 刷新
          </el-button>
        </el-tooltip>
        <el-tooltip content="给某个 Agent 新增一条定时任务" placement="top">
          <el-button size="small" type="primary" @click="openCreateDialog">
            <el-icon><Plus /></el-icon> 新建任务
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="cc-list" v-loading="loading">
      <div v-if="filteredJobs.length === 0 && !loading" class="cc-empty">
        <el-icon :size="32"><Timer /></el-icon>
        <span>暂无 Cron 任务</span>
      </div>

      <div
        v-for="job in filteredJobs"
        :key="job.id || job.name"
        class="cc-job-row"
        :class="{ 'cc-job-fail': (job.failCount || 0) >= 3, 'cc-job-paused': !isEnabled(job) }"
      >
        <div class="cc-job-line" @click="toggleExpand(job)">
          <!-- 左：名称 + agent + cron -->
          <div class="cc-job-main">
            <div class="cc-job-name-row">
              <span class="cc-status-dot" :class="(job.failCount || 0) >= 3 ? 'is-fail' : (!isEnabled(job) ? 'is-paused' : 'is-ok')"></span>
              <span class="cc-job-name">{{ job.name || job.id }}</span>
              <el-icon class="cc-expand-icon" :class="{ open: expandedJobKey === jobKey(job) }"><ArrowDown /></el-icon>
            </div>
            <div class="cc-job-meta">
              <span class="cc-agent-chip" :title="`执行 Agent：${agentLabel(job.agentId || job.agent)}`">
                <img class="cc-agent-avatar" :src="agentAvatar(job.agentId || job.agent)" :alt="agentLabel(job.agentId || job.agent)" @error="setDefaultAvatar" />
                <span>{{ agentLabel(job.agentId || job.agent) }}</span>
              </span>
              <span class="cc-delivery" :class="{ silent: !hasDelivery(job) }">
                {{ deliveryLabel(job) }}
              </span>
              <span class="cc-cron-expr" :title="getCronExpr(job)">
                {{ parseCron(getCronExpr(job)) }}
              </span>
            </div>
          </div>

          <!-- 中：下次执行 + 最近状态 -->
          <div class="cc-job-middle">
            <div class="cc-next-run" v-if="job.nextRun || job.next_run || (job as any).nextRunAtMs">
              <el-icon :size="11"><Clock /></el-icon>
              <span>{{ formatNextRunMs((job as any).nextRunAtMs) || formatNextRun(job.nextRun || job.next_run) }}</span>
            </div>
            <div class="cc-last-status" v-if="job.lastRun">
              <el-tag
                size="small"
                :type="runStatusType(job.lastRun.status)"
                effect="plain"
              >
                {{ runStatusLabel(job.lastRun.status) }}
              </el-tag>
              <span class="cc-last-time">{{ formatRelativeTime(job.lastRun.startedAt || job.lastRun.start_time || job.lastRun.ts) }}</span>
            </div>
            <div class="cc-fail-count" v-if="(job.failCount || 0) >= 3">
              <el-icon :size="11"><WarningFilled /></el-icon>
              失败 {{ job.failCount }} 次
            </div>
          </div>

          <!-- 右：操作 -->
          <div class="cc-job-actions" @click.stop>
            <el-tooltip content="编辑这个任务的名称、Agent、时间和要求" placement="top">
              <el-button
                class="cc-edit-action-btn"
                size="small"
                type="primary"
                plain
                :icon="EditPen"
                :disabled="editingJobKey === jobKey(job)"
                @click="startEdit(job)"
              >
                编辑任务
              </el-button>
            </el-tooltip>
            <span
              class="cc-action-tip"
              @mouseenter="showActionTip($event, '立即执行：马上手动运行一次这个任务')"
              @mouseleave="hideActionTip"
              @focusin="showActionTip($event, '立即执行：马上手动运行一次这个任务')"
              @focusout="hideActionTip"
            >
              <el-button
                size="small"
                type="primary"
                :icon="VideoPlay"
                circle
                plain
                aria-label="立即执行：马上手动运行一次这个任务"
                @click="triggerJob(job)"
                :loading="triggering === (job.id || job.name)"
              />
            </span>
            <span
              class="cc-action-tip"
              @mouseenter="showActionTip($event, !isEnabled(job) ? '恢复任务：让这个任务继续按时间自动执行' : '暂停任务：暂时停止这个任务的自动执行')"
              @mouseleave="hideActionTip"
              @focusin="showActionTip($event, !isEnabled(job) ? '恢复任务：让这个任务继续按时间自动执行' : '暂停任务：暂时停止这个任务的自动执行')"
              @focusout="hideActionTip"
            >
              <el-button
                size="small"
                :type="!isEnabled(job) ? 'success' : 'warning'"
                :icon="!isEnabled(job) ? CaretRight : VideoPause"
                circle
                plain
                :aria-label="!isEnabled(job) ? '恢复任务：让这个任务继续按时间自动执行' : '暂停任务：暂时停止这个任务的自动执行'"
                @click="togglePause(job)"
                :loading="toggling === (job.id || job.name)"
              />
            </span>
            <span
              class="cc-action-tip"
              @mouseenter="showActionTip($event, '查看日志：查看这个任务每次执行的记录、输出和结果')"
              @mouseleave="hideActionTip"
              @focusin="showActionTip($event, '查看日志：查看这个任务每次执行的记录、输出和结果')"
              @focusout="hideActionTip"
            >
              <el-button
                size="small"
                type="info"
                :icon="Memo"
                circle
                plain
                aria-label="查看日志：查看这个任务每次执行的记录、输出和结果"
                @click="openHistory(job)"
              />
            </span>
            <el-popconfirm
              title="确定删除这个定时任务吗？"
              confirm-button-text="删除"
              cancel-button-text="取消"
              confirm-button-type="danger"
              @confirm="deleteJob(job)"
            >
              <template #reference>
                <span
                  class="cc-action-tip"
                  @mouseenter="showActionTip($event, '删除任务：从 Cron 中心移除这个定时任务')"
                  @mouseleave="hideActionTip"
                  @focusin="showActionTip($event, '删除任务：从 Cron 中心移除这个定时任务')"
                  @focusout="hideActionTip"
                >
                  <el-button
                    size="small"
                    type="danger"
                    :icon="Delete"
                    circle
                    plain
                    aria-label="删除任务：从 Cron 中心移除这个定时任务"
                    :loading="deleting === (job.id || job.name)"
                  />
                </span>
              </template>
            </el-popconfirm>
          </div>
        </div>

        <div v-if="expandedJobKey === jobKey(job)" class="cc-job-detail">
          <div v-if="editingJobKey !== jobKey(job)" class="cc-detail-card">
            <div class="cc-detail-title-row">
              <div class="cc-detail-title">任务要求</div>
            </div>
            <pre class="cc-detail-message">{{ getJobMessage(job) || '这个任务没有写明要求。' }}</pre>
          </div>
          <div v-if="editingJobKey !== jobKey(job)" class="cc-detail-card">
            <div class="cc-detail-title">执行配置</div>
            <div class="cc-detail-grid">
              <span>执行 Agent</span><strong>{{ agentLabel(job.agentId || job.agent) }}</strong>
              <span>技能/工具</span><strong>{{ getJobTools(job) }}</strong>
              <span>会话模式</span><strong>{{ sessionTargetLabel((job as any).sessionTarget) }}</strong>
              <span>触达方式</span><strong>{{ deliveryLabel(job) }}</strong>
              <span>创建时间</span><strong>{{ formatCreated(job) }}</strong>
            </div>
          </div>
          <div v-else class="cc-detail-card cc-edit-card">
            <div class="cc-detail-title-row">
              <div class="cc-detail-title">编辑任务</div>
              <div class="cc-edit-actions">
                <el-tooltip content="放弃本次修改，回到查看状态" placement="top">
                  <el-button size="small" @click.stop="cancelEdit">取消</el-button>
                </el-tooltip>
                <el-tooltip content="保存修改并同步到 OpenClaw 定时任务" placement="top">
                  <el-button
                    size="small"
                    type="primary"
                    :loading="saving === jobKey(job)"
                    @click.stop="saveEdit(job)"
                  >
                    保存
                  </el-button>
                </el-tooltip>
              </div>
            </div>
            <el-form label-position="top" class="cc-edit-form" @click.stop>
              <el-form-item label="任务名称">
                <el-input v-model="editForm.name" placeholder="填写任务名称" />
              </el-form-item>
              <el-form-item label="执行 Agent">
                <el-select v-model="editForm.agentId" style="width: 100%">
                  <el-option
                    v-for="agent in allAgentOptions"
                    :key="agent.id"
                    :label="agent.name"
                    :value="agent.id"
                  >
                    <span class="cc-agent-option">
                      <img class="cc-agent-option-avatar" :src="agent.avatar" :alt="agent.name" @error="setDefaultAvatar" />
                      <span>{{ agent.name }}</span>
                    </span>
                  </el-option>
                </el-select>
              </el-form-item>
              <div class="cc-edit-schedule">
                <el-form-item label="时间类型">
                  <el-select v-model="editForm.scheduleType">
                    <el-option label="Cron 表达式" value="cron" />
                    <el-option label="固定间隔" value="every" />
                    <el-option label="指定时间执行一次" value="at" />
                  </el-select>
                </el-form-item>
                <el-form-item :label="editScheduleInputLabel">
                  <el-input v-model="editForm.scheduleValue" :placeholder="editSchedulePlaceholder" />
                </el-form-item>
              </div>
              <el-form-item label="任务要求">
                <el-input
                  v-model="editForm.message"
                  type="textarea"
                  :rows="5"
                  placeholder="写给这个 Agent 的具体任务要求..."
                />
              </el-form-item>
              <el-form-item label="执行方式">
                <el-radio-group v-model="editForm.deliveryMode">
                  <el-radio-button label="none">静默执行</el-radio-button>
                  <el-radio-button label="announce">完成后推送</el-radio-button>
                </el-radio-group>
              </el-form-item>
            </el-form>
          </div>
        </div>
      </div>
    </div>

    <!-- 执行记录弹窗 -->
    <el-dialog
      v-model="historyVisible"
      :title="`执行记录 — ${historyJob?.name || historyJob?.id || ''}`"
      width="600px"
      append-to-body
    >
      <div class="cc-history">
        <div v-if="!historyJob?.runs?.length" class="cc-history-empty">暂无执行记录</div>
        <div
          v-for="(run, i) in historyJob?.runs || []"
          :key="i"
          class="cc-history-row"
          :class="{ 'run-fail': run.status === 'error' || run.status === 'failed' }"
        >
          <el-tag
            size="small"
            :type="runStatusType(run.status)"
            effect="dark"
            style="min-width: 52px; text-align: center;"
          >
            {{ runStatusLabel(run.status) }}
          </el-tag>
          <span class="cc-history-time">{{ formatFullTime(run.startedAt || run.start_time || run.ts) }}</span>
          <span class="cc-history-dur" v-if="run.durationMs || run.duration_ms">
            {{ Math.round(((run.durationMs ?? run.duration_ms) as number) / 1000) }}s
          </span>
          <span class="cc-history-msg" v-if="run.error || run.message">
            {{ run.error || run.message }}
          </span>
        </div>
      </div>
    </el-dialog>

    <!-- 新建任务 -->
    <el-dialog
      v-model="createVisible"
      title="新建定时任务"
      width="620px"
      append-to-body
      class="cron-create-dialog"
    >
      <el-form label-position="top" class="cc-create-form">
        <el-form-item label="任务名称">
          <el-input v-model="createForm.name" placeholder="例如：上午状态确认" />
        </el-form-item>
        <el-form-item label="执行 Agent">
          <el-select v-model="createForm.agentId" style="width: 100%">
            <el-option
              v-for="agent in allAgentOptions"
              :key="agent.id"
              :label="agent.name"
              :value="agent.id"
            >
              <span class="cc-agent-option">
                <img class="cc-agent-option-avatar" :src="agent.avatar" :alt="agent.name" @error="setDefaultAvatar" />
                <span>{{ agent.name }}</span>
              </span>
            </el-option>
          </el-select>
        </el-form-item>
        <div class="cc-create-schedule">
          <el-form-item label="时间类型">
            <el-select v-model="createForm.scheduleType">
              <el-option label="Cron 表达式" value="cron" />
              <el-option label="固定间隔" value="every" />
              <el-option label="指定时间执行一次" value="at" />
            </el-select>
          </el-form-item>
          <el-form-item :label="scheduleInputLabel">
            <el-input v-model="createForm.scheduleValue" :placeholder="schedulePlaceholder" />
          </el-form-item>
        </div>
        <el-form-item label="任务要求">
          <el-input
            v-model="createForm.message"
            type="textarea"
            :rows="5"
            placeholder="写给这个 Agent 的具体任务要求..."
          />
        </el-form-item>
        <el-form-item label="执行方式">
          <el-radio-group v-model="createForm.deliveryMode">
            <el-radio-button label="none">静默执行</el-radio-button>
            <el-radio-button label="announce">完成后推送</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createJob">创建任务</el-button>
      </template>
    </el-dialog>
  </el-dialog>
  <Teleport to="body">
    <div
      v-if="actionTip.visible"
      class="cc-floating-action-tip"
      :style="{ left: `${actionTip.left}px`, top: `${actionTip.top}px` }"
    >
      {{ actionTip.text }}
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  Refresh, Timer, Clock, WarningFilled, VideoPlay, VideoPause, CaretRight, Memo, Delete, Plus, ArrowDown, EditPen } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { setDefaultAvatar } from '../utils/avatarFallback'
import { useAgentStore } from '../stores/agent'
import { buildAgentPresentationOptions, DEFAULT_AGENT_AVATAR_SRC } from '../utils/agent-presentation.mjs'

const visible = defineModel<boolean>('visible', { default: false })
const agentStore = useAgentStore()

interface CronRun {
  status: string
  startedAt?: string
  start_time?: string
  ts?: string
  durationMs?: number
  duration_ms?: number
  error?: string
  message?: string
}

interface CronSchedule {
  kind?: string
  expr?: string
  everyMs?: number
  tz?: string
}

interface CronJob {
  id?: string
  name?: string
  agent?: string
  agentId?: string
  cron?: string
  schedule?: CronSchedule | string
  enabled?: boolean
  paused?: boolean
  status?: string
  nextRun?: string
  next_run?: string
  lastRun?: CronRun
  runs?: CronRun[]
  failCount?: number
  payload?: {
    kind?: string
    message?: string
    tools?: string[] | string
    [key: string]: unknown
  }
  delivery?: {
    mode?: string
    channel?: string
    [key: string]: unknown
  }
  sessionTarget?: string
  createdAtMs?: number
}

const loading = ref(false)
const jobs = ref<CronJob[]>([])
const searchText = ref('')
const agentFilter = ref('')
const triggering = ref<string | null>(null)
const toggling = ref<string | null>(null)
const deleting = ref<string | null>(null)
const creating = ref(false)
const saving = ref<string | null>(null)
const createVisible = ref(false)
const historyVisible = ref(false)
const historyJob = ref<CronJob | null>(null)
const expandedJobKey = ref('')
const editingJobKey = ref('')
const actionTip = ref({
  visible: false,
  text: '',
  left: 0,
  top: 0,
})

const createForm = ref({
  name: '',
  agentId: '',
  scheduleType: 'cron' as 'cron' | 'every' | 'at',
  scheduleValue: '0 9 * * *',
  message: '',
  deliveryMode: 'none' as 'none' | 'announce',
})
const editForm = ref({
  name: '',
  agentId: '',
  scheduleType: 'cron' as 'cron' | 'every' | 'at',
  scheduleValue: '',
  message: '',
  deliveryMode: 'none' as 'none' | 'announce',
})

const failJobs = computed(() => jobs.value.filter(j => (j.failCount || 0) >= 3).length)

function showActionTip(event: MouseEvent | FocusEvent, text: string) {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  const tooltipWidth = Math.min(280, Math.max(160, text.length * 11 + 24))
  const tooltipHeight = text.length > 18 ? 52 : 38
  const gap = 12
  let left = rect.left - tooltipWidth - gap
  if (left < gap) {
    left = rect.right + gap
  }
  left = Math.max(gap, Math.min(window.innerWidth - tooltipWidth - gap, left))
  const minTop = tooltipHeight / 2 + gap
  const maxTop = window.innerHeight - tooltipHeight / 2 - gap
  const top = Math.max(minTop, Math.min(maxTop, rect.top + rect.height / 2))
  actionTip.value = { visible: true, text, left, top }
}

function hideActionTip() {
  actionTip.value.visible = false
}

const filteredJobs = computed(() => {
  const q = searchText.value.toLowerCase()
  return jobs.value.filter(j => {
    const agentId = String(j.agentId || j.agent || '')
    if (agentFilter.value && agentId !== agentFilter.value) return false
    if (!q) return true
    return (j.name || '').toLowerCase().includes(q) ||
           (j.id || '').toLowerCase().includes(q) ||
           agentId.toLowerCase().includes(q) ||
           agentLabel(agentId).toLowerCase().includes(q)
  })
})

const referencedAgentIds = computed(() => jobs.value
  .map(job => String(job.agentId || job.agent || '').trim())
  .filter(Boolean))
const allAgentOptions = computed(() => buildAgentPresentationOptions(agentStore.agents, referencedAgentIds.value))

function agentLabel(id?: string): string {
  if (!id) return '未指定 Agent'
  return allAgentOptions.value.find(agent => agent.id === id)?.name || id
}
function agentAvatar(id?: string): string {
  return allAgentOptions.value.find(agent => agent.id === id)?.avatar || DEFAULT_AGENT_AVATAR_SRC
}
const agentOptions = computed(() => allAgentOptions.value)
function jobKey(job: CronJob): string {
  return String(job.id || job.name || '')
}
function toggleExpand(job: CronJob) {
  const key = jobKey(job)
  expandedJobKey.value = expandedJobKey.value === key ? '' : key
  if (expandedJobKey.value !== key) editingJobKey.value = ''
}
function collapseAll() {
  expandedJobKey.value = ''
  editingJobKey.value = ''
}
function getJobMessage(job: CronJob): string {
  const payload = job.payload || {}
  return String(payload.message || payload.command || payload.systemEvent || '').trim()
}
function getJobTools(job: CronJob): string {
  const payload = job.payload || {}
  const tools = payload.tools || (job as any).tools
  if (Array.isArray(tools) && tools.length) return tools.join('、')
  if (typeof tools === 'string' && tools.trim()) return tools.trim()
  return '未指定'
}
function sessionTargetLabel(target?: string): string {
  if (target === 'main') return '主会话'
  if (target === 'isolated') return '独立会话'
  return target || '默认'
}
const scheduleInputLabel = computed(() => {
  if (createForm.value.scheduleType === 'every') return '间隔'
  if (createForm.value.scheduleType === 'at') return '执行时间'
  return 'Cron 表达式'
})
const schedulePlaceholder = computed(() => {
  if (createForm.value.scheduleType === 'every') return '例如：30m、2h、1d'
  if (createForm.value.scheduleType === 'at') return '例如：+30m 或 2026-06-11T20:30:00+08:00'
  return '例如：0 9 * * *'
})
const editScheduleInputLabel = computed(() => {
  if (editForm.value.scheduleType === 'every') return '间隔'
  if (editForm.value.scheduleType === 'at') return '执行时间'
  return 'Cron 表达式'
})
const editSchedulePlaceholder = computed(() => {
  if (editForm.value.scheduleType === 'every') return '例如：30m、2h、1d'
  if (editForm.value.scheduleType === 'at') return '例如：+30m 或 2026-06-11T20:30:00+08:00'
  return '例如：0 9 * * *'
})
function hasDelivery(job: any): boolean {
  const mode = job?.delivery?.mode
  return !!mode && mode !== 'none'
}
function deliveryLabel(job: any): string {
  if (hasDelivery(job)) {
    const ch = job?.delivery?.channel
    return ch === 'feishu' ? '→ 推送到飞书' : `→ 推送到 ${ch || '渠道'}`
  }
  const sk = String(job?.sessionKey || '')
  if (sk.includes('feishu')) return '→ 结果发往飞书'
  return '静默执行'
}
function formatCreated(job: any): string {
  const ms = job?.createdAtMs
  if (!ms) return '未知时间'
  const d = new Date(ms)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

// 获取 cron 表达式字符串（兼容 schedule.expr 和直接字符串）
function getCronExpr(job: CronJob): string {
  if (typeof job.schedule === 'object' && job.schedule?.expr) return job.schedule.expr
  if (typeof job.schedule === 'string') return job.schedule
  if (job.cron) return job.cron
  if (typeof job.schedule === 'object' && job.schedule?.kind === 'every') {
    const ms = job.schedule.everyMs || 0
    if (ms < 60_000) return `每 ${ms / 1000} 秒`
    if (ms < 3600_000) return `每 ${ms / 60_000} 分钟`
    return `每 ${ms / 3600_000} 小时`
  }
  return ''
}

function getScheduleType(job: CronJob): 'cron' | 'every' | 'at' {
  if (typeof job.schedule === 'object') {
    if (job.schedule?.kind === 'every') return 'every'
    if (job.schedule?.kind === 'at') return 'at'
  }
  return 'cron'
}

function getScheduleValue(job: CronJob): string {
  if (typeof job.schedule === 'object') {
    if (job.schedule?.kind === 'every') {
      const ms = job.schedule.everyMs || 0
      if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`
      if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
      if (ms % 60_000 === 0) return `${ms / 60_000}m`
      if (ms) return `${Math.round(ms / 1000)}s`
    }
    if ((job.schedule as any)?.at) return String((job.schedule as any).at)
    if (job.schedule?.expr) return job.schedule.expr
  }
  return getCronExpr(job)
}

// 判断任务是否启用（enabled 字段，默认 true）
function isEnabled(job: CronJob): boolean {
  if (typeof job.enabled === 'boolean') return job.enabled
  if (job.paused) return false
  if (job.status === 'paused') return false
  return true
}

// cron 表达式解析为人类可读
function parseCron(expr: string | undefined): string {
  if (!expr) return ''
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return expr
  const [min, hour, day, month, week] = parts
  if (min === '0' && hour === '*/2' && day === '*' && month === '*' && week === '*') return '每 2 小时'
  if (min === '0' && hour === '*' && day === '*' && month === '*' && week === '*') return '每小时整点'
  if (min === '0' && hour === '0' && day === '*' && month === '*' && week === '*') return '每天凌晨'
  if (min === '3' && hour === '3' && day === '*' && month === '*' && week === '*') return '每天 03:03'
  if (min.startsWith('*/') && hour === '*' && day === '*') return `每 ${min.slice(2)} 分钟`
  if (hour.startsWith('*/') && day === '*') return `每 ${hour.slice(2)} 小时`
  if (day === '*' && month === '*' && week !== '*') {
    const weekDays = ['日','一','二','三','四','五','六']
    const weekIdx = parseInt(week)
    return `每周${(!isNaN(weekIdx) && weekDays[weekIdx]) ? weekDays[weekIdx] : week}`
  }
  if (min !== '*' && hour !== '*' && day === '*') return `每天 ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`
  return expr
}

function formatNextRun(t: string | undefined): string {
  if (!t) return ''
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  const diff = d.getTime() - Date.now()
  if (diff < 0) return '即将执行'
  if (diff < 60_000) return `${Math.round(diff / 1000)} 秒后`
  if (diff < 3600_000) return `${Math.round(diff / 60_000)} 分钟后`
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)} 小时后`
  return `${Math.round(diff / 86400_000)} 天后`
}

function formatNextRunMs(ms: number | undefined | null): string {
  if (!ms) return ''
  const diff = ms - Date.now()
  if (diff < 0) return '即将执行'
  if (diff < 60_000) return `${Math.round(diff / 1000)} 秒后`
  if (diff < 3600_000) return `${Math.round(diff / 60_000)} 分钟后`
  if (diff < 86400_000) {
    const h = Math.floor(diff / 3600_000)
    const m = Math.floor((diff % 3600_000) / 60_000)
    return m > 0 ? `${h} 小时 ${m} 分钟后` : `${h} 小时后`
  }
  return `${Math.round(diff / 86400_000)} 天后`
}

function formatRelativeTime(t: string | undefined): string {
  if (!t) return ''
  const d = new Date(t)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.round(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)} 小时前`
  return `${Math.round(diff / 86400_000)} 天前`
}

function formatFullTime(t: string | undefined): string {
  if (!t) return '—'
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function runStatusType(status: string | undefined): 'success' | 'danger' | 'warning' | 'info' {
  switch ((status || '').toLowerCase()) {
    case 'success': case 'ok': case 'done': return 'success'
    case 'error': case 'failed': case 'fail': return 'danger'
    case 'running': case 'in_progress': return 'warning'
    default: return 'info'
  }
}

function runStatusLabel(status: string | undefined): string {
  switch ((status || '').toLowerCase()) {
    case 'success': case 'ok': return '成功'
    case 'done': return '完成'
    case 'error': case 'failed': case 'fail': return '失败'
    case 'running': case 'in_progress': return '执行中'
    default: return status || '未知'
  }
}

async function loadJobs() {
  loading.value = true
  try {
    const res = await fetch('/api/cron/list')
    if (res.ok) {
      const data = await res.json()
      jobs.value = data.jobs || []
    } else {
      ElMessage.error('加载 Cron 任务失败')
    }
  } catch {
    ElMessage.error('网络错误，无法加载 Cron 任务')
  } finally {
    loading.value = false
  }
}

async function triggerJob(job: CronJob) {
  const id = job.id || job.name
  if (!id) return
  triggering.value = id
  try {
    const res = await fetch('/api/cron/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      ElMessage.success(`已触发：${job.name || id}`)
      setTimeout(loadJobs, 1500)
    } else {
      const err = await res.json().catch(() => ({}))
      ElMessage.error(err.error || '触发失败')
    }
  } catch {
    ElMessage.error('网络错误')
  } finally {
    triggering.value = null
  }
}

async function togglePause(job: CronJob) {
  const id = job.id || job.name
  if (!id) return
  const isPaused = !isEnabled(job)
  toggling.value = id
  try {
    const endpoint = isPaused ? '/api/cron/resume' : '/api/cron/pause'
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      ElMessage.success(isPaused ? '已恢复' : '已暂停')
      setTimeout(loadJobs, 1000)
    } else {
      ElMessage.error(isPaused ? '恢复失败' : '暂停失败')
    }
  } catch {
    ElMessage.error('网络错误')
  } finally {
    toggling.value = null
  }
}

function openCreateDialog() {
  const defaultAgentId = agentFilter.value || allAgentOptions.value[0]?.id || ''
  if (!defaultAgentId) {
    ElMessage.warning('当前没有可用的 Agent')
    return
  }
  createForm.value = {
    name: '',
    agentId: defaultAgentId,
    scheduleType: 'cron',
    scheduleValue: '0 9 * * *',
    message: '',
    deliveryMode: 'none',
  }
  createVisible.value = true
}

function startEdit(job: CronJob) {
  const key = jobKey(job)
  expandedJobKey.value = key
  editingJobKey.value = key
  editForm.value = {
    name: String(job.name || job.id || ''),
    agentId: String(job.agentId || job.agent || ''),
    scheduleType: getScheduleType(job),
    scheduleValue: getScheduleValue(job),
    message: getJobMessage(job),
    deliveryMode: hasDelivery(job) ? 'announce' : 'none',
  }
}

function cancelEdit() {
  editingJobKey.value = ''
}

async function saveEdit(job: CronJob) {
  const id = job.id || job.name
  if (!id) return
  const form = editForm.value
  if (!form.name.trim()) {
    ElMessage.warning('请先填写任务名称')
    return
  }
  if (!form.agentId) {
    ElMessage.warning('请先选择执行 Agent')
    return
  }
  if (!form.scheduleValue.trim()) {
    ElMessage.warning('请先填写执行时间')
    return
  }
  if (!form.message.trim()) {
    ElMessage.warning('请先填写任务要求')
    return
  }
  saving.value = jobKey(job)
  try {
    const res = await fetch('/api/cron/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name: form.name.trim(),
        agentId: form.agentId,
        scheduleType: form.scheduleType,
        scheduleValue: form.scheduleValue.trim(),
        message: form.message.trim(),
        deliveryMode: form.deliveryMode,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      ElMessage.success('定时任务已保存')
      editingJobKey.value = ''
      await loadJobs()
      expandedJobKey.value = String(id)
    } else {
      ElMessage.error(data.error || '保存失败')
    }
  } catch {
    ElMessage.error('网络错误')
  } finally {
    saving.value = null
  }
}

async function createJob() {
  const form = createForm.value
  if (!form.name.trim()) {
    ElMessage.warning('请先填写任务名称')
    return
  }
  if (!form.agentId) {
    ElMessage.warning('请先选择执行 Agent')
    return
  }
  if (!form.scheduleValue.trim()) {
    ElMessage.warning('请先填写执行时间')
    return
  }
  if (!form.message.trim()) {
    ElMessage.warning('请先填写任务要求')
    return
  }
  creating.value = true
  try {
    const res = await fetch('/api/cron/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        agentId: form.agentId,
        scheduleType: form.scheduleType,
        scheduleValue: form.scheduleValue.trim(),
        message: form.message.trim(),
        deliveryMode: form.deliveryMode,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      ElMessage.success('定时任务已创建')
      createVisible.value = false
      await loadJobs()
    } else {
      ElMessage.error(data.error || '创建失败')
    }
  } catch {
    ElMessage.error('网络错误')
  } finally {
    creating.value = false
  }
}

async function deleteJob(job: CronJob) {
  const id = job.id || job.name
  if (!id) return
  deleting.value = id
  try {
    const res = await fetch('/api/cron/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      ElMessage.success('定时任务已删除')
      if (expandedJobKey.value === id) expandedJobKey.value = ''
      await loadJobs()
    } else {
      ElMessage.error(data.error || '删除失败')
    }
  } catch {
    ElMessage.error('网络错误')
  } finally {
    deleting.value = null
  }
}

function openHistory(job: CronJob) {
  historyJob.value = job
  historyVisible.value = true
}

watch(visible, (val) => {
  if (val) loadJobs()
})
</script>

<style scoped>
.cron-center-dialog :deep(.el-dialog__body) {
  padding: 12px 16px;
}

/* 工具栏 */
.cc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
}
.cc-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cc-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.cc-agent-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.cc-agent-option-avatar,
.cc-agent-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(235, 235, 245, 0.24);
}

/* 任务列表 */
.cc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 560px;
  overflow-y: auto;
  min-height: 120px;
}
.cc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--text-muted);
  font-size: 13px;
}

/* 任务行 */
.cc-job-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 14px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition: all 0.2s;
}
.cc-job-row:hover {
  background: var(--fill-subtle);
  border-color: var(--text-muted);
}
.cc-job-row.cc-job-fail {
  border-left: 3px solid #ff453a;
  background: rgba(255, 69, 58,0.05);
}
.cc-job-row.cc-job-paused {
  opacity: 0.6;
  border-style: dashed;
}
.cc-job-line {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

/* 左：名称 + agent + cron */
.cc-job-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cc-job-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.cc-expand-icon {
  color: var(--text-muted);
  transition: transform 0.16s ease;
}
.cc-expand-icon.open {
  transform: rotate(180deg);
}
.cc-job-fail-dot, .cc-job-paused-dot, .cc-job-ok-dot {
  font-size: 10px;
  flex-shrink: 0;
}
.cc-job-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e5e5ea);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cc-job-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cc-agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px 3px 4px;
  border-radius: 999px;
  border: 1px solid rgba(142, 142, 147, 0.24);
  background: rgba(142, 142, 147, 0.10);
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
}
.cc-cron-expr {
  font-size: 11px;
  color: var(--text-secondary, #98989d);
}

/* 中：下次执行 + 最近状态 */
.cc-job-middle {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
  min-width: 120px;
}
.cc-next-run {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-secondary, #98989d);
}
.cc-last-status {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cc-last-time {
  font-size: 10px;
  color: var(--text-muted);
}
.cc-fail-count {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #ff453a;
  font-weight: 600;
}

/* 右：操作 */
.cc-job-actions {
  display: grid;
  grid-template-columns: minmax(88px, auto) repeat(4, 34px);
  gap: 8px;
  align-items: center;
  justify-content: end;
  min-width: 256px;
  flex-shrink: 0;
}
.cc-job-actions :deep(.el-button) {
  margin: 0;
}
.cc-edit-action-btn {
  width: 88px;
}
.cc-action-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  overflow: visible;
}
.cc-job-detail {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(240px, 0.75fr);
  gap: 10px;
  padding: 10px 0 2px 30px;
}
.cc-detail-card {
  border: 1px solid rgba(142, 142, 147, 0.20);
  border-radius: 8px;
  background: rgba(142, 142, 147, 0.08);
  padding: 10px 12px;
}
.cc-detail-title {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}
.cc-detail-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.cc-detail-title-row .cc-detail-title {
  margin-bottom: 0;
}
.cc-detail-message {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.65;
  max-height: 160px;
  overflow: auto;
}
.cc-detail-grid {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px 10px;
  align-items: center;
  font-size: 12px;
}
.cc-detail-grid span {
  color: var(--text-muted);
}
.cc-detail-grid strong {
  color: var(--text-primary);
  font-weight: 600;
  min-width: 0;
}
.cc-edit-card {
  grid-column: 1 / -1;
}
.cc-edit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cc-edit-form {
  display: grid;
  grid-template-columns: minmax(180px, 0.7fr) minmax(180px, 0.7fr) minmax(260px, 1.4fr);
  gap: 0 12px;
}
.cc-edit-schedule {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 12px;
}
.cc-edit-form :deep(.el-form-item:nth-last-child(2)) {
  grid-column: 1 / -1;
}
.cc-edit-form :deep(.el-form-item:last-child) {
  grid-column: 1 / -1;
}

/* 执行记录 */
.cc-history {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 400px;
  overflow-y: auto;
}
.cc-history-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-muted);
  font-size: 13px;
}
.cc-history-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}
.cc-history-row.run-fail {
  background: rgba(255, 69, 58,0.05);
  border-color: rgba(255, 69, 58,0.2);
}
.cc-history-time {
  font-size: 11px;
  color: var(--text-secondary, #98989d);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.cc-history-dur {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.cc-history-msg {
  font-size: 11px;
  color: #ff6961;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono { font-family: 'Cascadia Code', 'Fira Code', monospace; }
.cc-delivery {
  font-size: 11px;
  color: var(--accent);
  white-space: nowrap;
}
.cc-delivery.silent { color: var(--text-muted); }
.cc-agent-tag :deep(.el-icon) { vertical-align: -1px; }
.cc-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.cc-status-dot.is-ok { background: var(--success); }
.cc-status-dot.is-paused { background: var(--text-muted); }
.cc-status-dot.is-fail { background: var(--danger); }
.cc-create-form {
  display: grid;
  gap: 2px;
}
.cc-create-schedule {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 12px;
}

:global(html.light-theme .cron-center-dialog .cc-job-row) {
  background:
    linear-gradient(180deg, rgba(0, 122, 255, 0.026), rgba(255, 255, 255, 0.95)),
    #ffffff;
  border-color: rgba(0, 122, 255, 0.13);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
}

:global(html.light-theme .cron-center-dialog .cc-job-row:hover) {
  background:
    linear-gradient(180deg, rgba(0, 122, 255, 0.055), rgba(255, 255, 255, 0.98)),
    #ffffff;
  border-color: rgba(0, 122, 255, 0.22);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.075);
}

:global(html.light-theme .cron-center-dialog .cc-job-row.cc-job-fail) {
  background:
    linear-gradient(180deg, rgba(255, 69, 58, 0.055), rgba(255, 255, 255, 0.96)),
    #ffffff;
  border-color: rgba(255, 69, 58, 0.22);
}

:global(html.light-theme .cron-center-dialog .cc-agent-chip) {
  background: rgba(0, 122, 255, 0.055);
  border-color: rgba(0, 122, 255, 0.14);
}

:global(html.light-theme .cron-center-dialog .cc-job-detail) {
  border-top: 1px solid rgba(0, 122, 255, 0.1);
}

:global(html.light-theme .cron-center-dialog .cc-detail-card) {
  background:
    linear-gradient(180deg, rgba(0, 122, 255, 0.035), rgba(255, 255, 255, 0.98)),
    #ffffff;
  border-color: rgba(0, 122, 255, 0.13);
}

:global(html.light-theme .cron-center-dialog .cc-detail-message) {
  background: transparent;
}

:global(html.light-theme .cron-center-dialog .cc-history-row) {
  background: rgba(0, 122, 255, 0.035);
  border-color: rgba(0, 122, 255, 0.12);
}

:global(html.light-theme .cron-center-dialog .cc-history-row.run-fail) {
  background: rgba(255, 69, 58, 0.05);
  border-color: rgba(255, 69, 58, 0.18);
}
@media (max-width: 860px) {
  .cc-job-line,
  .cc-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .cc-job-middle,
  .cc-job-actions {
    align-items: flex-start;
  }
  .cc-job-detail,
  .cc-create-schedule,
  .cc-edit-form,
  .cc-edit-schedule {
    grid-template-columns: 1fr;
    padding-left: 0;
  }
}
</style>

<style>
.cc-floating-action-tip {
  position: fixed;
  z-index: 5000;
  max-width: 280px;
  padding: 8px 11px;
  border: 1px solid rgba(142, 142, 147, 0.28);
  border-radius: 9px;
  background: rgba(28, 28, 30, 0.96);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.34);
  color: rgba(255, 255, 255, 0.94);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  pointer-events: none;
  transform: translateY(-50%);
  animation: cc-tip-in 0.12s ease-out;
}
html.light-theme .cc-floating-action-tip {
  border-color: rgba(60, 60, 67, 0.14);
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 14px 34px rgba(31, 41, 55, 0.16);
  color: rgba(17, 24, 39, 0.92);
}
@keyframes cc-tip-in {
  from {
    opacity: 0;
    transform: translateY(calc(-50% + 4px));
  }
  to {
    opacity: 1;
    transform: translateY(-50%);
  }
}
</style>
