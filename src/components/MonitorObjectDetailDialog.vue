<template>
  <el-dialog
    v-model="visible"
    width="min(720px, 94vw)"
    class="monitor-detail-dialog"
    :close-on-click-modal="true"
    destroy-on-close
  >
    <template #header>
      <div class="monitor-detail-title">
        <img :src="object?.avatarSrc || object?.sourceIconSrc" :alt="object?.name || ''" @error="setDefaultAvatar" />
        <div>
          <span>{{ object?.sourceName || 'AI 工具' }}</span>
          <strong>{{ object?.name || '监控对象' }}</strong>
        </div>
      </div>
    </template>

    <div v-if="object" class="monitor-detail-body">
      <div class="monitor-detail-status">
        <span :class="`is-${object.monitorStatus}`">{{ object.statusLabel }}</span>
        <span>{{ object.lastActivityText }}</span>
      </div>

      <dl>
        <div>
          <dt>来源工具</dt>
          <dd><img :src="object.sourceIconSrc" alt="" @error="setDefaultAvatar" />{{ object.sourceName }}</dd>
        </div>
        <div v-if="object.project">
          <dt>项目或工作目录</dt>
          <dd :title="object.project">{{ object.project }}</dd>
        </div>
        <div>
          <dt>Token</dt>
          <dd class="is-token">{{ object.tokenText }}</dd>
        </div>
        <div>
          <dt>API 等价费用</dt>
          <dd class="is-cost">{{ object.costText }}</dd>
        </div>
      </dl>

      <div class="monitor-detail-actions">
        <el-button type="primary" @click="$emit('execution')">查看执行记录</el-button>
        <el-button @click="$emit('usage')">查看用量详情</el-button>
        <el-button v-if="object.hasSpecializedDetail" @click="$emit('specialized')">打开工具专属详情</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { setDefaultAvatar } from '../utils/avatarFallback'

interface MonitorDetailObject {
  name: string
  sourceName: string
  sourceIconSrc: string
  avatarSrc: string
  monitorStatus: 'running' | 'idle' | 'aborted' | 'error'
  statusLabel: string
  lastActivityText: string
  project?: string
  tokenText: string
  costText: string
  hasSpecializedDetail: boolean
}

defineProps<{ object: MonitorDetailObject | null }>()
const visible = defineModel<boolean>('visible', { default: false })
defineEmits<{ execution: []; usage: []; specialized: [] }>()
</script>

<style scoped>
.monitor-detail-title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.monitor-detail-title > img {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 12px;
}
.monitor-detail-title div { display: grid; gap: 3px; }
.monitor-detail-title span { color: #98989d; font-size: 12px; }
.monitor-detail-title strong { color: #f5f5f7; font-size: 20px; }
.monitor-detail-body { padding: 4px 2px 8px; }
.monitor-detail-status {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #98989d;
  font-size: 13px;
}
.monitor-detail-status span:first-child {
  padding: 4px 9px;
  border: 1px solid currentColor;
  border-radius: 999px;
}
.monitor-detail-status .is-running { color: #30d158; }
.monitor-detail-status .is-idle { color: #ff9f0a; }
.monitor-detail-status .is-aborted { color: #98989d; }
.monitor-detail-status .is-error { color: #ff453a; }
dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 18px 0;
}
dl > div {
  min-width: 0;
  padding: 13px;
  background: #202022;
  border: 1px solid #353538;
  border-radius: 10px;
}
dt { color: #98989d; font-size: 12px; }
dd {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin: 7px 0 0;
  overflow: hidden;
  color: #f5f5f7;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
dd img { width: 18px; height: 18px; object-fit: contain; border-radius: 4px; }
dd.is-token { color: #0a84ff; }
dd.is-cost { color: #30d158; }
.monitor-detail-actions { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 620px) { dl { grid-template-columns: 1fr; } }
:global(html.light-theme) .monitor-detail-title strong,
:global(html.light-theme) dd { color: #1d1d1f; }
:global(html.light-theme) dl > div { background: #fff; border-color: #d2d2d7; }
</style>
