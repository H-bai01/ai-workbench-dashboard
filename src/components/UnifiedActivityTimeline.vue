<template>
  <el-dialog
    v-if="!inline"
    v-model="visible"
    width="min(980px, 94vw)"
    title="AI 工具活动时间线"
    class="unified-timeline-dialog"
  >
    <TimelineContent />
  </el-dialog>
  <TimelineContent v-else />
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch } from 'vue'
import { fetchObservedSessionIndex } from '../api/session-observation'
import type { ObservedSessionIndexEntry, SessionObservationScope } from '../types/session-observation'
import { createAiToolRegistry, DEFAULT_AI_TOOLS } from '../utils/ai-tool-registry.mjs'
import { setDefaultAvatar } from '../utils/avatarFallback'

const props = defineProps<{ modelValue?: boolean; inline?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  execution: [scope: SessionObservationScope]
}>()
const visible = computed({
  get: () => props.modelValue ?? false,
  set: value => emit('update:modelValue', value),
})

const registry = createAiToolRegistry(DEFAULT_AI_TOOLS)
const RANGE_OPTIONS = [
  { hours: 24, label: '24 小时' },
  { hours: 72, label: '3 天' },
  { hours: 168, label: '7 天' },
  { hours: 720, label: '30 天' },
]
const selectedHours = ref(168)
const sessions = ref<ObservedSessionIndexEntry[]>([])
const loading = ref(false)
const error = ref('')

const visibleSessions = computed(() => {
  const since = Date.now() - selectedHours.value * 3600_000
  return sessions.value.filter(session => session.lastActivityMs >= since)
})
const sourceCount = computed(() => new Set(visibleSessions.value.map(session => session.source)).size)

function toolIcon(source: string) {
  return registry.get(source)?.iconSrc || '/avatars/default.svg'
}
function formatTime(value: number) {
  if (!value) return '未知时间'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
function openSession(session: ObservedSessionIndexEntry) {
  emit('execution', {
    source: session.source,
    displayName: `${session.clientName} · ${session.name}`,
    sessionIds: [session.sessionId],
  })
}
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await fetchObservedSessionIndex()
    sessions.value = response.sessions || []
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '活动时间线读取失败'
  } finally {
    loading.value = false
  }
}

const TimelineContent = defineComponent({
  name: 'TimelineContent',
  setup() {
    return () => h('div', { class: 'unified-timeline' }, [
      h('div', { class: 'unified-timeline__toolbar' }, [
        h('span', {}, loading.value
          ? '正在读取活动记录…'
          : `${visibleSessions.value.length} 个会话 · ${sourceCount.value} 个 AI 工具`),
        h('div', { class: 'unified-timeline__ranges' }, RANGE_OPTIONS.map(option => h('button', {
          type: 'button',
          class: { active: selectedHours.value === option.hours },
          onClick: () => { selectedHours.value = option.hours },
        }, option.label))),
        h('button', { type: 'button', onClick: refresh }, '刷新'),
      ]),
      error.value ? h('div', { class: 'unified-timeline__error' }, error.value) : null,
      !loading.value && !visibleSessions.value.length
        ? h('div', { class: 'unified-timeline__empty' }, '当前时间范围没有可读取活动')
        : h('ol', { class: 'unified-timeline__list' }, visibleSessions.value.map(session => h('li', {
          key: `${session.source}:${session.sessionId}`,
        }, [
          h('span', { class: 'unified-timeline__rail' }),
          h('button', { type: 'button', onClick: () => openSession(session) }, [
            h('img', {
              src: toolIcon(session.source),
              alt: '',
              onError: setDefaultAvatar,
            }),
            h('span', { class: 'unified-timeline__main' }, [
              h('strong', {}, session.name),
              h('small', {}, `${session.clientName} · ${session.projectPath || session.agentId || '本地会话'}`),
            ]),
            h('span', { class: 'unified-timeline__side' }, [
              h('time', {}, formatTime(session.lastActivityMs)),
              h('small', {}, session.model && session.model !== 'unknown' ? session.model : '模型未记录'),
            ]),
          ]),
        ]))),
    ])
  },
})

watch(() => props.modelValue, value => {
  if (value) void refresh()
})
onMounted(() => {
  if (props.inline) void refresh()
})
</script>

<style>
.unified-timeline { min-height: 180px; }
.unified-timeline__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: #98989d;
  font-size: 12px;
}
.unified-timeline__toolbar > span { margin-right: auto; }
.unified-timeline__ranges { display: flex; gap: 5px; }
.unified-timeline__toolbar button {
  padding: 5px 9px;
  color: #c7c7cc;
  background: #202022;
  border: 1px solid #353538;
  border-radius: 7px;
  cursor: pointer;
}
.unified-timeline__toolbar button.active { color: #fff; background: #0a84ff; border-color: #0a84ff; }
.unified-timeline__list { max-height: 520px; margin: 0; padding: 0; overflow: auto; list-style: none; }
.unified-timeline__list li { position: relative; padding-left: 20px; }
.unified-timeline__rail {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 6px;
  width: 1px;
  background: #353538;
}
.unified-timeline__rail::before {
  position: absolute;
  top: 21px;
  left: -4px;
  width: 9px;
  height: 9px;
  background: #0a84ff;
  border-radius: 50%;
  content: '';
}
.unified-timeline__list button {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  margin-bottom: 8px;
  padding: 11px 13px;
  color: #f5f5f7;
  text-align: left;
  background: #202022;
  border: 1px solid #353538;
  border-radius: 10px;
  cursor: pointer;
}
.unified-timeline__list button:hover { border-color: #0a84ff; }
.unified-timeline__list img { width: 32px; height: 32px; margin-right: 10px; object-fit: contain; border-radius: 8px; }
.unified-timeline__main { display: grid; min-width: 0; gap: 3px; }
.unified-timeline__main strong,
.unified-timeline__main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unified-timeline__main small,
.unified-timeline__side small { color: #98989d; }
.unified-timeline__side { display: grid; flex: 0 0 auto; gap: 3px; margin-left: auto; text-align: right; }
.unified-timeline__error { color: #ff453a; }
.unified-timeline__empty { padding: 48px 16px; color: #98989d; text-align: center; }
html.light-theme .unified-timeline__list button { color: #1d1d1f; background: #fff; border-color: #d2d2d7; }
@media (max-width: 700px) {
  .unified-timeline__toolbar { align-items: flex-start; flex-wrap: wrap; }
  .unified-timeline__toolbar > span { flex: 1 1 100%; }
  .unified-timeline__side small { display: none; }
}
</style>
