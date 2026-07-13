<template>
  <!-- ── 弹窗模式（Dialog Mode）── -->
  <el-dialog
    v-if="!inline"
    v-model="visible"
    title=""
    width="92vw"
    style="max-width: 1200px"
    :close-on-click-modal="true"
    destroy-on-close
    class="timeline-dialog"
  >
    <template #header>
      <div class="tl-header">
        <div class="tl-title-row">
          <span class="tl-title">OpenClaw 活动时间线</span>
          <div class="tl-range-btns">
            <button v-for="opt in RANGE_OPTIONS" :key="opt.hours"
              class="tl-range-btn" :class="{ active: selectedHours === opt.hours }"
              @click="setRange(opt.hours)">{{ opt.label }}</button>
          </div>
        </div>
        <div class="tl-summary" v-if="!loading && sessions.length">
          {{ sessions.length }} 条 OpenClaw session · {{ agentLanes.length }} 个 Agent ·
          时间跨度 {{ formatDuration((timeEnd - timeStart) / 1000) }}
        </div>
      </div>
    </template>
    <div class="tl-body" v-loading="loading">
      <div v-if="!loading && sessions.length === 0" class="tl-empty">
        <div>过去 {{ selectedHours }} 小时内没有 OpenClaw Agent 活动记录</div>
        <div class="tl-empty-sub">尝试扩大时间窗口</div>
      </div>
      <div v-else class="tl-chart-wrap">
        <div class="tl-lane-labels">
          <div class="tl-lane-label tl-agent-header" :style="{ height: TIME_AXIS_H + 'px' }">Agent</div>
          <div v-for="lane in agentLanes" :key="lane.agentId"
            class="tl-lane-label" :style="{ height: LANE_H + 'px' }">
            <img class="tl-lane-avatar" :src="lane.avatar" :alt="lane.name" @error="setDefaultAvatar" />
            <span class="tl-lane-name">{{ lane.name }}</span>
          </div>
        </div>
        <div class="tl-svg-wrap" ref="svgWrap" @scroll="onScroll">
          <svg :width="svgWidth" :height="svgHeight" class="tl-svg">
            <rect width="100%" height="100%" fill="transparent" />
            <g class="tl-grid">
              <template v-for="tick in timeTicks" :key="tick.ts">
                <line :x1="tick.x" :y1="TIME_AXIS_H" :x2="tick.x" :y2="svgHeight"
                  stroke="var(--tl-grid-line)" stroke-width="1" />
                <text :x="tick.x + 4" :y="TIME_AXIS_H - 6"
                  fill="var(--tl-axis-text)" font-size="10">{{ tick.label }}</text>
              </template>
            </g>
            <g v-if="nowX > 0 && nowX < svgWidth">
              <line :x1="nowX" :y1="TIME_AXIS_H" :x2="nowX" :y2="svgHeight"
                stroke="#ff9f0a" stroke-width="1" stroke-dasharray="4,3" />
              <text :x="nowX + 4" :y="TIME_AXIS_H - 6" fill="#ff9f0a" font-size="10">现在</text>
            </g>
            <g>
              <template v-for="(lane, li) in agentLanes" :key="lane.agentId + '-bg'">
                <rect x="0" :y="TIME_AXIS_H + li * LANE_H" :width="svgWidth" :height="LANE_H"
                  :fill="li % 2 === 0 ? 'var(--tl-lane-alt)' : 'transparent'" />
              </template>
            </g>
            <g>
              <template v-for="bar in sessionBars" :key="bar.sessionId">
                <rect :x="bar.x" :y="bar.y + 6" :width="Math.max(bar.w, 4)" :height="LANE_H - 12" :rx="4"
                  :fill="bar.color" :opacity="hoveredSession === bar.sessionId ? 1 : 0.75"
                  class="tl-bar"
                  style="cursor: pointer"
                  @mouseenter="e => showTooltip(e, bar)" @mouseleave="hideTooltip"
                  @click="openSessionDetail(bar)" />
                <text v-if="bar.trigger === 'cron' && bar.w > 28"
                  :x="bar.x + 5" :y="bar.y + LANE_H - 18" font-size="9" fill="var(--tl-bar-label)">定时</text>
              </template>
            </g>
            <line x1="0" :y1="TIME_AXIS_H" :x2="svgWidth" :y2="TIME_AXIS_H"
              stroke="var(--tl-axis-line)" stroke-width="1" />
          </svg>
          <div v-if="tooltip.visible" class="tl-tooltip"
            :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
            <div class="tl-tt-agent">
              <img class="tl-tt-avatar" :src="tooltip.agentAvatar" :alt="tooltip.agentName" @error="setDefaultAvatar" />
              <span>{{ tooltip.agentName }}</span>
            </div>
            <div class="tl-tt-time">{{ tooltip.startTime }} → {{ tooltip.endTime }}</div>
            <div class="tl-tt-dur">时长 {{ tooltip.duration }}</div>
            <div class="tl-tt-trigger">触发：{{ tooltip.trigger === 'cron' ? '定时任务' : '用户消息' }}</div>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>

  <!-- ── 内联模式（Inline Mode）── -->
  <template v-else>
    <!-- 内联 header（范围选择 + 摘要 + 刷新）-->
    <div class="tl-inline-header">
      <div class="tl-inline-left">
        <span class="tl-summary" v-if="!loading && sessions.length">
          {{ sessions.length }} 条 OpenClaw session · {{ agentLanes.length }} 个 Agent ·
          {{ formatDuration((timeEnd - timeStart) / 1000) }}
        </span>
        <span v-else-if="loading" class="tl-summary">加载中…</span>
        <span v-else class="tl-summary">暂无活动</span>
      </div>
      <div class="tl-inline-right">
        <div class="tl-range-btns">
          <button v-for="opt in RANGE_OPTIONS" :key="opt.hours"
            class="tl-range-btn" :class="{ active: selectedHours === opt.hours }"
            @click="setRange(opt.hours)">{{ opt.label }}</button>
        </div>
        <button class="tl-refresh-btn" @click="fetchTimeline" title="刷新数据">
          <el-icon><Refresh /></el-icon>
        </button>
      </div>
    </div>

    <!-- 内联图表正文 -->
    <div class="tl-body tl-body-inline" v-loading="loading">
      <div v-if="!loading && sessions.length === 0" class="tl-empty">
        <div>过去 {{ selectedHours }} 小时内没有 OpenClaw Agent 活动</div>
        <div class="tl-empty-sub">尝试扩大时间范围</div>
      </div>
      <div v-else class="tl-chart-wrap">
        <div class="tl-lane-labels">
          <div class="tl-lane-label tl-agent-header" :style="{ height: TIME_AXIS_H + 'px' }">Agent</div>
          <div v-for="lane in agentLanes" :key="lane.agentId"
            class="tl-lane-label" :style="{ height: LANE_H + 'px' }">
            <img class="tl-lane-avatar" :src="lane.avatar" :alt="lane.name" @error="setDefaultAvatar" />
            <span class="tl-lane-name">{{ lane.name }}</span>
          </div>
        </div>
        <div class="tl-svg-wrap" ref="svgWrap" @scroll="onScroll">
          <svg :width="svgWidth" :height="svgHeight" class="tl-svg">
            <rect width="100%" height="100%" fill="transparent" />
            <g class="tl-grid">
              <template v-for="tick in timeTicks" :key="tick.ts">
                <line :x1="tick.x" :y1="TIME_AXIS_H" :x2="tick.x" :y2="svgHeight"
                  stroke="var(--tl-grid-line)" stroke-width="1" />
                <text :x="tick.x + 4" :y="TIME_AXIS_H - 6"
                  fill="var(--tl-axis-text)" font-size="10">{{ tick.label }}</text>
              </template>
            </g>
            <g v-if="nowX > 0 && nowX < svgWidth">
              <line :x1="nowX" :y1="TIME_AXIS_H" :x2="nowX" :y2="svgHeight"
                stroke="#ff9f0a" stroke-width="1" stroke-dasharray="4,3" />
              <text :x="nowX + 4" :y="TIME_AXIS_H - 6" fill="#ff9f0a" font-size="10">现在</text>
            </g>
            <g>
              <template v-for="(lane, li) in agentLanes" :key="lane.agentId + '-bg'">
                <rect x="0" :y="TIME_AXIS_H + li * LANE_H" :width="svgWidth" :height="LANE_H"
                  :fill="li % 2 === 0 ? 'var(--tl-lane-alt)' : 'transparent'" />
              </template>
            </g>
            <g>
              <template v-for="bar in sessionBars" :key="bar.sessionId">
                <rect :x="bar.x" :y="bar.y + 6" :width="Math.max(bar.w, 4)" :height="LANE_H - 12" :rx="4"
                  :fill="bar.color" :opacity="hoveredSession === bar.sessionId ? 1 : 0.75"
                  class="tl-bar"
                  style="cursor: pointer"
                  @mouseenter="e => showTooltip(e, bar)" @mouseleave="hideTooltip"
                  @click="openSessionDetail(bar)" />
                <text v-if="bar.trigger === 'cron' && bar.w > 28"
                  :x="bar.x + 5" :y="bar.y + LANE_H - 18" font-size="9" fill="var(--tl-bar-label)">定时</text>
              </template>
            </g>
            <line x1="0" :y1="TIME_AXIS_H" :x2="svgWidth" :y2="TIME_AXIS_H"
              stroke="var(--tl-axis-line)" stroke-width="1" />
          </svg>
          <div v-if="tooltip.visible" class="tl-tooltip"
            :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
            <div class="tl-tt-agent">
              <img class="tl-tt-avatar" :src="tooltip.agentAvatar" :alt="tooltip.agentName" @error="setDefaultAvatar" />
              <span>{{ tooltip.agentName }}</span>
            </div>
            <div class="tl-tt-time">{{ tooltip.startTime }} → {{ tooltip.endTime }}</div>
            <div class="tl-tt-dur">时长 {{ tooltip.duration }}</div>
            <div class="tl-tt-trigger">触发：{{ tooltip.trigger === 'cron' ? '定时任务' : '用户消息' }}</div>
          </div>
        </div>
      </div>
    </div>
  </template>

  <!-- ── 会话详情弹窗（点击时间线 bar 查看这次做了什么）── -->
  <el-dialog
    v-model="sessionDetailVisible"
    title="这次会话做了什么"
    width="820px"
    top="6vh"
    :append-to-body="true"
    destroy-on-close
    class="session-detail-dialog"
  >
    <div v-if="sessionDetailLoading" class="sd-loading">加载中…</div>
    <template v-else-if="sessionDetail">
      <div class="sd-meta">
        <span class="sd-agent-chip">
          <img class="sd-agent-avatar" :src="sessionDetailAgentAvatar" :alt="sessionDetailAgentName" @error="setDefaultAvatar" />
          <span class="sd-agent">{{ sessionDetailAgentName }}</span>
        </span>
        <span class="sd-model" v-if="sessionDetail.model">模型 {{ sessionDetail.model }}</span>
        <span class="sd-time" v-if="sessionDetail.startTime">{{ fmtStepTime(sessionDetail.startTime) }} 起</span>
        <span class="sd-count">{{ sessionDetail.stepCount }} 步</span>
      </div>
      <el-scrollbar height="72vh">
        <div class="sd-steps">
          <div v-if="sessionDetailSteps.length === 0" class="sd-empty">这次会话没有可展示的内容</div>
          <template v-else>
            <div class="sd-table-head">
              <span>Agent</span>
              <span>动作</span>
              <span>时间</span>
              <span>内容</span>
            </div>
            <div v-for="(s, i) in sessionDetailSteps" :key="i" class="sd-step" :class="'sd-' + s.kind">
              <div class="sd-step-agent">
                <img class="sd-step-avatar" :src="s.agentAvatar" :alt="s.agentName" @error="setDefaultAvatar" />
                <span>{{ s.agentName }}</span>
              </div>
              <div class="sd-step-type">
                <span class="sd-badge">{{ s.badge }}</span>
                <button v-if="s.hasOriginal" class="sd-original-toggle" @click="toggleStepOriginal(i)">
                  {{ isStepOriginalOpen(i) ? '收起原文' : '查看原文' }}
                </button>
              </div>
              <div class="sd-step-time">{{ s.time || '-' }}</div>
              <div class="sd-step-content">
                <pre class="sd-text" :class="{ 'sd-code': s.kind === 'tool', 'sd-result': s.kind === 'toolResult' }">{{ s.text }}</pre>
                <pre v-if="s.hasOriginal && isStepOriginalOpen(i)" class="sd-original">{{ s.originalText }}</pre>
              </div>
            </div>
          </template>
        </div>
      </el-scrollbar>
    </template>
    <div v-else class="sd-empty">加载失败</div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { DEFAULT_AVATAR_SRC, setDefaultAvatar } from '../utils/avatarFallback'
import { normalizeAgentAvatarSource, stableAgentColor } from '../utils/agent-presentation.mjs'
import { createSafeRecord, ownValue } from '../utils/safe-record.mjs'

const props = defineProps<{
  modelValue?: boolean
  /** 内联模式（Inline Mode）：不使用 el-dialog，直接嵌入页面 */
  inline?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [val: boolean] }>()

const visible = computed({
  get: () => props.modelValue ?? false,
  set: (v) => emit('update:modelValue', v),
})

// === Constants ===
const LANE_H = 48
const TIME_AXIS_H = 28
const PAD_R = 24
const MIN_BAR_W = 4
const MIN_SVG_W = 800

const RANGE_OPTIONS = [
  { label: '6小时',  hours: 6 },
  { label: '24小时', hours: 24 },
  { label: '7天',  hours: 168 },
  { label: '30天', hours: 720 },
]

function agentColor(id: string) {
  return stableAgentColor(id)
}

// === State ===
const selectedHours = ref(24)
const loading = ref(false)
const sessions = ref<any[]>([])
const svgWrap = ref<HTMLElement | null>(null)
const svgWrapWidth = ref(MIN_SVG_W)

const hoveredSession = ref<string | null>(null)

// === 会话详情（点击时间线 bar 查看做了什么）===
const sessionDetailVisible = ref(false)
const sessionDetailLoading = ref(false)
const sessionDetail = ref<any>(null)
const sessionDetailAgentName = ref('')
const sessionDetailAgentAvatar = ref('')
const openOriginalSteps = ref<Set<number>>(new Set())

type SessionDetailStepView = {
  kind: string
  badge: string
  time: string
  agentName: string
  agentAvatar: string
  text: string
  originalText: string
  hasOriginal: boolean
}

async function openSessionDetail(bar: any): Promise<void> {
  if (!bar?.agentId || !bar?.sessionId) return
  sessionDetailVisible.value = true
  sessionDetailLoading.value = true
  sessionDetail.value = null
  openOriginalSteps.value = new Set()
  sessionDetailAgentName.value = ownValue(agentMeta.value, bar.agentId)?.name || getConfiguredAgentName(bar.agentId)
  sessionDetailAgentAvatar.value = ownValue(agentMeta.value, bar.agentId)?.avatar || getAgentAvatarSrc(bar.agentId)
  try {
    const resp = await fetch(`/api/session-detail?agentId=${encodeURIComponent(bar.agentId)}&sessionId=${encodeURIComponent(bar.sessionId)}`)
    if (resp.ok) sessionDetail.value = await resp.json()
    else ElMessage.error('加载会话详情失败')
  } catch (_) {
    ElMessage.error('加载会话详情失败')
  } finally {
    sessionDetailLoading.value = false
  }
}

const TOOL_NAME_MAP: Record<string, string> = {
  exec: '执行命令',
  bash: 'Shell 脚本',
  process: '进程管理',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  apply_patch: '应用补丁',
  message: '发送消息',
  cron: '定时任务',
  session_status: '会话状态',
  sessions_list: '会话列表',
  memory_search: '记忆检索',
}

function toolNameZh(name?: string): string {
  if (!name) return '工具'
  return ownValue(TOOL_NAME_MAP, name) || name
}

function asText(value: any): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isTechnicalEnglishHeavy(text: string): boolean {
  const raw = String(text || '')
  const english = raw.match(/[A-Za-z]{4,}/g)?.length || 0
  const chinese = raw.match(/[\u4e00-\u9fff]/g)?.length || 0
  return english >= 6 && chinese < english * 2
}

function summarizeTechnicalText(text: string): string {
  const lower = String(text || '').toLowerCase()
  const topics: string[] = []
  if (/system|mention|feishu|lark|user_id/.test(lower)) topics.push('飞书提及和身份识别规则')
  if (/current time|reference utc|asia\/shanghai/.test(lower)) topics.push('时间上下文')
  if (/cron|checkin/.test(lower)) topics.push('定时任务触发')
  if (/send-task-summary|python/.test(lower)) topics.push('任务总结脚本')
  if (/bash|command|cwd/.test(lower)) topics.push('命令执行参数')
  if (/session|pid|process|poll/.test(lower)) topics.push('后台进程状态')
  if (/no_reply/.test(lower)) topics.push('无需回复标记')
  if (/error|failed|exception/.test(lower)) topics.push('错误信息')
  if (!topics.length) topics.push('系统或工具原始信息')
  return `${Array.from(new Set(topics)).join('、')}。原文已收起，需要核对时可点「查看原文」。`
}

function translateSystemText(text: string): string {
  const translated = text
    .replace(/\[System:\s*The content may include mention tags in the form name\. Treat these as real mentions of Feishu entities \(users or bots\)\.\]/g, '系统说明：消息里可能包含飞书提及标签，请按真实提及处理。')
    .replace(/\[System:\s*If user_id is ["'][^"']+["'], that mention refers to you\.\]/g, '系统说明：如果提到你的用户 ID，请理解为在 @ 你。')
    .replace(/\[System:\s*([^\]]+)\]/g, '系统说明：$1')
    .replace(/If you do not send directly, your final plain-text reply will be delivered automatically\./g, '如果不直接发送，最终文字回复会自动送达。')
    .replace(/Use the message tool if you need to notify the user directly for the current chat\./g, '如果需要直接通知当前对话的用户，请使用消息发送工具。')
    .replace(/Current time:\s*([^\n]+)/g, '当前时间：$1')
    .replace(/Reference UTC:\s*([^\n]+)/g, '参考 UTC 时间：$1')
    .replace(/\bNO_REPLY\b/g, '无需回复')
    .replace(/real mentions of Feishu entities \(users or bots\)/g, '真实的飞书成员或机器人提及')
    .replace(/the content may include mention tags in the form name/gi, '内容里可能包含名称形式的提及标签')
    .replace(/that mention refers to you/gi, '这个提及指向你')
  return isTechnicalEnglishHeavy(translated) ? summarizeTechnicalText(text) : translated
}

function translateUserText(raw: string): string {
  let text = translateSystemText(raw)
  text = text.replace(/\[cron:[^\s\]]+\s+([^\]]+)\]\s*/g, '定时任务「$1」触发：\n')
  text = text.replace(/执行\s+python3\s+~\/clawd\/scripts\/send-task-summary\.py\s+--mode\s+([A-Za-z])。?/g, '执行脚本：发送任务总结（模式 $1）。')
  text = text.replace(/只执行这一条命令，不做任何其他事情。?/g, '只运行这一项任务。')
  text = text.replace(/执行完成后回复\s+无需回复，不要把任何输出发到飞书。?/g, '完成后无需回复，不向飞书发送额外输出。')
  text = text.replace(/不要把任何输出发到飞书。?/g, '不向飞书发送额外输出。')
  return isTechnicalEnglishHeavy(text) ? summarizeTechnicalText(raw) : text.trim()
}

function translateToolCall(name: string | undefined, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return `调用${toolNameZh(name)}`
  const modeMatch = trimmed.match(/send-task-summary\.py\s+--mode\s+([A-Za-z])/)
  if (modeMatch) return `运行 Python 脚本：发送任务总结（模式 ${modeMatch[1]}）`
  const pythonMatch = trimmed.match(/python3\s+([^\s]+)(.*)$/)
  if (pythonMatch) return `运行 Python 脚本：${pythonMatch[1]}${pythonMatch[2] ? `，参数：${pythonMatch[2].trim()}` : ''}`

  try {
    const parsed = JSON.parse(trimmed)
    const action = parsed.action || '执行'
    if (action === 'poll') {
      const seconds = parsed.timeout ? Math.round(Number(parsed.timeout) / 1000) : null
      return `轮询后台进程：${parsed.sessionId || '未知会话'}${seconds ? `，最多等待 ${seconds} 秒` : ''}`
    }
    const actionMap: Record<string, string> = {
      list: '列出后台进程',
      log: '读取进程日志',
      write: '向进程写入内容',
      'send-keys': '向进程发送按键',
      submit: '提交进程输入',
      paste: '粘贴内容到进程',
      kill: '终止后台进程',
      clear: '清空进程输出',
      remove: '移除进程记录',
    }
    return `${actionMap[action] || `执行进程操作：${action}`}${parsed.sessionId ? `（${parsed.sessionId}）` : ''}`
  } catch {
    return `${toolNameZh(name)}：${isTechnicalEnglishHeavy(trimmed) ? summarizeTechnicalText(trimmed) : translateSystemText(trimmed)}`
  }
}

function translateToolResult(raw: string): string {
  const lines = translateSystemText(raw).split('\n').map(line => {
    let out = line
    out = out.replace(
      /Command still running \(session ([^,]+), pid ([^)]+)\)\. Use process \(list\/poll\/log\/write\/send-keys\/submit\/paste\/kill\/clear\/remove\) for follow-up\./,
      '命令仍在后台运行。会话：$1，进程号：$2。可以继续查看进度、读取日志或终止进程。'
    )
    out = out.replace(/^OK$/, '执行成功')
    out = out.replace(/^No output\.?$/i, '没有输出')
    out = out.replace(/Process exited with code 0\./g, '进程已正常结束（退出码 0）。')
    out = out.replace(/Process exited with code (\d+)\./g, '进程已结束（退出码 $1）。')
    out = out.replace(/Command exited with code (\d+)\./g, '命令已结束（退出码 $1）。')
    return out
  })
  const translated = lines.join('\n').trim()
  return isTechnicalEnglishHeavy(translated) ? summarizeTechnicalText(raw) : translated
}

function stepBadge(step: any): string {
  if (step.kind === 'user') return '用户消息'
  if (step.kind === 'assistant') return '回复'
  if (step.kind === 'thinking') return '思考过程'
  if (step.kind === 'tool') return `调用工具：${toolNameZh(step.name)}`
  if (step.kind === 'toolResult') return `${toolNameZh(step.name)}结果`
  return '说明'
}

function buildSessionDetailStep(step: any): SessionDetailStepView {
  const originalText = step.kind === 'tool'
    ? asText(step.brief || step.text)
    : asText(step.text || step.brief)
  let text = originalText
  if (step.kind === 'user') text = translateUserText(originalText)
  else if (step.kind === 'assistant' || step.kind === 'thinking') text = translateSystemText(originalText).trim()
  else if (step.kind === 'tool') text = translateToolCall(step.name, originalText)
  else if (step.kind === 'toolResult') text = translateToolResult(originalText)
  else text = translateSystemText(originalText).trim()

  return {
    kind: step.kind || 'note',
    badge: stepBadge(step),
    time: fmtStepTime(step.ts || null),
    agentName: sessionDetailAgentName.value || 'Agent',
    agentAvatar: sessionDetailAgentAvatar.value || getAgentAvatarSrc(sessionDetail.value?.agentId || ''),
    text: text || '暂无内容',
    originalText,
    hasOriginal: Boolean(originalText.trim()) && originalText.trim() !== text.trim(),
  }
}

const sessionDetailSteps = computed<SessionDetailStepView[]>(() => {
  return (sessionDetail.value?.steps || []).map((step: any) => buildSessionDetailStep(step))
})

function isStepOriginalOpen(index: number): boolean {
  return openOriginalSteps.value.has(index)
}

function toggleStepOriginal(index: number) {
  const next = new Set(openOriginalSteps.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  openOriginalSteps.value = next
}

function fmtStepTime(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const tooltip = ref({
  visible: false, x: 0, y: 0,
  agentName: '', agentAvatar: '', startTime: '', endTime: '', duration: '', trigger: '',
})

// Agent meta from config
const agentMeta = ref<Record<string, { name: string; avatar: string }>>(createSafeRecord())
function getConfiguredAgentName(id: string, fallbackName?: string): string {
  return fallbackName || id
}

function getAgentAvatarSrc(_id: string): string {
  return DEFAULT_AVATAR_SRC
}

async function loadAgentMeta() {
  try {
    const resp = await fetch('/api/agents-configured')
    if (resp.ok) {
      const data = await resp.json()
      for (const a of (data.agents || [])) {
        if (!a.id) continue
        agentMeta.value[a.id] = {
          name: getConfiguredAgentName(a.id, a.name || a.id),
          avatar: normalizeAgentAvatarSource(a.avatar),
        }
      }
    }
  } catch { /* ignore */ }
}

// === Data ===
async function fetchTimeline() {
  loading.value = true
  try {
    const resp = await fetch(`/api/activity-timeline?hours=${selectedHours.value}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    sessions.value = data.sessions || []
  } catch (e: any) {
    ElMessage.error('加载时间线失败: ' + e.message)
    sessions.value = []
  } finally {
    loading.value = false
    nextTick(updateSvgWidth)
  }
}

function setRange(h: number) {
  selectedHours.value = h
  fetchTimeline()
}

function updateSvgWidth() {
  svgWrapWidth.value = svgWrap.value?.clientWidth || MIN_SVG_W
}

// === Derived geometry ===
const timeStart = computed(() => {
  if (!sessions.value.length) return Date.now() - selectedHours.value * 3600000
  return Math.min(...sessions.value.map(s => s.startMs))
})

const timeEnd = computed(() => {
  const now = Date.now()
  if (!sessions.value.length) return now
  return Math.max(now, ...sessions.value.map(s => s.endMs))
})

const timeSpan = computed(() => Math.max(timeEnd.value - timeStart.value, 1))

const agentLanes = computed(() => {
  const agentIds = [...new Set(sessions.value.map(s => s.agentId))]
  agentIds.sort((a, b) => {
    const aFirst = sessions.value.find(s => s.agentId === a)?.startMs || 0
    const bFirst = sessions.value.find(s => s.agentId === b)?.startMs || 0
    return aFirst - bFirst
  })
  return agentIds.map(id => ({
    agentId: id,
    name: ownValue(agentMeta.value, id)?.name || getConfiguredAgentName(id),
    avatar: ownValue(agentMeta.value, id)?.avatar || getAgentAvatarSrc(id),
    color: agentColor(id),
  }))
})

const svgWidth = computed(() => Math.max(svgWrapWidth.value - 2, MIN_SVG_W))
const svgHeight = computed(() => TIME_AXIS_H + agentLanes.value.length * LANE_H + 4)

function tsToX(ms: number): number {
  return ((ms - timeStart.value) / timeSpan.value) * (svgWidth.value - PAD_R)
}

const sessionBars = computed(() => {
  return sessions.value.map(s => {
    const laneIdx = agentLanes.value.findIndex(l => l.agentId === s.agentId)
    const x = tsToX(s.startMs)
    const x2 = tsToX(s.endMs)
    const w = Math.max(x2 - x, MIN_BAR_W)
    const y = TIME_AXIS_H + laneIdx * LANE_H
    return { ...s, x, y, w, color: agentColor(s.agentId) }
  })
})

const timeTicks = computed(() => {
  const ticks: { ts: number; x: number; label: string }[] = []
  const spanMs = timeSpan.value
  let intervalMs: number
  if (spanMs <= 3 * 3600000)        intervalMs = 15 * 60000
  else if (spanMs <= 12 * 3600000)  intervalMs = 60 * 60000
  else if (spanMs <= 4 * 86400000)  intervalMs = 6 * 3600000
  else if (spanMs <= 14 * 86400000) intervalMs = 24 * 3600000
  else                               intervalMs = 7 * 86400000

  const first = Math.ceil(timeStart.value / intervalMs) * intervalMs
  for (let ts = first; ts <= timeEnd.value; ts += intervalMs) {
    const x = tsToX(ts)
    if (x < 0 || x > svgWidth.value) continue
    const d = new Date(ts)
    let label: string
    if (intervalMs < 3600000) label = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    else if (intervalMs < 86400000) label = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`
    else label = `${d.getMonth() + 1}/${d.getDate()}`
    ticks.push({ ts, x, label })
  }
  return ticks
})

const nowX = computed(() => tsToX(Date.now()))

// === Tooltip ===
function showTooltip(e: MouseEvent, bar: any) {
  hoveredSession.value = bar.sessionId
  const svgRect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect()
  if (!svgRect) return
  const x = e.clientX - (svgRect.left + (svgWrap.value?.scrollLeft || 0)) + 12
  const y = e.clientY - svgRect.top - 60
  tooltip.value = {
    visible: true,
    x: Math.min(x, svgWidth.value - 200),
    y: Math.max(y, 0),
    agentName: ownValue(agentMeta.value, bar.agentId)?.name || getConfiguredAgentName(bar.agentId),
    agentAvatar: ownValue(agentMeta.value, bar.agentId)?.avatar || getAgentAvatarSrc(bar.agentId),
    startTime: formatTime(bar.startMs),
    endTime: bar.endTs ? formatTime(bar.endMs) : '进行中',
    duration: formatDuration(bar.durationMs / 1000),
    trigger: bar.trigger || 'user',
  }
}

function hideTooltip() {
  hoveredSession.value = null
  tooltip.value.visible = false
}

function onScroll() {
  tooltip.value.visible = false
}

// === Formatters ===
function formatTime(ms: number) {
  const d = new Date(ms)
  if (selectedHours.value <= 24) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(secs: number) {
  if (secs < 60) return `${Math.round(secs)} 秒`
  if (secs < 3600) return `${Math.round(secs / 60)} 分钟`
  if (secs < 86400) return `${(secs / 3600).toFixed(1)} 小时`
  return `${(secs / 86400).toFixed(1)} 天`
}

// === Lifecycle ===
watch(() => props.modelValue, async (val) => {
  // 弹窗模式：打开时加载数据
  if (!props.inline && val) {
    await loadAgentMeta()
    await fetchTimeline()
  }
})

onMounted(async () => {
  window.addEventListener('resize', updateSvgWidth)
  // 内联模式（Inline Mode）：挂载时立即加载数据
  if (props.inline) {
    await loadAgentMeta()
    await fetchTimeline()
  }
})

// 暴露 fetchTimeline 供父组件展开时触发
defineExpose({ fetchTimeline })
</script>

<style scoped>
.timeline-dialog :deep(.el-dialog__header) { padding: 16px 20px 0; }
.timeline-dialog :deep(.el-dialog__body) { padding: 0; }

/* ─── 弹窗 header ───────────────────────────────────────────────────────────── */
.tl-header { display: flex; flex-direction: column; gap: 4px; }
.tl-title-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.tl-title { font-size: 16px; font-weight: 600; color: var(--text-primary); }
.tl-summary { font-size: 12px; color: var(--tl-muted); }

.tl-range-btns { display: flex; gap: 4px; }
.tl-range-btn {
  background: rgba(255, 255, 255, 0.06); border: 1px solid var(--glass-card-border);
  border-radius: 999px; color: var(--text-secondary); font-size: 12px;
  padding: 4px 11px; cursor: pointer; transition: all 0.16s ease; font-family: inherit;
  box-shadow: inset 0 1px 0 var(--glass-inner-highlight);
}
.tl-range-btn:hover { background: rgba(255, 255, 255, 0.11); color: var(--text-primary); }
.tl-range-btn.active {
  background: rgba(10, 132, 255, 0.22); border-color: rgba(10, 132, 255, 0.46); color: #8ecbff;
}

/* ─── 图表正文 ───────────────────────────────────────────────────────────────── */
.tl-body {
  --tl-grid-line: rgba(152, 152, 157, 0.12);
  --tl-axis-text: rgba(209, 209, 214, 0.64);
  --tl-axis-line: rgba(152, 152, 157, 0.16);
  --tl-lane-alt: rgba(152, 152, 157, 0.055);
  --tl-bar-label: rgba(255, 255, 255, 0.82);
  --tl-muted: rgba(209, 209, 214, 0.72);
  padding: 16px;
  min-height: 100px;
}
.tl-body-inline { padding: 0; }

.tl-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 40px 0; color: var(--tl-muted); font-size: 14px;
}
.tl-empty-icon { font-size: 36px; }
.tl-empty-sub { font-size: 12px; color: rgba(152, 152, 157, 0.8); }

.tl-chart-wrap {
  display: flex;
  gap: 10px;
  overflow: hidden;
  min-height: 220px;
}
.tl-lane-labels {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 152px;
  border: 1px solid var(--glass-card-border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.055);
  box-shadow: inset 0 1px 0 var(--glass-inner-highlight);
  backdrop-filter: blur(18px) saturate(1.35);
  overflow: hidden;
}
.tl-time-label-spacer { height: v-bind('TIME_AXIS_H + "px"'); flex-shrink: 0; }
.tl-agent-header {
  border-top: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--tl-muted);
  background: rgba(255, 255, 255, 0.035);
}
.tl-lane-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  flex-shrink: 0;
  overflow: hidden;
  border-top: 1px solid rgba(152, 152, 157, 0.12);
}
.tl-lane-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  background: var(--fill-subtle);
}
.tl-lane-name { font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tl-svg-wrap {
  flex: 1; overflow-x: auto; overflow-y: hidden; position: relative;
  border: 1px solid var(--glass-card-border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.042);
  box-shadow: inset 0 1px 0 var(--glass-inner-highlight);
  backdrop-filter: blur(18px) saturate(1.35);
}
.tl-svg { display: block; }
.tl-bar {
  cursor: pointer;
  transition: opacity 0.1s, filter 0.1s;
  filter: drop-shadow(0 4px 10px rgba(22, 22, 23, 0.22));
}
.tl-bar:hover { filter: drop-shadow(0 4px 14px rgba(10, 132, 255, 0.24)); }

.tl-tooltip {
  position: absolute;
  background: rgba(28, 28, 30, 0.82);
  border: 1px solid var(--glass-card-border); border-radius: 12px;
  padding: 10px 12px; min-width: 180px; pointer-events: none; z-index: 10;
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(20px) saturate(1.35);
}
.tl-tt-agent { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #f1f5f9; margin-bottom: 6px; }
.tl-tt-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-color);
}
.tl-tt-time  { font-size: 12px; color: #98989d; }
.tl-tt-dur   { font-size: 12px; color: #98989d; }
.tl-tt-trigger { font-size: 11px; color: #8e8e93; margin-top: 4px; }

/* ─── 内联模式（Inline Mode）header ────────────────────────────────────────── */
.tl-inline-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 0 12px; gap: 12px;
}
.tl-inline-left { display: flex; align-items: center; gap: 12px; }
.tl-inline-title { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.tl-inline-right { display: flex; align-items: center; gap: 8px; }
.tl-refresh-btn {
  background: rgba(255, 255, 255, 0.06); border: 1px solid var(--glass-card-border);
  border-radius: 999px; color: var(--text-muted); font-size: 14px;
  width: 30px; height: 30px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: all 0.16s ease;
  box-shadow: inset 0 1px 0 var(--glass-inner-highlight);
}
.tl-refresh-btn:hover { background: rgba(10, 132, 255, 0.16); color: #8ecbff; border-color: rgba(10, 132, 255, 0.36); }

:global(html.light-theme .tl-body) {
  --tl-grid-line: rgba(142, 142, 147, 0.16);
  --tl-axis-text: #8e8e93;
  --tl-axis-line: rgba(142, 142, 147, 0.2);
  --tl-lane-alt: rgba(14, 165, 233, 0.055);
  --tl-bar-label: rgba(22, 22, 23, 0.72);
  --tl-muted: #8e8e93;
}

:global(html.light-theme .tl-summary),
:global(html.light-theme .tl-lane-name) {
  color: #3a3a3c;
}

:global(html.light-theme .tl-range-btn),
:global(html.light-theme .tl-refresh-btn) {
  background: rgba(255, 255, 255, 0.62);
  border-color: rgba(60, 60, 67, 0.12);
  color: #6e6e73;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255,255,255,0.8);
  backdrop-filter: blur(18px) saturate(1.25);
}

:global(html.light-theme .tl-range-btn:hover),
:global(html.light-theme .tl-refresh-btn:hover) {
  background: #eaf3ff;
  color: #0066cc;
}

:global(html.light-theme .tl-range-btn.active) {
  background: #eaf3ff;
  border-color: #6cb2ff;
  color: #0066cc;
}

:global(html.light-theme .tl-svg-wrap) {
  background: rgba(255, 255, 255, 0.62);
  border-color: rgba(60, 60, 67, 0.13);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.82);
}

:global(html.light-theme .tl-lane-labels) {
  background: rgba(255, 255, 255, 0.58);
  border-color: rgba(60, 60, 67, 0.13);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255,255,255,0.82);
}

:global(html.light-theme .tl-lane-label) {
  border-top-color: #e4edf6;
}

:global(html.light-theme .tl-agent-header) {
  background: rgba(255, 255, 255, 0.48);
  color: #6e6e73;
}

:global(html.light-theme .tl-lane-avatar),
:global(html.light-theme .tl-tt-avatar) {
  border-color: #d1d1d6;
  background: #ffffff;
}

:global(html.light-theme .tl-empty) {
  color: #8e8e93;
}

:global(html.light-theme .tl-empty-sub) {
  color: #98989d;
}

/* ── 会话详情弹窗 ── */
.sd-loading, .sd-empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  padding: 40px 0;
  font-size: 14px;
}
.sd-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  padding: 0 2px 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-lighter);
  margin-bottom: 10px;
}
.sd-agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.sd-agent-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
}
.sd-agent { font-weight: 600; color: var(--el-text-color-primary); font-size: 14px; }
.sd-steps { display: flex; flex-direction: column; gap: 10px; padding-right: 6px; }
.sd-table-head,
.sd-step {
  display: grid;
  grid-template-columns: 132px 148px 82px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
.sd-table-head {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-card-border, var(--el-border-color-lighter));
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  backdrop-filter: blur(18px) saturate(1.25);
}
.sd-step {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.045);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.sd-step.sd-user { border-left: 3px solid #5e5ce6; }
.sd-step.sd-assistant { border-left: 3px solid #30d158; }
.sd-step.sd-tool { border-left: 3px solid #ff9f0a; }
.sd-step.sd-toolResult { border-left: 3px solid #0a84ff; }
.sd-step.sd-thinking { border-left: 3px solid #bf5af2; }
.sd-step-agent {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--el-text-color-primary);
  font-size: 13px;
  font-weight: 650;
}
.sd-step-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
  flex: 0 0 auto;
}
.sd-step-agent span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sd-step-type {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.sd-step-time {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
  white-space: nowrap;
}
.sd-step-content { min-width: 0; }
.sd-badge { font-size: 12px; font-weight: 700; color: var(--el-text-color-regular); }
.sd-text, .sd-code {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.55;
  color: var(--el-text-color-primary);
  font-family: inherit;
}
.sd-code {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  background: var(--el-fill-color-light);
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--el-text-color-regular);
}
.sd-result {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  max-height: 240px;
  overflow: auto;
  background: var(--el-fill-color-lighter);
  padding: 8px 10px;
  border-radius: 6px;
}
.sd-original-toggle {
  appearance: none;
  border: 1px solid var(--el-border-color);
  background: rgba(64, 158, 255, 0.08);
  color: var(--el-text-color-regular);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  transition: all 0.16s ease;
}
.sd-original-toggle:hover {
  border-color: #409eff;
  color: #409eff;
}
.sd-original {
  margin: 8px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border: 1px solid var(--el-border-color-lighter);
  padding: 8px 10px;
  border-radius: 6px;
}

:global(html.light-theme .sd-table-head),
:global(html.light-theme .sd-step) {
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(60, 60, 67, 0.12);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

@media (max-width: 760px) {
  .sd-table-head { display: none; }
  .sd-step {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .sd-step-type {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
