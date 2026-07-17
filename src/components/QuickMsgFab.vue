<template>
  <div class="qmf-wrap" :class="[`qmf-corner-${triggerCorner}`, { 'qmf-free': triggerPosition }]" :style="triggerStyle">
    <button
      class="qmf-trigger"
      :class="{ open: panelVisible, dragging: triggerDragging }"
      @mousedown="startTriggerDrag"
      @click="onTriggerClick"
      @dblclick.stop="resetTriggerPosition"
      title="快捷发消息（⌘⇧M）"
      aria-label="快捷发消息"
    >
      <el-icon class="qmf-icon"><Promotion /></el-icon>
    </button>

    <Teleport to="body">
      <Transition name="qm-slide">
        <div v-if="panelVisible" class="qmf-panel-wrap" @keydown.esc="close">
          <div class="qmf-backdrop" @click="close" />

          <div class="qmf-panel" :style="panelStyle" @click.stop>
            <div class="qmf-header" @mousedown="startPanelDrag">
              <span class="qmf-title">{{ editing ? '快捷发送设置' : '快捷发消息' }}</span>
              <div class="qmf-header-actions" @mousedown.stop>
                <button
                  class="qmf-icon-btn"
                  :class="{ active: editing }"
                  :title="editing ? '返回发送' : '编辑快捷发送'"
                  @click="toggleSettings"
                >
                  <el-icon><Setting /></el-icon>
                </button>
                <button class="qmf-close" title="关闭" @click="close">
                  <el-icon><Close /></el-icon>
                </button>
              </div>
            </div>

            <template v-if="!editing">
              <div class="qmf-section-row">
                <div class="qmf-section-label">发送给</div>
                <button class="qmf-mini-link" @click="openSettings">编辑</button>
              </div>

              <div v-if="configLoading" class="qmf-empty">正在读取 Agent...</div>
              <div v-else-if="agentList.length" class="qmf-agents">
                <button
                  v-for="ag in agentList"
                  :key="ag.id"
                  class="qmf-agent-btn"
                  :class="{ selected: selectedId === ag.id }"
                  @click="selectAgent(ag.id)"
                >
                  <img class="qmf-agent-avatar" :src="ag.avatar" :alt="ag.name" @error="setDefaultAvatar" />
                  <span class="qmf-agent-name">{{ ag.name }}</span>
                </button>
              </div>
              <div v-else class="qmf-empty">
                没有启用快捷发送 Agent
                <button class="qmf-inline-btn" @click="openSettings">去设置</button>
              </div>

              <template v-if="templates.length">
                <div class="qmf-section-row">
                  <div class="qmf-section-label">快捷模板</div>
                  <button class="qmf-mini-link" @click="openSettings">编辑</button>
                </div>
                <div class="qmf-templates">
                  <button
                    v-for="(tpl, i) in templates"
                    :key="`${tpl}-${i}`"
                    class="qmf-tpl-btn"
                    :class="{ active: message === tpl }"
                    @click="fillTemplate(tpl)"
                  >
                    {{ tpl }}
                  </button>
                </div>
              </template>

              <div class="qmf-section-label">消息内容</div>
              <textarea
                ref="inputRef"
                v-model="message"
                class="qmf-textarea"
                placeholder="输入要发送的消息内容..."
                rows="3"
                @keydown.meta.enter.prevent="send"
                @keydown.ctrl.enter.prevent="send"
              />
              <div class="qmf-hint">⌘↵ 快速发送</div>

              <div class="qmf-footer">
                <span class="qmf-target" v-if="selectedAgent">
                  → <img class="qmf-target-avatar" :src="selectedAgent.avatar" :alt="selectedAgent.name" @error="setDefaultAvatar" /> {{ selectedAgent.name }}
                </span>
                <span class="qmf-target empty" v-else>← 请先选择 Agent</span>
                <button
                  class="qmf-send-btn"
                  :class="{ loading: sending }"
                  :disabled="!canSend"
                  @click="send"
                >
                  {{ sending ? '发送中…' : '发送' }}
                </button>
              </div>
            </template>

            <template v-else>
              <div class="qmf-settings-scroll">
                <div class="qmf-section-label">显示哪些 Agent</div>
                <div v-if="allAgents.length" class="qmf-agent-edit-list">
                  <label
                    v-for="ag in allAgents"
                    :key="ag.id"
                    class="qmf-agent-toggle"
                    :class="{ selected: enabledDraftIds.includes(ag.id) }"
                  >
                    <input
                      type="checkbox"
                      :checked="enabledDraftIds.includes(ag.id)"
                      @change="toggleDraftAgent(ag.id)"
                    />
                    <img class="qmf-agent-avatar" :src="ag.avatar" :alt="ag.name" @error="setDefaultAvatar" />
                    <span class="qmf-agent-edit-name">
                      <strong>{{ ag.name }}</strong>
                      <small>{{ ag.id }}</small>
                    </span>
                  </label>
                </div>
                <div v-else class="qmf-empty">没有读取到真实 Agent</div>

                <div class="qmf-section-row qmf-template-editor-title">
                  <div class="qmf-section-label">快捷模板</div>
                  <button class="qmf-mini-link" @click="restoreDefaultTemplates">恢复默认</button>
                </div>
                <div class="qmf-template-editor">
                  <div
                    v-for="(_, i) in templateDrafts"
                    :key="`draft-${i}`"
                    class="qmf-template-row"
                  >
                    <input
                      v-model="templateDrafts[i]"
                      class="qmf-template-input"
                      placeholder="输入模板内容"
                    />
                    <button class="qmf-row-icon-btn" title="删除模板" @click="removeTemplate(i)">
                      <el-icon><Delete /></el-icon>
                    </button>
                  </div>
                  <div class="qmf-template-row">
                    <input
                      v-model="newTemplate"
                      class="qmf-template-input"
                      placeholder="新增一条快捷模板"
                      @keydown.enter.prevent="addTemplate"
                    />
                    <button class="qmf-row-icon-btn primary" title="新增模板" @click="addTemplate">
                      <el-icon><Plus /></el-icon>
                    </button>
                  </div>
                </div>
              </div>

              <div class="qmf-settings-actions">
                <button class="qmf-secondary-btn" @click="cancelSettings">取消</button>
                <button class="qmf-send-btn" :disabled="configSaving" @click="saveSettings">
                  {{ configSaving ? '保存中…' : '保存' }}
                </button>
              </div>
            </template>

            <Transition name="qm-result">
              <div v-if="resultMsg" class="qmf-result" :class="resultType">
                {{ resultMsg }}
              </div>
            </Transition>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { Close, Delete, Plus, Promotion, Setting } from '@element-plus/icons-vue'
import { useAgentStore } from '../stores/agent'
import { setDefaultAvatar } from '../utils/avatarFallback'
import { normalizeAgentAvatarSource } from '../utils/agent-presentation.mjs'

interface AgentItem {
  id: string
  name: string
  emoji: string
  avatar: string
}

interface QuickMessageConfigResponse {
  agents?: AgentItem[]
  config?: {
    enabledAgentIds?: string[]
    templates?: string[]
  }
  defaults?: {
    templates?: string[]
  }
}

const store = useAgentStore()

const panelVisible = ref(false)
const editing = ref(false)
const selectedId = ref('')
const message = ref('')
const sending = ref(false)
const resultMsg = ref('')
const resultType = ref<'success' | 'error'>('success')
const configLoading = ref(false)
const configSaving = ref(false)

function openFromToolManagement(event: Event): void {
  const toolId = String((event as CustomEvent<{ toolId?: string }>).detail?.toolId || '')
  if (toolId && toolId !== 'openclaw') return
  panelVisible.value = true
  editing.value = false
  void nextTick(() => inputRef.value?.focus())
}
const inputRef = ref<HTMLTextAreaElement | null>(null)
const panelPosition = ref<{ left: number; top: number } | null>(loadPanelPosition())
const dragState = ref<{ dx: number; dy: number } | null>(null)
type TriggerCorner = 'br' | 'bl' | 'tr' | 'tl'
const triggerCorner = ref<TriggerCorner>(loadTriggerCorner())
const triggerPosition = ref<{ left: number; top: number } | null>(clampTriggerPosition(loadTriggerPosition()))
const triggerDragging = ref(false)
const triggerDragState = ref<{ startX: number; startY: number; dx: number; dy: number; moved: boolean } | null>(null)
const allAgents = ref<AgentItem[]>([])
const enabledAgentIds = ref<string[]>([])
const templateList = ref<string[]>([])
const defaultTemplates = ref<string[]>([
  '请汇报当前状态',
  '请检查是否有异常',
  '请继续处理当前任务',
  '请总结最近进展',
])
const enabledDraftIds = ref<string[]>([])
const templateDrafts = ref<string[]>([])
const newTemplate = ref('')

const PANEL_W = 420
const PANEL_H = 620

const panelStyle = computed(() => {
  if (!panelPosition.value) {
    if (triggerPosition.value) {
      const triggerW = 78
      const triggerH = 54
      const left = Math.min(
        Math.max(12, triggerPosition.value.left < window.innerWidth / 2
          ? triggerPosition.value.left
          : triggerPosition.value.left + triggerW - PANEL_W),
        window.innerWidth - PANEL_W - 12,
      )
      const top = Math.min(
        Math.max(12, triggerPosition.value.top < window.innerHeight / 2
          ? triggerPosition.value.top + triggerH + 12
          : triggerPosition.value.top - PANEL_H - 12),
        window.innerHeight - PANEL_H - 12,
      )
      return { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' }
    }
    const style: Record<string, string> = {}
    if (triggerCorner.value.includes('t')) style.top = '86px'
    else style.bottom = '94px'
    if (triggerCorner.value.includes('l')) style.left = '28px'
    else style.right = '28px'
    return style
  }
  return {
    left: `${panelPosition.value.left}px`,
    top: `${panelPosition.value.top}px`,
    right: 'auto',
    bottom: 'auto',
  }
})

const triggerStyle = computed(() => {
  if (!triggerPosition.value) return {}
  return {
    left: `${triggerPosition.value.left}px`,
    top: `${triggerPosition.value.top}px`,
    right: 'auto',
    bottom: 'auto',
  }
})

const agentList = computed<AgentItem[]>(() => {
  const byId = new Map(allAgents.value.map(a => [a.id, a]))
  return enabledAgentIds.value.map(id => byId.get(id)).filter(Boolean) as AgentItem[]
})

const selectedAgent = computed(() =>
  agentList.value.find(a => a.id === selectedId.value) ?? null
)

const templates = computed<string[]>(() =>
  templateList.value
)

const canSend = computed(() =>
  !!message.value.trim() && !!selectedAgent.value && !sending.value
)

function togglePanel(): void {
  panelVisible.value = !panelVisible.value
}

function onTriggerClick(): void {
  if (triggerDragState.value?.moved) {
    triggerDragState.value = null
    return
  }
  togglePanel()
}

function close(): void {
  panelVisible.value = false
  editing.value = false
}

function selectAgent(id: string): void {
  selectedId.value = id
  nextTick(() => inputRef.value?.focus())
}

function fillTemplate(tpl: string): void {
  message.value = tpl
  nextTick(() => inputRef.value?.focus())
}

function normalizeAvatarPath(_id: string, avatar?: string): string {
  return normalizeAgentAvatarSource(avatar)
}

function agentsFromStore(): AgentItem[] {
  return store.agents.map(a => {
    const parts = (a.key || '').split(':')
    const id = parts[1] || a.key || ''
    return {
      id,
      name: a.name || a.displayName || a.key || id,
      emoji: a.emoji || '',
      avatar: normalizeAgentAvatarSource(a.avatar),
    }
  }).filter(a => a.id)
}

function cleanTemplates(value: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text.slice(0, 500))
    if (out.length >= 20) break
  }
  return out
}

function applyConfig(data: QuickMessageConfigResponse): void {
  const agents = Array.isArray(data.agents) ? data.agents : []
  allAgents.value = agents.map(a => ({
    id: String(a.id || '').trim(),
    name: a.name || a.id,
    emoji: a.emoji || '',
    avatar: normalizeAvatarPath(a.id, a.avatar),
  })).filter(a => a.id)

  if (allAgents.value.length === 0) {
    allAgents.value = agentsFromStore()
  }

  defaultTemplates.value = cleanTemplates(data.defaults?.templates || defaultTemplates.value)
  const allIds = allAgents.value.map(a => a.id)
  const configuredIds = Array.isArray(data.config?.enabledAgentIds) ? data.config.enabledAgentIds : allIds
  const validIds = new Set(allIds)
  enabledAgentIds.value = configuredIds.map(id => String(id || '').trim()).filter(id => validIds.has(id))
  templateList.value = cleanTemplates(data.config?.templates || defaultTemplates.value)
  ensureSelectedAgent()
}

async function loadConfig(): Promise<void> {
  configLoading.value = true
  try {
    const resp = await fetch('/api/quick-message-config')
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || '读取快捷发送配置失败')
    applyConfig(data)
  } catch (e: any) {
    allAgents.value = agentsFromStore()
    enabledAgentIds.value = allAgents.value.map(a => a.id)
    templateList.value = [...defaultTemplates.value]
    showResult(`读取配置失败：${e.message}`, 'error')
  } finally {
    configLoading.value = false
  }
}

function ensureSelectedAgent(): void {
  if (selectedAgent.value) return
  selectedId.value = agentList.value[0]?.id || ''
}

function openSettings(): void {
  editing.value = true
  enabledDraftIds.value = [...enabledAgentIds.value]
  templateDrafts.value = [...templateList.value]
  newTemplate.value = ''
  resultMsg.value = ''
}

function toggleSettings(): void {
  if (editing.value) {
    cancelSettings()
  } else {
    openSettings()
  }
}

function cancelSettings(): void {
  editing.value = false
  enabledDraftIds.value = []
  templateDrafts.value = []
  newTemplate.value = ''
}

function toggleDraftAgent(id: string): void {
  if (enabledDraftIds.value.includes(id)) {
    enabledDraftIds.value = enabledDraftIds.value.filter(x => x !== id)
    return
  }
  const next = new Set([...enabledDraftIds.value, id])
  enabledDraftIds.value = allAgents.value.map(a => a.id).filter(agentId => next.has(agentId))
}

function addTemplate(): void {
  const text = newTemplate.value.trim()
  if (!text) return
  templateDrafts.value = cleanTemplates([...templateDrafts.value, text])
  newTemplate.value = ''
}

function removeTemplate(index: number): void {
  templateDrafts.value = templateDrafts.value.filter((_, i) => i !== index)
}

function restoreDefaultTemplates(): void {
  templateDrafts.value = [...defaultTemplates.value]
}

async function saveSettings(): Promise<void> {
  configSaving.value = true
  try {
    const validIds = new Set(allAgents.value.map(a => a.id))
    const payload = {
      enabledAgentIds: enabledDraftIds.value.filter(id => validIds.has(id)),
      templates: cleanTemplates(templateDrafts.value),
    }
    const resp = await fetch('/api/quick-message-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await resp.json()
    if (!resp.ok || data.success === false) throw new Error(data.error || '保存失败')
    applyConfig(data)
    editing.value = false
    window.dispatchEvent(new CustomEvent('quick-message-config-updated'))
    showResult('快捷发送设置已保存', 'success')
  } catch (e: any) {
    showResult(`保存失败：${e.message}`, 'error')
  } finally {
    configSaving.value = false
  }
}

function loadPanelPosition(): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem('quick_msg_panel_position_v2')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') return parsed
  } catch { /* ignore */ }
  return null
}

function loadTriggerCorner(): TriggerCorner {
  try {
    const raw = localStorage.getItem('quick_msg_trigger_corner_v2')
    if (raw === 'br' || raw === 'bl' || raw === 'tr' || raw === 'tl') return raw
  } catch { /* ignore */ }
  return 'br'
}

function loadTriggerPosition(): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem('quick_msg_trigger_position_v2')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') return parsed
  } catch { /* ignore */ }
  return null
}

function clampTriggerPosition(pos: { left: number; top: number } | null): { left: number; top: number } | null {
  if (!pos) return null
  if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null
  if (typeof window === 'undefined') return pos
  const btnW = 78
  const btnH = 54
  return {
    left: Math.min(Math.max(12, pos.left), Math.max(12, window.innerWidth - btnW - 12)),
    top: Math.min(Math.max(80, pos.top), Math.max(80, window.innerHeight - btnH - 12)),
  }
}

function keepTriggerVisible(): void {
  if (!triggerPosition.value) return
  const clamped = clampTriggerPosition(triggerPosition.value)
  if (!clamped) {
    resetTriggerPosition()
    return
  }
  if (clamped.left !== triggerPosition.value.left || clamped.top !== triggerPosition.value.top) {
    triggerPosition.value = clamped
    saveTriggerPosition()
  }
}

function saveTriggerCorner(): void {
  localStorage.setItem('quick_msg_trigger_corner_v2', triggerCorner.value)
}

function resetTriggerPosition(): void {
  triggerPosition.value = null
  triggerCorner.value = 'br'
  panelPosition.value = null
  localStorage.removeItem('quick_msg_trigger_position_v2')
  localStorage.removeItem('quick_msg_panel_position_v2')
  saveTriggerCorner()
}

function saveTriggerPosition(): void {
  if (!triggerPosition.value) return
  localStorage.setItem('quick_msg_trigger_position_v2', JSON.stringify(triggerPosition.value))
}

function savePanelPosition(): void {
  if (!panelPosition.value) return
  localStorage.setItem('quick_msg_panel_position_v2', JSON.stringify(panelPosition.value))
}

function startPanelDrag(event: MouseEvent): void {
  const panel = (event.currentTarget as HTMLElement).closest('.qmf-panel') as HTMLElement | null
  if (!panel) return
  const rect = panel.getBoundingClientRect()
  dragState.value = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
  panelPosition.value = { left: rect.left, top: rect.top }
  document.addEventListener('mousemove', onPanelDrag)
  document.addEventListener('mouseup', stopPanelDrag)
}

function onPanelDrag(event: MouseEvent): void {
  if (!dragState.value) return
  const left = Math.min(Math.max(12, event.clientX - dragState.value.dx), window.innerWidth - PANEL_W - 12)
  const top = Math.min(Math.max(12, event.clientY - dragState.value.dy), window.innerHeight - PANEL_H - 12)
  panelPosition.value = { left, top }
}

function stopPanelDrag(): void {
  if (dragState.value) savePanelPosition()
  dragState.value = null
  document.removeEventListener('mousemove', onPanelDrag)
  document.removeEventListener('mouseup', stopPanelDrag)
}

function startTriggerDrag(event: MouseEvent): void {
  if (event.button !== 0) return
  const wrap = (event.currentTarget as HTMLElement).closest('.qmf-wrap') as HTMLElement | null
  const rect = wrap?.getBoundingClientRect()
  triggerDragState.value = {
    startX: event.clientX,
    startY: event.clientY,
    dx: rect ? event.clientX - rect.left : 39,
    dy: rect ? event.clientY - rect.top : 27,
    moved: false,
  }
  document.addEventListener('mousemove', onTriggerDrag)
  document.addEventListener('mouseup', stopTriggerDrag)
}

function onTriggerDrag(event: MouseEvent): void {
  if (!triggerDragState.value) return
  const dx = event.clientX - triggerDragState.value.startX
  const dy = event.clientY - triggerDragState.value.startY
  if (Math.hypot(dx, dy) < 8) return
  triggerDragState.value.moved = true
  triggerDragging.value = true
  const btnW = 78
  const btnH = 54
  const left = Math.min(Math.max(12, event.clientX - triggerDragState.value.dx), window.innerWidth - btnW - 12)
  const top = Math.min(Math.max(80, event.clientY - triggerDragState.value.dy), window.innerHeight - btnH - 12)
  triggerPosition.value = { left, top }
  const vertical = top + btnH / 2 < window.innerHeight / 2 ? 't' : 'b'
  const horizontal = left + btnW / 2 < window.innerWidth / 2 ? 'l' : 'r'
  triggerCorner.value = `${vertical}${horizontal}` as TriggerCorner
}

function stopTriggerDrag(): void {
  if (triggerDragState.value?.moved) {
    saveTriggerCorner()
    saveTriggerPosition()
    panelPosition.value = null
  }
  triggerDragging.value = false
  document.removeEventListener('mousemove', onTriggerDrag)
  document.removeEventListener('mouseup', stopTriggerDrag)
}

async function send(): Promise<void> {
  if (!canSend.value) return
  sending.value = true
  resultMsg.value = ''
  try {
    if (!selectedAgent.value) throw new Error('请先选择一个真实 Agent')
    const resp = await fetch('/api/agent-send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: selectedId.value, message: message.value.trim() }),
    })
    const data = await resp.json()
    if (resp.ok && data.success) {
      showResult(`已提交给 ${data.agentName || selectedAgent.value?.name || selectedId.value}`, 'success')
      message.value = ''
      setTimeout(close, 2500)
    } else {
      showResult(`发送失败：${data.error || '未知错误'}`, 'error')
    }
  } catch (e: any) {
    showResult(`请求失败：${e.message}`, 'error')
  } finally {
    sending.value = false
    setTimeout(() => { resultMsg.value = '' }, 3000)
  }
}

function showResult(text: string, type: 'success' | 'error'): void {
  resultType.value = type
  resultMsg.value = text
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
    e.preventDefault()
    panelVisible.value = !panelVisible.value
  }
}

onMounted(() => {
  void loadConfig()
  keepTriggerVisible()
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', keepTriggerVisible)
  window.addEventListener('ai-workbench:open-quick-message', openFromToolManagement)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', keepTriggerVisible)
  window.removeEventListener('ai-workbench:open-quick-message', openFromToolManagement)
  document.removeEventListener('mousemove', onPanelDrag)
  document.removeEventListener('mouseup', stopPanelDrag)
  document.removeEventListener('mousemove', onTriggerDrag)
  document.removeEventListener('mouseup', stopTriggerDrag)
})

watch(panelVisible, (v) => {
  if (v && !editing.value) nextTick(() => inputRef.value?.focus())
})

watch(agentList, () => {
  ensureSelectedAgent()
})
</script>

<style scoped>
/* ─── FAB 触发按钮 ──────────────────────────────────────────────────────────── */
.qmf-wrap {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 2600;
  transition: inset 0.22s ease, left 0.18s ease, top 0.18s ease, transform 0.22s ease;
}

.qmf-wrap.qmf-free {
  bottom: auto;
  right: auto;
}

.qmf-corner-br { bottom: 28px; right: 28px; top: auto; left: auto; }
.qmf-corner-bl { bottom: 28px; left: 28px; top: auto; right: auto; }
.qmf-corner-tr { top: 86px; right: 28px; bottom: auto; left: auto; }
.qmf-corner-tl { top: 86px; left: 28px; bottom: auto; right: auto; }

.qmf-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 78px;
  height: 54px;
  padding: 0;
  background: rgba(10, 132, 255, 0.86);
  color: #fff;
  border: 1px solid rgba(186, 230, 253, 0.38);
  border-radius: 18px;
  cursor: pointer;
  box-shadow:
    0 14px 34px rgba(10, 132, 255, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.34);
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s, border-color 0.15s, width 0.15s;
  outline: none;
  touch-action: none;
}

.qmf-trigger:hover {
  transform: translateY(-2px);
  border-color: rgba(186, 230, 253, 0.72);
  box-shadow:
    0 18px 42px rgba(10, 132, 255, 0.38),
    0 0 0 5px rgba(10, 132, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
}

.qmf-trigger.open {
  background: rgba(0, 122, 255, 0.92);
  transform: scale(0.96);
}

.qmf-trigger.dragging {
  cursor: grabbing;
  transform: scale(0.98);
}

.qmf-icon {
  font-size: 24px;
  line-height: 1;
}

/* ─── 遮罩 + 面板布局 ───────────────────────────────────────────────────────── */
.qmf-panel-wrap {
  position: fixed;
  inset: 0;
  z-index: 2000;
  pointer-events: none;
}

.qmf-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: all;
}

.qmf-panel {
  position: absolute;
  bottom: 80px;
  right: 28px;
  width: 420px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 36px);
  background: var(--glass-card-bg);
  border: 1px solid var(--glass-card-border);
  border-radius: 14px;
  box-shadow: var(--glass-inner-highlight), 0 24px 60px rgba(0, 0, 0, 0.38);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: all;
  overflow: hidden;
}

/* ─── 标题栏 ─────────────────────────────────────────────────────────────────── */
.qmf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: move;
  user-select: none;
}

.qmf-title {
  font-size: 15px;
  font-weight: 700;
  color: #f1f5f9;
}

.qmf-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.qmf-icon-btn,
.qmf-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  color: #8e8e93;
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  border-radius: 7px;
  line-height: 1;
  transition: color 0.15s, background 0.15s;
  }

.qmf-icon-btn:hover,
.qmf-close:hover {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.08);
}

.qmf-icon-btn.active {
  color: #b3d7ff;
  background: rgba(10, 132, 255, 0.14);
}

/* ─── 区块标题 ───────────────────────────────────────────────────────────────── */
.qmf-section-label {
  font-size: 11px;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0;
  font-weight: 600;
}

.qmf-section-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.qmf-mini-link,
.qmf-inline-btn {
  background: transparent;
  border: none;
  color: #7ab8ff;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.qmf-mini-link:hover,
.qmf-inline-btn:hover {
  color: #b3d7ff;
}

.qmf-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  color: #8e8e93;
  font-size: 13px;
}

/* ─── Agent 选择区 ───────────────────────────────────────────────────────────── */
.qmf-agents {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.qmf-agent-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  cursor: pointer;
  color: #98989d;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s;
  outline: none;
}

.qmf-agent-btn:hover {
  background: var(--fill-hover);
  color: #e5e5ea;
}

.qmf-agent-btn.selected {
  background: rgba(10, 132, 255, 0.13);
  border-color: rgba(10, 132, 255, 0.32);
  color: #b3d7ff;
}

.qmf-agent-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
}

.qmf-settings-scroll {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: min(492px, calc(100vh - 168px));
  overflow-y: auto;
  padding-right: 4px;
}

.qmf-agent-edit-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.qmf-agent-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  color: #c7c7cc;
  transition: background 0.15s, border-color 0.15s;
}

.qmf-agent-toggle:hover {
  background: var(--fill-hover);
}

.qmf-agent-toggle.selected {
  background: rgba(10, 132, 255, 0.13);
  border-color: rgba(10, 132, 255, 0.32);
}

.qmf-agent-toggle input {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  accent-color: #0a84ff;
}

.qmf-agent-edit-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.qmf-agent-edit-name strong {
  overflow: hidden;
  color: #e5e5ea;
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qmf-agent-edit-name small {
  overflow: hidden;
  color: #8e8e93;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qmf-target {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.qmf-target-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-color);
}

/* ─── 快捷模板区 ─────────────────────────────────────────────────────────────── */
.qmf-templates {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.qmf-tpl-btn {
  text-align: left;
  padding: 6px 11px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 7px;
  cursor: pointer;
  color: #98989d;
  font-size: 12px;
  transition: all 0.15s;
  outline: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qmf-tpl-btn:hover {
  background: rgba(10, 132, 255, 0.1);
  border-color: rgba(10, 132, 255, 0.28);
  color: #b3d7ff;
}

.qmf-tpl-btn.active {
  background: rgba(10, 132, 255, 0.13);
  border-color: rgba(10, 132, 255, 0.34);
  color: #b3d7ff;
}

.qmf-template-editor-title {
  margin-top: 4px;
}

.qmf-template-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qmf-template-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qmf-template-input {
  min-width: 0;
  flex: 1;
  height: 34px;
  box-sizing: border-box;
  padding: 7px 10px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: #e5e5ea;
  font: inherit;
  font-size: 12px;
  outline: none;
}

.qmf-template-input:focus {
  border-color: rgba(10, 132, 255, 0.38);
}

.qmf-row-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: #a1a1aa;
  cursor: pointer;
}

.qmf-row-icon-btn:hover {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.35);
}

.qmf-row-icon-btn.primary {
  color: #b3d7ff;
}

.qmf-row-icon-btn.primary:hover {
  color: #dbeafe;
  border-color: rgba(10, 132, 255, 0.4);
}

/* ─── 消息输入框 ─────────────────────────────────────────────────────────────── */
.qmf-textarea {
  width: 100%;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: #e5e5ea;
  font-size: 13px;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
  transition: border-color 0.15s;
  line-height: 1.6;
}

.qmf-textarea::placeholder {
  color: #6e6e73;
}

.qmf-textarea:focus {
  border-color: rgba(10, 132, 255, 0.34);
  background: var(--fill-subtle);
}

.qmf-hint {
  font-size: 10px;
  color: #6e6e73;
  text-align: right;
  margin-top: -6px;
}

/* ─── 底部操作区 ─────────────────────────────────────────────────────────────── */
.qmf-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.qmf-target {
  font-size: 12px;
  color: #8e8e93;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qmf-target.empty {
  color: #6e6e73;
}

.qmf-send-btn {
  padding: 8px 18px;
  background: #0a84ff;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
  white-space: nowrap;
  outline: none;
}

.qmf-send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(10, 132, 255, 0.22);
}

.qmf-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

.qmf-send-btn.loading {
  background: #6e6e73;
}

.qmf-settings-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}

.qmf-secondary-btn {
  padding: 8px 16px;
  background: var(--fill-subtle);
  color: #c7c7cc;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  outline: none;
}

.qmf-secondary-btn:hover {
  background: var(--fill-hover);
  color: #f1f5f9;
}

/* ─── 发送结果提示 ───────────────────────────────────────────────────────────── */
.qmf-result {
  padding: 8px 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}

.qmf-result.success {
  background: rgba(48, 209, 88, 0.12);
  color: #4ade80;
  border: 1px solid rgba(48, 209, 88, 0.2);
}

.qmf-result.error {
  background: rgba(255, 69, 58, 0.12);
  color: #ff6961;
  border: 1px solid rgba(255, 69, 58, 0.2);
}

:global(html.light-theme .qmf-panel) {
  background: rgba(255, 255, 255, 0.97);
  border-color: rgba(0, 122, 255, 0.15);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 24px 58px rgba(15, 23, 42, 0.18);
}

:global(html.light-theme .qmf-title) {
  color: #1d1d1f;
}

:global(html.light-theme .qmf-close) {
  color: #6b7280;
}

:global(html.light-theme .qmf-icon-btn) {
  color: #6b7280;
}

:global(html.light-theme .qmf-icon-btn:hover),
:global(html.light-theme .qmf-close:hover) {
  color: #1d1d1f;
  background: rgba(0, 122, 255, 0.06);
}

:global(html.light-theme .qmf-icon-btn.active) {
  color: #0057b8;
  background: rgba(219, 234, 254, 0.9);
}

:global(html.light-theme .qmf-section-label) {
  color: #4b5563;
}

:global(html.light-theme .qmf-agent-btn),
:global(html.light-theme .qmf-tpl-btn),
:global(html.light-theme .qmf-agent-toggle),
:global(html.light-theme .qmf-template-input),
:global(html.light-theme .qmf-row-icon-btn),
:global(html.light-theme .qmf-secondary-btn) {
  background: #ffffff;
  border-color: rgba(15, 23, 42, 0.13);
  color: #374151;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

:global(html.light-theme .qmf-agent-btn:hover),
:global(html.light-theme .qmf-tpl-btn:hover),
:global(html.light-theme .qmf-agent-toggle:hover),
:global(html.light-theme .qmf-secondary-btn:hover) {
  background: rgba(239, 246, 255, 0.98);
  border-color: rgba(0, 122, 255, 0.26);
  color: #0b63ce;
}

:global(html.light-theme .qmf-agent-btn.selected),
:global(html.light-theme .qmf-tpl-btn.active),
:global(html.light-theme .qmf-agent-toggle.selected) {
  background: rgba(219, 234, 254, 0.9);
  border-color: rgba(0, 122, 255, 0.38);
  color: #0057b8;
}

:global(html.light-theme .qmf-agent-edit-name strong) {
  color: #1f2937;
}

:global(html.light-theme .qmf-agent-edit-name small),
:global(html.light-theme .qmf-empty) {
  color: #6b7280;
}

:global(html.light-theme .qmf-mini-link),
:global(html.light-theme .qmf-inline-btn) {
  color: #0b63ce;
}

:global(html.light-theme .qmf-textarea) {
  background: #ffffff;
  border-color: rgba(0, 122, 255, 0.24);
  color: #1f2937;
}

:global(html.light-theme .qmf-textarea::placeholder) {
  color: #6b7280;
}

:global(html.light-theme .qmf-textarea:focus) {
  background: #ffffff;
  border-color: rgba(0, 122, 255, 0.45);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
}

:global(html.light-theme .qmf-template-input:focus) {
  border-color: rgba(0, 122, 255, 0.45);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.08);
}

:global(html.light-theme .qmf-hint),
:global(html.light-theme .qmf-target.empty) {
  color: #6b7280;
}

:global(html.light-theme .qmf-target) {
  color: #4b5563;
}

:global(html.light-theme .qmf-send-btn:disabled) {
  opacity: 1;
  background: #bfdbfe;
  color: #ffffff;
  box-shadow: none;
}

:global(html.light-theme .qmf-result.success) {
  background: rgba(48, 209, 88, 0.1);
  color: #15803d;
  border-color: rgba(22, 163, 74, 0.2);
}

:global(html.light-theme .qmf-result.error) {
  background: rgba(255, 59, 48, 0.08);
  color: #b42318;
  border-color: rgba(255, 59, 48, 0.18);
}

/* ─── 动画 ──────────────────────────────────────────────────────────────────── */
.qm-slide-enter-active,
.qm-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.qm-slide-enter-from,
.qm-slide-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.97);
}

.qm-result-enter-active,
.qm-result-leave-active {
  transition: opacity 0.3s ease;
}

.qm-result-enter-from,
.qm-result-leave-to {
  opacity: 0;
}
</style>
