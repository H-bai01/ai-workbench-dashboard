<template>
  <el-dialog
    top="4vh"
    v-model="dialogVisible"
    title="OpenClaw 版本管理"
    width="860px"
    :close-on-click-modal="false"
    destroy-on-close
    class="version-dialog"
    :modal-class="'version-dialog-modal'"
  >
    <div class="dialog-header">
      <el-button type="primary" :icon="Refresh" :loading="syncing" @click="handleSync">
        同步版本
      </el-button>
      <span v-if="lastSync" class="last-sync">上次同步：{{ formatLocalTime(lastSync) }}</span>
      <span v-else class="last-sync">尚未同步</span>
    </div>

    <!-- 版本切换进度提示 -->
    <div v-if="switching" class="switch-progress-bar">
      <el-icon class="is-loading" :size="16"><Loading /></el-icon>
      <span class="switch-progress-text">{{ switchProgress || '正在切换版本...' }}</span>
    </div>

    <el-table
      ref="tableRef"
      :data="versions"
      v-loading="loading"
      :height="tableMaxHeight"
      empty-text="暂无版本数据"
      :header-cell-style="{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }"
    >
      <el-table-column prop="version" label="版本号" min-width="180">
        <template #default="{ row }">
          <span class="version-cell version-click" :title="row.version" @click="handleVersionClick(row)">{{ row.version }}
          </span>
        </template>
      </el-table-column>

      <el-table-column prop="publishedAt" label="发布时间" width="170">
        <template #default="{ row }">
          {{ formatDate(row.publishedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" align="center" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.version === props.currentVersion"
            size="small"
            disabled
            type="primary"
          >
            当前版本
          </el-button>
          <el-button
            v-else
            size="small"
            type="primary"
            :loading="switching === row.version"
            :disabled="switching !== null"
            @click="handleSwitch(row.version)"
          >
            {{ switching === row.version ? '切换中...' : '切换' }}
          </el-button>
        </template>
      </el-table-column>

      <!-- 加载更多指示器（放在表格内部 append 插槽） -->
      <template #append>
        <div v-if="!loading && versions.length > 0" class="load-more-footer">
          <span v-if="moreLoading" class="loading-more">
            <el-icon class="is-loading" :size="14"><Loading /></el-icon>
            加载中...
          </span>
          <span v-else-if="!hasMore" class="no-more">没有更多数据了</span>
        </div>
      </template>
    </el-table>

    <!-- 版本详情弹框 -->
    <el-dialog
      append-to-body
      v-model="detailVisible"
      :title="selectedVersion?.version ?? ''"
      width="600px"
      top="5vh"
      :close-on-click-modal="false"
      destroy-on-close
      class="version-detail-dialog"
      :modal-class="'version-dialog-modal'"
    >
      <div v-if="selectedVersion" class="detail-content-wrapper">
        <div class="detail-content">
          <div class="detail-meta">
            <span class="detail-meta-item">发布时间：{{ formatDate(selectedVersion.publishedAt) }}</span>
            <button class="detail-original-toggle" type="button" @click="detailShowOriginal = !detailShowOriginal">
              {{ detailShowOriginal ? '查看中文整理' : '查看原文' }}
            </button>
          </div>
          <div v-if="!detailShowOriginal" class="detail-cn">
            <section class="detail-section detail-section-major">
              <h3>重大更新</h3>
              <ul v-if="versionDetailSections.major.length">
                <li v-for="(item, index) in versionDetailSections.major" :key="`major-${index}`">{{ item }}</li>
              </ul>
              <p v-else class="no-description">本版本没有单独标出的重大更新。</p>
            </section>
            <section class="detail-section detail-section-fix">
              <h3>修复更新</h3>
              <ul v-if="versionDetailSections.fixes.length">
                <li v-for="(item, index) in versionDetailSections.fixes" :key="`fix-${index}`">{{ item }}</li>
              </ul>
              <p v-else class="no-description">本版本没有单独标出的修复项。</p>
            </section>
          </div>
          <div v-else class="detail-description" v-html="renderedDescription"></div>
        </div>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="detailVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { Refresh, Loading } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getVersions, syncVersions, switchVersion, type VersionInfo } from '../api/version-manager'
import { marked } from 'marked'
import { renderSafeMarkdown } from '../utils/safe-content.mjs'

marked.setOptions({ breaks: true })

const props = withDefaults(defineProps<{
  visible: boolean
  currentVersion?: string
}>(), {
  currentVersion: ''
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

const versions = ref<VersionInfo[]>([])
const loading = ref(false)
const moreLoading = ref(false)
const syncing = ref(false)
const switching = ref<string | null>(null)
const switchProgress = ref('')
const lastSync = ref<string | null>(null)
const currentPage = ref(1)
const pageSize = 10
const hasMore = ref(true)
const tableRef = ref()
const tableMaxHeight = ref(500)
let scrollTimer: ReturnType<typeof setTimeout> | null = null
let tableBodyWrapper: HTMLElement | null = null

// 版本详情弹框状态
const detailVisible = ref(false)
const selectedVersion = ref<VersionInfo | null>(null)
const detailShowOriginal = ref(false)
const renderedDescription = computed(() => {
  if (!selectedVersion.value?.description) return '<p class="no-description">暂无版本说明</p>'
  return renderSafeMarkdown(selectedVersion.value.description, source => marked.parse(source, { async: false }) as string)
})
const versionDetailSections = computed(() => buildVersionDetailSections(selectedVersion.value?.description || ''))

// 计算表格高度
function calculateTableHeight(): void {
  const dialog = document.querySelector('.version-dialog .el-dialog__body')
  if (!dialog) {
    tableMaxHeight.value = 500
    return
  }
  const bodyHeight = (dialog as HTMLElement).clientHeight
  // 减去 dialog-header(约 40px)、padding(上下 40px)、底部加载更多(40px)
  tableMaxHeight.value = Math.max(250, bodyHeight - 40 - 40 - 40)
}

// 表格滚动事件：触底加载下一页
function handleTableScroll(e: Event): void {
  if (scrollTimer !== null) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    const target = e.target as HTMLElement
    if (!target) return
    const scrollTop = target.scrollTop
    const scrollHeight = target.scrollHeight
    const clientHeight = target.clientHeight
    // 距底部 80px 时触发加载
    if (scrollTop + clientHeight >= scrollHeight - 80) {
      loadMoreVersions()
    }
    scrollTimer = null
  }, 150)
}

// 加载第一页
async function loadVersions(): Promise<void> {
  loading.value = true
  versions.value = []
  currentPage.value = 1
  hasMore.value = true
  try {
    const data = await getVersions(1, pageSize)
    versions.value = data.versions || []
    lastSync.value = data.lastSync
    hasMore.value = (data.total || 0) > pageSize
  } catch {
    ElMessage.error('获取版本列表失败')
  } finally {
    loading.value = false
  }
}

// 加载更多（追加）
async function loadMoreVersions(): Promise<void> {
  if (moreLoading.value || !hasMore.value || loading.value) return
  moreLoading.value = true
  currentPage.value += 1
  try {
    const data = await getVersions(currentPage.value, pageSize)
    if (data.versions && data.versions.length > 0) {
      versions.value = [...versions.value, ...data.versions]
      hasMore.value = (data.total || 0) > versions.value.length
    } else {
      hasMore.value = false
      currentPage.value -= 1
    }
  } catch {
    ElMessage.error('加载更多版本失败')
    currentPage.value -= 1
  } finally {
    moreLoading.value = false
  }
}

async function handleSync(): Promise<void> {
  syncing.value = true
  try {
    const result = await syncVersions()
    if (result.success) {
      ElMessage.success(`同步成功，共 ${result.count} 个版本（来源：${result.source}）`)
      await loadVersions()
    } else {
      ElMessage.error('同步失败')
    }
  } catch {
    ElMessage.error('同步请求失败')
  } finally {
    syncing.value = false
  }
}

async function handleSwitch(version: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认切换到版本 ${version}？切换后网关将自动重启，Dashboard 会短暂断开。`,
      '确认切换版本',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
    )

    switching.value = version
    switchProgress.value = '正在安装 openclaw@' + version + '...'

    const result = await switchVersion(version)
    if (result.success) {
      if (result.restarted) {
        // 网关已重启，前端显示重连提示
        ElMessage.success(result.message || '版本切换成功，网关已重启')
        // 等待连接恢复后刷新列表
        setTimeout(async () => {
          try {
            await loadVersions()
          } catch {
            ElMessage.info('Dashboard 正在重连，请稍后刷新')
          }
        }, 3000)
      } else {
        ElMessage.success(result.message || '切换成功')
        await loadVersions()
      }
    } else {
      ElMessage.error(result.error || result.message || '切换失败')
    }
  } catch (err: unknown) {
    if (err !== 'cancel') {
      ElMessage.error('切换请求失败')
    }
  } finally {
    switching.value = null
    switchProgress.value = ''
  }
}

// 点击版本号 → 弹详情框
function handleVersionClick(row: VersionInfo): void {
  selectedVersion.value = row
  detailShowOriginal.value = false
  detailVisible.value = true
}

function buildVersionDetailSections(raw: string): { major: string[]; fixes: string[] } {
  const cleaned = raw.replace(/\r/g, '').trim()
  if (!cleaned) return { major: [], fixes: [] }
  const major: string[] = []
  const fixes: string[] = []
  let bucket: 'major' | 'fixes' = 'major'
  const lines = cleaned.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const heading = trimmed.replace(/^#+\s*/, '').replace(/[:：]$/, '').toLowerCase()
    if (/^(fixes|fixed|bug fixes|bugfixes|修复|修复更新|bug 修复)$/.test(heading)) {
      bucket = 'fixes'
      continue
    }
    if (/^(changes|changed|features|feature|new|added|breaking changes|重大更新|更新|改进|improvements)$/.test(heading)) {
      bucket = 'major'
      continue
    }
    const bullet = trimmed.replace(/^[-*+•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim()
    if (!bullet || bullet === trimmed && /^#+/.test(trimmed)) continue
    if (/^v?\d+(\.\d+){1,3}(-[a-z0-9.]+)?$/i.test(bullet)) continue
    const translated = translateVersionLine(bullet)
    if (bucket === 'fixes' || /^fix(es|ed)?\b/i.test(bullet)) fixes.push(translated)
    else major.push(translated)
  }
  if (!major.length && !fixes.length) major.push(translateVersionLine(cleaned.slice(0, 500)))
  return {
    major: dedupeVersionLines(major),
    fixes: dedupeVersionLines(fixes),
  }
}

function dedupeVersionLines(lines: string[]): string[] {
  const seen = new Set<string>()
  return lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => {
      if (!line || seen.has(line)) return false
      seen.add(line)
      return true
    })
}

function translateVersionLine(line: string): string {
  let text = line
    .replace(/^[-*+•]\s*/, '')
    .replace(/^•\s*/, '')
    .replace(/\s*Thanks\s+@[\s\S]*$/i, '')
    .replace(/\s+by\s+@[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const prefixMap: Array<[RegExp, string]> = [
    [/^docs?\s*[:：]\s*/i, '文档：'],
    [/^fix(es|ed)?\s*[:：]?\s*/i, '修复：'],
    [/^bug\s*fix(es)?\s*[:：]?\s*/i, '修复：'],
    [/^add(ed|s)?\s*[:：]?\s*/i, '新增：'],
    [/^feat(ure)?s?\s*[:：]?\s*/i, '新增：'],
    [/^change(d|s)?\s*[:：]?\s*/i, '调整：'],
    [/^improve(d|s|ments)?\s*[:：]?\s*/i, '优化：'],
    [/^remove(d|s)?\s*[:：]?\s*/i, '移除：'],
    [/^update(d|s)?\s*[:：]?\s*/i, '更新：'],
    [/^chore\s*[:：]?\s*/i, '维护：'],
  ]

  let prefix = ''
  for (const [pattern, replacement] of prefixMap) {
    if (pattern.test(text)) {
      prefix = replacement
      text = text.replace(pattern, '').trim()
      break
    }
  }

  text = translateReleaseBody(text)
  if (!text) return prefix ? `${prefix}补充版本说明。` : '补充版本说明。'
  return `${prefix || '更新：'}${text}`
}

function translateReleaseBody(line: string): string {
  let text = line
    .replace(/\s*Thanks\s+@[\s\S]*$/i, '')
    .replace(/\s+and\s+@[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const phrasePairs: Array<[RegExp, string]> = [
    [/\bclarify\b/gi, '补充说明'],
    [/\bREADME onboarding\b/gi, 'README 入门流程'],
    [/\bonboarding\b/gi, '入门流程'],
    [/\bstartup paths?\b/gi, '启动路径'],
    [/\bWhatsApp QR\/408 recovery\b/gi, 'WhatsApp 二维码和 408 错误恢复'],
    [/\bQR\/408 recovery\b/gi, '二维码和 408 错误恢复'],
    [/\boutput language prompts?\b/gi, '输出语言提示词'],
    [/\badvanced features?\b/gi, '高级功能'],
    [/\bupstream 403 troubleshooting\b/gi, '上游 403 错误排查'],
    [/\bplugin fallback override guidance\b/gi, '插件回退覆盖指引'],
    [/\bcontext-pruning ratio bounds?\b/gi, '上下文裁剪比例边界'],
    [/\blocal dashboard recovery\b/gi, '本地工作台恢复'],
    [/\blocal 工作台 recovery\b/gi, '本地工作台恢复'],
    [/\bCLI env markers?\b/gi, 'CLI 环境标记'],
    [/\bremote onboarding Token behavior\b/gi, '远程入门流程中的 Token 行为'],
    [/\bPeekaboo Bridge permissions? for subprocess agents?\b/gi, 'Peekaboo Bridge 子进程 Agent 权限'],
    [/\bbrowser CDP diagnostics\b/gi, '浏览器 CDP 诊断'],
    [/\bPlugin SDK allowlist imports?\b/gi, '插件 SDK 导入白名单'],
    [/\bstatus-reaction timing defaults?\b/gi, '状态/反馈反应的默认时间'],
    [/\bqueue steering behavior\b/gi, '队列调度行为'],
    [/\blimited-tool troubleshooting\b/gi, '受限工具排查'],
    [/\brecovery\b/gi, '恢复'],
    [/\bdiagnostics?\b/gi, '诊断'],
    [/\btroubleshooting\b/gi, '排查'],
    [/\bpermissions?\b/gi, '权限'],
    [/\bsubprocess agents?\b/gi, '子进程 Agent'],
    [/\bimports?\b/gi, '导入'],
    [/\bbehavior\b/gi, '行为'],
    [/\bbounds?\b/gi, '边界'],
    [/\bprompts?\b/gi, '提示词'],
    [/\bfeatures?\b/gi, '功能'],
    [/\bguidance\b/gi, '指引'],
    [/\bdashboard\b/gi, '工作台'],
    [/\bgateway\b/gi, '网关'],
    [/\bagents?\b/gi, 'Agent'],
    [/\btokens?\b/gi, 'Token'],
    [/\busage\b/gi, '用量'],
    [/\bcost\b/gi, '费用'],
    [/\bmodels?\b/gi, '模型'],
    [/\bsessions?\b/gi, '会话'],
    [/\btimeline\b/gi, '时间线'],
    [/\bchangelog\b/gi, '版本说明'],
    [/\brollback\b/gi, '版本回退'],
    [/\bbackups?\b/gi, '备份'],
    [/\blayout\b/gi, '布局'],
    [/\btheme\b/gi, '主题'],
    [/\bnotifications?\b/gi, '通知'],
    [/\bsearch\b/gi, '搜索'],
    [/\bskills?\b/gi, '技能'],
    [/\bcron\b/gi, '定时任务'],
    [/\bfiles?\b/gi, '文件'],
    [/\bproject\b/gi, '项目'],
    [/\bboard\b/gi, '看板'],
    [/\bdisplay\b/gi, '展示'],
    [/\bshow\b/gi, '显示'],
    [/\bhide\b/gi, '隐藏'],
    [/\bload(ing)?\b/gi, '加载'],
    [/\berrors?\b/gi, '错误'],
    [/\bstatus\b/gi, '状态'],
    [/\band\b/gi, '、'],
  ]

  for (const [pattern, replacement] of phrasePairs) text = text.replace(pattern, replacement)

  text = text
    .replace(/\s*,\s*/g, '、')
    .replace(/\s*;\s*/g, '；')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/、+/g, '、')
    .replace(/\s+([，。、；：])/g, '$1')
    .trim()

  if (hasReleaseEnglish(text)) text = summarizeReleaseEnglish(line)

  if (!/[。.!?]$/.test(text)) text += '。'
  return text
}

function hasReleaseEnglish(text: string): boolean {
  return (String(text || '').match(/[A-Za-z]{4,}/g)?.length || 0) >= 3
}

function summarizeReleaseEnglish(line: string): string {
  const lower = String(line || '').toLowerCase()
  const topics: string[] = []
  if (/readme|onboarding|startup/.test(lower)) topics.push('完善入门文档和启动路径说明')
  if (/whatsapp|qr|408/.test(lower)) topics.push('补充二维码登录和 408 错误恢复说明')
  if (/cron|output language|prompt/.test(lower)) topics.push('规范定时任务输出语言和提示词')
  if (/skill|advanced feature/.test(lower)) topics.push('补充技能高级能力说明')
  if (/upstream|403|fallback|plugin/.test(lower)) topics.push('补充插件回退和上游错误排查')
  if (/context|pruning|token/.test(lower)) topics.push('说明上下文裁剪和 Token 行为')
  if (/browser|cdp|sdk|import/.test(lower)) topics.push('完善浏览器诊断和 SDK 导入说明')
  if (/permission|subprocess|queue|steering/.test(lower)) topics.push('调整权限、队列和子进程 Agent 行为')
  if (/fix|bug|recover|repair/.test(lower)) topics.push('修复稳定性和恢复流程问题')
  if (!topics.length) topics.push('整理英文版本说明为中文摘要')
  return Array.from(new Set(topics)).join('；')
}

function formatLocalTime(timeStr: string): string {
  if (!timeStr) return '-'
  try {
    const d = new Date(timeStr)
    const Y = d.getFullYear()
    const M = String(d.getMonth() + 1).padStart(2, '0')
    const D = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    const s = String(d.getSeconds()).padStart(2, '0')
    return `${Y}-${M}-${D} ${h}:${m}:${s}`
  } catch {
    return timeStr
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    const Y = d.getFullYear()
    const M = String(d.getMonth() + 1).padStart(2, '0')
    const D = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${Y}-${M}-${D} ${h}:${m}`
  } catch {
    return dateStr
  }
}

// 窗口大小变化时重新计算高度
function handleResize(): void {
  calculateTableHeight()
}

watch(() => props.visible, async (val) => {
  if (val) {
    await nextTick()
    await nextTick()
    calculateTableHeight()
    loadVersions()
    window.addEventListener('resize', handleResize)
    // 绑定表格内部滚动事件
    tableBodyWrapper = tableRef.value?.$el?.querySelector('.el-table__body-wrapper') as HTMLElement | null
    tableBodyWrapper?.addEventListener('scroll', handleTableScroll)
  } else {
    window.removeEventListener('resize', handleResize)
    tableBodyWrapper?.removeEventListener('scroll', handleTableScroll)
    tableBodyWrapper = null
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  tableBodyWrapper?.removeEventListener('scroll', handleTableScroll)
  tableBodyWrapper = null
  if (scrollTimer !== null) {
    clearTimeout(scrollTimer)
    scrollTimer = null
  }
})
</script>

<style scoped>
.dialog-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.last-sync {
  font-size: 13px;
  color: var(--text-secondary, #98989d);
}

/* 版本切换进度条 */
.switch-progress-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  margin-bottom: 16px;
  background: var(--bg-elevated);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.switch-progress-text {
  font-size: 13px;
  color: var(--text-primary);
}

.desc-cell {
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

/* 版本号单元格：单行完整显示，不截断 */
.version-cell {
  display: inline-block;
  white-space: nowrap;
  vertical-align: middle;
}

/* 版本号点击样式 */
.version-click {
  cursor: pointer;
  color: var(--accent, #0a84ff);
  transition: opacity 0.2s;
}

.version-click:hover {
  opacity: 0.8;
  text-decoration: underline;
}

/* 加载更多底部提示 */
.load-more-footer {
  text-align: center;
  padding: 12px 0 4px;
  font-size: 13px;
  color: var(--text-secondary, #98989d);
}

.loading-more {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.no-more {
  opacity: 0.7;
}

/* ── 版本详情弹框样式 ── */
.detail-content-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 0; /* 允许 flex 子元素缩小 */
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  min-height: 0; /* 允许 flex 子元素缩小 */
}

.detail-meta {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-secondary, #98989d);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.detail-meta-item {
  display: inline-block;
}

.detail-original-toggle {
  border: 1px solid rgba(10, 132, 255, 0.28);
  background: rgba(10, 132, 255, 0.1);
  color: #8ecbff;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.detail-cn {
  height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 2px;
}

.detail-section {
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  border-radius: 12px;
  padding: 14px 16px;
}

.detail-section h3 {
  margin: 0 0 10px;
  font-size: 16px;
  color: var(--text-primary);
}

.detail-section ul {
  margin: 0;
  padding-left: 18px;
  color: var(--text-primary);
  line-height: 1.8;
}

.detail-section li {
  margin: 4px 0;
}

.detail-description {
  line-height: 1.8;
  font-size: 14px;
  color: var(--text-primary);
  word-break: break-word;
  height: 50vh;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.detail-description :deep(h1),
.detail-description :deep(h2),
.detail-description :deep(h3) {
  margin-top: 16px;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.detail-description :deep(h1):first-child,
.detail-description :deep(h2):first-child,
.detail-description :deep(h3):first-child {
  margin-top: 0;
}

.detail-description :deep(p) {
  margin-bottom: 12px;
}

.detail-description :deep(ul),
.detail-description :deep(ol) {
  padding-left: 24px;
  margin-bottom: 12px;
}

.detail-description :deep(li) {
  margin-bottom: 4px;
}

.detail-description :deep(code) {
  background: var(--bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.detail-description :deep(pre) {
  background: var(--bg-elevated);
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin-bottom: 12px;
}

.detail-description :deep(pre code) {
  background: none;
  padding: 0;
}

.detail-description :deep(blockquote) {
  border-left: 3px solid var(--accent, #0a84ff);
  padding-left: 12px;
  color: var(--text-secondary, #98989d);
  margin-bottom: 12px;
}

.detail-description :deep(a) {
  color: var(--accent, #0a84ff);
  text-decoration: none;
}

.detail-description :deep(a):hover {
  text-decoration: underline;
}

.detail-description :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 12px;
}

.detail-description :deep(th),
.detail-description :deep(td) {
  border: 1px solid var(--border-color);
  padding: 8px 12px;
  text-align: left;
}

.detail-description :deep(th) {
  background: var(--bg-elevated);
}

.no-description {
  color: var(--text-secondary, #98989d);
  font-style: italic;
}

/* ── 弹框样式：与抽屉一致的深色背景 (--bg-card) ── */
:deep(.version-dialog.el-dialog),
:deep(.version-detail-dialog.el-dialog) {
  background-color: var(--bg-card) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}

:deep(.version-dialog .el-dialog__header),
:deep(.version-detail-dialog .el-dialog__header) {
  background-color: var(--bg-card) !important;
  border-bottom: 1px solid var(--border-color) !important;
  padding: 16px 20px !important;
  margin-right: 0 !important;
}

:deep(.version-dialog .el-dialog__title),
:deep(.version-detail-dialog .el-dialog__title) {
  color: var(--text-primary) !important;
}

:deep(.version-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  min-height: 90vh !important;
  max-height: 95vh !important;
  overflow: hidden !important;
}

:deep(.version-detail-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  max-height: 80vh !important;
  overflow: hidden !important;
}

:deep(.version-dialog .el-dialog__close),
:deep(.version-detail-dialog .el-dialog__close) {
  color: var(--text-primary) !important;
}

:deep(.version-dialog .el-dialog__close):hover,
:deep(.version-detail-dialog .el-dialog__close):hover {
  color: var(--accent, #0a84ff) !important;
}

/* 弹框遮罩层 */
.version-dialog-modal {
  background-color: rgba(0, 0, 0, 0.5);
}

/* 表格样式：无斑马纹，数据行无背景色 */
:deep(.version-dialog .el-table),
:deep(.version-detail-dialog .el-table) {
  --el-table-border-color: var(--border-color) !important;
  --el-table-bg-color: transparent !important;
  --el-table-tr-bg-color: transparent !important;
  --el-table-header-bg-color: var(--bg-elevated) !important;
  --el-table-text-color: var(--text-primary) !important;
  --el-table-header-text-color: var(--text-secondary) !important;
  --el-table-row-hover-bg-color: var(--bg-elevated) !important;
}

:deep(.version-dialog .el-table::before),
:deep(.version-dialog .el-table::after),
:deep(.version-detail-dialog .el-table::before),
:deep(.version-detail-dialog .el-table::after) {
  background-color: var(--border-color);
}

/* 固定表头：表格滚动条隐藏 */
:deep(.el-table__body-wrapper) {
  overflow-y: auto !important;
}

:deep(.el-table__body-wrapper::-webkit-scrollbar) {
  width: 6px;
}

:deep(.el-table__body-wrapper::-webkit-scrollbar-thumb) {
  background: var(--border-color);
  border-radius: 3px;
}

:deep(.el-table__body-wrapper::-webkit-scrollbar-track) {
  background: transparent;
}
</style>
