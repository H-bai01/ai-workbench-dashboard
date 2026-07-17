<template>
  <button class="monitor-object-card" type="button" @click="$emit('view')">
    <span class="monitor-object-card__head">
      <span class="monitor-object-card__identity">
        <img :src="avatarSrc || sourceIconSrc" :alt="name" @error="setDefaultAvatar" />
        <span>
          <strong :title="name">{{ name }}</strong>
          <small>
            <img :src="sourceIconSrc" alt="" @error="setDefaultAvatar" />
            {{ sourceName }}
          </small>
        </span>
      </span>
      <span class="monitor-object-card__status" :class="`is-${status}`">{{ statusLabel }}</span>
    </span>

    <span v-if="project" class="monitor-object-card__project" :title="project">{{ project }}</span>

    <span class="monitor-object-card__meta">
      <span>{{ lastActivityText }}</span>
      <span class="monitor-object-card__usage">
        <strong>{{ tokenText }}</strong>
        <strong>{{ costText }}</strong>
      </span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { setDefaultAvatar } from '../utils/avatarFallback'

defineProps<{
  name: string
  sourceName: string
  sourceIconSrc: string
  avatarSrc: string
  status: 'running' | 'idle' | 'aborted' | 'error'
  statusLabel: string
  lastActivityText: string
  project?: string
  tokenText: string
  costText: string
}>()

defineEmits<{ view: [] }>()
</script>

<style scoped>
.monitor-object-card {
  width: 100%;
  min-width: 0;
  padding: 13px;
  color: #f5f5f7;
  text-align: left;
  background: #202022;
  border: 1px solid #353538;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease;
}

.monitor-object-card:hover {
  border-color: #0a84ff;
  transform: translateY(-1px);
}

.monitor-object-card__head,
.monitor-object-card__identity,
.monitor-object-card__meta,
.monitor-object-card__usage,
.monitor-object-card__identity small {
  display: flex;
  align-items: center;
}

.monitor-object-card__head,
.monitor-object-card__meta {
  justify-content: space-between;
  gap: 10px;
}

.monitor-object-card__identity {
  min-width: 0;
  gap: 10px;
}

.monitor-object-card__identity > img {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  object-fit: cover;
  border-radius: 9px;
}

.monitor-object-card__identity > span {
  min-width: 0;
}

.monitor-object-card__identity strong,
.monitor-object-card__project {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.monitor-object-card__identity small {
  gap: 5px;
  margin-top: 3px;
  color: #98989d;
}

.monitor-object-card__identity small img {
  width: 14px;
  height: 14px;
  object-fit: contain;
  border-radius: 3px;
}

.monitor-object-card__status {
  flex: 0 0 auto;
  padding: 3px 7px;
  color: #98989d;
  font-size: 11px;
  border: 1px solid currentColor;
  border-radius: 999px;
}

.monitor-object-card__status.is-running { color: #30d158; }
.monitor-object-card__status.is-idle { color: #ff9f0a; }
.monitor-object-card__status.is-aborted { color: #98989d; }
.monitor-object-card__status.is-error { color: #ff453a; }

.monitor-object-card__project {
  margin-top: 10px;
  color: #c7c7cc;
  font-size: 12px;
}

.monitor-object-card__meta {
  margin-top: 11px;
  color: #98989d;
  font-size: 11px;
}

.monitor-object-card__usage {
  flex: 0 0 auto;
  gap: 8px;
}

.monitor-object-card__usage strong:first-child { color: #0a84ff; }
.monitor-object-card__usage strong:last-child { color: #30d158; }

:global(html.light-theme) .monitor-object-card {
  color: #1d1d1f;
  background: #fff;
  border-color: #d2d2d7;
}
</style>
