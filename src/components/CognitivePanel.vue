<template>
  <el-card class="cognitive-panel" shadow="never">
    <template #header>
      <div class="cp-header">
        <span><el-icon><MagicStick /></el-icon> 智能增强</span>
        <el-button size="small" text @click="refresh">刷新</el-button>
      </div>
    </template>

    <el-tabs v-model="activeTab" size="small" class="cp-tabs">
      <!-- ── 认知引擎 ── -->
      <el-tab-pane label="认知引擎" name="cognitive">
        <div class="cp-section">
          <div class="cp-label">实时意图</div>
          <div v-if="lastAnalysis" class="cp-result">
            <el-tag :type="intentTagType" size="small">{{ lastAnalysis.intent?.label || '-' }}</el-tag>
            <span class="cp-subtext">{{ lastAnalysis.intent?.type }}</span>
          </div>
          <div v-else class="cp-empty">在左侧输入消息时自动分析</div>

          <div class="cp-label mt">情绪状态</div>
          <div v-if="lastAnalysis?.sentiment" class="cp-meters">
            <div class="cp-meter-row">
              <span class="cp-meter-label">正向度</span>
              <el-progress :percentage="Math.round((lastAnalysis.sentiment.valence + 1) / 2 * 100)"
                :color="lastAnalysis.sentiment.valence > 0 ? '#67c23a' : '#f56c6c'" :show-text="false" />
            </div>
            <div class="cp-meter-row">
              <span class="cp-meter-label">紧急度</span>
              <el-progress :percentage="Math.round(lastAnalysis.sentiment.urgency * 100)"
                color="#e6a23c" :show-text="false" />
            </div>
            <div class="cp-meter-row">
              <span class="cp-meter-label">沮丧度</span>
              <el-progress :percentage="Math.round(lastAnalysis.sentiment.frustration * 100)"
                color="#f56c6c" :show-text="false" />
            </div>
          </div>
          <div v-else class="cp-empty">-</div>

          <div v-if="lastAnalysis?.moodContext" class="cp-mood-hint">
            <el-icon><InfoFilled /></el-icon>
            {{ lastAnalysis.moodContext }}
          </div>
        </div>
      </el-tab-pane>

      <!-- ── 记忆树（MEMORY.md）── -->
      <el-tab-pane label="记忆树" name="memory">
        <div class="cp-section">
          <div class="cp-file-hint"><el-icon><Document /></el-icon> 直接对应 {{ memoryFile || '当前 OpenClaw 工作空间/MEMORY.md' }}</div>
          <div class="cp-toolbar">
            <el-button size="small" type="primary" @click="openAddDialog">+ 写入记忆</el-button>
          </div>

          <div v-if="memoryNodes.length === 0" class="cp-empty">MEMORY.md 为空或未找到</div>
          <div v-else class="cp-tree">
            <div v-for="trunk in trunks" :key="trunk.id" class="cp-trunk">
              <div class="cp-node-title"><span class="cp-node-icon"><el-icon><FolderOpened /></el-icon></span>{{ trunk.content }}</div>
              <!-- 直属叶子 -->
              <div v-for="leaf in leavesOf(trunk.id)" :key="leaf.id" class="cp-leaf">
                <span class="cp-node-icon"><el-icon><Memo /></el-icon></span>{{ leaf.content }}
              </div>
              <!-- 分支 + 分支下叶子 -->
              <div v-for="branch in branchesOf(trunk.id)" :key="branch.id" class="cp-branch">
                <div class="cp-node-title"><span class="cp-node-icon"><el-icon><Folder /></el-icon></span>{{ branch.content }}</div>
                <div v-for="leaf in leavesOf(branch.id)" :key="leaf.id" class="cp-leaf">
                  <span class="cp-node-icon"><el-icon><Memo /></el-icon></span>{{ leaf.content }}
                </div>
              </div>
            </div>
          </div>

          <el-dialog v-model="showAddNode" title="写入一条记忆" width="400px" append-to-body>
            <el-form :model="newNode" label-width="70px" size="small">
              <el-form-item label="类型">
                <el-select v-model="newNode.type" @change="newNode.parentContent = ''">
                  <el-option label="叶子（一条具体记忆）" value="leaf" />
                  <el-option label="分支（子分类）" value="branch" />
                  <el-option label="主干（新大类）" value="trunk" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="newNode.type !== 'trunk'" label="归到">
                <el-select v-model="newNode.parentContent" placeholder="选择父节点" filterable>
                  <el-option v-for="n in parentOptions" :key="n.id"
                    :label="n.content" :value="n.content" />
                </el-select>
              </el-form-item>
              <el-form-item label="内容">
                <el-input v-model="newNode.content" type="textarea" :rows="2" placeholder="要记住的内容" />
              </el-form-item>
            </el-form>
            <template #footer>
              <el-button @click="showAddNode = false">取消</el-button>
              <el-button type="primary" @click="addMemoryNode">写入 MEMORY.md</el-button>
            </template>
          </el-dialog>
        </div>
      </el-tab-pane>

      <!-- ── 人格演化（SOUL.md）── -->
      <el-tab-pane label="人格演化" name="personality">
        <div class="cp-section">
          <el-select v-model="selectedAgentId" size="small" style="width: 100%; margin-bottom: 12px">
            <el-option v-for="a in personalityAgents" :key="a.agentId"
              :label="`${a.name} (${a.agentId})`" :value="a.agentId" />
          </el-select>

          <div v-if="currentAgent">
            <div class="cp-file-hint"><el-icon><Document /></el-icon> 写入 {{ displayPath(currentAgent.soulPath || `${currentAgent.agentId}/SOUL.md`) }}</div>

            <div class="cp-label mt">当前演化观察</div>
            <div v-if="currentAgent.observations?.length" class="cp-obs-list">
              <div v-for="(o, i) in currentAgent.observations" :key="i" class="cp-obs-item">· {{ o }}</div>
            </div>
            <div v-else class="cp-empty">还没演化过，点下方按钮生成</div>

            <div class="cp-label mt">上次演化</div>
            <div class="cp-subtext">{{ currentAgent.lastEvolved ? new Date(currentAgent.lastEvolved).toLocaleString('zh-CN') : '从未' }}</div>

            <div class="cp-actions">
              <el-button size="small" type="primary" :loading="evolving" @click="triggerEvolve">
                {{ evolving ? 'Ollama 分析中...' : '触发演化' }}
              </el-button>
              <el-tooltip content="读取该 agent 近期对话，用本地 Ollama(gemma3:12b) 分析 用户 的沟通偏好，把建议写进 SOUL.md 的可回退区块。需 Ollama 运行中。" placement="top">
                <el-icon class="cp-info-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </div>

            <div v-if="evolveResult" class="cp-evolve-result">
              <div class="cp-label">本次演化结果</div>
              <div v-for="(o, i) in evolveResult.observations" :key="i" class="cp-obs-item">· {{ o }}</div>
              <div v-if="evolveResult.summary" class="cp-subtext">特点：{{ evolveResult.summary }}</div>
              <el-tag v-if="evolveResult.soulUpdated" type="success" size="small">已写入 SOUL.md（可回退）</el-tag>
            </div>
          </div>
          <div v-else class="cp-empty">加载中...</div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled, QuestionFilled } from '@element-plus/icons-vue'

const props = defineProps<{ agentId?: string; lastAnalysis?: any }>()

const activeTab = ref('cognitive')

// ── 认知引擎 ──────────────────────────────────────────────────────────────────
const intentTagType = computed(() => {
  const t = props.lastAnalysis?.intent?.type
  if (t === 'greeting' || t === 'thanks') return 'success'
  if (t === 'time_query' || t === 'status_check' || t === 'simple_math') return 'info'
  return 'warning'
})

// ── 记忆树（MEMORY.md）────────────────────────────────────────────────────────
interface MemNode { id: number; content: string; type: string; parentId: number | null; line: number }
const memoryNodes = ref<MemNode[]>([])
const memoryFile = ref('')
const showAddNode = ref(false)
const newNode = ref({ content: '', type: 'leaf', parentContent: '' })

const trunks = computed(() => memoryNodes.value.filter(n => n.type === 'trunk'))
function branchesOf(pid: number) { return memoryNodes.value.filter(n => n.type === 'branch' && n.parentId === pid) }
function leavesOf(pid: number) { return memoryNodes.value.filter(n => n.type === 'leaf' && n.parentId === pid) }
const parentOptions = computed(() => {
  if (newNode.value.type === 'branch') return memoryNodes.value.filter(n => n.type === 'trunk')
  return memoryNodes.value.filter(n => n.type === 'trunk' || n.type === 'branch')
})

async function loadMemory() {
  try {
    const r = await fetch('/api/memory-tree')
    const d = await r.json()
    if (d.ok) {
      memoryNodes.value = d.nodes
      memoryFile.value = displayPath(d.file || '')
    }
  } catch {}
}

function openAddDialog() {
  newNode.value = { content: '', type: 'leaf', parentContent: '' }
  showAddNode.value = true
}

async function addMemoryNode() {
  if (!newNode.value.content.trim()) return ElMessage.warning('内容不能为空')
  if (newNode.value.type !== 'trunk' && !newNode.value.parentContent) return ElMessage.warning('请选择父节点')
  try {
    const r = await fetch('/api/memory-tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newNode.value),
    })
    const d = await r.json()
    if (d.ok) {
      showAddNode.value = false
      ElMessage.success(`已写入 MEMORY.md：${d.inserted}`)
      await loadMemory()
    } else {
      ElMessage.error(d.error || '写入失败')
    }
  } catch (e: any) { ElMessage.error(e.message) }
}

// ── 人格演化（SOUL.md）────────────────────────────────────────────────────────
interface PAgent { agentId: string; name: string; lastEvolved: string | null; observations: string[]; soulExists: boolean; soulPath?: string; currentEvolution: string | null }
const personalityAgents = ref<PAgent[]>([])
const selectedAgentId = ref(props.agentId || '')
const evolving = ref(false)
const evolveResult = ref<any>(null)

const currentAgent = computed(() => personalityAgents.value.find(a => a.agentId === selectedAgentId.value) || null)

function displayPath(path: string): string {
  return String(path || '').replace(/^\/Users\/[^/]+/, '~')
}

async function loadPersonality() {
  try {
    const r = await fetch('/api/personality')
    const d = await r.json()
    if (d.ok) {
      personalityAgents.value = d.agents
      if (!personalityAgents.value.some(a => a.agentId === selectedAgentId.value)) {
        selectedAgentId.value = personalityAgents.value[0]?.agentId || ''
      }
    }
  } catch {}
}

async function triggerEvolve() {
  evolving.value = true
  evolveResult.value = null
  try {
    const r = await fetch(`/api/personality/${encodeURIComponent(selectedAgentId.value)}/evolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const d = await r.json()
    if (d.ok) {
      evolveResult.value = d
      ElMessage.success(`${d.name} 的 SOUL.md 已更新`)
      await loadPersonality()
    } else {
      ElMessage.warning(d.error || '演化失败')
    }
  } catch (e: any) { ElMessage.error(e.message) }
  finally { evolving.value = false }
}

// ── 通用 ──────────────────────────────────────────────────────────────────────
async function refresh() {
  await Promise.all([loadMemory(), loadPersonality()])
  ElMessage.success('已刷新')
}

watch(() => props.agentId, (v) => { if (v) selectedAgentId.value = v })

onMounted(() => {
  loadMemory()
  loadPersonality()
})
</script>

<style scoped>
.cognitive-panel { margin-top: 12px; }
.cp-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
.cp-tabs { --el-font-size-base: 13px; }
.cp-section { padding: 4px 0; }
.cp-label { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
.cp-label.mt { margin-top: 14px; }
.cp-empty { font-size: 12px; color: var(--el-text-color-placeholder); padding: 8px 0; }
.cp-file-hint { font-size: 11px; color: var(--el-text-color-secondary); background: var(--el-fill-color-lighter); padding: 4px 8px; border-radius: 4px; margin-bottom: 8px; }
.cp-result { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.cp-subtext { font-size: 12px; color: var(--el-text-color-secondary); }
.cp-meters { display: flex; flex-direction: column; gap: 8px; }
.cp-meter-row { display: flex; align-items: center; gap: 8px; }
.cp-meter-label { font-size: 12px; width: 44px; flex-shrink: 0; color: var(--el-text-color-regular); }
.cp-meter-row .el-progress { flex: 1; }
.cp-mood-hint { margin-top: 10px; font-size: 12px; color: var(--el-color-warning); display: flex; gap: 4px; align-items: flex-start; }
.cp-toolbar { display: flex; gap: 8px; margin-bottom: 10px; }
.cp-tree { display: flex; flex-direction: column; gap: 10px; max-height: 360px; overflow-y: auto; }
.cp-trunk { background: var(--el-fill-color-lighter); border-radius: 6px; padding: 8px; }
.cp-branch { margin-left: 14px; margin-top: 6px; background: var(--el-fill-color); border-radius: 4px; padding: 6px; }
.cp-leaf { margin-left: 14px; font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; display: flex; gap: 4px; }
.cp-node-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; }
.cp-node-icon { flex-shrink: 0; }
.cp-obs-list { display: flex; flex-direction: column; gap: 6px; }
.cp-obs-item { font-size: 13px; line-height: 1.5; color: var(--el-text-color-regular); }
.cp-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.cp-info-icon { color: var(--el-text-color-secondary); cursor: help; }
.cp-evolve-result { margin-top: 12px; padding: 8px; background: var(--el-fill-color-lighter); border-radius: 6px; display: flex; flex-direction: column; gap: 6px; }
</style>
