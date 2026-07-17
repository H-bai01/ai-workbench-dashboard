<template>
  <teleport to="body">
    <transition name="palette-fade">
      <div v-if="modelValue" class="palette-backdrop" @mousedown.self="close">
        <div class="palette-panel" @keydown="onKeydown">
          <!-- Search input -->
          <div class="palette-input-wrap">
            <el-icon class="palette-icon"><Search /></el-icon>
            <input
              ref="inputRef"
              v-model="query"
              class="palette-input"
              placeholder="搜索功能、Agent、本地 AI 项目、历史消息..."
              @input="onInput"
            />
            <span v-if="loading" class="palette-spinner" />
            <kbd class="palette-esc" @click="close">esc</kbd>
          </div>

          <!-- Results -->
          <div class="palette-results" ref="resultsRef">
            <!-- Empty state -->
            <div v-if="!query && allItems.length === 0" class="palette-empty">
              <div class="palette-hint-grid">
                <div v-for="act in ACTIONS" :key="act.key" class="palette-hint-item" @click="selectAction(act)">
                  <span class="palette-hint-icon"><component :is="act.icon" /></span>
                  <span class="palette-hint-label">{{ act.label }}</span>
                </div>
              </div>
              <div class="palette-hint-tip">快捷键 ↑↓ 导航 · Enter 确认 · Esc 关闭</div>
            </div>

            <!-- Query results -->
            <template v-if="query">
              <!-- Actions section -->
              <div v-if="matchedActions.length" class="palette-section">
                <div class="palette-section-title">功能</div>
                <div
                  v-for="(act, i) in matchedActions"
                  :key="act.key"
                  class="palette-item"
                  :class="{ active: flatIndex(0, i) === activeIdx }"
                  @click="selectAction(act)"
                  @mouseenter="activeIdx = flatIndex(0, i)"
                >
                  <span class="palette-item-icon"><component :is="act.icon" /></span>
                  <div class="palette-item-text">
                    <span class="palette-item-label">{{ act.label }}</span>
                    <span class="palette-item-desc">{{ act.desc }}</span>
                  </div>
                  <el-icon class="palette-item-arrow"><ArrowRight /></el-icon>
                </div>
              </div>

              <!-- Agents section -->
              <div v-if="agentResults.length" class="palette-section">
                <div class="palette-section-title">Agent</div>
                <div
                  v-for="(ag, i) in agentResults"
                  :key="ag.id"
                  class="palette-item"
                  :class="{ active: flatIndex(matchedActions.length, i) === activeIdx }"
                  @click="selectAgent(ag)"
                  @mouseenter="activeIdx = flatIndex(matchedActions.length, i)"
                >
                  <img class="palette-agent-avatar" :src="agentAvatar(ag.id)" :alt="agentDisplayName(ag.id)" @error="setDefaultAvatar" />
                  <div class="palette-item-text">
                    <span class="palette-item-label">{{ agentDisplayName(ag.id) }}</span>
                    <span class="palette-item-desc">{{ ag.model }}</span>
                  </div>
                  <el-icon class="palette-item-arrow"><ArrowRight /></el-icon>
                </div>
              </div>

              <!-- Local AI projects section -->
              <div v-if="localAiResults.length" class="palette-section">
                <div class="palette-section-title">本地 AI 项目</div>
                <div
                  v-for="(item, i) in localAiResults"
                  :key="item.sourceId"
                  class="palette-item"
                  :class="{ active: flatIndex(matchedActions.length + agentResults.length, i) === activeIdx }"
                  @click="selectLocalAiItem(item)"
                  @mouseenter="activeIdx = flatIndex(matchedActions.length + agentResults.length, i)"
                >
                  <img class="palette-agent-avatar palette-local-avatar" :src="item.avatarSrc" :alt="item.appName" @error="setDefaultAvatar" />
                  <div class="palette-item-text">
                    <span class="palette-item-label">{{ item.label }}</span>
                    <span class="palette-item-desc">{{ item.desc }}</span>
                  </div>
                  <el-icon class="palette-item-arrow"><ArrowRight /></el-icon>
                </div>
              </div>

              <!-- Messages section -->
              <div v-if="messageResults.length" class="palette-section">
                <div class="palette-section-title">历史消息</div>
                <div
                  v-for="(msg, i) in messageResults"
                  :key="`${msg.session_id}-${i}`"
                  class="palette-item palette-msg-item"
                  :class="{ active: flatIndex(matchedActions.length + agentResults.length + localAiResults.length, i) === activeIdx }"
                  @click="selectMessage(msg)"
                  @mouseenter="activeIdx = flatIndex(matchedActions.length + agentResults.length + localAiResults.length, i)"
                >
                  <img class="palette-agent-avatar" :src="agentAvatar(msg.agent_id)" :alt="agentDisplayName(msg.agent_id)" @error="setDefaultAvatar" />
                  <div class="palette-item-text">
                    <span class="palette-item-label">{{ agentDisplayName(msg.agent_id) }}</span>
                    <span class="palette-item-snippet" v-html="sanitizeHighlightHtml(msg.snippet)" />
                  </div>
                  <span class="palette-item-ts">{{ formatTs(msg.timestamp) }}</span>
                </div>
              </div>

              <!-- Docs section (#9: 文档文件搜索结果) -->
              <div v-if="docResults.length" class="palette-section">
                <div class="palette-section-title">文档文件</div>
                <div
                  v-for="(doc, i) in docResults"
                  :key="doc.path"
                  class="palette-item palette-msg-item"
                  :class="{ active: flatIndex(matchedActions.length + agentResults.length + localAiResults.length + messageResults.length, i) === activeIdx }"
                  @click="selectDoc(doc)"
                  @mouseenter="activeIdx = flatIndex(matchedActions.length + agentResults.length + localAiResults.length + messageResults.length, i)"
                >
                  <span class="palette-item-icon palette-doc-icon"><Document /></span>
                  <div class="palette-item-text">
                    <span class="palette-item-label">{{ doc.title }}</span>
                    <span class="palette-item-snippet" v-html="sanitizeHighlightHtml(doc.snippet)" />
                  </div>
                  <span class="palette-item-ts">{{ docShortPath(doc.path) }}</span>
                </div>
              </div>

              <!-- No results -->
              <div v-if="!loading && query && allItems.length === 0" class="palette-no-result">
                <el-icon><Search /></el-icon>
                <span>没有找到 "{{ query }}"</span>
                <div class="palette-no-result-hint">建议先构建搜索索引 →
                  <span class="palette-link" @click="buildIndex">立即建索引</span>
                </div>
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="palette-footer">
            <span v-if="footerStatusText">{{ footerStatusText }}</span>
            <span v-else class="palette-footer-warn">
              索引为空
              <span class="palette-link" @click="buildIndex">{{ indexing ? '建索引中...' : '点击建索引' }}</span>
            </span>
            <span class="palette-footer-right">{{ indexStatus.lastIndexedAt ? '更新于 ' + formatTs(indexStatus.lastIndexedAt) : '' }}</span>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import {
  Search,
  ArrowRight,
  Grid,
  Timer,
  DataLine,
  Folder,
  Money,
  SuitcaseLine,
  Odometer,
  Document,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { formatTokenZh } from '../utils/tokenFormat'
import { localUsageSourceAvatarSrc, localUsageSourceId } from '../utils/usageTimeline'
import { DEFAULT_AVATAR_SRC, setDefaultAvatar } from '../utils/avatarFallback'
import { normalizeAgentAvatarSource } from '../utils/agent-presentation.mjs'
import { sanitizeHighlightHtml } from '../utils/safe-content.mjs'
import { createSafeRecord, ownValue } from '../utils/safe-record.mjs'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [val: boolean]
  'open-action': [key: string]
  'navigate-agent': [agentId: string]
  'open-token-source': [sourceId: string]
}>()

const ACTIONS = [
  { key: 'projects',    icon: Grid,        label: 'OpenClaw 项目看板', desc: '5列 Kanban 跟踪 OpenClaw 项目进度' },
  { key: 'cron',        icon: Timer,       label: '定时任务',    desc: 'Cron 任务中心' },
  { key: 'timeline',   icon: DataLine,    label: 'OpenClaw 活动时间线', desc: '查看 Agent session Gantt 图' },
  { key: 'fileManager',icon: Folder,      label: '文件管理',    desc: '管理 AI 工作目录和我的目录' },
  { key: 'billing',    icon: Money,       label: '计费配置',    desc: '设置 OpenClaw / Codex / Claude Code 模型计费率' },
  { key: 'skills',     icon: SuitcaseLine,label: 'OpenClaw 技能库', desc: '查看所有 Agent 技能' },
  { key: 'gpu',        icon: Odometer,    label: 'GPU 显存',    desc: '查看 GPU 显存占用' },
  { key: 'token',      icon: DataLine,    label: 'Token / 费用概览', desc: '查看本机 AI Token 消耗与费用' },
]

interface LocalAiSearchItem {
  sourceId: string
  appId: string
  appName: string
  label: string
  desc: string
  avatarSrc: string
  searchText: string
}

const query = ref('')
const activeIdx = ref(0)
const loading = ref(false)
const indexing = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const resultsRef = ref<HTMLElement | null>(null)

const agentResults = ref<any[]>([])
const localAiItems = ref<LocalAiSearchItem[]>([])
const messageResults = ref<any[]>([])
const docResults = ref<any[]>([])

const indexStatus = ref({ totalMessages: 0, totalFiles: 0, lastIndexedAt: null as string | null })

const matchedActions = computed(() => {
  if (!query.value) return []
  const q = query.value.toLowerCase()
  return ACTIONS.filter(a => a.label.includes(q) || a.desc.includes(q) || a.key.includes(q))
})

const localAiResults = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return localAiItems.value
    .filter(item => item.searchText.includes(q))
    .slice(0, 8)
})

const footerStatusText = computed(() => {
  const parts: string[] = []
  if (indexStatus.value.totalMessages > 0) {
    parts.push(`已索引 ${indexStatus.value.totalMessages.toLocaleString()} 条消息`)
  }
  if (localAiItems.value.length > 0) {
    parts.push(`本地 AI ${localAiItems.value.length} 项`)
  }
  return parts.join(' · ')
})

const allItems = computed(() => [
  ...matchedActions.value,
  ...agentResults.value,
  ...localAiResults.value,
  ...messageResults.value,
  ...docResults.value,
])

function flatIndex(sectionOffset: number, i: number) {
  return sectionOffset + i
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function onInput() {
  activeIdx.value = 0
  agentResults.value = []
  messageResults.value = []
  docResults.value = []
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!query.value.trim()) return
  debounceTimer = setTimeout(doSearch, 300)
}

async function doSearch() {
  if (!query.value.trim()) return
  loading.value = true
  try {
    const resp = await fetch(`/api/search?q=${encodeURIComponent(query.value)}&limit=10`)
    if (resp.ok) {
      const data = await resp.json()
      agentResults.value = data.results?.agents || []
      messageResults.value = data.results?.messages || []
      docResults.value = data.results?.docs || []
    }
  } catch { /* network error */ } finally {
    loading.value = false
  }
}

async function fetchIndexStatus() {
  try {
    const resp = await fetch('/api/search/status')
    if (resp.ok) indexStatus.value = await resp.json()
  } catch { /* ignore */ }
}

async function buildIndex() {
  if (indexing.value) return
  indexing.value = true
  try {
    const resp = await fetch('/api/search/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (resp.ok) {
      const data = await resp.json()
      ElMessage.success(`索引完成：${data.totalInDb?.toLocaleString()} 条消息`)
      await fetchIndexStatus()
      if (query.value) doSearch()
    }
  } catch { ElMessage.error('索引失败') } finally {
    indexing.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  const total = allItems.value.length
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx.value = (activeIdx.value + 1) % Math.max(total, 1); scrollActive() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx.value = (activeIdx.value - 1 + Math.max(total, 1)) % Math.max(total, 1); scrollActive() }
  else if (e.key === 'Enter') { e.preventDefault(); activateItem() }
  else if (e.key === 'Escape') { close() }
}

function scrollActive() {
  nextTick(() => {
    const el = resultsRef.value?.querySelector('.palette-item.active')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function activateItem() {
  const ai = activeIdx.value
  const aLen = matchedActions.value.length
  const agLen = agentResults.value.length
  const localLen = localAiResults.value.length
  const msgLen = messageResults.value.length
  if (ai < aLen) selectAction(matchedActions.value[ai])
  else if (ai < aLen + agLen) selectAgent(agentResults.value[ai - aLen])
  else if (ai < aLen + agLen + localLen) selectLocalAiItem(localAiResults.value[ai - aLen - agLen])
  else if (ai < aLen + agLen + localLen + msgLen) selectMessage(messageResults.value[ai - aLen - agLen - localLen])
  else selectDoc(docResults.value[ai - aLen - agLen - localLen - msgLen])
}

function selectDoc(doc: any) {
  close()
  // 用文件管理器打开（如果实现了），否则复制路径
  const home = doc.path?.replace(/^\/Users\/[^/]+/, '~') || doc.path
  window.navigator.clipboard?.writeText(doc.path).catch(() => {})
  ElMessage.success({ message: `路径已复制：${home}`, duration: 2500 })
}

function docShortPath(p: string) {
  return (p || '').replace(/^\/Users\/[^/]+/, '~')
}

function selectAction(act: typeof ACTIONS[0]) {
  close()
  emit('open-action', act.key)
}

function selectAgent(ag: any) {
  close()
  emit('navigate-agent', ag.id)
}

function selectLocalAiItem(item: LocalAiSearchItem) {
  close()
  emit('open-token-source', item.sourceId)
}

function selectMessage(msg: any) {
  close()
  emit('navigate-agent', msg.agent_id)
}

function close() {
  emit('update:modelValue', false)
}

// Agent name/avatar from config (cached after first load)
const agentMeta = ref<Record<string, { name: string; avatar: string }>>(createSafeRecord())
function getConfiguredAgentName(id: string, fallbackName?: string): string {
  return fallbackName || id
}

function agentAvatar(id: string) {
  return ownValue(agentMeta.value, id)?.avatar || DEFAULT_AVATAR_SRC
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

async function loadLocalAiItems() {
  try {
    const resp = await fetch('/api/local-ai-usage?days=all')
    if (!resp.ok) return
    const data = await resp.json()
    const next: LocalAiSearchItem[] = []
    for (const app of (data.apps || [])) {
      const appId = String(app.id || '')
      if (!appId) continue
      const appName = String(app.name || appId)
      for (const item of (app.items || [])) {
        const itemId = String(item.id || item.path || item.name || '')
        if (!itemId) continue
        if (item.path && item.exists === false) continue
        const sourceId = localUsageSourceId(appId, itemId)
        const label = String(item.name || item.path || itemId)
        const model = String(item.model || item.primaryModel || '')
        const tokens = Number(item.usage?.tokens) || 0
        const descParts = [appName]
        if (model) descParts.push(model)
        if (tokens > 0) descParts.push(formatTokenZh(tokens))
        const desc = descParts.join(' · ')
        next.push({
          sourceId,
          appId,
          appName,
          label,
          desc,
          avatarSrc: localUsageSourceAvatarSrc(sourceId) || '/app-logos/chatgpt-white-black.svg',
          searchText: `${appName} ${appId} ${label} ${itemId} ${model}`.toLowerCase(),
        })
      }
    }
    localAiItems.value = next
  } catch {
    localAiItems.value = []
  }
}

function agentDisplayName(id: string) {
  return ownValue(agentMeta.value, id)?.name || getConfiguredAgentName(id)
}

function formatTs(ts: string | null) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    return `${d.getMonth() + 1}/${d.getDate()}`
  } catch { return '' }
}

watch(() => props.modelValue, async (val) => {
  if (val) {
    query.value = ''
    agentResults.value = []
    messageResults.value = []
    activeIdx.value = 0
    await fetchIndexStatus()
    await loadAgentMeta()
    await loadLocalAiItems()
    nextTick(() => inputRef.value?.focus())
  }
})

onMounted(loadAgentMeta)
</script>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.46);
  backdrop-filter: blur(12px) saturate(1.2);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}

.palette-panel {
  width: 640px;
  max-width: 92vw;
  background:
    radial-gradient(circle at 18% 0%, rgba(10, 132, 255, 0.11), transparent 34%),
    var(--glass-card-bg);
  border: 1px solid var(--glass-card-border);
  border-radius: 20px;
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(28px) saturate(1.35);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}

.palette-input-wrap {
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--glass-card-border);
  gap: 10px;
  flex-shrink: 0;
}

.palette-icon {
  color: var(--text-muted);
  font-size: 18px;
  flex-shrink: 0;
}

.palette-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 16px;
  padding: 16px 0;
  font-family: inherit;
}

.palette-input::placeholder {
  color: var(--text-muted);
}

.palette-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color);
  border-top-color: #5e5ce6;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.palette-esc {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-card-border);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
  flex-shrink: 0;
}

.palette-results {
  overflow-y: auto;
  flex: 1;
}

.palette-section {
  padding: 8px 0 4px;
}

.palette-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 4px 16px;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.14s ease, transform 0.14s ease;
  border-radius: 12px;
  margin: 0 8px;
}

.palette-item:hover,
.palette-item.active {
  background: rgba(10, 132, 255, 0.14);
}

.palette-item-icon {
  font-size: 17px;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #8ecbff;
  background: rgba(10, 132, 255, 0.12);
  border: 1px solid rgba(10, 132, 255, 0.20);
  flex-shrink: 0;
}
.palette-doc-icon { color: #30d158; background: rgba(48, 209, 88, 0.12); border-color: rgba(48, 209, 88, 0.20); }

.palette-agent-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  background: var(--fill-subtle);
}

.palette-local-avatar {
  border-radius: 8px;
}

.palette-item-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.palette-item-label {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
}

.palette-item-desc {
  color: var(--text-muted);
  font-size: 12px;
}

.palette-item-snippet {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item-snippet :deep(mark) {
  background: transparent;
  color: #ff9f0a;
  font-weight: 600;
}

.palette-item-arrow {
  color: var(--text-muted);
  font-size: 14px;
  flex-shrink: 0;
}

.palette-item-ts {
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

.palette-msg-item .palette-item-icon {
  font-size: 15px;
}

.palette-empty {
  padding: 20px 16px 16px;
}

.palette-hint-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}

.palette-hint-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid var(--glass-card-border);
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.15s;
}

.palette-hint-item:hover {
  background: rgba(94, 92, 230, 0.15);
  border-color: rgba(94, 92, 230, 0.4);
}

.palette-hint-icon {
  font-size: 18px;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #8ecbff;
  background: rgba(10, 132, 255, 0.12);
  border: 1px solid rgba(10, 132, 255, 0.20);
}

.palette-hint-label {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

.palette-hint-tip {
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

.palette-no-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
  color: var(--text-muted);
  font-size: 14px;
}

.palette-no-result .el-icon {
  font-size: 32px;
  opacity: 0.3;
}

.palette-no-result-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.palette-link {
  color: #5e5ce6;
  cursor: pointer;
  text-decoration: underline;
}

.palette-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid var(--glass-card-border);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.palette-footer-warn {
  color: #ff9f0a;
  opacity: 0.8;
}

.palette-footer-right {
  color: var(--text-muted);
}

/* Transition */
.palette-fade-enter-active,
.palette-fade-leave-active {
  transition: opacity 0.15s ease;
}
.palette-fade-enter-active .palette-panel,
.palette-fade-leave-active .palette-panel {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.palette-fade-enter-from,
.palette-fade-leave-to {
  opacity: 0;
}
.palette-fade-enter-from .palette-panel,
.palette-fade-leave-to .palette-panel {
  transform: translateY(-12px);
  opacity: 0;
}

:global(html.light-theme) .palette-backdrop {
  background: rgba(245, 247, 251, 0.42);
}

:global(html.light-theme) .palette-panel {
  background:
    radial-gradient(circle at 18% 0%, rgba(10, 132, 255, 0.08), transparent 34%),
    rgba(255, 255, 255, 0.74);
  border-color: rgba(60, 60, 67, 0.12);
  box-shadow: 0 28px 72px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255,255,255,0.88);
}

:global(html.light-theme) .palette-input-wrap,
:global(html.light-theme) .palette-footer {
  border-color: rgba(60, 60, 67, 0.12);
}

:global(html.light-theme) .palette-hint-item,
:global(html.light-theme) .palette-esc {
  background: rgba(255, 255, 255, 0.62);
  border-color: rgba(60, 60, 67, 0.12);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.82);
}

:global(html.light-theme) .palette-item:hover,
:global(html.light-theme) .palette-item.active {
  background: rgba(10, 132, 255, 0.10);
}

:global(html.light-theme) .palette-input,
:global(html.light-theme) .palette-item-label {
  color: #1d1d1f;
}
</style>
