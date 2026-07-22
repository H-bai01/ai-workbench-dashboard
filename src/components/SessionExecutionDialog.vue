<template>
  <el-dialog
    v-model="visible"
    top="4vh"
    width="min(1240px, 95vw)"
    class="session-execution-dialog"
    :title="`${scope?.displayName || '会话'} · 执行记录`"
    :close-on-click-modal="true"
  >
    <div class="execution-intro">
      <div>
        <strong>统一只读会话时间线</strong>
        <span>只展示客户端真实记录，不会发送消息、恢复会话或启动任务</span>
      </div>
      <el-tag type="info" effect="plain">只读</el-tag>
    </div>

    <div v-if="errorMessage" class="execution-error">{{ errorMessage }}</div>

    <div class="execution-layout">
      <aside class="session-list" aria-label="项目会话列表">
        <div class="session-list-head">
          <strong>会话</strong>
          <span>{{ sessions.length }}</span>
        </div>
        <div v-if="sessionsLoading" class="execution-loading">正在读取会话索引...</div>
        <el-empty v-else-if="sessions.length === 0" description="该范围暂无可读取会话" :image-size="48" />
        <template v-else>
          <button
            v-for="session in sessions"
            :key="session.sessionId"
            type="button"
            class="session-row"
            :class="{ active: selectedSessionId === session.sessionId }"
            :disabled="sessionsLoading || eventsLoading"
            @click="selectSession(session.sessionId)"
          >
            <span class="session-row-title" :title="session.name">{{ session.name }}</span>
            <span class="session-row-meta">
              <span :class="['status-dot', `status-${session.status}`]" />
              <span>{{ session.label || '没干活' }}</span>
              <span>{{ formatTime(session.lastActivityMs) }}</span>
            </span>
            <span class="session-row-usage">
              <span>{{ formatTokenZh(session.usage?.tokens || 0) }}</span>
              <span>{{ sessionCostText(session) }}</span>
            </span>
          </button>
        </template>
      </aside>

      <section class="event-panel">
        <template v-if="selectedSession">
          <header class="event-panel-head">
            <div class="event-session-title">
              <strong :title="selectedSession.name">{{ selectedSession.name }}</strong>
              <span>{{ selectedSession.clientName }} · {{ selectedSession.model || '该客户端未提供模型' }}</span>
            </div>
            <div class="event-summary">
              <span>{{ formatTokenZh(selectedSession.usage?.tokens || 0) }} Token</span>
              <span>{{ sessionCostText(selectedSession) }}</span>
            </div>
          </header>

          <div class="event-filter" aria-label="执行记录筛选">
            <button
              v-for="option in FILTERS"
              :key="option.value"
              type="button"
              :class="{ active: filterMode === option.value }"
              :disabled="eventsLoading"
              @click="setFilter(option.value)"
            >{{ option.label }}</button>
          </div>

          <div class="event-scroll">
            <button
              v-if="hasMore"
              type="button"
              class="load-earlier"
              :disabled="eventsLoading"
              @click="loadEarlier"
            >{{ eventsLoading ? '正在加载...' : '加载更早记录' }}</button>

            <div v-if="eventsLoading && events.length === 0" class="execution-loading">正在读取执行记录...</div>
            <el-empty
              v-else-if="events.length === 0"
              :description="emptyEventText"
              :image-size="52"
            />

            <ol v-else class="event-timeline">
              <li v-for="event in events" :key="event.id" :class="['event-item', `event-${event.type}`]">
                <span class="event-rail-dot" />
                <div class="event-card">
                  <div class="event-card-head">
                    <strong>{{ event.label || eventTypeLabel(event.type) }}</strong>
                    <span v-if="event.model && event.model !== 'unknown'">{{ event.model }}</span>
                    <time>{{ formatTimestamp(event.timestamp) }}</time>
                  </div>

                  <p v-if="event.content" class="event-content">{{ event.content }}</p>
                  <div v-if="event.contentTruncated" class="truncated-note">内容过长，已显示安全截断摘要</div>

                  <div v-if="event.type === 'tool_call' || event.type === 'tool_result'" class="tool-summary">
                    <div class="tool-line">
                      <span class="tool-name">{{ event.toolName || '该客户端未提供工具名称' }}</span>
                      <span :class="['tool-state', `tool-state-${event.toolState || 'unknown'}`]">{{ toolStateText(event.toolState) }}</span>
                      <span v-if="event.toolCallId" class="tool-id">ID {{ shortId(event.toolCallId) }}</span>
                    </div>
                    <details v-if="event.argumentsSummary">
                      <summary>安全参数摘要</summary>
                      <pre>{{ event.argumentsSummary }}</pre>
                      <span v-if="event.argumentsTruncated" class="truncated-note">参数已截断</span>
                    </details>
                    <details v-if="event.resultSummary">
                      <summary>安全结果摘要</summary>
                      <pre>{{ event.resultSummary }}</pre>
                      <span v-if="event.resultTruncated" class="truncated-note">工具结果已截断</span>
                    </details>
                  </div>

                  <div v-if="event.usage" class="usage-line">
                    <span>{{ formatTokenZh(event.usage.tokens || 0) }} Token</span>
                    <span>{{ event.priceConfigured === false ? '价格未配置' : formatCny(event.usage.cost || 0) }}</span>
                  </div>

                  <div v-if="event.artifacts?.length" class="artifact-list">
                    <div v-for="artifact in event.artifacts" :key="artifact.id" class="artifact-row">
                      <div>
                        <strong>{{ artifact.name }}</strong>
                        <span>{{ artifact.relativePath }}</span>
                      </div>
                      <div class="artifact-meta">
                        <span>{{ artifact.type }}</span>
                        <span>{{ artifact.exists ? formatBytes(artifact.size) : '文件当前不存在' }}</span>
                        <span>预览暂不可用</span>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            </ol>
          </div>
        </template>
        <el-empty v-else description="请先选择一个会话" :image-size="58" />
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchObservedEvents, fetchObservedSessions } from '../api/session-observation'
import { formatTokenZh } from '../utils/tokenFormat'
import type {
  ObservedSession,
  ObservedSessionEvent,
  SessionEventType,
  SessionObservationScope,
} from '../types/session-observation'

const visible = defineModel<boolean>('visible', { default: false })
const props = defineProps<{ scope: SessionObservationScope | null }>()

type FilterMode = 'all' | 'thinking' | 'tools' | 'results' | 'errors'
const FILTERS: Array<{ value: FilterMode; label: string; types: SessionEventType[]; errorsOnly?: boolean }> = [
  { value: 'all', label: '全部', types: [] },
  { value: 'thinking', label: '只看思考', types: ['thinking'] },
  { value: 'tools', label: '只看工具', types: ['tool_call', 'tool_result'] },
  { value: 'results', label: '只看结果', types: ['tool_result', 'artifact'] },
  { value: 'errors', label: '只看错误', types: ['tool_result', 'lifecycle_error', 'lifecycle_aborted'], errorsOnly: true },
]

const sessions = ref<ObservedSession[]>([])
const selectedSessionId = ref('')
const events = ref<ObservedSessionEvent[]>([])
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const sessionsLoading = ref(false)
const eventsLoading = ref(false)
const errorMessage = ref('')
const filterMode = ref<FilterMode>('all')

const selectedSession = computed(() => sessions.value.find(session => session.sessionId === selectedSessionId.value) || null)
const selectedFilter = computed(() => FILTERS.find(option => option.value === filterMode.value) || FILTERS[0])
const selectedTypes = computed(() => selectedFilter.value.types)
const emptyEventText = computed(() => {
  if (filterMode.value === 'thinking') return '客户端未提供思考内容'
  if (filterMode.value === 'errors') return '该会话没有结构化错误或终止记录'
  return '该页没有可安全展示的执行记录'
})
const scopeKey = computed(() => JSON.stringify({
  source: props.scope?.source,
  agentId: props.scope?.agentId,
  sessionIds: props.scope?.sessionIds || [],
}))

async function loadSessions(): Promise<void> {
  if (!visible.value || !props.scope) return
  sessionsLoading.value = true
  errorMessage.value = ''
  sessions.value = []
  selectedSessionId.value = ''
  events.value = []
  try {
    const response = await fetchObservedSessions(props.scope)
    sessions.value = response.sessions || []
    if (sessions.value.length) await selectSession(sessions.value[0].sessionId)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '读取会话失败'
  } finally {
    sessionsLoading.value = false
  }
}

async function fetchEvents(appendEarlier = false): Promise<void> {
  if (!props.scope || !selectedSessionId.value || eventsLoading.value) return
  eventsLoading.value = true
  errorMessage.value = ''
  try {
    const response = await fetchObservedEvents({
      source: props.scope.source,
      sessionId: selectedSessionId.value,
      cursor: appendEarlier ? nextCursor.value : null,
      limit: 30,
      types: selectedTypes.value,
      errorsOnly: selectedFilter.value.errorsOnly === true,
    })
    const merged = appendEarlier ? [...response.events, ...events.value] : response.events
    const unique = new Map(merged.map(event => [event.id, event]))
    events.value = [...unique.values()].sort((a, b) => a.sequence - b.sequence)
    nextCursor.value = response.nextCursor
    hasMore.value = response.hasMore
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '读取执行记录失败'
  } finally {
    eventsLoading.value = false
  }
}

async function selectSession(sessionId: string): Promise<void> {
  selectedSessionId.value = sessionId
  events.value = []
  nextCursor.value = null
  hasMore.value = false
  await fetchEvents(false)
}

async function loadEarlier(): Promise<void> {
  if (!nextCursor.value) return
  await fetchEvents(true)
}

async function setFilter(value: FilterMode): Promise<void> {
  if (eventsLoading.value || filterMode.value === value) return
  filterMode.value = value
  events.value = []
  nextCursor.value = null
  hasMore.value = false
  if (selectedSessionId.value) await fetchEvents(false)
}

function formatTime(value: number): string {
  if (!value) return '无时间记录'
  const delta = Math.max(0, Date.now() - value)
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return new Date(value).toLocaleDateString('zh-CN')
}

function formatTimestamp(value: string): string {
  if (!value) return '该客户端未提供时间'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function formatCny(value: number): string {
  return `¥${Math.max(0, Number(value) || 0).toFixed(4)}`
}

function sessionCostText(session: ObservedSession): string {
  if (session.priceStatus === 'unconfigured') return '价格未配置'
  if (session.priceStatus === 'partial') return `部分价格未配置 · ${formatCny(session.usage?.cost || 0)}`
  return formatCny(session.usage?.cost || 0)
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value
}

function toolStateText(value: string): string {
  return ({
    completed: '已完成',
    matched: '已匹配调用',
    error: '执行错误',
    waiting: '等待结果 / 结果未记录',
    orphan: '未找到对应调用',
  } as Record<string, string>)[value] || '该客户端未提供状态'
}

function eventTypeLabel(value: SessionEventType): string {
  return ({
    user_message: '用户消息',
    assistant_message: 'AI 回复',
    thinking: '思考记录',
    tool_call: '工具调用',
    tool_result: '工具结果',
    lifecycle_start: '开始',
    lifecycle_complete: '完成',
    lifecycle_error: '失败',
    lifecycle_aborted: '终止',
    artifact: '产出',
    usage: 'Token 记录',
    unknown: '普通事件',
  })[value]
}

function formatBytes(value: number): string {
  const size = Math.max(0, Number(value) || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

watch([visible, scopeKey], ([isVisible]) => {
  if (isVisible) loadSessions()
  else {
    sessions.value = []
    events.value = []
    selectedSessionId.value = ''
    errorMessage.value = ''
    filterMode.value = 'all'
  }
})
</script>

<style scoped>
:global(.session-execution-dialog) {
  display: flex;
  flex-direction: column;
  height: min(840px, 92dvh);
  max-height: 92dvh;
  overflow: hidden;
}

:global(.session-execution-dialog .el-dialog__header) {
  flex: 0 0 auto;
}

:global(.session-execution-dialog .el-dialog__body) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.execution-intro,
.session-list-head,
.event-panel-head,
.tool-line,
.artifact-row,
.event-card-head,
.event-summary {
  display: flex;
  align-items: center;
}

.execution-intro {
  flex: 0 0 auto;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0 14px;
  border-bottom: 1px solid var(--el-border-color);
}

.execution-intro div { display: grid; gap: 3px; }
.execution-intro span { color: var(--el-text-color-secondary); font-size: 12px; }
.execution-error { flex: 0 0 auto; margin: 10px 0; padding: 9px 12px; color: var(--el-color-danger); background: var(--el-color-danger-light-9); border-radius: 4px; }

.execution-layout {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(240px, 290px) minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.session-list {
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px 12px 14px 0;
  border-right: 1px solid var(--el-border-color);
  scrollbar-gutter: stable;
}

.session-list-head { justify-content: space-between; padding: 0 8px 10px; }
.session-list-head span { color: var(--el-text-color-secondary); }
.session-row { width: 100%; min-height: 92px; padding: 11px; margin-bottom: 7px; text-align: left; color: inherit; background: transparent; border: 1px solid var(--el-border-color); border-radius: 6px; cursor: pointer; }
.session-row:hover { border-color: var(--el-color-primary-light-5); background: var(--el-fill-color-light); }
.session-row.active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.session-row:disabled { cursor: wait; opacity: 0.72; }
.session-row-title { display: block; overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.session-row-meta, .session-row-usage { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
.session-row-usage { justify-content: space-between; }
.status-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--el-text-color-placeholder); }
.status-running { background: var(--el-color-warning); }
.status-error { background: var(--el-color-danger); }
.status-aborted { background: var(--el-text-color-secondary); }
.status-idle { background: var(--el-color-success); }

.event-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 14px 0 0 16px; }
.event-panel-head { justify-content: space-between; gap: 16px; padding: 0 2px 12px; }
.event-session-title { min-width: 0; display: grid; gap: 3px; }
.event-session-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-session-title span, .event-summary { color: var(--el-text-color-secondary); font-size: 12px; }
.event-summary { gap: 12px; white-space: nowrap; }
.event-filter { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 0 12px; border-top: 1px solid var(--el-border-color-lighter); }
.event-filter button, .load-earlier { min-height: 30px; padding: 5px 11px; color: var(--el-text-color-regular); background: var(--el-fill-color-light); border: 1px solid var(--el-border-color); border-radius: 4px; cursor: pointer; }
.event-filter button.active { color: var(--el-color-primary); border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.event-filter button:disabled { cursor: wait; opacity: 0.65; }
.event-scroll { flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding-right: 6px; scrollbar-gutter: stable; }
.load-earlier { display: block; margin: 0 auto 12px; }
.execution-loading { padding: 24px; color: var(--el-text-color-secondary); text-align: center; }

.event-timeline { list-style: none; padding: 0 0 18px 20px; margin: 0; border-left: 1px solid var(--el-border-color); }
.event-item { position: relative; padding: 0 0 12px 14px; }
.event-rail-dot { position: absolute; top: 14px; left: -5px; width: 9px; height: 9px; border: 2px solid var(--el-bg-color); border-radius: 50%; background: var(--el-color-primary); }
.event-thinking .event-rail-dot { background: var(--el-color-warning); }
.event-tool_call .event-rail-dot, .event-tool_result .event-rail-dot { background: var(--el-color-success); }
.event-lifecycle_error .event-rail-dot, .event-lifecycle_aborted .event-rail-dot { background: var(--el-color-danger); }
.event-card { padding: 11px 13px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color-blank); }
.event-card-head { gap: 8px; }
.event-card-head strong { font-size: 13px; }
.event-card-head span, .event-card-head time { color: var(--el-text-color-secondary); font-size: 11px; }
.event-card-head time { margin-left: auto; }
.event-content { margin: 9px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
.truncated-note { margin-top: 7px; color: var(--el-color-warning); font-size: 11px; }
.tool-summary { margin-top: 9px; }
.tool-line { flex-wrap: wrap; gap: 8px; }
.tool-name { font-weight: 650; }
.tool-id { color: var(--el-text-color-placeholder); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.tool-state { padding: 2px 6px; border-radius: 3px; color: var(--el-text-color-secondary); background: var(--el-fill-color); font-size: 11px; }
.tool-state-error { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.tool-state-completed, .tool-state-matched { color: var(--el-color-success); background: var(--el-color-success-light-9); }
.tool-state-waiting, .tool-state-orphan { color: var(--el-color-warning); background: var(--el-color-warning-light-9); }
details { margin-top: 8px; }
summary { color: var(--el-color-primary); cursor: pointer; font-size: 12px; }
pre { max-height: 220px; overflow: auto; padding: 9px; margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--el-fill-color-light); border-radius: 4px; font-size: 12px; }
.usage-line { display: flex; gap: 12px; margin-top: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
.artifact-list { display: grid; gap: 7px; margin-top: 9px; }
.artifact-row { justify-content: space-between; gap: 14px; padding: 9px; border-left: 3px solid var(--el-color-primary); background: var(--el-fill-color-light); }
.artifact-row > div:first-child { min-width: 0; display: grid; gap: 3px; }
.artifact-row span { color: var(--el-text-color-secondary); font-size: 11px; overflow-wrap: anywhere; }
.artifact-meta { display: grid; flex: 0 0 auto; gap: 2px; text-align: right; }

@media (max-width: 760px) {
  :global(.session-execution-dialog) {
    height: 92dvh;
    max-height: 92dvh;
  }

  .execution-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(120px, 32%) minmax(0, 1fr);
  }

  .session-list { max-height: none; border-right: 0; border-bottom: 1px solid var(--el-border-color); padding-right: 0; }
  .event-panel { min-height: 0; padding-left: 0; }
  .event-panel-head { align-items: flex-start; flex-direction: column; }
}
</style>
