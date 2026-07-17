<template>
  <el-dialog
    v-model="visible"
    width="min(940px, 94vw)"
    class="tool-management-dialog"
    append-to-body
    destroy-on-close
  >
    <template #header>
      <div class="tool-management-head">
        <div>
          <span>统一能力入口</span>
          <h2>{{ focusedAction?.label || 'AI 工具管理' }}</h2>
        </div>
        <p>{{ focusedAction?.description || '每个工具只显示自身真实支持的功能。' }}</p>
      </div>
    </template>

    <div v-if="visibleTools.length" class="tool-management-list">
      <section v-for="tool in visibleTools" :key="tool.id" class="tool-management-group">
        <header>
          <img :src="tool.iconSrc" :alt="tool.name" @error="setDefaultAvatar" />
          <div>
            <strong>{{ tool.name }}</strong>
            <span>{{ tool.objectLabel }}</span>
          </div>
        </header>
        <div class="tool-management-actions">
          <button
            v-for="action in actionsFor(tool)"
            :key="action.id"
            type="button"
            @click="$emit('action', tool.id, action.id)"
          >
            <strong>{{ action.label }}</strong>
            <span>{{ action.description }}</span>
          </button>
        </div>
      </section>
    </div>
    <el-empty v-else description="当前没有工具提供这项能力" :image-size="72" />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AiToolDescriptor } from '../utils/ai-tool-registry.mjs'
import {
  buildAiToolManagementActions,
  getAiToolManagementAction,
  type AiToolManagementActionId,
} from '../utils/ai-tool-actions.mjs'
import { setDefaultAvatar } from '../utils/avatarFallback'

const props = defineProps<{
  tools: readonly AiToolDescriptor[]
  focusAction?: AiToolManagementActionId | null
}>()
const visible = defineModel<boolean>('visible', { default: false })
defineEmits<{
  action: [toolId: string, actionId: AiToolManagementActionId]
}>()

const focusedAction = computed(() => (
  props.focusAction ? getAiToolManagementAction(props.focusAction) : undefined
))

function actionsFor(tool: AiToolDescriptor) {
  const actions = buildAiToolManagementActions(tool)
  return props.focusAction
    ? actions.filter(action => action.id === props.focusAction)
    : actions
}

const visibleTools = computed(() => (
  props.tools.filter(tool => actionsFor(tool).length > 0)
))
</script>

<style scoped>
.tool-management-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
.tool-management-head span,
.tool-management-head p {
  color: #98989d;
  font-size: 12px;
}
.tool-management-head h2 { margin: 3px 0 0; color: #f5f5f7; font-size: 22px; }
.tool-management-head p { max-width: 360px; margin: 0; text-align: right; }
.tool-management-list { display: grid; gap: 12px; }
.tool-management-group {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 14px;
  padding: 14px;
  border: 1px solid #353538;
  border-radius: 12px;
  background: #1d1d1f;
}
.tool-management-group > header {
  display: flex;
  align-items: center;
  gap: 11px;
}
.tool-management-group img {
  width: 42px;
  height: 42px;
  object-fit: contain;
  border-radius: 10px;
}
.tool-management-group header div { display: grid; gap: 3px; }
.tool-management-group header strong { color: #f5f5f7; font-size: 16px; }
.tool-management-group header span { color: #98989d; font-size: 12px; }
.tool-management-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.tool-management-actions button {
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid #3a3a3c;
  border-radius: 9px;
  background: #27272a;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.tool-management-actions button:hover { border-color: #0a84ff; background: #1b2a3b; }
.tool-management-actions strong,
.tool-management-actions span { display: block; }
.tool-management-actions strong { color: #f5f5f7; font-size: 13px; }
.tool-management-actions span {
  margin-top: 4px;
  overflow: hidden;
  color: #98989d;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 760px) {
  .tool-management-head { align-items: flex-start; flex-direction: column; }
  .tool-management-head p { text-align: left; }
  .tool-management-group { grid-template-columns: 1fr; }
  .tool-management-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 480px) {
  .tool-management-actions { grid-template-columns: 1fr; }
}
:global(html.light-theme) .tool-management-head h2,
:global(html.light-theme) .tool-management-group header strong,
:global(html.light-theme) .tool-management-actions strong { color: #1d1d1f; }
:global(html.light-theme) .tool-management-group { border-color: #d2d2d7; background: #fff; }
:global(html.light-theme) .tool-management-actions button { border-color: #d2d2d7; background: #f5f5f7; }
</style>
