<template>
  <el-dialog
    v-model="visible"
    title="文件管理"
    width="1100px"
    top="6vh"
    :close-on-click-modal="true"
    class="fm-dialog"
  >
    <div class="fm-body">
      <!-- 左侧：分组文件树 -->
      <div class="fm-tree">
        <el-input
          v-model="search"
          placeholder="搜索文件名 / 中文译名 / 说明"
          size="small"
          :prefix-icon="Search"
          clearable
        />

        <div v-if="loading" class="fm-empty">
          <el-icon class="is-loading"><Loading /></el-icon> 加载中…
        </div>

        <template v-else>
          <div v-for="cat in filteredCategories" :key="cat.name" class="fm-cat">
            <div
              class="fm-cat-header fm-collapsible"
              @click="toggleCat(cat.name)"
            >
              <el-icon class="fm-chevron" :class="{ collapsed: isCatCollapsed(cat.name) }"><ArrowDown /></el-icon>
              <el-icon class="fm-cat-icon"><component :is="getCategoryIcon(cat.name)" /></el-icon>
              <span class="fm-cat-name">{{ cleanCategoryName(cat.name) }}</span>
              <span class="fm-cat-count">{{ cat.groups.reduce((s, g) => s + g.items.length, 0) }}</span>
            </div>
            <div v-show="!isCatCollapsed(cat.name)" class="fm-cat-body">
              <div class="fm-cat-desc">{{ cat.rootDesc }}</div>

              <div v-for="grp in cat.groups" :key="grp.name" class="fm-group">
                <div
                  class="fm-group-name fm-collapsible"
                  @click="toggleGroup(cat.name + '::' + grp.name)"
                >
                  <el-icon class="fm-chevron sm" :class="{ collapsed: isGroupCollapsed(cat.name + '::' + grp.name) }"><ArrowDown /></el-icon>
                  <span>{{ cleanGroupName(grp.name) }}</span>
                  <span class="fm-group-count">{{ grp.items.length }}</span>
                </div>
                <div v-show="!isGroupCollapsed(cat.name + '::' + grp.name)" class="fm-group-items">
                  <div
                    v-for="item in grp.items"
                    :key="item.path"
                    class="fm-item"
                    :class="{
                      active: selectedPath === item.path,
                      missing: !item.exists,
                      sensitive: item.sensitive,
                      binary: item.binary,
                      dir: item.isDir,
                    }"
                    @click="selectFile(item)"
                  >
                    <el-icon class="fm-item-icon"><component :is="getFileIcon(item)" /></el-icon>
                    <div class="fm-item-info">
                      <div class="fm-item-cn">{{ item.cn }}</div>
                      <div class="fm-item-path">{{ shortPath(item.path) }}</div>
                    </div>
                    <span class="fm-item-meta">
                      <span v-if="item.isDir" class="fm-tag dir">目录 {{ item.entries ?? '?' }}</span>
                      <span v-else-if="!item.exists" class="fm-tag missing">缺失</span>
                      <span v-else class="fm-tag size">{{ formatSize(item.size) }}</span>
                    </span>
                    <!-- 快捷打开按钮 -->
                    <div class="fm-item-actions" v-if="item.exists" @click.stop>
                      <el-tooltip content="在系统文件管理器中显示" placement="top">
                        <el-button
                          link
                          size="small"
                          @click.stop="revealInFinder(item)"
                          class="fm-icon-btn"
                        >
                          <el-icon><FolderOpened /></el-icon>
                        </el-button>
                      </el-tooltip>
                      <el-tooltip :content="item.isDir ? '打开此目录' : '用默认应用打开'" placement="top">
                        <el-button
                          link
                          size="small"
                          @click.stop="openWithDefault(item)"
                          class="fm-icon-btn"
                        >
                          <el-icon><Position /></el-icon>
                        </el-button>
                      </el-tooltip>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="filteredCategories.length === 0" class="fm-empty">
            <el-icon><DocumentRemove /></el-icon>
            没找到匹配「{{ search }}」的文件
          </div>
        </template>
      </div>

      <!-- 右侧：内容预览 -->
      <div class="fm-preview">
        <div v-if="!selected" class="fm-preview-empty">
          <el-icon :size="48"><Document /></el-icon>
          <div>点击左侧任一文件查看详情</div>
        </div>

        <template v-else>
          <!-- 文件元信息 -->
          <div class="fm-meta-card">
            <div class="fm-meta-title">
              <span class="fm-meta-title-main">
                <el-icon><component :is="getFileIcon(selected)" /></el-icon>
                {{ selected.cn }}
              </span>
              <span v-if="selected.sensitive" class="fm-badge danger">敏感</span>
              <span v-if="selected.binary" class="fm-badge warning">二进制</span>
              <span v-if="selected.isDir" class="fm-badge info">目录</span>
              <div class="fm-meta-actions" v-if="selected.exists">
                <el-button
                  size="small"
                  :icon="FolderOpened"
                  @click="revealInFinder(selected)"
                >在文件管理器中显示</el-button>
                <el-button
                  size="small"
                  type="primary"
                  :icon="Position"
                  @click="openWithDefault(selected)"
                >{{ selected.isDir ? '打开目录' : '用默认应用打开' }}</el-button>
                <el-button
                  v-if="isEditable"
                  size="small"
                  type="warning"
                  :icon="Edit"
                  @click="startEditing"
                >编辑</el-button>
                <!-- #16 备份恢复按钮（Backup Restore Button）-->
                <el-button
                  v-if="isEditable && !selected.isDir"
                  size="small"
                  :icon="RefreshLeft"
                  @click="openBackupPanel"
                  :loading="loadingBackups"
                >备份恢复</el-button>
              </div>
            </div>
            <div class="fm-meta-grid">
              <div class="fm-meta-row">
                <span class="fm-meta-label">说明</span>
                <span class="fm-meta-val">{{ selected.desc }}</span>
              </div>
              <div class="fm-meta-row">
                <span class="fm-meta-label">谁在用</span>
                <span class="fm-meta-val">
                  <el-tag
                    v-for="u in selected.usedBy"
                    :key="u"
                    size="small"
                    class="fm-user-tag"
                  >{{ u }}</el-tag>
                </span>
              </div>
              <div class="fm-meta-row">
                <span class="fm-meta-label">路径</span>
                <span class="fm-meta-val mono">{{ selected.path }}</span>
              </div>
              <div class="fm-meta-row" v-if="selected.exists && !selected.isDir">
                <span class="fm-meta-label">大小</span>
                <span class="fm-meta-val">{{ formatSize(selected.size) }}</span>
              </div>
              <div class="fm-meta-row" v-if="selected.exists && selected.mtime">
                <span class="fm-meta-label">修改时间</span>
                <span class="fm-meta-val">{{ formatTime(selected.mtime) }}</span>
              </div>
              <div class="fm-meta-row" v-if="selected.isDir">
                <span class="fm-meta-label">子项数</span>
                <span class="fm-meta-val">{{ selected.entries }}</span>
              </div>
            </div>
          </div>

          <!-- 内容预览 / 编辑器 -->
          <div class="fm-content-card">
            <!-- 编辑模式 header -->
            <div v-if="editing" class="fm-content-header fm-editor-header">
              <span><el-icon><Edit /></el-icon> 编辑模式</span>
              <div class="fm-editor-actions">
                <el-tag v-if="editDirty" size="small" type="warning" effect="dark">未保存</el-tag>
                <el-button size="small" @click="cancelEditing">取消</el-button>
                <el-button
                  size="small"
                  type="primary"
                  :loading="saving"
                  @click="saveFile"
                >保存</el-button>
              </div>
            </div>
            <div v-else class="fm-content-header">
              <span><el-icon><Document /></el-icon> 内容预览</span>
              <button
                v-if="canToggleOriginal"
                class="fm-preview-toggle"
                @click="previewShowOriginal = !previewShowOriginal"
              >
                {{ previewShowOriginal ? '显示中文解释' : '显示原文' }}
              </button>
            </div>

            <!-- 编辑器区域 -->
            <div v-if="editing" class="fm-editor-wrap">
              <div class="fm-editor-line-nums" ref="lineNumsRef">
                <div
                  v-for="n in editorLineCount"
                  :key="n"
                  class="fm-line-num"
                >{{ n }}</div>
              </div>
              <textarea
                ref="editorRef"
                v-model="editContent"
                class="fm-editor-textarea"
                spellcheck="false"
                @scroll="syncLineNums"
                @input="onEditorInput"
              />
            </div>

            <!-- 预览模式 -->
            <template v-else>
              <div v-if="loadingContent" class="fm-content-loading">
                <el-icon class="is-loading"><Loading /></el-icon> 读取中…
              </div>

              <template v-else-if="content">
                <div v-if="content.type === 'binary'" class="fm-content-notice">
                  <el-icon><Warning /></el-icon> {{ content.message }}
                </div>
                <div v-else-if="content.type === 'too_large'" class="fm-content-notice">
                  <el-icon><Warning /></el-icon> {{ content.message }}
                </div>
                <div v-else-if="content.type === 'error'" class="fm-content-notice error">
                  <el-icon><WarningFilled /></el-icon> 读取失败：{{ content.error }}
                </div>
                <div v-else-if="content.type === 'dir'" class="fm-content-dir">
                  <div class="fm-dir-summary">共 {{ content.totalCount }} 项{{ content.totalCount > 50 ? '（显示前 50）' : '' }}：</div>
                  <div class="fm-dir-list">
                    <span v-for="entry in content.entries" :key="entry" class="fm-dir-entry">{{ entry }}</span>
                  </div>
                </div>
                <div v-else-if="content.type === 'text'">
                  <template v-if="previewShowOriginal">
                    <div
                      v-if="isMarkdown"
                      class="fm-md markdown-body"
                      v-html="renderedMarkdown"
                    />
                    <pre v-else-if="isJson" class="fm-code fm-json">{{ prettifiedJson }}</pre>
                    <pre v-else class="fm-code">{{ content.content }}</pre>
                  </template>
                  <div
                    v-else
                    class="fm-readable markdown-body"
                    v-html="renderedReadablePreview"
                  />
                </div>
              </template>

              <div v-else class="fm-content-notice">
                <el-icon><DocumentRemove /></el-icon> 文件不存在或无法读取
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- #16 备份列表 Dialog（Backup List Dialog）-->
    <el-dialog
      v-model="backupPanelVisible"
      title="备份恢复"
      width="560px"
      append-to-body
      :close-on-click-modal="true"
    >
      <div class="fm-backup-panel">
        <div class="fm-backup-file">
          <el-icon><Document /></el-icon>
          {{ selected?.cn }} — <span class="mono">{{ selected?.path }}</span>
        </div>
        <div v-if="backups.length === 0" class="fm-backup-empty">
          <el-icon><DocumentRemove /></el-icon>
          暂无备份文件（编辑保存时会自动创建备份）
        </div>
        <div v-else class="fm-backup-list">
          <div
            v-for="bk in backups"
            :key="bk.path"
            class="fm-backup-item"
          >
            <div class="fm-backup-info">
              <span class="fm-backup-date">{{ bk.date }}</span>
              <span class="fm-backup-size">{{ formatSize(bk.size) }}</span>
            </div>
            <div class="fm-backup-path mono">{{ bk.displayPath }}</div>
            <el-button
              size="small"
              type="warning"
              :loading="restoringBak === bk.path"
              @click="restoreBackup(bk)"
            >↩ 恢复此版本</el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="backupPanelVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 保存后 reset 提示 -->
    <el-dialog
      v-model="resetHintVisible"
      title="建议重载 Agent 配置"
      width="420px"
      append-to-body
      :close-on-click-modal="true"
    >
      <div class="fm-reset-hint">
        <p>你编辑了 <strong>IDENTITY.md</strong>，新配置需要 Agent 重新加载才能生效。</p>
        <p class="fm-reset-cmd">openclaw agent --reset <strong>{{ resetAgentId }}</strong></p>
        <p class="fm-reset-sub">或在 Agent 抽屉中点击「重启」按钮。</p>
      </div>
      <template #footer>
        <el-button type="primary" @click="resetHintVisible = false">知道了</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import {
  Search, Document, DocumentRemove, Loading, Warning, WarningFilled,
  ArrowDown, FolderOpened, Position, Edit, RefreshLeft,
  Folder, Tickets, Setting, Lock, Files, Notebook, Cpu, DocumentChecked,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import { renderSafeMarkdown, sanitizeRichHtml } from '../utils/safe-content.mjs'

const visible = defineModel<boolean>('visible', { default: false })

interface FileItem {
  path: string
  cn: string
  desc: string
  usedBy: string[]
  exists?: boolean
  size?: number
  entries?: number
  mtime?: number
  isDir?: boolean
  binary?: boolean
  sensitive?: boolean
}
interface Group { name: string; items: FileItem[] }
interface Category { name: string; rootDesc: string; groups: Group[] }

const loading = ref(false)
const categories = ref<Category[]>([])
const search = ref('')
const selected = ref<FileItem | null>(null)
const selectedPath = computed(() => selected.value?.path || '')
const content = ref<any>(null)
const loadingContent = ref(false)
const previewShowOriginal = ref(false)

// ── 编辑器状态 ──
const editing = ref(false)
const editContent = ref('')
const editDirty = ref(false)
const saving = ref(false)
const editorRef = ref<HTMLTextAreaElement | null>(null)
const lineNumsRef = ref<HTMLElement | null>(null)
const resetHintVisible = ref(false)
const resetAgentId = ref('')

const EDITABLE_EXTS = ['.md', '.json', '.py', '.txt', '.yaml', '.yml', '.sh', '.js', '.ts', '.env']
const isEditable = computed(() => {
  if (!selected.value || !content.value || content.value.type !== 'text') return false
  if (selected.value.sensitive || selected.value.isDir) return false
  const ext = selected.value.path.toLowerCase().split('.').pop()
  return EDITABLE_EXTS.includes('.' + ext)
})

const editorLineCount = computed(() => {
  return editContent.value.split('\n').length
})

function startEditing() {
  editContent.value = content.value?.content || ''
  editDirty.value = false
  editing.value = true
  nextTick(() => {
    editorRef.value?.focus()
  })
}

function cancelEditing() {
  if (editDirty.value) {
    if (!confirm('放弃未保存的更改？')) return
  }
  editing.value = false
  editDirty.value = false
}

function onEditorInput() {
  editDirty.value = true
}

function syncLineNums() {
  if (editorRef.value && lineNumsRef.value) {
    lineNumsRef.value.scrollTop = editorRef.value.scrollTop
  }
}

async function saveFile() {
  if (!selected.value) return
  saving.value = true
  try {
    const resp = await fetch('/api/file-manager/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: selected.value.path, content: editContent.value }),
    })
    const data = await resp.json()
    if (!data.ok) throw new Error(data.error || '保存失败')

    ElMessage.success(`保存成功${data.backupPath ? '（已备份）' : ''}`)
    // 同步本地 content
    content.value = { ...content.value, content: editContent.value }
    editDirty.value = false
    editing.value = false

    // IDENTITY.md 提示 reset
    if (data.resetHint) {
      resetAgentId.value = data.resetHint
      resetHintVisible.value = true
    }
  } catch (e: any) {
    ElMessage.error('保存失败：' + e.message)
  } finally {
    saving.value = false
  }
}

// ── #16 备份恢复（Backup Restore）────────────────────────────────────────────
interface BackupItem {
  path: string
  displayPath: string
  ts: number
  date: string
  size: number
}

const backupPanelVisible = ref(false)
const loadingBackups = ref(false)
const backups = ref<BackupItem[]>([])
const restoringBak = ref<string>('')

async function openBackupPanel(): Promise<void> {
  if (!selected.value) return
  backupPanelVisible.value = true
  loadingBackups.value = true
  backups.value = []
  try {
    const resp = await fetch(`/api/file-manager/backups?path=${encodeURIComponent(selected.value.path)}`)
    const data = await resp.json()
    if (data.ok) {
      backups.value = data.backups || []
    } else {
      ElMessage.error('加载备份列表失败：' + (data.error || '未知错误'))
    }
  } catch (e: any) {
    ElMessage.error('请求失败：' + e.message)
  } finally {
    loadingBackups.value = false
  }
}

async function restoreBackup(bk: BackupItem): Promise<void> {
  if (!selected.value) return
  restoringBak.value = bk.path
  try {
    const resp = await fetch('/api/file-manager/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupPath: bk.path, targetPath: selected.value.path }),
    })
    const data = await resp.json()
    if (data.ok) {
      ElMessage.success(`已恢复到 ${bk.date} 的版本（原文件已备份）`)
      backupPanelVisible.value = false
      // 重新读取文件内容
      if (selected.value) await selectFile(selected.value)
    } else {
      ElMessage.error('恢复失败：' + (data.error || '未知错误'))
    }
  } catch (e: any) {
    ElMessage.error('请求失败：' + e.message)
  } finally {
    restoringBak.value = ''
  }
}

// 切换文件时退出编辑
watch(selected, () => {
  editing.value = false
  editDirty.value = false
  previewShowOriginal.value = false
})

watch(visible, (val) => {
  if (val) loadTree()
  else { selected.value = null; content.value = null }
})

async function loadTree() {
  loading.value = true
  try {
    const resp = await fetch('/api/file-manager/tree')
    const data = await resp.json()
    categories.value = data.categories || []
  } catch {
    console.error('[FileManager] tree load failed')
  } finally {
    loading.value = false
  }
}

// ── 折叠状态：默认全部展开 ──
const collapsedCats = ref<Set<string>>(new Set())
const collapsedGroups = ref<Set<string>>(new Set())

function toggleCat(name: string) {
  const s = new Set(collapsedCats.value)
  s.has(name) ? s.delete(name) : s.add(name)
  collapsedCats.value = s
}
function toggleGroup(key: string) {
  const s = new Set(collapsedGroups.value)
  s.has(key) ? s.delete(key) : s.add(key)
  collapsedGroups.value = s
}
function isCatCollapsed(name: string): boolean {
  return collapsedCats.value.has(name)
}
function isGroupCollapsed(key: string): boolean {
  return collapsedGroups.value.has(key)
}

// ── 打开文件/文件夹 ──
async function callReveal(path: string, mode: 'open' | 'reveal') {
  try {
    const resp = await fetch('/api/file-manager/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, mode }),
    })
    const data = await resp.json()
    if (!data.success) {
      ElMessage.error('打开失败：' + (data.error || '未知错误'))
    }
  } catch (e: any) {
    ElMessage.error('打开失败：' + e.message)
  }
}

function revealInFinder(item: FileItem) {
  if (!item.exists) {
    ElMessage.warning('文件不存在')
    return
  }
  callReveal(item.path, 'reveal')
}

function openWithDefault(item: FileItem) {
  if (!item.exists) {
    ElMessage.warning('文件不存在')
    return
  }
  callReveal(item.path, 'open')
}

async function selectFile(item: FileItem) {
  selected.value = item
  content.value = null
  if (!item.exists) return
  if (item.sensitive) {
    content.value = { type: 'binary', message: '敏感文件，已跳过预览（避免泄露凭证）' }
    return
  }
  loadingContent.value = true
  try {
    const resp = await fetch('/api/file-manager/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path }),
    })
    content.value = await resp.json()
  } catch (e: any) {
    content.value = { type: 'error', error: e.message }
  } finally {
    loadingContent.value = false
  }
}

const filteredCategories = computed<Category[]>(() => {
  if (!search.value.trim()) return categories.value
  const q = search.value.toLowerCase()
  return categories.value
    .map(cat => ({
      ...cat,
      groups: cat.groups
        .map(g => ({
          ...g,
          items: g.items.filter(it =>
            it.path.toLowerCase().includes(q) ||
            it.cn.toLowerCase().includes(q) ||
            it.desc.toLowerCase().includes(q)
          ),
        }))
        .filter(g => g.items.length > 0),
    }))
    .filter(cat => cat.groups.length > 0)
})

function stripDecorativePrefix(name: string): string {
  return String(name || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/^[\s·•\-–—|]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanCategoryName(name: string): string {
  return stripDecorativePrefix(name) || name
}

function cleanGroupName(name: string): string {
  return stripDecorativePrefix(name) || name
}

function getCategoryIcon(name: string) {
  const clean = cleanCategoryName(name)
  if (clean.includes('工作')) return Folder
  if (clean.includes('设备')) return Cpu
  return Files
}

function getFileIcon(item: FileItem) {
  if (!item.exists) return DocumentRemove
  if (item.isDir) return Folder
  if (item.sensitive) return Lock
  const ext = item.path.split('.').pop()?.toLowerCase()
  if (ext === 'md') return Notebook
  if (ext === 'json') return Setting
  if (ext === 'py' || ext === 'sh' || ext === 'js' || ext === 'ts') return Tickets
  if (ext === 'log') return DocumentChecked
  return Document
}

function shortPath(p: string): string {
  return p.replace(/^~\//, '~/').replace(/^\/Users\/[^/]+\//, '~/')
}

function formatSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── 内容渲染 ──
const isMarkdown = computed(() => {
  if (!selected.value || content.value?.type !== 'text') return false
  return selected.value.path.toLowerCase().endsWith('.md')
})
const isJson = computed(() => {
  if (!selected.value || content.value?.type !== 'text') return false
  return selected.value.path.toLowerCase().endsWith('.json')
})
const renderedMarkdown = computed<string>(() => {
  if (!content.value?.content) return ''
  return renderSafeMarkdown(
    content.value.content,
    (source) => marked.parse(source, { async: false }) as string,
  )
})
const prettifiedJson = computed<string>(() => {
  if (!content.value?.content) return ''
  try {
    return JSON.stringify(JSON.parse(content.value.content), null, 2)
  } catch {
    return content.value.content
  }
})

const canToggleOriginal = computed(() => content.value?.type === 'text')

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const FILE_READABLE_TRANSLATIONS: Array<[RegExp, string]> = [
  [/TOOLS\.md\s*-\s*Local Notes/gi, 'TOOLS.md - 本地工具注记'],
  [/IDENTITY\.md\s*-\s*Who I Am/gi, 'IDENTITY.md - 我是谁'],
  [/SOUL\.md\s*-\s*Soul/gi, 'SOUL.md - 灵魂书'],
  [/USER\.md\s*-\s*User Preferences/gi, 'USER.md - 用户偏好'],
  [/AGENTS\.md\s*-\s*Agent Rules/gi, 'AGENTS.md - Agent 工作规则'],
  [/MEMORY\.md\s*-\s*Long Term Memory/gi, 'MEMORY.md - 长期记忆'],
  [/HEARTBEAT\.md\s*-\s*Heartbeat/gi, 'HEARTBEAT.md - 心跳清单'],
  [/\bLocal Notes\b/gi, '本地注记'],
  [/\bWhat Goes Here\b/gi, '这里应该写什么'],
  [/\bThings like\b/gi, '例如这些内容'],
  [/\bCamera names and locations\b/gi, '摄像头名称和位置'],
  [/\bSSH hosts and aliases\b/gi, 'SSH 主机和别名'],
  [/\bPreferred voices for TTS\b/gi, '文字转语音偏好的声音'],
  [/\bSkills define how tools work\b/gi, '技能用于定义工具如何工作'],
  [/\bThis file is for your specifics\b/gi, '这个文件记录你这台机器特有的配置'],
  [/\bthe stuff that's unique to your setup\b/gi, '只属于你这套环境的内容'],
  [/\bCreate\b/gi, '创建'],
  [/\bsearch\b/gi, '搜索'],
  [/\bmanage\b/gi, '管理'],
  [/\bread\b/gi, '读取'],
  [/\bwrite\b/gi, '写入'],
  [/\bedit\b/gi, '编辑'],
  [/\bconfiguration\b/gi, '配置'],
  [/\bsetup\b/gi, '配置'],
  [/\bexamples?\b/gi, '示例'],
  [/\bnotes?\b/gi, '注记'],
  [/\brules?\b/gi, '规则'],
  [/\btools?\b/gi, '工具'],
  [/\bskills?\b/gi, '技能'],
  [/\bidentity\b/gi, '身份设定'],
  [/\bmemory\b/gi, '记忆'],
  [/\buser preferences?\b/gi, '用户偏好'],
  [/\bworkflow\b/gi, '工作流'],
  [/\bautomation\b/gi, '自动化'],
]

function isEnglishHeavyText(text: string): boolean {
  const raw = String(text || '')
  const english = raw.match(/[A-Za-z]{4,}/g)?.length || 0
  const chinese = raw.match(/[\u4e00-\u9fff]/g)?.length || 0
  return english >= 8 && chinese < english * 2
}

function summarizeEnglishContent(raw: string): string {
  const lower = String(raw || '').toLowerCase()
  const topics: string[] = []
  if (/camera|rtsp|onvif/.test(lower)) topics.push('摄像头、视频流或设备地址配置')
  if (/ssh|host|alias/.test(lower)) topics.push('SSH 主机、别名和登录信息')
  if (/voice|tts|audio/.test(lower)) topics.push('语音、朗读或音频偏好')
  if (/skill|tool|command|cli/.test(lower)) topics.push('工具、技能或命令行能力说明')
  if (/agent|identity|persona|role/.test(lower)) topics.push('Agent 身份、角色和行为规则')
  if (/memory|preference|history/.test(lower)) topics.push('记忆、偏好和长期上下文')
  if (/workflow|automation|cron|schedule/.test(lower)) topics.push('自动化流程、定时任务或执行计划')
  if (/api|token|secret|key|permission/.test(lower)) topics.push('接口、权限或敏感配置')
  if (!topics.length) topics.push('本地配置说明和使用规则')
  return `# ${selected.value?.cn || '中文解释'}\n\n${selected.value?.desc || '这是工作台里的配置内容。'}\n\n## 通俗说明\n\n这份文件主要记录：${Array.from(new Set(topics)).join('、')}。\n\n英文原文、参数名和完整配置已默认收起，避免影响阅读；需要逐字核对或编辑时，可以点「显示原文」或「编辑」。`
}

function translateReadableText(text: string): string {
  let out = String(text || '')
  for (const [pattern, replacement] of FILE_READABLE_TRANSLATIONS) {
    out = out.replace(pattern, replacement)
  }
  out = out.replace(/\s+([，。、；：])/g, '$1').trim()
  if (isEnglishHeavyText(out)) {
    return summarizeEnglishContent(text)
  }
  return out
}

function extractHeadings(raw: string): string[] {
  return raw.split('\n')
    .map(line => line.match(/^\s{0,3}#{1,4}\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .slice(0, 8) as string[]
}

function explainJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 12) : []
    const keyList = keys.length
      ? `<ul>${keys.map(k => `<li><code>${escapeHtml(k)}</code>：配置字段，可点「显示原文」查看具体值。</li>`).join('')}</ul>`
      : '<p>这是一个 JSON 配置文件，当前没有可展开的顶层字段。</p>'
    return `<h2>${escapeHtml(selected.value?.cn || '配置文件')}</h2>
      <p>${escapeHtml(selected.value?.desc || '这是工作台使用的结构化配置。')}</p>
      <h3>通俗说明</h3>
      <p>这类文件通常是给程序读取的配置表。为了避免直接看到一大段符号，默认先展示字段含义；需要精确修改时可以点击「编辑」，需要核对原始结构时点击「显示原文」。</p>
      <h3>主要字段</h3>${keyList}`
  } catch {
    return `<h2>${escapeHtml(selected.value?.cn || '配置文件')}</h2>
      <p>这个文件看起来像配置文件，但内容不是标准 JSON。建议点「显示原文」核对具体格式。</p>`
  }
}

function explainCode(raw: string): string {
  const path = selected.value?.path || ''
  const ext = path.split('.').pop()?.toLowerCase()
  const funcs = raw.match(/(?:function\s+|def\s+)([A-Za-z_][\w]*)/g)?.slice(0, 8) || []
  const commands = raw.split('\n').filter(l => /\b(curl|python|node|npm|pnpm|bash|zsh)\b/.test(l)).slice(0, 6)
  const lang = ext === 'py' ? 'Python 脚本' : ext === 'sh' ? 'Shell 脚本' : ext === 'js' || ext === 'ts' ? '前端/服务脚本' : '代码文件'
  return `<h2>${escapeHtml(selected.value?.cn || '代码文件')}</h2>
    <p>${escapeHtml(selected.value?.desc || `这是一个${lang}。`)}</p>
    <h3>通俗说明</h3>
    <p>这是给系统或 Agent 执行的${lang}。默认不直接展示代码细节，避免阅读时被语法干扰；你可以点击「显示原文」查看完整代码，或点击「编辑」直接修改。</p>
    ${funcs.length ? `<h3>可识别的函数</h3><ul>${funcs.map(f => `<li><code>${escapeHtml(f.replace(/^(function|def)\s+/, ''))}</code></li>`).join('')}</ul>` : ''}
    ${commands.length ? `<h3>涉及的命令</h3><ul>${commands.map(c => `<li>${escapeHtml(explainCommand(c.trim()))}</li>`).join('')}</ul>` : ''}`
}

function explainCommand(command: string): string {
  if (/send-task-summary\.py/.test(command)) return '运行任务总结脚本，把定时任务结果整理后发送到指定入口。'
  if (/\bnpm\s+run\s+build\b/.test(command)) return '构建前端页面，用来检查代码是否能正常打包。'
  if (/\bpython3?\b/.test(command)) return '运行 Python 脚本，通常用于采集数据、同步状态或执行自动化任务。'
  if (/\b(curl|wget)\b/.test(command)) return '请求网络接口或下载数据。'
  if (/\b(node|pnpm|npm|yarn)\b/.test(command)) return '运行前端或 Node.js 相关命令。'
  return `执行命令：${command}`
}

const renderedReadablePreview = computed<string>(() => {
  const raw = String(content.value?.content || '')
  if (!selected.value) return ''
  let markdown = ''
  if (isJson.value) {
    return sanitizeRichHtml(explainJson(raw))
  }
  if (/\.(py|sh|js|ts)$/i.test(selected.value.path)) {
    return sanitizeRichHtml(explainCode(raw))
  }
  if (isMarkdown.value) {
    const headings = extractHeadings(raw)
    markdown = `# ${selected.value.cn}\n\n${selected.value.desc || '这是 AI 工作台总控里的配置文件。'}\n\n`
    if (headings.length) {
      markdown += `## 内容结构\n\n${headings.map(h => `- ${translateReadableText(h)}`).join('\n')}\n\n`
    }
    markdown += `## 阅读提示\n\n默认已把英文标题、说明和代码类内容整理成中文阅读版；需要逐字核对时，点右上角「显示原文」。\n\n`
    if (isEnglishHeavyText(raw)) {
      markdown += summarizeEnglishContent(raw)
    } else {
      markdown += raw
        .split('\n')
        .filter(line => /^\s*[-*]\s+/.test(line) || /^\s{0,3}#{1,4}\s+/.test(line))
        .slice(0, 18)
        .map(line => translateReadableText(line))
        .join('\n')
    }
  } else {
    markdown = `# ${selected.value.cn}\n\n${selected.value.desc || '这是一个文本文件。'}\n\n## 中文阅读版\n\n${translateReadableText(raw).slice(0, 4000)}`
  }
  return renderSafeMarkdown(markdown, (source) => marked.parse(source, { async: false }) as string)
})
</script>

<style scoped>
.fm-body {
  --fm-panel-bg: rgba(255, 255, 255, 0.055);
  --fm-panel-bg-strong: rgba(255, 255, 255, 0.075);
  --fm-panel-bg-hover: rgba(255, 255, 255, 0.105);
  --fm-readable-bg: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015)), rgba(20, 20, 22, 0.32);
  --fm-code-bg: rgba(0, 0, 0, 0.3);
  --fm-editor-bg: rgba(0, 0, 0, 0.35);
  --fm-editor-gutter-bg: rgba(0, 0, 0, 0.25);
  --fm-title-color: rgba(245, 245, 247, 0.9);
  --fm-title-soft-color: rgba(245, 245, 247, 0.82);
  --fm-path-color: var(--text-secondary);
  --fm-blue: #409cff;
  --fm-blue-soft: rgba(64, 156, 255, 0.07);
  --fm-blue-border: rgba(64, 156, 255, 0.12);
  --fm-border-soft: rgba(255, 255, 255, 0.08);
  --fm-code-text: #d4d4d4;
  --fm-json-text: #a5d6a7;
  --fm-editor-text: #e5e5ea;
  --fm-toggle-color: #6cb2ff;
  --fm-toggle-bg: rgba(10, 132, 255, 0.08);
  --fm-toggle-border: rgba(10, 132, 255, 0.24);
  --fm-toggle-hover-bg: rgba(10, 132, 255, 0.14);
  --fm-toggle-hover-border: rgba(10, 132, 255, 0.45);
  display: flex;
  gap: 14px;
  height: 70vh;
}

:global(html.light-theme .fm-body) {
  --fm-panel-bg: rgba(120, 120, 128, 0.08);
  --fm-panel-bg-strong: rgba(120, 120, 128, 0.1);
  --fm-panel-bg-hover: rgba(120, 120, 128, 0.16);
  --fm-readable-bg: linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.48)), rgba(255,255,255,0.58);
  --fm-code-bg: #f5f5f7;
  --fm-editor-bg: #f5f5f7;
  --fm-editor-gutter-bg: rgba(120, 120, 128, 0.08);
  --fm-title-color: #1d1d1f;
  --fm-title-soft-color: #3a3a3c;
  --fm-path-color: #8e8e93;
  --fm-blue: #0066cc;
  --fm-blue-soft: rgba(0, 122, 255, 0.055);
  --fm-blue-border: rgba(0, 122, 255, 0.12);
  --fm-border-soft: rgba(60, 60, 67, 0.12);
  --fm-code-text: #24292f;
  --fm-json-text: #116329;
  --fm-editor-text: #1d1d1f;
  --fm-toggle-color: #0066cc;
  --fm-toggle-bg: rgba(0, 122, 255, 0.08);
  --fm-toggle-border: rgba(0, 122, 255, 0.18);
  --fm-toggle-hover-bg: rgba(0, 122, 255, 0.12);
  --fm-toggle-hover-border: rgba(0, 122, 255, 0.3);
}

/* ── 左侧文件树 ── */
.fm-tree {
  width: 380px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding-right: 4px;
}
.fm-tree::-webkit-scrollbar { width: 4px; }
.fm-tree::-webkit-scrollbar-thumb { background: var(--fill-hover); border-radius: 2px; }

.fm-cat { margin-bottom: 10px; }
.fm-cat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 6px 6px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 8px;
}
.fm-collapsible {
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  transition: background 0.15s;
}
.fm-collapsible:hover { background: var(--fill-subtle); }
.fm-chevron {
  font-size: 14px;
  color: var(--text-secondary);
  transition: transform 0.2s;
  flex-shrink: 0;
}
.fm-chevron.sm { font-size: 11px; }
.fm-chevron.collapsed { transform: rotate(-90deg); }
.fm-cat-name { font-size: 15px; font-weight: 800; color: var(--text-primary); flex: 1; }
.fm-cat-icon {
  width: 18px;
  height: 18px;
  color: #8ab4ff;
}
.fm-cat-count {
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--fill-subtle);
  border-radius: 8px;
  padding: 1px 8px;
}
.fm-cat-body { padding-left: 4px; }
.fm-cat-desc {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  padding: 0 8px 0 28px;
  line-height: 1.45;
}

.fm-group-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 750;
  color: var(--fm-blue);
  margin: 10px 6px 6px 18px;
  padding: 5px 8px;
  min-height: 28px;
  border: 1px solid var(--fm-blue-border);
  border-radius: 7px;
  background: var(--fm-blue-soft);
  text-transform: uppercase;
  letter-spacing: 0.42px;
}
.fm-group-count {
  font-size: 10px;
  color: var(--text-secondary);
  background: rgba(64, 156, 255,0.1);
  border-radius: 6px;
  padding: 0 6px;
  margin-left: auto;
  text-transform: none;
}
.fm-group-items {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-left: 30px;
  padding-left: 10px;
  border-left: 1px solid var(--fm-border-soft);
}
.fm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  min-height: 48px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  margin-bottom: 0;
}
.fm-item:hover { background: var(--fm-panel-bg-hover); }
.fm-item.active {
  background: rgba(10, 132, 255,0.15);
  border: 1px solid rgba(10, 132, 255,0.3);
  padding: 7px 8px;
}
.fm-item.missing { opacity: 0.4; }
.fm-item-icon {
  width: 18px;
  height: 18px;
  font-size: 16px;
  flex-shrink: 0;
  color: #8ab4ff;
}
.fm-item-info { flex: 1; min-width: 0; }
.fm-item-cn {
  font-size: 12px;
  font-weight: 650;
  color: var(--fm-title-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fm-item-path { font-size: 10px; color: var(--fm-path-color); font-family: 'Cascadia Code', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fm-item-meta { flex-shrink: 0; }

.fm-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--fill-subtle);
  color: var(--text-secondary);
}
.fm-tag.dir { background: rgba(64, 156, 255,0.15); color: #6cb2ff; }
.fm-tag.missing { background: rgba(255, 69, 58,0.15); color: #ff6961; }

/* 列表项快捷打开按钮（hover 才显示） */
.fm-item-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.fm-item:hover .fm-item-actions {
  display: flex;
}
.fm-item.active .fm-item-actions {
  display: flex;
}
.fm-icon-btn {
  padding: 2px !important;
  height: auto !important;
}
.fm-icon-btn :deep(.el-icon) {
  font-size: 14px;
  color: var(--text-secondary);
}
.fm-icon-btn:hover :deep(.el-icon) {
  color: #409cff;
}

.fm-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--text-secondary);
  font-size: 13px;
}

/* ── 右侧预览 ── */
.fm-preview {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.fm-preview::-webkit-scrollbar { width: 4px; }
.fm-preview::-webkit-scrollbar-thumb { background: var(--fill-hover); border-radius: 2px; }

.fm-preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: var(--text-secondary);
  font-size: 14px;
}

.fm-meta-card,
.fm-content-card {
  background: var(--fm-panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 14px;
}
.fm-meta-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fm-meta-title-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.fm-meta-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.fm-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.fm-badge.danger { background: rgba(255, 69, 58,0.2); color: #ff6961; }
.fm-badge.warning { background: rgba(255, 159, 10,0.2); color: #ffb340; }
.fm-badge.info { background: rgba(64, 156, 255,0.2); color: #6cb2ff; }

.fm-meta-grid { display: flex; flex-direction: column; gap: 6px; }
.fm-meta-row { display: flex; gap: 10px; font-size: 12px; }
.fm-meta-label { width: 70px; flex-shrink: 0; color: var(--text-secondary); font-weight: 600; }
.fm-meta-val { flex: 1; color: var(--text-primary); word-break: break-all; }
.fm-meta-val.mono { font-family: 'Cascadia Code', monospace; font-size: 11px; }
.fm-user-tag { margin-right: 4px !important; }

.fm-content-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
  justify-content: space-between;
}
.fm-content-header > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.fm-preview-toggle {
  border: 1px solid var(--fm-toggle-border);
  color: var(--fm-toggle-color);
  background: var(--fm-toggle-bg);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}
.fm-preview-toggle:hover {
  border-color: var(--fm-toggle-hover-border);
  background: var(--fm-toggle-hover-bg);
}

.fm-content-loading,
.fm-content-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 13px;
  background: var(--fm-panel-bg);
  border-radius: 6px;
}
.fm-content-notice.error { color: #ff6961; }

.fm-code,
.fm-json {
  margin: 0;
  padding: 12px;
  background: var(--fm-code-bg);
  border-radius: 6px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--fm-code-text);
  max-height: 50vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.fm-json { color: var(--fm-json-text); }

.fm-md {
  padding: 12px 16px;
  background: var(--fm-panel-bg);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  max-height: 50vh;
  overflow-y: auto;
}
.fm-md :deep(h1) {
  font-size: 16px;
  font-weight: 800;
  margin: 10px 0 8px;
  padding-bottom: 6px;
  color: var(--fm-title-color);
  border-bottom: 1px solid var(--border-color);
}
.fm-md :deep(h2) {
  font-size: 14px;
  font-weight: 750;
  margin: 10px 0 6px;
  color: var(--fm-title-color);
}
.fm-md :deep(h3) {
  font-size: 13px;
  font-weight: 700;
  margin: 8px 0 4px;
  color: var(--fm-title-soft-color);
}
.fm-md :deep(code) { background: var(--fill-subtle); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.fm-md :deep(pre) { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; overflow-x: auto; }
.fm-md :deep(pre code) { background: transparent; padding: 0; }
.fm-md :deep(ul), .fm-md :deep(ol) { padding-left: 24px; }
.fm-md :deep(blockquote) { border-left: 3px solid #409cff; padding-left: 10px; color: var(--text-secondary); margin: 6px 0; }
.fm-md :deep(a) { color: #409cff; }
.fm-md :deep(table) { border-collapse: collapse; margin: 8px 0; }
.fm-md :deep(td), .fm-md :deep(th) { border: 1px solid var(--border-color); padding: 4px 8px; }

.fm-readable {
  padding: 14px 18px;
  border-radius: 8px;
  background: var(--fm-readable-bg);
  border: 1px solid var(--fm-border-soft);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.78;
  max-height: 50vh;
  overflow-y: auto;
}
.fm-readable :deep(h1) {
  font-size: 20px;
  margin: 0 0 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--fm-border-soft);
}
.fm-readable :deep(h2) {
  font-size: 15px;
  margin: 14px 0 8px;
}
.fm-readable :deep(h3) {
  font-size: 13px;
  margin: 12px 0 6px;
  color: var(--text-secondary);
}
.fm-readable :deep(code) {
  background: var(--fm-panel-bg-strong);
  border: 1px solid var(--fm-border-soft);
  padding: 1px 6px;
  border-radius: 5px;
  font-family: 'Cascadia Code', monospace;
  font-size: 12px;
}
.fm-readable :deep(ul) { padding-left: 20px; }

.fm-content-dir { padding: 8px; }
.fm-dir-summary { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.fm-dir-list { display: flex; flex-wrap: wrap; gap: 6px; }
.fm-dir-entry {
  font-family: 'Cascadia Code', monospace;
  font-size: 11px;
  padding: 3px 8px;
  background: var(--fm-panel-bg);
  border-radius: 4px;
  color: var(--text-primary);
}

/* ── 编辑器 ── */
.fm-editor-header {
  justify-content: space-between;
  border-color: rgba(255, 159, 10,0.3) !important;
  color: #ffb340 !important;
}
.fm-editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fm-editor-wrap {
  display: flex;
  gap: 0;
  background: var(--fm-editor-bg);
  border-radius: 6px;
  overflow: hidden;
  height: 52vh;
  border: 1px solid var(--border-color);
}
.fm-editor-line-nums {
  width: 42px;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--fm-editor-gutter-bg);
  border-right: 1px solid var(--border-color);
  padding: 12px 0;
  user-select: none;
}
.fm-line-num {
  height: 22px;
  line-height: 22px;
  text-align: right;
  padding-right: 8px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
  color: var(--text-muted);
}
.fm-editor-textarea {
  flex: 1;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  padding: 12px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 22px;
  color: #e5e5ea;
  color: var(--fm-editor-text);
  caret-color: #0a84ff;
  tab-size: 2;
  white-space: pre;
  overflow-wrap: normal;
  overflow: auto;
}
.fm-editor-textarea::selection {
  background: rgba(10, 132, 255,0.25);
}

/* reset 提示 */
.fm-reset-hint { font-size: 13px; color: var(--text-primary); line-height: 1.7; }
.fm-reset-cmd {
  margin: 10px 0;
  padding: 8px 14px;
  background: var(--fm-code-bg);
  border-radius: 6px;
  font-family: 'Cascadia Code', monospace;
  font-size: 12px;
  color: #6cb2ff;
  border-left: 3px solid #0a84ff;
}
.fm-reset-sub { font-size: 12px; color: var(--text-secondary); }

/* ─── #16 备份恢复（Backup Restore Panel）──────────────────────────────────── */
.fm-backup-panel { display: flex; flex-direction: column; gap: 14px; }

.fm-backup-file {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text-secondary);
  padding: 8px 12px; background: var(--fm-panel-bg);
  border-radius: 7px; border: 1px solid var(--border-color);
}
.fm-backup-file .mono { color: var(--text-primary); font-family: monospace; font-size: 12px; }

.fm-backup-empty {
  display: flex; align-items: center; gap: 8px;
  padding: 24px; justify-content: center;
  color: var(--text-muted); font-size: 13px;
}

.fm-backup-list { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; }

.fm-backup-item {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--fm-panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition: background 0.15s;
}
.fm-backup-item:hover { background: var(--fm-panel-bg-hover); }

.fm-backup-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.fm-backup-date { font-size: 13px; color: var(--text-primary); font-weight: 500; }
.fm-backup-size { font-size: 11px; color: var(--text-muted); }
.fm-backup-path { font-size: 11px; color: #5e5ce6; font-family: monospace; width: 100%; margin-top: 2px; word-break: break-all; }
</style>
