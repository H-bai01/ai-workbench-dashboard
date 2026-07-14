<template>
  <el-popover
    v-if="hasBubbles"
    :key="latestMessages?.length"
    placement="right"
    width="400px"
    :offset="12"
    trigger="manual"
    :visible="bubbleVisible"
    class="bubble-popover"
  >
    <div class="bubble-list" :style="{ maxHeight: '95vh', overflowY: 'auto' }">
      <div
        v-for="(msg, idx) in latestMessages"
        :key="idx"
        class="chat-row chat-row-assistant markdown-bubble-item"
      >
        <div class="chat-bubble" :class="getBubbleClass(msg)">
          <div class="bubble-label" v-if="msg.contentType === 'thinking'">思考</div>
          <div class="bubble-label" v-else-if="msg.contentType === 'toolUse'">工具调用</div>
          <div class="bubble-label" v-else-if="msg.contentType === 'toolResult' && msg.isError">工具错误</div>
          <div class="bubble-label" v-else-if="msg.contentType === 'toolResult'">工具结果</div>
          <div class="markdown-body" v-html="renderMessage(msg.content)"></div>
        </div>
      </div>
    </div>

    <template #reference>
      <el-card
        class="agent-card"
        shadow="hover"
        @click="openDrawer"
        @dblclick="openDrawerAndChat"
      >
        <!-- Header: Name + Status Badge -->
        <div class="card-header">
          <div class="agent-identity">
            <div class="agent-avatar" :class="statusColorClass">
              <!-- 优先显示图片头像，失败则降级到图标 -->
              <img
                v-if="avatarSrc"
                :src="avatarSrc"
                :alt="displayName"
                class="avatar-img"
                @error="onAvatarError"
              />
              <el-icon v-else :size="18"><component :is="avatarIcon" /></el-icon>
            </div>
            <span class="agent-name" :title="displayName">{{ displayName }}</span>
          </div>
          <el-tag
            :type="statusTagType"
            :effect="agent.status === 'running' ? 'dark' : 'light'"
            size="small"
            class="status-badge"
            :title="statusDescription"
          >
            <el-icon :size="12"><component :is="statusIcon" /></el-icon>
            {{ displayStatus }}
          </el-tag>
        </div>

        <!-- Body: Metadata + Token -->
        <div class="card-body">
          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">当前会话</span>
              <span class="meta-value key-value" :title="agent.label || agent.key">{{ truncateLabel }}</span>
            </div>

            <div class="meta-item">
              <span class="meta-label">持续时间</span>
              <span class="meta-value duration">{{ durationText }}</span>
            </div>

            <div class="meta-item" v-if="historicalTokens > 0">
              <span class="meta-label">历史 Token</span>
              <span class="meta-value hist-token">{{ formatHistoricalTokens(historicalTokens) }}</span>
            </div>

            <div class="meta-item" v-if="modelDisplayName">
              <span class="meta-label">模型</span>
              <span class="meta-value model-tag" :title="modelDisplayName">{{ shortModelName }}</span>
            </div>
          </div>

          <!-- Token Usage Progress Bar (all agents) -->
          <div class="token-section">
            <div class="token-header">
              <span class="meta-label">上下文用量</span>
              <span class="token-percent" :class="agent.tokenUsage ? percentageClass : 'text-muted'">
                {{ agent.tokenUsage ? tokenPercent + '%' : '—' }}
              </span>
            </div>
            <el-progress
              :percentage="agent.tokenUsage?.percentage ?? 0"
              :status="agent.tokenUsage ? tokenProgressStatus : undefined"
              :stroke-width="6"
              :show-text="false"
              :class="['token-progress', !agent.tokenUsage ? 'token-progress--empty' : '']"
            />
            <div class="token-detail">
              <span>{{ agent.tokenUsage ? formatTokenZh(agent.tokenUsage.current) : '—' }}</span>
              <span class="token-sep">/</span>
              <span>{{ agent.tokenUsage ? formatTokenZh(agent.tokenUsage.max) : '—' }}</span>
            </div>
          </div>

          <!-- ▼ 实时活动条 -->
          <el-popover
            v-if="agent.status === 'running'"
            placement="bottom"
            :width="360"
            trigger="hover"
            :show-after="200"
            :hide-after="100"
            popper-class="live-activity-popper"
          >
            <template #default>
              <div class="live-steps-popup">
                <div class="live-steps-title">
                  <span>近期活动</span>
                  <el-button
                    link size="small"
                    class="live-thinking-toggle"
                    @click="showAllThinking = !showAllThinking"
                  >
                    {{ showAllThinking ? '隐藏思考原文' : '查看完整思考（英文）' }}
                  </el-button>
                </div>
                <template v-if="liveSteps.length > 0">
                  <div
                    v-for="(step, i) in liveSteps"
                    :key="i"
                    class="live-step-row"
                    :class="`step-type-${step.type}`"
                  >
                    <span class="step-icon-sm" :class="`step-icon-${step.type}`" />
                    <div class="step-content">
                      <span class="step-type-badge">{{ stepTypeLabel(step.type) }}</span>
                      <span class="step-full-text">{{ showAllThinking && step.type === 'thinking' ? step.text : stepPopupText(step) }}</span>
                    </div>
                  </div>
                </template>
                <div v-else class="live-steps-empty">加载中…</div>
              </div>
            </template>
            <template #reference>
              <div class="live-activity-strip" @click.stop>
                <span class="live-pulse-dot" />
                <div class="live-activity-content">
                  <span class="live-step-type">{{ bestInlineStep ? stepTypeLabel(bestInlineStep.type) : '运行中' }}</span>
                  <span class="live-activity-text">{{ stepInlineText(bestInlineStep) }}</span>
                </div>
              </div>
            </template>
          </el-popover>
        </div>
      </el-card>
    </template>
  </el-popover>

   <!-- 没有气泡时直接渲染卡片 -->
  <el-card
    v-else
    class="agent-card"
    shadow="hover"
    @click="openDrawer"
    @dblclick="openDrawerAndChat"
  >
    <!-- Header: Name + Status Badge -->
    <div class="card-header">
      <div class="agent-identity">
        <div class="agent-avatar" :class="statusColorClass">
          <img
            v-if="avatarSrc"
            :src="avatarSrc"
            :alt="displayName"
            class="avatar-img"
            @error="onAvatarError"
          />
          <el-icon v-else :size="18"><component :is="avatarIcon" /></el-icon>
        </div>
        <span class="agent-name" :title="displayName">{{ displayName }}</span>
      </div>
      <el-tag
        :type="statusTagType"
        :effect="agent.status === 'running' ? 'dark' : 'light'"
        size="small"
        class="status-badge"
        :title="statusDescription"
      >
        <el-icon :size="12"><component :is="statusIcon" /></el-icon>
        {{ displayStatus }}
      </el-tag>
    </div>

    <!-- Body: Metadata + Token -->
    <div class="card-body">
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">当前会话</span>
          <span class="meta-value key-value" :title="agent.label || agent.key">{{ truncateLabel }}</span>
        </div>

        <div class="meta-item">
          <span class="meta-label">持续时间</span>
          <span class="meta-value duration">{{ durationText }}</span>
        </div>

        <!-- 历史 Token 用量 -->
        <div class="meta-item" v-if="historicalTokens > 0">
          <span class="meta-label">历史 Token</span>
          <span class="meta-value hist-token">{{ formatHistoricalTokens(historicalTokens) }}</span>
        </div>

        <!-- 使用模型 -->
        <div class="meta-item" v-if="modelDisplayName">
          <span class="meta-label">模型</span>
          <span class="meta-value model-tag" :title="modelDisplayName">{{ shortModelName }}</span>
        </div>
      </div>

      <!-- Token Usage Progress Bar (all agents) -->
      <div class="token-section">
        <div class="token-header">
          <span class="meta-label">上下文用量</span>
          <span class="token-percent" :class="agent.tokenUsage ? percentageClass : 'text-muted'">
            {{ agent.tokenUsage ? tokenPercent + '%' : '—' }}
          </span>
        </div>
        <el-progress
          :percentage="agent.tokenUsage?.percentage ?? 0"
          :status="agent.tokenUsage ? tokenProgressStatus : undefined"
          :stroke-width="6"
          :show-text="false"
          :class="['token-progress', !agent.tokenUsage ? 'token-progress--empty' : '']"
        />
        <div class="token-detail">
          <span>{{ agent.tokenUsage ? formatTokenZh(agent.tokenUsage.current) : '—' }}</span>
          <span class="token-sep">/</span>
          <span>{{ agent.tokenUsage ? formatTokenZh(agent.tokenUsage.max) : '—' }}</span>
        </div>
      </div>

      <!-- ▼ 实时活动条 -->
      <el-popover
        v-if="agent.status === 'running'"
        placement="bottom"
        :width="360"
        trigger="hover"
        :show-after="200"
        :hide-after="100"
        popper-class="live-activity-popper"
      >
        <template #default>
          <div class="live-steps-popup">
            <div class="live-steps-title">
              <span>近期活动</span>
              <el-button
                link size="small"
                class="live-thinking-toggle"
                @click="showAllThinking = !showAllThinking"
              >
                {{ showAllThinking ? '隐藏思考原文' : '查看完整思考（英文）' }}
              </el-button>
            </div>
            <template v-if="liveSteps.length > 0">
              <div
                v-for="(step, i) in liveSteps"
                :key="i"
                class="live-step-row"
                :class="`step-type-${step.type}`"
              >
                <span class="step-icon-sm" :class="`step-icon-${step.type}`" />
                <div class="step-content">
                  <span class="step-type-badge">{{ stepTypeLabel(step.type) }}</span>
                  <span class="step-full-text">{{ showAllThinking && step.type === 'thinking' ? step.text : stepPopupText(step) }}</span>
                </div>
              </div>
            </template>
            <div v-else class="live-steps-empty">加载中…</div>
          </div>
        </template>
        <template #reference>
          <div class="live-activity-strip" @click.stop>
            <span class="live-pulse-dot" />
            <div class="live-activity-content">
              <span class="live-step-type">{{ bestInlineStep ? stepTypeLabel(bestInlineStep.type) : '运行中' }}</span>
              <span class="live-activity-text">{{ stepInlineText(bestInlineStep) }}</span>
            </div>
          </div>
        </template>
      </el-popover>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'
import { renderSafeMarkdown } from '../utils/safe-content.mjs'
import type { AgentInfo } from '../stores/agent'
import { useAgentStore } from '../stores/agent'
import { formatTokenZh } from '../utils/tokenFormat'
import { setDefaultAvatar } from '../utils/avatarFallback'
import { normalizeAgentAvatarSource } from '../utils/agent-presentation.mjs'
import { ownValue } from '../utils/safe-record.mjs'
import {
  UserFilled,
  CircleCheckFilled,
  Clock,
  WarningFilled,
  CircleCloseFilled,
  Timer,
} from '@element-plus/icons-vue'

const props = defineProps<{
  agent: AgentInfo
  latestMessages?: BubbleMessage[]
}>()

interface BubbleMessage {
  content: string
  contentType?: string
  isError?: boolean
}

const emit = defineEmits<{
  (e: 'detail', agent: AgentInfo, opts?: { focusInput?: boolean }): void
}>()

const store = useAgentStore()

// ========== 头像 ==========
// 从 agent key 提取 agentId（如 agent:main:xxx → main）
const agentId = computed(() => {
  const parts = (props.agent.key || '').split(':')
  return (parts[0] === 'agent' && parts.length >= 2) ? parts[1] : parts[0]
})

const avatarSrc = computed(() => {
  return normalizeAgentAvatarSource(props.agent.avatar)
})

function onAvatarError(event: Event) {
  setDefaultAvatar(event)
}

// ========== 历史 Token ==========
const historicalTokens = computed(() => {
  return props.agent.historicalTokens || store.getAgentHistoricalTokens(agentId.value)
})

function formatHistoricalTokens(n: number): string {
  return formatTokenZh(n)
}

// ========== 模型简称 ==========
const MODEL_SHORT: Record<string, string> = {
  'deepseek-v4-flash': 'DeepSeek Flash',
  'deepseek-v4-pro': 'DeepSeek V4',
  'deepseek-v3': 'DeepSeek V3',
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
  'MiniMax-M2.7': 'MiniMax',
  'claude-fable-5': 'Claude Fable',
  'claude-opus-4-8': 'Claude Opus',
  'claude-sonnet-5': 'Claude Sonnet',
  'claude-haiku-4-5': 'Claude Haiku',
  'claude-sonnet-4-6': 'Claude Sonnet',
  'claude-sonnet-4-5': 'Claude Sonnet',
  'claude-opus-4': 'Claude Opus',
  'claude-opus-4-6': 'Claude Opus',
  'claude-opus-4-7': 'Claude Opus',
  'claude-opus-4-5': 'Claude Opus',
  'chat-latest': 'ChatGPT',
  'gpt-5.3-codex': 'Codex',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.4-nano': 'GPT-5.4 Nano',
  'gpt-5.4-pro': 'GPT-5.4 Pro',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.5-pro': 'GPT-5.5 Pro',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
}
function modelToDisplayName(model: unknown): string {
  if (typeof model === 'string') return model
  if (!model || typeof model !== 'object') return ''

  const data = model as Record<string, unknown>
  const primary = data.primary ?? data.model ?? data.id ?? data.name ?? data.label
  return typeof primary === 'string' ? primary : ''
}
const modelDisplayName = computed(() => modelToDisplayName(props.agent.model))
const shortModelName = computed(() => {
  const m = modelDisplayName.value
  return ownValue(MODEL_SHORT, m) || m.split('/').pop() || m
})

// 渲染消息 Markdown（兼容上游 renderMessage 函数式写法）
function renderMessage(text: string): string {
  if (!text) return ''
  return renderSafeMarkdown(text, source => marked.parse(source, { async: false }) as string)
}

// renderedMessage removed — template now calls renderMessage(msg.content) directly

function getBubbleClass(msg: BubbleMessage): string {
  const ct = msg.contentType ?? 'text'
  if (ct === 'thinking') return 'bubble-thinking'
  if (ct === 'toolUse') return 'bubble-tool'
  if (ct === 'toolResult') {
    return msg.isError ? 'bubble-tool-error' : 'bubble-tool'
  }
  return 'bubble-assistant'
}

// el-popover 可见性控制
// REC-080: 完全依赖 store 的 messageBubbles 状态（BUBBLE_DURATION = 20s）
const hasBubbles = computed(() => !!(props.latestMessages && props.latestMessages.length > 0))
const bubbleVisible = ref(hasBubbles.value)

watch(() => props.latestMessages, (newVal) => {
  bubbleVisible.value = !!(newVal && newVal.length > 0)
}, { immediate: true })

const statusTagType = computed(() => {
  switch (props.agent.status) {
    case 'running': return 'warning'
    case 'idle': return 'success'
    case 'error': return 'danger'
    case 'aborted': return 'info'
    default: return 'info'
  }
})

const statusColorClass = computed(() => {
  switch (props.agent.status) {
    case 'running': return 'status-running'
    case 'idle': return 'status-idle'
    case 'error': return 'status-error'
    case 'aborted': return 'status-aborted'
    default: return 'status-unknown'
  }
})

const statusIcon = computed(() => {
  switch (props.agent.status) {
    case 'running': return CircleCheckFilled
    case 'idle': return Clock
    case 'error': return WarningFilled
    case 'aborted': return CircleCloseFilled
    default: return Clock
  }
})

const displayStatus = computed(() => {
  const map: Record<string, string> = {
    running: '运行中',
    idle: '空闲',
    error: '错误',
    aborted: '已终止',
    unknown: '未知',
  }
  return map[props.agent.status] ?? props.agent.status
})

const statusDescription = computed(() => {
  const descriptions: Record<string, string> = {
    running: 'Agent 正在执行任务',
    idle: 'Agent 处于空闲状态',
    error: 'Agent 发生错误',
    aborted: 'Agent 已被终止',
    unknown: 'Agent 状态未知',
  }
  return descriptions[props.agent.status] || props.agent.status
})

const durationText = computed(() => {
  return store.formatDuration(props.agent.elapsedMs ?? 0)
})

const tokenPercent = computed(() => {
  return props.agent.tokenUsage?.percentage ?? 0
})

const tokenProgressStatus = computed(() => {
  const p = props.agent.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'exception'
  if (p >= 70) return 'warning'
  return 'success'
})

const percentageClass = computed(() => {
  const p = props.agent.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'text-danger'
  if (p >= 70) return 'text-warning'
  return 'text-success'
})

const truncateLabel = computed(() => {
  const label = props.agent.label || props.agent.key
  return label.length > 24 ? label.slice(0, 24) + '…' : label
})

const isCronSession = computed(() => {
  return props.agent.key.includes(':cron:')
})

function stripAgentEmoji(name: string): string {
  return name.replace(/^\p{Extended_Pictographic}(?:\uFE0F)?\s*/u, '').trim()
}

const displayName = computed(() => {
  return stripAgentEmoji(props.agent.displayName || props.agent.label || props.agent.name || agentId.value || 'Agent')
})

const avatarIcon = computed(() => {
  if (isCronSession.value) return Timer
  return UserFilled
})

// ========== 实时活动（running 时轮询 session jsonl） ==========
interface LiveStep {
  type: 'trigger' | 'thinking' | 'tool' | 'toolResult' | 'text'
  name?: string
  text: string
  timestamp: string | null
}

const liveSteps = ref<LiveStep[]>([])
const showAllThinking = ref(false)  // 是否展示完整 thinking 原文
const LIVE_ACTIVITY_INTERVAL = 2000
const BACKGROUND_LIVE_ACTIVITY_INTERVAL = 15000
let liveActivityTimer: ReturnType<typeof setTimeout> | null = null

async function fetchLiveActivity() {
  if (props.agent.status !== 'running') return
  try {
    const resp = await fetch(`/api/agent-live-activity?agent=${agentId.value}`)
    if (resp.ok) {
      const data = await resp.json()
      liveSteps.value = data.steps || []
    }
  } catch { /* 网络失败静默 */ }
}

function stopLiveActivityPoll() {
  if (liveActivityTimer) {
    clearTimeout(liveActivityTimer)
    liveActivityTimer = null
  }
}

function scheduleLiveActivityPoll() {
  stopLiveActivityPoll()
  if (props.agent.status !== 'running') return
  liveActivityTimer = setTimeout(async () => {
    await fetchLiveActivity()
    scheduleLiveActivityPoll()
  }, document.hidden ? BACKGROUND_LIVE_ACTIVITY_INTERVAL : LIVE_ACTIVITY_INTERVAL)
}

function handleLiveActivityVisibilityChange() {
  if (props.agent.status !== 'running') return
  if (!document.hidden) fetchLiveActivity()
  scheduleLiveActivityPoll()
}

watch(() => props.agent.status, (newStatus) => {
  if (newStatus === 'running') {
    fetchLiveActivity()
    scheduleLiveActivityPoll()
  } else {
    stopLiveActivityPoll()
  }
}, { immediate: true })

onMounted(() => {
  document.addEventListener('visibilitychange', handleLiveActivityVisibilityChange)
})

onUnmounted(() => {
  stopLiveActivityPoll()
  document.removeEventListener('visibilitychange', handleLiveActivityVisibilityChange)
})

const latestStep = computed(() => liveSteps.value[liveSteps.value.length - 1] ?? null)

// 内嵌条优先显示有意义的步骤（跳过英文 thinking）
const bestInlineStep = computed(() => {
  const steps = liveSteps.value
  // 优先找：text > toolResult > tool > trigger
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = steps[i].type
    if (t === 'text' || t === 'toolResult' || t === 'tool') return steps[i]
  }
  // 都是 thinking/trigger 就直接用最后一步
  return latestStep.value
})

function stepTypeLabel(type: string): string {
  const map: Record<string, string> = {
    thinking: '思考中', tool: '调用工具', toolResult: '工具结果', text: '回复', trigger: '触发任务',
  }
  return map[type] ?? type
}

// 内嵌条文本：不显示英文 thinking，提取有意义的中文内容
function stepInlineText(step: LiveStep | null): string {
  if (!step) return '正在运行…'
  if (step.type === 'thinking') return '思考中…'
  if (step.type === 'trigger') {
    // 提取 cron 消息主体，去掉 [cron:xxx name] 前缀
    const m = step.text.match(/\]\s*(.+)/)
    return (m ? m[1] : step.text).slice(0, 60)
  }
  if (step.type === 'tool') {
    return `${step.name ?? 'exec'}${step.text ? ': ' + step.text.slice(0, 50) : ''}`
  }
  if (step.type === 'toolResult') {
    // 取第一行有内容的输出
    const firstLine = step.text.split('\n').find(l => l.trim()) ?? ''
    return firstLine.slice(0, 60) || '执行完成'
  }
  // text 类型：如果是 NO_REPLY 就说"无需回复"
  const t = step.text.trim()
  if (t === 'NO_REPLY' || t === '\n\nNO_REPLY') return '无需回复'
  return t.slice(0, 60)
}

// 悬停气泡文本：thinking 不显示英文内容
function stepPopupText(step: LiveStep): string {
  if (step.type === 'thinking') return '（思考中，内容略）'
  return stepInlineText(step)
}

// =========================================================

function openDrawer(): void {
  emit('detail', props.agent)
}

function openDrawerAndChat(): void {
  emit('detail', props.agent, { focusInput: true })
}
</script>

<style scoped>
/* ==================== Bubble List ==================== */
.bubble-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.markdown-bubble-item {
  animation: bubbleSlideIn 0.3s ease-out;
}

/* ── Chat row layout ── */
.chat-row {
  display: flex;
}

.chat-row-assistant {
  justify-content: flex-start;
}

/* ── Chat bubble ── */
.chat-bubble {
  max-width: 100%;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

/* ── Bubble: assistant (default text) ── */
.bubble-assistant {
  background: #2c2c2e;
  color: #e5e5ea;
  border-bottom-left-radius: 4px;
}

/* ── Bubble: thinking ── */
.bubble-thinking {
  background: rgba(255, 159, 10, 0.08);
  color: #e5e5ea;
  border-bottom-left-radius: 4px;
  border-left: 3px solid #ffd60a;
  font-style: italic;
}

.bubble-thinking .markdown-body {
  opacity: 0.8;
}

/* ── Bubble: tool use / tool result ── */
.bubble-tool {
  background: rgba(10, 132, 255, 0.12);
  color: #e5e5ea;
  border-bottom-left-radius: 4px;
  border: 1px solid rgba(10, 132, 255, 0.25);
  border-left: 3px solid #0a84ff;
  font-size: 11.5px;
}

/* ── Bubble: tool error ── */
.bubble-tool-error {
  background: rgba(255, 69, 58, 0.08);
  color: #e5e5ea;
  border-bottom-left-radius: 4px;
  border-left: 3px solid #ff453a;
  font-size: 11.5px;
}

/* ── Bubble label (thinking/tool labels) ── */
.bubble-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  border-radius: 4px;
  opacity: 0.75;
  background: var(--fill-subtle);
}

.bubble-tool .bubble-label {
  background: rgba(10, 132, 255, 0.2);
  color: #6cb2ff;
  opacity: 0.9;
}

.bubble-tool-error .bubble-label {
  background: rgba(255, 69, 58, 0.2);
  color: #ef9a9a;
  opacity: 0.9;
}

.bubble-thinking .bubble-label {
  background: rgba(255, 159, 10, 0.15);
  color: #ffd667;
  opacity: 0.85;
}

/* ==================== Card ==================== */
.agent-card {
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  border-radius: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}

.agent-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px var(--accent-glow);
  border-color: var(--accent);
}

.agent-card :deep(.el-card__body) {
  padding: 14px;
}

/* ==================== Header ==================== */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.agent-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.agent-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.agent-name {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.status-badge {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  border-radius: 6px;
  padding: 0 8px;
}

/* ==================== Body ==================== */
.card-body {
  font-size: 13px;
}

.meta-grid {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.meta-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
}

.meta-label {
  color: var(--text-secondary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.meta-value {
  color: var(--text-primary);
  font-size: 12px;
  text-align: right;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.key-value {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
}

.duration {
  font-variant-numeric: tabular-nums;
}

/* ==================== Token ==================== */
.token-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

.token-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.token-percent {
  font-weight: 600;
  font-size: 13px;
}

.token-progress {
  margin-bottom: 2px;
}

.token-detail {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.token-sep {
  color: var(--text-secondary);
  opacity: 0.5;
}

/* ==================== Status Colors ==================== */
.status-running { background: rgba(255, 159, 10, 0.15); color: #ffd60a; }
.status-idle { background: rgba(48, 209, 88, 0.15); color: #30d158; }
.status-error { background: rgba(255, 69, 58, 0.15); color: #ff453a; }
.status-aborted { background: rgba(142, 142, 147, 0.15); color: #8e8e93; }
.status-unknown { background: rgba(152, 152, 157, 0.15); color: #98989d; }

.text-success { color: #30d158; font-weight: 600; }
.text-warning { color: #ffd60a; font-weight: 600; }
.text-danger { color: #ff453a; font-weight: 600; }
.text-info { color: #9e9e9e; font-weight: 600; }
.text-muted { color: var(--text-secondary); font-weight: 400; }
.token-progress--empty :deep(.el-progress-bar__inner) { background: var(--fill-subtle); }

/* ==================== 实时活动条 ==================== */
.live-activity-strip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(48, 209, 88, 0.12), rgba(10, 132, 255, 0.055));
  border: 1px solid rgba(48, 209, 88, 0.22);
  box-shadow: inset 0 1px 0 var(--glass-inner-highlight);
  backdrop-filter: blur(16px) saturate(1.25);
  cursor: default;
  overflow: hidden;
}

.live-pulse-dot {
  flex-shrink: 0;
  margin-top: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #30d158;
  animation: livePulse 1.4s ease-in-out infinite;
}

@keyframes livePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}

.live-activity-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.live-step-type {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #81c784;
  line-height: 1;
}

.live-activity-text {
  font-size: 11.5px;
  color: rgba(210, 240, 210, 0.88);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

/* ── 悬停气泡内容 ── */
.live-steps-popup {
  padding: 2px 0;
}
.live-steps-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color);
}
.live-thinking-toggle {
  font-size: 10px !important;
  color: #409cff !important;
  padding: 0 !important;
  height: auto !important;
  letter-spacing: 0;
}
.live-step-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border-color);
}
.live-step-row:last-child { border-bottom: none; }
.step-icon-sm {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  margin-top: 6px;
  border-radius: 999px;
  background: #8e8e93;
  box-shadow: 0 0 0 4px rgba(142, 142, 147, 0.11);
}
.step-icon-thinking { background: #ffd60a; box-shadow: 0 0 0 4px rgba(255, 214, 10, 0.12); }
.step-icon-tool { background: #0a84ff; box-shadow: 0 0 0 4px rgba(10, 132, 255, 0.12); }
.step-icon-toolResult { background: #30d158; box-shadow: 0 0 0 4px rgba(48, 209, 88, 0.12); }
.step-icon-text { background: #bf5af2; box-shadow: 0 0 0 4px rgba(191, 90, 242, 0.12); }
.step-icon-trigger { background: #ff9f0a; box-shadow: 0 0 0 4px rgba(255, 159, 10, 0.12); }
.step-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.step-type-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--text-muted);
  text-transform: uppercase;
}
.step-full-text {
  font-size: 12px;
  color: rgba(220,220,220,0.9);
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
}
.step-type-thinking .step-type-badge { color: #ffd667; }
.step-type-thinking .step-full-text  { color: rgba(255, 214, 102,0.7); font-style: italic; }
.step-type-tool .step-type-badge     { color: #6cb2ff; }
.step-type-tool .step-full-text      { color: #bbdefb; }
.step-type-toolResult .step-type-badge { color: #a5d6a7; }
.step-type-toolResult .step-full-text  { color: #c8e6c9; }
.step-type-text .step-type-badge     { color: #cf7ef5; }
.step-type-text .step-full-text      { color: #e5c0fa; }
.step-type-trigger .step-full-text   { color: rgba(200,200,200,0.55); font-size: 11px; }
.live-steps-empty {
  font-size: 12px;
  color: var(--text-muted);
  padding: 4px 0;
}

</style>

<!-- ════════════════════════════════════════════════
     非 scoped 样式：el-popover 使用 Teleport 渲染到 body 层，
     scoped 样式无法穿透，必须放在非 scoped 块中
     ════════════════════════════════════════════════ -->
<style>
/* ==================== 实时活动悬停弹窗 ==================== */
.el-popover.live-activity-popper {
  z-index: 5001 !important;
  background: linear-gradient(135deg, rgba(44, 44, 46, 0.82), rgba(24, 34, 28, 0.76)) !important;
  border: 1px solid rgba(235, 235, 245, 0.16) !important;
  border-radius: 14px !important;
  backdrop-filter: blur(24px) saturate(1.35) !important;
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
  padding: 12px 14px !important;
}

/* ==================== REC-071: 气泡弹出框 ==================== */
.el-popover.bubble-popover {
  z-index: 5000 !important;
  background: linear-gradient(135deg, rgba(28, 28, 30, 0.95), rgba(18, 18, 36, 0.98)) !important;
  border: 1px solid rgba(10, 132, 255, 0.35) !important;
  border-radius: 10px !important;
  box-shadow:
    0 4px 16px rgba(33, 150, 243, 0.2),
    0 2px 8px rgba(0, 0, 0, 0.4) !important;
  padding: 10px 14px !important;
  min-width: 0 !important;
  max-width: none !important;
}

/* ==================== REC-081: 气泡动画 ==================== */
@keyframes bubbleSlideIn {
  from {
    opacity: 0;
    transform: translateX(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes bubbleFadeOut {
  from {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateX(-10px) scale(0.95);
  }
}

.bubble-popover {
  animation: bubbleSlideIn 0.3s ease-out;
}

.markdown-bubble {
  animation: bubbleSlideIn 0.3s ease-out;
}

.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: cover;
}

.hist-token {
  font-variant-numeric: tabular-nums;
  color: #ff9f0a;
  font-weight: 500;
}

.model-tag {
  font-size: 11px;
  color: var(--text-secondary, #98989d);
  background: var(--fill-subtle);
  border-radius: 3px;
  padding: 1px 5px;
}
</style>
