<template>
  <el-dialog
    top="7vh"
    v-model="visible"
    title="计费配置"
    width="860px"
    :close-on-click-modal="false"
    class="billing-config-dialog"
  >
    <div class="bc-intro">
      <el-icon><InfoFilled /></el-icon>
      <span>按 token 单价用于计算 API 等价费用；包月订阅仅代表订阅口径，不会伪装成实际逐次账单。</span>
    </div>

    <el-scrollbar height="52vh" class="bc-scroll">
      <div v-if="!localConfig" class="bc-empty">
        <el-icon class="is-loading"><Loading /></el-icon> 加载中…
      </div>

      <template v-else>
        <div v-if="displayedModelIds.length === 0" class="bc-empty">
          <el-icon><InfoFilled /></el-icon>
          暂无已使用的模型。OpenClaw、Codex、Claude Code 消耗过 token 的模型会自动出现在这里。
        </div>

        <!-- 各模型卡片（只展示有 token 用量的模型） -->
        <div
          v-for="(cfg, modelId) in displayedModels"
          :key="modelId"
          class="bc-model-card"
        >
          <div class="bc-model-header">
            <span class="bc-model-logo" :class="`bc-logo--${logoKey(String(modelId))}`">
              <img v-if="logoSrc(String(modelId))" :src="logoSrc(String(modelId))" alt="" />
              <template v-else>{{ String(modelId).slice(0, 2).toUpperCase() }}</template>
            </span>
            <span class="bc-model-id">{{ modelId }}</span>
            <el-select
              v-model="cfg.mode"
              size="small"
              class="bc-mode-select"
              :teleported="false"
            >
              <el-option label="包月订阅" value="subscription_monthly" />
              <el-option label="按 token 计费" value="per_token" />
              <el-option label="OpenClaw 默认" value="use_default" />
              <el-option label="免费" value="free" />
            </el-select>
            <el-button
              type="danger"
              link
              size="small"
              :icon="Delete"
              @click="removeModel(String(modelId))"
            >移除</el-button>
          </div>

          <!-- 包月订阅字段 -->
          <div v-if="cfg.mode === 'subscription_monthly'" class="bc-fields">
            <div class="bc-field">
              <label>月订阅费 (¥/月)</label>
              <el-input-number v-model="cfg.monthlyCNY" :min="0" :precision="2" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field">
              <label>月度 token 配额（可选）</label>
              <el-input-number v-model="cfg.quotaTokensPerMonth" :min="0" :step="1000000" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field">
              <label>超额单价 (¥/百万 token)</label>
              <el-input-number v-model="cfg.overTokenPriceCNYPerMillion" :min="0" :precision="2" size="small" style="width: 100%;" />
            </div>
          </div>

          <!-- 按 token 字段 -->
          <div v-else-if="cfg.mode === 'per_token'" class="bc-fields">
            <div class="bc-field">
              <label>输入价 (¥/百万 token)</label>
              <el-input-number v-model="cfg.inputPriceCNYPerMillion" :min="0" :precision="4" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field">
              <label>输出价 (¥/百万 token)</label>
              <el-input-number v-model="cfg.outputPriceCNYPerMillion" :min="0" :precision="4" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field">
              <label>缓存读价 (¥/百万 token，可选)</label>
              <el-input-number v-model="cfg.cacheReadPriceCNYPerMillion" :min="0" :precision="4" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field">
              <label>缓存写价 (¥/百万 token，可选)</label>
              <el-input-number v-model="cfg.cacheWritePriceCNYPerMillion" :min="0" :precision="4" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field bc-field-full">
              <label class="bc-field-section">时段折扣（可选，例：DeepSeek 夜间半价）</label>
              <div class="bc-discount-row">
                <span class="bc-discount-label">折扣系数</span>
                <el-input-number
                  v-model="cfg.discountFactor"
                  :min="0" :max="1" :step="0.1" :precision="2"
                  size="small"
                  placeholder="0.5 = 5折"
                />
                <span class="bc-discount-label">生效时段（北京时间）</span>
                <el-input-number v-model="cfg.discountStartHour" :min="0" :max="23" size="small" />
                <span class="bc-discount-sep">至</span>
                <el-input-number v-model="cfg.discountEndHour" :min="0" :max="23" size="small" />
                <span class="bc-discount-label">时</span>
              </div>
            </div>
          </div>

          <div v-else-if="cfg.mode === 'use_default'" class="bc-fields-note">
            使用 OpenClaw Gateway 自带的计费数据（usage-stats 返回的 cost 字段）。
          </div>

          <div v-else-if="cfg.mode === 'free'" class="bc-fields-note">
            该模型不计费（费用恒为 ¥0）。
          </div>

          <div v-if="cfg.note" class="bc-note">{{ cfg.note }}</div>
        </div>

        <!-- 添加新模型 -->
        <div class="bc-add-row">
          <el-input
            v-model="newModelId"
            placeholder="输入模型 ID（如 gpt-4-turbo）"
            size="small"
            style="width: 280px;"
            @keyup.enter="addModel"
          />
          <el-button
            type="primary"
            size="small"
            :icon="Plus"
            :disabled="!newModelId.trim()"
            @click="addModel"
          >添加模型</el-button>
          <el-button
            size="small"
            :icon="RefreshLeft"
            @click="restoreDefaults"
          >恢复内置默认</el-button>
        </div>

        <!-- 全局电费叠加（可选） -->
        <div class="bc-global-section">
          <div class="bc-global-title">全局电费（可选，叠加在所有模型成本之上）</div>
          <div class="bc-global-field">
            <span>电费单价 (¥/小时)</span>
            <el-input-number
              v-model="localConfig.globalAddons!.electricityPerHour"
              :min="0" :precision="2" size="small"
              placeholder="0 = 不叠加"
            />
          </div>
        </div>
      </template>
    </el-scrollbar>

    <template #footer>
      <div class="bc-footer">
        <span class="bc-footer-hint">配置保存于 <code>billing-config.json</code>，保存后会刷新统计</span>
        <div>
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">

// 模型品牌 logo(复用 /public/model-logos 资源)
const LOGO_KEYS = ['deepseek','minimax','anthropic','openai','qwen','google'] as const
function logoKey(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('minimax')) return 'minimax'
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic'
  if (m.includes('gpt') || m.includes('openai')) return 'openai'
  if (m.includes('qwen')) return 'qwen'
  if (m.includes('gemma') || m.includes('google')) return 'google'
  return 'generic'
}
function logoSrc(model: string): string {
  const key = logoKey(model)
  return (LOGO_KEYS as readonly string[]).includes(key) ? `/model-logos/${key}.svg` : ''
}
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { InfoFilled, Delete, Plus, RefreshLeft, Loading } from '@element-plus/icons-vue'
import { useAgentStore } from '../stores/agent'
import { createSafeRecord, ownValue, safeRecordFrom } from '../utils/safe-record.mjs'

const visible = defineModel<boolean>('visible', { default: false })
const emit = defineEmits<{
  (e: 'saved'): void
}>()
const store = useAgentStore()

const localConfig = ref<any>(null)
const newModelId = ref('')
const saving = ref(false)
const presetDefaults = ref<any>(null)
const localUsageByModel = ref<Record<string, any>>(createSafeRecord())

function addUsageToModelMap(map: Record<string, any>, modelId: string, usage: any) {
  const id = String(modelId || 'unknown')
  if (!Object.hasOwn(map, id)) map[id] = { tokens: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  map[id].tokens += Number(usage?.tokens) || 0
  map[id].cost += Number(usage?.cost) || 0
  map[id].input += Number(usage?.input) || 0
  map[id].output += Number(usage?.output) || 0
  map[id].cacheRead += Number(usage?.cacheRead) || 0
  map[id].cacheWrite += Number(usage?.cacheWrite) || 0
}

async function fetchLocalUsageModels() {
  try {
    const resp = await fetch('/api/local-ai-usage?days=all')
    if (!resp.ok) throw new Error('读取本地模型统计失败')
    const data = await resp.json()
    const map: Record<string, any> = createSafeRecord()
    for (const app of data.apps || []) {
      for (const [modelId, usage] of Object.entries(app.byModel || {})) {
        addUsageToModelMap(map, modelId, usage)
      }
    }
    localUsageByModel.value = map
  } catch {
    localUsageByModel.value = createSafeRecord()
  }
}

// 已使用过的模型 ID 集合（OpenClaw + Codex + Claude Code）
const usedModelIds = computed<string[]>(() => {
  const byModel = store.globalUsage.byModel || {}
  const ids = new Set<string>()
  for (const [id, usage] of Object.entries(byModel)) {
    if ((usage?.tokens ?? 0) > 0) ids.add(id)
  }
  for (const [id, usage] of Object.entries(localUsageByModel.value)) {
    if ((usage?.tokens ?? 0) > 0) ids.add(id)
  }
  return [...ids]
})

function modelUsageTokens(modelId: string): number {
  const openclawTokens = Number(ownValue(store.globalUsage.byModel, modelId)?.tokens) || 0
  const localTokens = Number(ownValue(localUsageByModel.value, modelId)?.tokens) || 0
  return openclawTokens + localTokens
}

// 仅展示已使用过的模型 + 用户手动添加的（按 token 用量降序）
const displayedModelIds = computed<string[]>(() => {
  if (!localConfig.value) return []
  const inConfig = Object.keys(localConfig.value.models)
  const all = new Set([...usedModelIds.value, ...inConfig.filter(id => manuallyAdded.value.has(id))])
  return [...all].sort((a, b) => modelUsageTokens(b) - modelUsageTokens(a))
})

// 用于 v-for 双参数迭代：返回 { modelId: cfg } 对象（保持 displayedModelIds 顺序）
const displayedModels = computed<Record<string, any>>(() => {
  if (!localConfig.value) return createSafeRecord()
  const out: Record<string, any> = createSafeRecord()
  for (const id of displayedModelIds.value) {
    const config = ownValue(localConfig.value.models, id)
    if (config) out[id] = config
  }
  return out
})

// 跟踪用户手动添加（点过"添加模型"按钮）的 ID，让它们即使没用过也能展示
const manuallyAdded = ref<Set<string>>(new Set())

// 打开时加载最新配置（深拷贝避免直接改 store）
watch(visible, async (val) => {
  if (val) {
    await Promise.all([
      store.fetchBillingConfig(),
      store.fetchGlobalUsage(),
      fetchLocalUsageModels(),
    ])
    const src = store.billingConfig
    localConfig.value = src ? JSON.parse(JSON.stringify(src)) : { version: 1, models: createSafeRecord(), fallback: { mode: 'use_default' }, globalAddons: { electricityPerHour: 0 } }
    localConfig.value.models = safeRecordFrom(localConfig.value.models)
    if (!localConfig.value.globalAddons) localConfig.value.globalAddons = { electricityPerHour: 0 }
    if (!localConfig.value.fallback) localConfig.value.fallback = { mode: 'use_default' }
    // 拉一次后端的内置预设，给新模型自动套用
    if (!presetDefaults.value) {
      try {
        const resp = await fetch('/api/billing-config/defaults')
        presetDefaults.value = await resp.json()
        if (presetDefaults.value?.models) presetDefaults.value.models = safeRecordFrom(presetDefaults.value.models)
      } catch { /* 静默 */ }
    }
    // 已使用但还没有配置的模型 → 自动加上（用预设或合理默认值）
    autoAddUsedModels()
  }
})

function autoAddUsedModels() {
  if (!localConfig.value) return
  for (const modelId of usedModelIds.value) {
    if (Object.hasOwn(localConfig.value.models, modelId)) continue  // 已有
    const preset = presetForModel(modelId)
    if (preset) {
      localConfig.value.models[modelId] = JSON.parse(JSON.stringify(preset))
    } else {
      // 没预设 → 默认按 token 计费，单价 0，提示用户编辑
      localConfig.value.models[modelId] = {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '新模型自动添加，请编辑实际单价',
      }
    }
  }
}

function presetForModel(modelId: string): any {
  const models = presetDefaults.value?.models
  if (!models || typeof models !== 'object') return null
  const exact = ownValue(models, modelId)
  if (exact) return exact
  const lower = modelId.toLowerCase()
  const match = Object.keys(models)
    .sort((a, b) => b.length - a.length)
    .find((key) => {
      const normalized = key.toLowerCase()
      return lower.startsWith(`${normalized}-`) || lower.startsWith(`${normalized}:`)
    })
  return match ? ownValue(models, match) : null
}

function addModel() {
  const id = newModelId.value.trim()
  if (!id) return
  if (Object.hasOwn(localConfig.value.models, id)) {
    ElMessage.warning(`"${id}" 已存在`)
    return
  }
  const preset = presetForModel(id)
  localConfig.value.models[id] = preset ? JSON.parse(JSON.stringify(preset)) : {
    mode: 'per_token',
    inputPriceCNYPerMillion: 0,
    outputPriceCNYPerMillion: 0,
  }
  manuallyAdded.value.add(id)
  newModelId.value = ''
}

function removeModel(id: string) {
  ElMessageBox.confirm(`确定移除 "${id}" 的计费配置？`, '提示', {
    confirmButtonText: '移除',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    delete localConfig.value.models[id]
  }).catch(() => {})
}

async function restoreDefaults() {
  try {
    const resp = await fetch('/api/billing-config/defaults')
    const data = await resp.json()
    localConfig.value = JSON.parse(JSON.stringify(data))
    localConfig.value.models = safeRecordFrom(localConfig.value.models)
    if (!localConfig.value.globalAddons) localConfig.value.globalAddons = { electricityPerHour: 0 }
    autoAddUsedModels()
    ElMessage.success('已重置为内置默认值，需要点击「保存」才生效')
  } catch (e: any) {
    ElMessage.error('恢复失败：' + e.message)
  }
}

async function handleSave() {
  saving.value = true
  try {
    const result = await store.saveBillingConfig(localConfig.value)
    if (result.success) {
      await Promise.all([
        store.fetchBillingConfig(),
        store.fetchGlobalUsage(),
        store.fetchCostSummary(),
        fetchLocalUsageModels(),
      ])
      emit('saved')
      ElMessage.success('计费配置已保存')
      visible.value = false
    } else {
      ElMessage.error('保存失败：' + result.error)
    }
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.bc-intro {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--fill-subtle);
  border-radius: 8px;
}
.bc-intro b { color: var(--text-primary, #e5e5ea); }
.bc-intro .el-icon { color: #0a84ff; margin-top: 2px; flex-shrink: 0; }

.bc-empty {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 60px 0; color: var(--text-secondary, #98989d);
}

.bc-model-card {
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.bc-model-header {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}
.bc-model-id {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bc-mode-select { width: 200px; }

.bc-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}
.bc-field { display: flex; flex-direction: column; gap: 4px; }
.bc-field-full { grid-column: 1 / -1; }
.bc-field label {
  font-size: 11px;
  color: var(--text-secondary, #98989d);
  letter-spacing: 0.3px;
}
.bc-field-section {
  font-size: 12px !important;
  color: var(--text-primary, #e5e5ea) !important;
  font-weight: 600;
  margin-top: 6px;
}

.bc-fields-note {
  font-size: 12px;
  color: var(--text-secondary, #98989d);
  padding: 8px 4px;
  font-style: italic;
}

.bc-discount-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-left: 2px solid var(--warning);
  border-radius: 6px;
}
.bc-discount-label { font-size: 11px; color: var(--text-secondary); }
.bc-discount-sep { color: var(--text-secondary, #98989d); }

.bc-note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary, #98989d);
  padding: 6px 8px;
  background: var(--fill-subtle);
  border-left: 2px solid var(--border-color);
  border-radius: 0 4px 4px 0;
}

.bc-add-row {
  display: flex; gap: 10px;
  padding: 12px 0;
  margin-top: 8px;
  border-top: 1px dashed var(--border-color);
}

.bc-global-section {
  margin-top: 16px;
  padding: 12px;
  background: rgba(48, 209, 88,0.06);
  border: 1px solid rgba(48, 209, 88,0.15);
  border-radius: 8px;
}
.bc-global-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }
.bc-global-field { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-secondary); }

.bc-footer {
  display: flex; align-items: center; justify-content: space-between;
}
.bc-footer-hint { font-size: 11px; color: var(--text-secondary, #98989d); }
.bc-footer-hint code { background: var(--fill-subtle); padding: 2px 6px; border-radius: 3px; }

.bc-model-logo {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary);
  overflow: hidden;
}
.bc-model-logo img { width: 17px; height: 17px; object-fit: contain; }
.bc-logo--deepseek { background: #4d6bfe; border-color: #4d6bfe; }
.bc-logo--minimax { background: #fe5658; border-color: #fe5658; }
.bc-logo--anthropic { background: #d97757; border-color: #d97757; }
.bc-logo--openai { background: #10a37f; border-color: #10a37f; }
</style>
