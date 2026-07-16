<template>
  <el-dialog
    v-model="visible"
    title="通知详情"
    width="560px"
    class="notification-detail-dialog"
    append-to-body
    destroy-on-close
  >
    <div v-if="notification" class="notification-detail">
      <div class="notification-detail-heading" :class="`is-${notification.type}`">
        <span class="notification-detail-icon" aria-hidden="true">{{ typeIcon }}</span>
        <div>
          <strong>{{ notification.agentName }}</strong>
          <span>{{ typeLabel }}</span>
        </div>
      </div>

      <dl class="notification-detail-meta">
        <template v-for="row in metadataRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>

      <section class="notification-detail-section">
        <h4>通知内容</h4>
        <p>{{ notification.message }}</p>
      </section>

      <section class="notification-detail-section">
        <h4>详细信息</h4>
        <p>{{ notification.detail || '暂无更多详细信息' }}</p>
      </section>

      <section v-if="notification.impact" class="notification-detail-section">
        <h4>影响范围</h4>
        <p>{{ notification.impact }}</p>
      </section>

      <section v-if="notification.currentResult" class="notification-detail-section">
        <h4>当前结果</h4>
        <p>{{ notification.currentResult }}</p>
      </section>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button
        v-if="notification?.retryAction"
        type="primary"
        :loading="retrying"
        @click="emit('retry', notification)"
      >
        重试
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { NotificationItem } from '../utils/notification-center.mjs'

const props = defineProps<{
  modelValue: boolean
  notification: NotificationItem | null
  retrying?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  retry: [notification: NotificationItem]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const typeLabel = computed(() => {
  if (props.notification?.type === 'error') return '错误'
  if (props.notification?.type === 'aborted') return '警告'
  return '信息'
})

const typeIcon = computed(() => {
  if (props.notification?.type === 'error') return '!'
  if (props.notification?.type === 'aborted') return '-'
  return 'i'
})

const metadataRows = computed(() => {
  const notification = props.notification
  if (!notification) return []
  const rows = [
    { label: '发生时间', value: new Date(notification.timestamp).toLocaleString('zh-CN', { hour12: false }) },
    { label: '来源', value: notification.source || notification.agentName },
    { label: '状态', value: typeLabel.value },
  ]
  if (notification.errorCode) rows.push({ label: '错误代码', value: notification.errorCode })
  if (notification.httpStatus) rows.push({ label: 'HTTP 状态', value: String(notification.httpStatus) })
  if (notification.timeRange) rows.push({ label: '时间范围', value: notification.timeRange })
  return rows
})
</script>

<style scoped>
.notification-detail {
  display: grid;
  gap: 14px;
}

.notification-detail-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid rgba(10, 132, 255, 0.22);
  border-radius: 10px;
  background: rgba(10, 132, 255, 0.07);
}

.notification-detail-heading.is-error {
  border-color: rgba(255, 69, 58, 0.28);
  background: rgba(255, 69, 58, 0.08);
}

.notification-detail-heading.is-aborted {
  border-color: rgba(255, 159, 10, 0.28);
  background: rgba(255, 159, 10, 0.08);
}

.notification-detail-heading > div {
  display: grid;
  gap: 3px;
}

.notification-detail-heading strong {
  color: var(--text-primary, #f5f5f7);
  font-size: 15px;
}

.notification-detail-heading span:not(.notification-detail-icon) {
  color: var(--text-secondary, #98989d);
  font-size: 12px;
}

.notification-detail-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 50%;
  background: rgba(10, 132, 255, 0.18);
  color: #64a8ff;
  font-weight: 800;
}

.is-error .notification-detail-icon {
  background: rgba(255, 69, 58, 0.18);
  color: #ff6961;
}

.is-aborted .notification-detail-icon {
  background: rgba(255, 159, 10, 0.18);
  color: #ffb340;
}

.notification-detail-meta {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--border-color, rgba(235, 235, 245, 0.12));
  border-radius: 10px;
}

.notification-detail-meta dt,
.notification-detail-meta dd {
  margin: 0;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border-color, rgba(235, 235, 245, 0.08));
  font-size: 12px;
}

.notification-detail-meta dt:nth-last-of-type(1),
.notification-detail-meta dd:last-child {
  border-bottom: 0;
}

.notification-detail-meta dt {
  color: var(--text-secondary, #98989d);
  background: rgba(255, 255, 255, 0.025);
}

.notification-detail-meta dd {
  min-width: 0;
  color: var(--text-primary, #f5f5f7);
  overflow-wrap: anywhere;
}

.notification-detail-section {
  padding: 12px 14px;
  border: 1px solid var(--border-color, rgba(235, 235, 245, 0.1));
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
}

.notification-detail-section h4 {
  margin: 0 0 6px;
  color: var(--text-secondary, #98989d);
  font-size: 11px;
  font-weight: 700;
}

.notification-detail-section p {
  margin: 0;
  color: var(--text-primary, #f5f5f7);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
