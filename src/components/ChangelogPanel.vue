<template>
  <!-- 内嵌版本历史面板（Changelog Panel — 版本迭代说明） -->
  <div class="cl-panel">
    <!-- 顶部工具栏 -->
    <div class="cl-toolbar">
      <div class="cl-toolbar-left">
        <span class="cl-count">2.x 版本记录</span>
        <span class="cl-range">当前体系：Workbench 2.x · 最新：{{ versions[0]?.date || '-' }}</span>
        <span class="cl-version-rule">规则：大版本.新功能.优化</span>
      </div>
      <div class="cl-toolbar-right">
        <button class="cl-btn cl-btn-share" @click="copyShare" :disabled="!selected" title="复制选中版本的介绍 + 部署链接，发给别人即可部署该版本">
          分享此版本
        </button>
        <button class="cl-btn cl-btn-ghost" @click="fetchGitVersions" :disabled="loadingGitVersions" title="刷新可回退版本">
          <span v-if="loadingGitVersions" class="cl-spin">刷新中</span>
          <span v-else>可回退（{{ rollbackableCount }}）</span>
        </button>
        <button class="cl-btn cl-btn-ghost" @click="load" title="刷新版本列表">刷新</button>
      </div>
    </div>

    <!-- 主内容：左侧版本列表 + 右侧功能详情 -->
    <div class="cl-body">
      <!-- 左侧版本时间线 -->
      <div class="cl-sidebar">
        <div
          v-for="v in versions"
          :key="v.version"
          class="cl-version-item"
          :class="{ active: selected?.version === v.version, current: isCurrentEntry(v), rollbackable: canRollbackEntry(v) }"
          @click="selected = v"
        >
          <span class="cl-ver-dot" :class="isCurrentEntry(v) ? 'dot-current' : canRollbackEntry(v) ? 'dot-rollback' : 'dot-normal'"></span>
          <div class="cl-ver-main">
            <div class="cl-ver-top">
              <span class="cl-ver-num">v{{ v.version }}</span>
              <span v-if="isCurrentEntry(v)" class="cl-ver-badge">当前</span>
              <span v-else-if="canRollbackEntry(v)" class="cl-ver-badge cl-ver-rollbackable">可回退</span>
            </div>
            <div class="cl-ver-sub">
              <span v-if="v.channel === 'beta'" class="cl-ver-beta">内测</span>
              <span class="cl-ver-tag">{{ v.tag }}</span>
            </div>
            <span class="cl-ver-date">{{ v.date }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧版本详情 -->
      <div class="cl-detail" v-if="selected">
        <div class="cl-detail-header">
          <div class="cl-detail-title-wrap">
            <h3 class="cl-detail-title">v{{ selected.version }} · {{ selected.summary }}</h3>
            <div class="cl-detail-meta">
              <el-tag size="small" :type="selected.channel === 'beta' ? 'warning' : 'success'" effect="dark">{{ selected.channel === 'beta' ? '内测版 Beta' : '正式版' }}</el-tag>
              <el-tag size="small" type="info" effect="plain">{{ selected.tag }}</el-tag>
              <span class="cl-detail-date">{{ selected.date }}</span>
              <el-tag v-if="selectedIsCurrent" size="small" type="success" effect="light">当前版本</el-tag>
              <el-tag v-else-if="selectedGitVersion" size="small" type="warning" effect="plain">支持 git 回退</el-tag>
              <el-tag v-else size="small" type="info" effect="plain">暂无 git 标签</el-tag>
            </div>
          </div>
        </div>

        <ul class="cl-feature-list">
          <li v-for="(f, i) in selected.features" :key="i" class="cl-feature-item">
            <span class="cl-feature-dot"></span>
            <span class="cl-feature-text">{{ f }}</span>
          </li>
        </ul>

        <!-- 该版本对应的功能截图 -->
        <figure v-if="selected.image" class="cl-feature-shot">
          <img :src="selected.image" :alt="`v${selected.version} ${selected.summary}`" loading="lazy" />
          <figcaption>v{{ selected.version }} · {{ selected.tag }}</figcaption>
        </figure>

        <!-- 版本回退（Rollback）区域 -->
        <div v-if="!selectedIsCurrent" class="cl-rollback-section">
          <div class="cl-rollback-header">
            <span class="cl-rollback-title">版本回退</span>
            <span class="cl-rollback-hint">只有已经纳入 git 标签的版本支持一键回退</span>
          </div>

          <div v-if="loadingGitVersions" class="cl-rollback-loading">
            <span class="cl-spin">检查中</span> 正在检查 git 版本...
          </div>

          <div v-else-if="selectedGitVersion" class="cl-git-rollback-card">
            <div class="cl-git-rollback-info">
              <span class="cl-git-tag">{{ selectedGitVersion.version }}</span>
              <span class="cl-git-date">{{ selectedGitVersion.date || selected.date }}</span>
              <span class="cl-git-message">{{ selectedGitVersion.message || selected.summary }}</span>
            </div>
            <button
              class="cl-btn cl-btn-rollback"
              :disabled="rollingBack === selectedGitVersion.version"
              @click="rollbackToGitVersion(selectedGitVersion.version)"
            >
              {{ rollingBack === selectedGitVersion.version ? '回退中...' : '回退到此版本' }}
            </button>
          </div>

          <div v-else class="cl-no-backup">
            <span>此版本未纳入 git，暂不支持回退</span>
            <span class="cl-no-backup-hint">只有打过 git 标签的版本才会显示可用回退按钮</span>
          </div>
        </div>

        <!-- 当前版本提示 -->
        <div v-else class="cl-current-hint">
          <span>这是当前运行版本，无需回退</span>
          <span class="cl-current-sub">当前 git 标签：{{ selectedGitVersion?.version || `v${selected.version}` }}</span>
        </div>
      </div>

      <!-- 右侧空状态 -->
      <div class="cl-detail cl-detail-empty" v-else>
        <span class="cl-empty-text">点击左侧版本查看详情</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dashboardPublicConfig } from '../config/public'
import CHANGELOG from '../changelog.json'

// ── 版本数据（Changelog Data）──
interface VersionEntry {
  version: string
  date: string
  tag: string
  summary: string
  features: string[]
  image?: string
  channel?: 'stable' | 'beta'
}

// ── git 可回退版本（Git Version Tag）──
interface GitVersion {
  version: string
  date: string
  message: string
  isCurrent: boolean
}

const versions = ref<VersionEntry[]>(CHANGELOG.versions as VersionEntry[])
const selected = ref<VersionEntry | null>(versions.value[0] || null)
const currentVersion = ref<string>('')
const gitVersions = ref<GitVersion[]>([])
const loadingGitVersions = ref(false)
const rollingBack = ref<string | null>(null)

const gitVersionMap = computed(() => {
  const map = new Map<string, GitVersion>()
  for (const item of gitVersions.value) map.set(item.version, item)
  return map
})

const selectedGitVersion = computed(() => {
  if (!selected.value) return null
  return gitVersionForEntry(selected.value)
})

const selectedIsCurrent = computed(() => {
  if (!selected.value) return false
  return isCurrentEntry(selected.value)
})

const rollbackableCount = computed(() => {
  return versions.value.filter(v => canRollbackEntry(v)).length
})

function gitTagForVersion(version: string) {
  return version.startsWith('v') ? version : `v${version}`
}

function gitVersionForEntry(entry: VersionEntry) {
  return gitVersionMap.value.get(gitTagForVersion(entry.version)) || null
}

function isCurrentEntry(entry: VersionEntry) {
  if (currentVersion.value) return currentVersion.value === entry.version
  const gitVersion = gitVersionForEntry(entry)
  return Boolean(gitVersion?.isCurrent)
}

function canRollbackEntry(entry: VersionEntry) {
  const gitVersion = gitVersionForEntry(entry)
  return Boolean(gitVersion && !gitVersion.isCurrent && !isCurrentEntry(entry))
}

// 复制「当前选中版本」的分享内容（介绍 + 该版本功能 + 该版本部署链接），粘贴给别人即可部署对应版本
// 仓库地址来自服务端公开配置白名单，不读取浏览器环境变量。
function copyShare() {
  const v = selected.value
  if (!v) return
  const repo = dashboardPublicConfig.shareRepoUrl
  if (!repo) {
    ElMessage.warning('尚未配置公开仓库地址，暂时无法生成可用的分享链接')
    return
  }
  const channel = v.channel === 'beta' ? '内测版' : '正式版'
  const feats = (v.features || []).map((f) => '· ' + f).join('\n')
  const text = `AI 工作台总控 · v${v.version}（${channel}）—— 本地 AI 工具与多 Agent 可视化管理工作台
${v.summary}

本版功能：
${feats}

下载部署：${repo}/releases/tag/v${v.version}
（下载源码包 → npm install → 复制 .env.example 为 .env 填配置 → npm run start:v2）`
  navigator.clipboard.writeText(text).then(
    () => ElMessage.success(`已复制 v${v.version} 的分享内容，直接粘贴给别人`),
    () => ElMessage.error('复制失败，请检查浏览器剪贴板权限，或手动复制'),
  )
}

// 加载当前 package.json 版本号
async function load() {
  try {
    // 从 APP_VERSION 全局变量获取当前版本（vite define 注入）
    if (typeof __APP_VERSION__ !== 'undefined') {
      currentVersion.value = __APP_VERSION__
    }
  } catch {
    currentVersion.value = ''
  }
  await fetchGitVersions()
}

// 获取 git 标签版本列表
async function fetchGitVersions() {
  loadingGitVersions.value = true
  try {
    const resp = await fetch('/api/system/git-versions')
    if (resp.ok) {
      const data = await resp.json()
      gitVersions.value = (data.versions || []) as GitVersion[]
      if (data.error) ElMessage.warning(`读取 git 版本失败：${data.error}`)
    } else {
      ElMessage.warning('读取可回退版本失败')
    }
  } catch (error) {
    ElMessage.warning(`读取可回退版本失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    loadingGitVersions.value = false
  }
}

// 执行 git 回退（Git Rollback）
async function rollbackToGitVersion(version: string) {
  try {
    await ElMessageBox.confirm(
      `确定回退到 ${version}？\n\n系统会先自动存档当前状态，回退后仍可再切回更新的版本。`,
      '确认版本回退',
      {
        confirmButtonText: '确认回退',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    rollingBack.value = version
    const resp = await fetch('/api/system/git-rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    })
    const result = await resp.json()
    if (result.ok) {
      if (result.backendRestartRecommended) {
        await ElMessageBox.alert(
          '回退成功。\n\n请重启一次工作台服务后刷新页面，回退才完全生效。\n\n注意：旧版本可能没有此回退按钮，若之后需要回到最新版本，可能需要技术协助。',
          '回退成功',
          {
            confirmButtonText: '知道了',
            type: 'success',
          }
        )
      } else {
        ElMessage.success('回退成功。')
      }
      await fetchGitVersions()
    } else {
      ElMessage.error(result.error || '回退失败，请检查后端日志')
    }
  } catch (e: unknown) {
    if (e !== 'cancel' && e !== 'close') {
      ElMessage.error('回退请求失败')
    }
  } finally {
    rollingBack.value = null
  }
}

onMounted(load)

// 声明 vite 注入的全局变量（TypeScript 类型）
declare const __APP_VERSION__: string
</script>

<style scoped>
.cl-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: transparent;
}

/* ── 工具栏 ── */
.cl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px 8px;
  border-bottom: 1px solid var(--glass-card-border);
}
.cl-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
.cl-count { font-weight: 600; color: var(--text-primary); }
.cl-range { opacity: 0.75; }
.cl-version-rule {
  color: var(--text-secondary);
  opacity: 0.62;
  white-space: nowrap;
}
.cl-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── 按钮 ── */
.cl-btn {
  border: 1px solid var(--glass-card-border);
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
  transition: all 0.15s;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  box-shadow: inset 0 1px 0 var(--glass-inner-highlight);
}
.cl-btn:hover { background: rgba(10, 132, 255, 0.13); color: var(--text-primary); border-color: rgba(10, 132, 255, 0.30); }
.cl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cl-btn-ghost { background: rgba(255, 255, 255, 0.045); border: 1px solid var(--glass-card-border); }
.cl-btn-share {
  background: rgba(10, 132, 255, 0.14);
  border: 1px solid rgba(10, 132, 255, 0.32);
  color: #0a84ff;
  font-weight: 600;
}
.cl-btn-share:hover { background: rgba(10, 132, 255, 0.22); border-color: #0a84ff; }
.cl-btn-share:disabled { opacity: 0.4; cursor: not-allowed; }
.cl-btn-rollback {
  background: rgba(255, 159, 10, 0.1);
  border: 1px solid rgba(255, 159, 10, 0.3);
  color: #ff9f0a;
  font-size: 11px;
  padding: 3px 10px;
  white-space: nowrap;
}
.cl-btn-rollback:hover {
  background: rgba(255, 159, 10, 0.2);
  border-color: #ff9f0a;
}

/* ── 主体 ── */
.cl-body {
  display: flex;
  gap: 0;
  min-height: 280px;
  max-height: 380px;
}

/* ── 左侧版本列表 ── */
.cl-sidebar {
  width: 200px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--glass-card-border);
  padding: 8px 0;
}
.cl-sidebar::-webkit-scrollbar { width: 4px; }
.cl-sidebar::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
.cl-sidebar::-webkit-scrollbar-track { background: transparent; }

.cl-version-item {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: all 0.15s;
  position: relative;
}
.cl-version-item:hover { background: rgba(255, 255, 255, 0.06); }
.cl-version-item.active {
  background: rgba(10, 132, 255, 0.12);
  border-left-color: #0a84ff;
}
.cl-version-item.current .cl-ver-num { color: #30d158; }

.cl-ver-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
}
.dot-current { background: #30d158; box-shadow: 0 0 5px rgba(48, 209, 88,0.5); }
.dot-rollback { background: #ff9f0a; box-shadow: 0 0 5px rgba(255, 159, 10, 0.45); }
.dot-normal { background: rgba(235, 235, 245, 0.30); }

/* 主体：纵向三行 —— 版本号行 / 标签+标题行 / 日期 */
.cl-ver-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.cl-ver-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cl-ver-num {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}
.cl-ver-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cl-ver-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(48, 209, 88,0.15);
  color: #30d158;
  border: 1px solid rgba(48, 209, 88,0.3);
  white-space: nowrap;
}
.cl-ver-rollbackable {
  background: rgba(255, 159, 10, 0.15);
  color: #ff9f0a;
  border-color: rgba(255, 159, 10, 0.3);
}
.cl-ver-beta {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 159, 10, 0.15);
  color: #ff9f0a;
  border: 1px solid rgba(255, 159, 10, 0.3);
  white-space: nowrap;
  flex-shrink: 0;
}
.cl-ver-tag {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cl-ver-date {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.6;
}
/* ── 右侧详情 ── */
.cl-detail {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px;
  min-width: 0;
}
.cl-detail::-webkit-scrollbar { width: 4px; }
.cl-detail::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
.cl-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
  opacity: 0.5;
}
.cl-empty-icon { font-size: 28px; }
.cl-empty-text { font-size: 13px; }

.cl-detail-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--glass-card-border);
}
.cl-detail-title-wrap { flex: 1; min-width: 0; }
.cl-detail-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
  line-height: 1.4;
}
.cl-detail-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cl-detail-date { font-size: 12px; color: var(--text-secondary); }

/* ── 功能列表 ── */
.cl-feature-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.cl-feature-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
}
.cl-feature-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0a84ff;
  flex-shrink: 0;
  margin-top: 8px;
}
.cl-feature-text { flex: 1; }

/* ── 功能截图 ── */
.cl-feature-shot {
  margin: 0 0 16px;
}
.cl-feature-shot img {
  display: block;
  width: 100%;
  border-radius: 10px;
  border: 1px solid var(--glass-card-border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.cl-feature-shot figcaption {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.7;
  text-align: center;
}
:global(html.light-theme) .cl-feature-shot img {
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}

/* ── 回退区域 ── */
.cl-rollback-section {
  background: rgba(255, 159, 10, 0.08);
  border: 1px solid rgba(255, 159, 10, 0.18);
  border-radius: 12px;
  padding: 12px;
  margin-top: 4px;
}
.cl-rollback-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cl-rollback-title { font-size: 13px; font-weight: 600; color: #ff9f0a; }
.cl-rollback-hint { font-size: 11px; color: var(--text-secondary); flex: 1; }

.cl-rollback-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 6px 0;
}
.cl-no-backup {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 4px 0;
}
.cl-no-backup-hint { font-size: 11px; opacity: 0.7; }

.cl-git-rollback-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid var(--glass-card-border);
  border-radius: 10px;
  box-shadow: inset 0 1px 0 var(--glass-inner-highlight);
}
.cl-git-rollback-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
}
.cl-git-tag {
  font-weight: 700;
  color: #ff9f0a;
  white-space: nowrap;
}
.cl-git-date {
  color: var(--text-secondary);
  white-space: nowrap;
}
.cl-git-message {
  color: var(--text-secondary);
  opacity: 0.72;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 当前版本提示 */
.cl-current-hint {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: rgba(48, 209, 88,0.06);
  border: 1px solid rgba(48, 209, 88,0.15);
  border-radius: 12px;
  font-size: 13px;
  color: #30d158;
}
.cl-current-sub { font-size: 11px; color: var(--text-secondary); }

:global(html.light-theme .cl-btn) {
  background: rgba(255, 255, 255, 0.62);
  border-color: rgba(60, 60, 67, 0.12);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255,255,255,0.85);
}

:global(html.light-theme .cl-version-item:hover) {
  background: rgba(10, 132, 255, 0.07);
}

:global(html.light-theme .cl-version-item.active) {
  background: rgba(10, 132, 255, 0.10);
}

/* ── 旋转动画 ── */
.cl-spin {
  display: inline-block;
  animation: cl-rotate 1s linear infinite;
}
@keyframes cl-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
