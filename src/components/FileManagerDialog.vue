<template>
  <el-dialog
    v-model="visible"
    title="文件管理"
    width="1180px"
    top="5vh"
    class="file-manager-dialog"
    destroy-on-close
  >
    <div class="file-manager-shell">
      <aside class="root-panel">
        <div class="panel-heading">
          <div>
            <strong>工作目录</strong>
            <p>AI 工具正在使用的目录和我的目录</p>
          </div>
          <el-button type="primary" size="small" :loading="addingRoot" @click="addRoot">
            添加目录
          </el-button>
        </div>

        <div v-if="loadingRoots" class="empty-state">正在识别目录…</div>
        <div v-else class="root-list">
          <section class="root-section">
            <div class="root-section-title">AI 工作目录</div>
            <div v-if="aiRoots.length === 0" class="root-section-empty">暂未识别到 AI 工作目录</div>
            <button
              v-for="root in aiRoots"
              :key="root.id + root.path"
              type="button"
              class="root-item"
              :class="{ active: activeRoot?.path === root.path }"
              @click="openRoot(root)"
            >
              <el-icon><Folder /></el-icon>
              <span class="root-copy">
                <strong>{{ root.name }}</strong>
                <small>{{ sourceLabel(root) }}</small>
                <small class="mono">{{ root.path }}</small>
              </span>
            </button>
          </section>

          <section class="root-section">
            <div class="root-section-title">我的目录</div>
            <div v-if="manualRoots.length === 0" class="root-section-empty">可使用“添加目录”补充工作目录</div>
            <button
              v-for="root in manualRoots"
              :key="root.id + root.path"
              type="button"
              class="root-item"
              :class="{ active: activeRoot?.path === root.path }"
              @click="openRoot(root)"
            >
              <el-icon><Folder /></el-icon>
              <span class="root-copy">
                <strong>{{ root.name }}</strong>
                <small>手动添加</small>
                <small class="mono">{{ root.path }}</small>
              </span>
              <el-button
                class="remove-root"
                type="danger"
                link
                size="small"
                @click.stop="removeRoot(root)"
              >移除</el-button>
            </button>
          </section>
        </div>
      </aside>

      <section class="browser-panel">
        <div class="directory-toolbar">
          <el-button :disabled="!canGoUp || directoryLoading" size="small" @click="goUp">
            <el-icon><ArrowLeft /></el-icon>
            上一级
          </el-button>
          <div class="current-path mono">{{ currentPath || '请选择管理目录' }}</div>
          <el-button :disabled="!currentPath || directoryLoading" size="small" @click="reloadDirectory">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>

        <div class="workspace-grid">
          <div class="entry-panel">
            <div v-if="directoryLoading" class="empty-state">正在读取目录…</div>
            <div v-else-if="!currentPath" class="empty-state">请先选择左侧目录。</div>
            <div v-else-if="entries.length === 0" class="empty-state">这个目录是空的。</div>
            <div v-else class="entry-list">
              <button
                v-for="entry in entries"
                :key="entry.path"
                type="button"
                class="entry-row"
                :class="{ active: selected?.path === entry.path }"
                @click="selectEntry(entry)"
                @dblclick="entry.isDir && enterDirectory(entry)"
              >
                <el-icon class="entry-icon">
                  <Folder v-if="entry.isDir" />
                  <Picture v-else-if="entry.image" />
                  <Document v-else />
                </el-icon>
                <span class="entry-name">{{ entry.name }}</span>
                <span class="entry-kind">{{ entry.isDir ? '目录' : formatSize(entry.size) }}</span>
                <span class="entry-time">{{ formatTime(entry.mtime) }}</span>
              </button>
            </div>
          </div>

          <div class="detail-panel">
            <div v-if="!selected" class="empty-state">选择文件或目录后可查看和操作。</div>
            <template v-else>
              <div class="detail-heading">
                <div>
                  <strong>{{ selected.name }}</strong>
                  <p class="mono">{{ selected.path }}</p>
                </div>
                <el-tag size="small">{{ selected.isDir ? '目录' : formatSize(selected.size) }}</el-tag>
              </div>

              <div class="action-row">
                <el-button v-if="selected.isDir" size="small" type="primary" @click="enterDirectory(selected)">进入目录</el-button>
                <el-button v-if="content?.type === 'text'" size="small" type="primary" @click="startEditing">编辑</el-button>
                <el-button v-if="!selected.isDir" size="small" @click="replaceSelected">替换</el-button>
                <el-button size="small" @click="renameSelected">重命名</el-button>
                <el-button size="small" @click="moveSelected">移动</el-button>
                <el-button size="small" type="danger" @click="deleteSelected">删除</el-button>
                <el-button size="small" @click="openSelected('open')">系统打开</el-button>
                <el-button size="small" @click="openSelected('reveal')">显示位置</el-button>
              </div>

              <div v-if="contentLoading" class="empty-state preview-state">正在读取文件…</div>

              <template v-else-if="!selected.isDir">
                <div v-if="editing" class="editor-card">
                  <div class="editor-toolbar">
                    <span>编辑文本</span>
                    <div>
                      <el-button size="small" @click="cancelEditing">取消</el-button>
                      <el-button size="small" type="primary" :loading="saving" @click="saveSelected">保存</el-button>
                    </div>
                  </div>
                  <textarea v-model="draft" spellcheck="false" />
                </div>

                <div v-else-if="content?.type === 'text'" class="text-preview">
                  <pre>{{ content.content }}</pre>
                </div>

                <div v-else-if="content?.type === 'image'" class="image-preview">
                  <img :src="content.previewUrl" :alt="selected.name">
                  <p>{{ formatSize(content.size) }} · {{ formatTime(selected.mtime) }}</p>
                </div>

                <div v-else-if="content?.type === 'binary'" class="binary-preview">
                  <el-icon :size="42"><Document /></el-icon>
                  <strong>{{ selected.name }}</strong>
                  <p>{{ formatSize(content.size) }} · {{ formatTime(selected.mtime) }}</p>
                  <p>可使用系统程序打开或替换此文件。</p>
                </div>
              </template>
            </template>
          </div>
        </div>
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Document, Folder, Picture, Refresh } from '@element-plus/icons-vue'
import { useAgentStore } from '../stores/agent'

interface FileRoot {
  id: string
  name: string
  path: string
  source: 'ai' | 'manual'
  sources?: Array<{
    toolId: string
    toolName: string
    contextId?: string
    contextName?: string
    contextType?: 'agent' | 'project'
  }>
}

interface FileEntry {
  path: string
  name: string
  isDir: boolean
  binary?: boolean
  image?: boolean
  size?: number | null
  mtime?: number
}

interface FileContent {
  type: 'text' | 'image' | 'binary'
  content?: string
  previewUrl?: string
  size?: number
  ext?: string
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const store = useAgentStore()

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const roots = ref<FileRoot[]>([])
const aiRoots = computed(() => roots.value.filter(root => root.source === 'ai'))
const manualRoots = computed(() => roots.value.filter(root => root.source === 'manual'))
const activeRoot = ref<FileRoot | null>(null)
const currentPath = ref('')
const entries = ref<FileEntry[]>([])
const selected = ref<FileEntry | null>(null)
const content = ref<FileContent | null>(null)
const loadingRoots = ref(false)
const addingRoot = ref(false)
const directoryLoading = ref(false)
const contentLoading = ref(false)
const editing = ref(false)
const saving = ref(false)
const draft = ref('')

const canGoUp = computed(() => Boolean(
  activeRoot.value && currentPath.value && currentPath.value !== activeRoot.value.path,
))

watch(() => props.modelValue, (open) => {
  if (open) void loadRoots()
  else resetDialog()
})

function resetDialog() {
  selected.value = null
  content.value = null
  editing.value = false
  draft.value = ''
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || payload.ok === false) throw new Error(String(payload.error || '请求失败'))
  return payload as T
}

function jsonPost(body: Record<string, unknown> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function sourceLabel(root: FileRoot) {
  const labels = (root.sources || []).map(source => (
    source.contextName ? `${source.toolName} · ${source.contextName}` : source.toolName
  ))
  return [...new Set(labels)].join('、') || 'AI 工作目录'
}

function failure(action: string, error: unknown, target = selected.value?.path || currentPath.value) {
  const reason = error instanceof Error ? error.message : '操作未完成'
  store.addNotification({
    type: 'error',
    agentId: 'file-manager',
    agentName: '文件管理',
    message: `${action}失败`,
    source: '文件管理',
    detail: `位置：${target || '未选择'}\n原因：${reason}`,
    errorCode: 'file_manager_operation_failed',
    impact: '本次文件操作没有完成。',
    currentResult: '请在通知详情中查看失败位置和原因。',
  })
  ElMessage.error(`${action}失败`)
}

async function loadRoots(preferredPath = '') {
  loadingRoots.value = true
  try {
    const payload = await requestJson<{ roots: FileRoot[] }>('/api/file-manager/tree')
    roots.value = payload.roots || []
    const next = roots.value.find(root => root.path === preferredPath)
      || roots.value.find(root => root.path === activeRoot.value?.path)
      || roots.value[0]
    if (next) await openRoot(next)
    else {
      activeRoot.value = null
      currentPath.value = ''
      entries.value = []
    }
  } catch (error) {
    failure('识别管理目录', error, '管理目录')
  } finally {
    loadingRoots.value = false
  }
}

async function openRoot(root: FileRoot) {
  activeRoot.value = root
  await loadDirectory(root.path)
}

async function loadDirectory(path: string) {
  directoryLoading.value = true
  selected.value = null
  content.value = null
  editing.value = false
  try {
    const payload = await requestJson<{ type: string; path: string; entries: FileEntry[] }>(
      '/api/file-manager/read',
      jsonPost({ path }),
    )
    if (payload.type !== 'dir') throw new Error('目标不是目录')
    currentPath.value = payload.path
    entries.value = payload.entries || []
  } catch (error) {
    failure('读取目录', error, path)
  } finally {
    directoryLoading.value = false
  }
}

function reloadDirectory() {
  if (currentPath.value) void loadDirectory(currentPath.value)
}

function goUp() {
  if (!canGoUp.value || !activeRoot.value) return
  const normalized = currentPath.value.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  const parent = normalized.slice(0, index) || activeRoot.value.path
  void loadDirectory(parent.length < activeRoot.value.path.length ? activeRoot.value.path : parent)
}

function enterDirectory(entry: FileEntry) {
  if (entry.isDir) void loadDirectory(entry.path)
}

async function selectEntry(entry: FileEntry) {
  selected.value = entry
  content.value = null
  editing.value = false
  if (entry.isDir) return
  contentLoading.value = true
  try {
    content.value = await requestJson<FileContent>('/api/file-manager/read', jsonPost({ path: entry.path }))
  } catch (error) {
    failure('读取文件', error, entry.path)
  } finally {
    contentLoading.value = false
  }
}

async function addRoot() {
  addingRoot.value = true
  try {
    const payload = await requestJson<{ cancelled?: boolean; root?: FileRoot }>(
      '/api/file-manager/select-root', jsonPost(),
    )
    if (!payload.cancelled) {
      ElMessage.success('目录已添加')
      await loadRoots(payload.root?.path || '')
    }
  } catch (error) {
    failure('添加目录', error, '手动目录')
  } finally {
    addingRoot.value = false
  }
}

async function removeRoot(root: FileRoot) {
  try {
    await ElMessageBox.confirm(`从文件管理中移除“${root.name}”？`, '移除管理目录', {
      confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning',
    })
    await requestJson('/api/file-manager/remove-root', jsonPost({ path: root.path }))
    ElMessage.success('目录已移除')
    if (activeRoot.value?.path === root.path) activeRoot.value = null
    await loadRoots()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    failure('移除目录', error, root.path)
  }
}

function startEditing() {
  if (content.value?.type !== 'text') return
  draft.value = content.value.content || ''
  editing.value = true
}

function cancelEditing() {
  editing.value = false
  draft.value = ''
}

async function saveSelected() {
  if (!selected.value) return
  saving.value = true
  try {
    await requestJson('/api/file-manager/write', jsonPost({ path: selected.value.path, content: draft.value }))
    content.value = { ...content.value!, content: draft.value, size: new Blob([draft.value]).size }
    editing.value = false
    ElMessage.success('文件已保存')
    await reloadAfterOperation(selected.value.path)
  } catch (error) {
    failure('保存文件', error)
  } finally {
    saving.value = false
  }
}

async function replaceSelected() {
  if (!selected.value || selected.value.isDir) return
  const target = selected.value
  try {
    const choice = await requestJson<{ cancelled?: boolean; selectionId?: string; name?: string }>(
      '/api/file-manager/select-replacement', jsonPost(),
    )
    if (choice.cancelled || !choice.selectionId) return
    await ElMessageBox.confirm(`用“${choice.name}”替换“${target.name}”？`, '替换文件', {
      confirmButtonText: '替换', cancelButtonText: '取消', type: 'warning',
    })
    await requestJson('/api/file-manager/replace', jsonPost({ path: target.path, selectionId: choice.selectionId }))
    ElMessage.success('文件已替换')
    await reloadAfterOperation(target.path)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    failure('替换文件', error, target.path)
  }
}

async function renameSelected() {
  if (!selected.value) return
  const target = selected.value
  try {
    const prompt = await ElMessageBox.prompt('输入新名称', `重命名“${target.name}”`, {
      inputValue: target.name,
      confirmButtonText: '下一步', cancelButtonText: '取消',
    })
    const name = String(prompt.value || '').trim()
    if (!name || name === target.name) return
    await ElMessageBox.confirm(`将“${target.name}”重命名为“${name}”？`, '确认重命名', {
      confirmButtonText: '重命名', cancelButtonText: '取消', type: 'warning',
    })
    await requestJson('/api/file-manager/rename', jsonPost({ path: target.path, name }))
    ElMessage.success('重命名完成')
    await reloadAfterOperation()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    failure('重命名', error, target.path)
  }
}

async function moveSelected() {
  if (!selected.value) return
  const target = selected.value
  try {
    const choice = await requestJson<{ cancelled?: boolean; selectionId?: string; path?: string }>(
      '/api/file-manager/select-destination', jsonPost(),
    )
    if (choice.cancelled || !choice.selectionId) return
    await ElMessageBox.confirm(`将“${target.name}”移动到“${choice.path}”？`, '确认移动', {
      confirmButtonText: '移动', cancelButtonText: '取消', type: 'warning',
    })
    await requestJson('/api/file-manager/move', jsonPost({ path: target.path, selectionId: choice.selectionId }))
    ElMessage.success('移动完成')
    await reloadAfterOperation()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    failure('移动', error, target.path)
  }
}

async function deleteSelected() {
  if (!selected.value) return
  const target = selected.value
  try {
    await ElMessageBox.confirm(`删除“${target.name}”？`, '确认删除', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    })
    await requestJson('/api/file-manager/delete', jsonPost({ path: target.path }))
    ElMessage.success('删除完成')
    await reloadAfterOperation()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    failure('删除', error, target.path)
  }
}

async function openSelected(mode: 'open' | 'reveal') {
  if (!selected.value) return
  try {
    await requestJson('/api/file-manager/reveal', jsonPost({ path: selected.value.path, mode }))
    ElMessage.success(mode === 'open' ? '已交给系统打开' : '已在系统中显示位置')
  } catch (error) {
    failure(mode === 'open' ? '系统打开' : '显示位置', error)
  }
}

async function reloadAfterOperation(reselectPath = '') {
  const directory = currentPath.value
  await loadDirectory(directory)
  if (reselectPath) {
    const entry = entries.value.find(item => item.path === reselectPath)
    if (entry) await selectEntry(entry)
  }
}

function formatSize(value?: number | null) {
  const size = Number(value || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${(size / 1024 ** 3).toFixed(1)} GB`
}

function formatTime(value?: number) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
</script>

<style scoped>
.file-manager-shell { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 680px; border: 1px solid var(--el-border-color); border-radius: 12px; overflow: hidden; }
.root-panel { padding: 16px; border-right: 1px solid var(--el-border-color); background: rgba(255,255,255,.02); }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.panel-heading p, .detail-heading p { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 12px; }
.root-list { display: flex; flex-direction: column; gap: 16px; }
.root-section { display: flex; flex-direction: column; gap: 8px; }
.root-section-title { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 700; letter-spacing: .04em; }
.root-section-empty { padding: 10px 6px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
.root-item { width: 100%; display: flex; align-items: flex-start; gap: 9px; padding: 11px; border: 1px solid var(--el-border-color); border-radius: 9px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.root-item:hover, .root-item.active { border-color: var(--el-color-primary); background: rgba(64,158,255,.10); }
.root-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.root-copy small { color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.remove-root { margin-left: auto; }
.browser-panel { min-width: 0; display: flex; flex-direction: column; }
.directory-toolbar { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--el-border-color); }
.current-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-secondary); }
.workspace-grid { display: grid; grid-template-columns: minmax(300px, .9fr) minmax(360px, 1.1fr); min-height: 626px; }
.entry-panel { min-width: 0; border-right: 1px solid var(--el-border-color); overflow: auto; max-height: 626px; }
.entry-list { padding: 8px; }
.entry-row { width: 100%; display: grid; grid-template-columns: 24px minmax(0, 1fr) 74px 128px; align-items: center; gap: 8px; padding: 9px 8px; border: 0; border-radius: 7px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.entry-row:hover, .entry-row.active { background: rgba(64,158,255,.11); }
.entry-icon { color: var(--el-color-primary); }
.entry-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry-kind, .entry-time { color: var(--el-text-color-secondary); font-size: 12px; text-align: right; }
.detail-panel { min-width: 0; padding: 16px; overflow: auto; max-height: 626px; }
.detail-heading { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--el-border-color); }
.detail-heading > div { min-width: 0; }
.detail-heading p { overflow-wrap: anywhere; }
.action-row { display: flex; flex-wrap: wrap; gap: 7px; padding: 12px 0; }
.text-preview, .image-preview, .binary-preview, .editor-card { border: 1px solid var(--el-border-color); border-radius: 9px; overflow: hidden; }
.text-preview { max-height: 440px; overflow: auto; background: #111318; }
.text-preview pre { margin: 0; padding: 14px; color: #d9dee8; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.image-preview { padding: 14px; text-align: center; }
.image-preview img { display: block; max-width: 100%; max-height: 390px; margin: 0 auto; object-fit: contain; }
.image-preview p, .binary-preview p { color: var(--el-text-color-secondary); }
.binary-preview { display: flex; min-height: 260px; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.editor-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid var(--el-border-color); }
.editor-card textarea { display: block; width: 100%; min-height: 410px; box-sizing: border-box; resize: vertical; border: 0; outline: 0; padding: 14px; background: #111318; color: #d9dee8; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.empty-state { display: flex; min-height: 150px; align-items: center; justify-content: center; padding: 20px; color: var(--el-text-color-secondary); text-align: center; }
.preview-state { min-height: 260px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
@media (max-width: 980px) {
  .file-manager-shell { grid-template-columns: 1fr; }
  .root-panel { border-right: 0; border-bottom: 1px solid var(--el-border-color); }
  .workspace-grid { grid-template-columns: 1fr; }
  .entry-panel { border-right: 0; border-bottom: 1px solid var(--el-border-color); max-height: 300px; }
}
</style>
