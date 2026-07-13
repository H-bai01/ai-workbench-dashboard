<template>
  <el-dialog
    top="4vh"
    v-model="dialogVisible"
    title="网关诊断修复"
    width="860px"
    :close-on-click-modal="false"
    destroy-on-close
    class="doctor-dialog"
    :modal-class="'doctor-dialog-modal'"
  >
    <!-- 状态指示器 -->
    <div class="doctor-status-bar" :class="statusClass">
      <el-icon :size="18" :class="statusIconClass">
        <component :is="statusIcon" />
      </el-icon>
      <span class="status-text">{{ statusText }}</span>
      <el-icon v-if="running" class="is-loading" :size="16"><Loading /></el-icon>
    </div>

    <!-- 执行信息 -->
    <div v-if="result" class="doctor-info">
      <div class="info-row">
        <span class="info-label">命令</span>
        <span class="info-value code">{{ result.command }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">平台</span>
        <span class="info-value">{{ result.platform }}</span>
      </div>
      <div class="info-row" v-if="result.error">
        <span class="info-label">错误</span>
        <span class="info-value error-text">{{ result.error }}</span>
      </div>
    </div>

    <!-- ▼ 中文解读（默认显示） -->
    <div v-if="result && chineseSummary.length > 0" class="doctor-cn-summary">
      <div class="cn-summary-header">
        <el-icon><Document /></el-icon>
        <span>诊断解读（中文）</span>
      </div>
      <div
        v-for="(item, i) in chineseSummary"
        :key="i"
        class="cn-item"
        :class="`cn-item-${item.level}`"
      >
        <el-icon class="cn-item-icon" :class="`cn-icon-${item.level}`"><component :is="levelIcon(item.level)" /></el-icon>
        <div class="cn-item-body">
          <div class="cn-item-title">{{ item.title }}</div>
          <div v-if="item.detail" class="cn-item-detail">{{ item.detail }}</div>
          <div v-if="item.suggestion" class="cn-item-suggest"><el-icon class="suggest-icon"><Opportunity /></el-icon><span>{{ item.suggestion }}</span></div>
        </div>
      </div>
    </div>

    <!-- ▼ 原始输出（默认折叠） -->
    <div v-if="result?.stdout || result?.stderr" class="doctor-raw-toggle">
      <el-button link size="small" @click="showRaw = !showRaw">
        <el-icon><component :is="showRaw ? ArrowUp : ArrowDown" /></el-icon>
        {{ showRaw ? '收起原始输出' : '查看原始输出（英文）' }}
      </el-button>
    </div>

    <template v-if="showRaw">
      <!-- 诊断输出 (stdout) -->
      <div v-if="result?.stdout" class="doctor-output">
        <div class="output-header">
          <el-icon :size="14"><Document /></el-icon>
          <span>标准输出</span>
        </div>
        <pre class="output-content">{{ result.stdout }}</pre>
      </div>

      <!-- 错误输出 (stderr) -->
      <div v-if="result?.stderr" class="doctor-output doctor-output-error">
        <div class="output-header">
          <el-icon :size="14"><Warning /></el-icon>
          <span>错误输出</span>
        </div>
        <pre class="output-content">{{ result.stderr }}</pre>
      </div>
    </template>

    <!-- 错误详情（axios / 后端报错时显示真实原因） -->
    <div v-if="!running && errorDetail && !result" class="doctor-error-box">
      <div class="doctor-error-title">
        <el-icon><Warning /></el-icon>
        失败原因
      </div>
      <pre class="doctor-error-text">{{ errorDetail }}</pre>
      <div class="doctor-error-hint">
        常见原因：① 后端服务 31022 端口未启动 ② openclaw CLI 不在 PATH ③ doctor 命令执行超过 180 秒
      </div>
    </div>

    <!-- 空状态（仅在从未运行过、也没错误时显示） -->
    <el-empty v-if="!running && !result && !errorDetail" description="暂无诊断结果" :image-size="60" />

    <template #footer>
      <div class="doctor-footer">
        <div class="doctor-fix-btns">
          <el-tooltip content="重启 OpenClaw 网关进程（约 5-10 秒）" placement="top">
            <el-button
              size="small"
              :icon="VideoPlay"
              :loading="fixing === 'restart'"
              :disabled="!!fixing"
              @click="autoFix('restart-gateway')"
            >重启网关</el-button>
          </el-tooltip>
          <el-tooltip content="删除残留的 .lock / .pid 文件（可解决网关无法启动问题）" placement="top">
            <el-button
              size="small"
              :icon="Delete"
              :loading="fixing === 'locks'"
              :disabled="!!fixing"
              @click="autoFix('clear-locks')"
            >清理锁文件</el-button>
          </el-tooltip>
        </div>
        <div class="doctor-footer-right">
          <el-button @click="dialogVisible = false">关闭</el-button>
          <el-button
            type="primary"
            :icon="Refresh"
            :loading="running"
            :disabled="running"
            @click="runDiagnosis"
          >
            {{ running ? `运行中 (${elapsedSec}s)` : '重新诊断' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { runDoctor, type DoctorResult } from '../api/system'
import { ElMessage } from 'element-plus'
import {
  Loading,
  Document,
  Warning,
  CircleCheck,
  CircleClose,
  Refresh,
  ArrowUp,
  ArrowDown,
  VideoPlay,
  Delete,
  InfoFilled,
  Opportunity,
} from '@element-plus/icons-vue'

// 诊断条目按级别映射到矢量图标（替代 emoji）
const LEVEL_ICON: Record<string, any> = {
  success: CircleCheck,
  error: CircleClose,
  warning: Warning,
  info: InfoFilled,
}
function levelIcon(level: string) {
  return LEVEL_ICON[level] || InfoFilled
}

const props = withDefaults(defineProps<{
  visible: boolean
}>(), {
  visible: false
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'refresh': []
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

const running = ref(false)
const result = ref<DoctorResult | null>(null)
const errorDetail = ref<string>('')  // axios 真实错误
const elapsedSec = ref(0)
const showRaw = ref(false)  // 原始输出折叠状态
let elapsedTimer: ReturnType<typeof setInterval> | null = null

// Sprint 8 #11: 自动修复
const fixing = ref<string>('')  // 当前正在执行的修复操作名（空字符串=没在修复）

async function autoFix(action: string) {
  fixing.value = action === 'restart-gateway' ? 'restart' : 'locks'
  try {
    const resp = await fetch('/api/system/auto-fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await resp.json()
    if (resp.ok && data.ok) {
      if (action === 'restart-gateway') {
        ElMessage.success('网关重启指令已发送，约 5-10 秒后生效，建议点击"重新诊断"验证')
      } else if (action === 'clear-locks') {
        const n = data.removed?.length || 0
        ElMessage.success(n > 0 ? `已清理 ${n} 个锁文件：${data.removed.map((p: string) => p.split('/').pop()).join(', ')}` : '未发现需要清理的锁文件')
      }
    } else {
      ElMessage.error(`修复失败：${data.error || '未知错误'}`)
    }
  } catch (e: any) {
    ElMessage.error('请求失败：' + e.message)
  } finally {
    fixing.value = ''
  }
}

// ── 中文翻译解读：把 openclaw doctor 的英文输出转成可读中文条目 ──
interface SummaryItem {
  level: 'success' | 'warning' | 'error' | 'info'
  title: string
  detail?: string
  suggestion?: string
}

const chineseSummary = computed<SummaryItem[]>(() => {
  if (!result.value) return []
  const items: SummaryItem[] = []
  const stdout = result.value.stdout || ''
  const stderr = result.value.stderr || ''

  // 1. 整体状态
  if (result.value.success) {
    items.push({
      level: 'success',
      title: '整体诊断通过',
      detail: 'OpenClaw Gateway 核心服务运行正常',
    })
  } else {
    items.push({
      level: 'error',
      title: '诊断检测到问题',
      detail: '请查看下方详细项',
    })
  }

  // 2. Plugins 状态
  const pluginsBlock = stdout.match(/Plugins[\s\S]{0,200}?Loaded:\s*(\d+)[\s\S]{0,100}?Imported:\s*(\d+)[\s\S]{0,100}?Disabled:\s*(\d+)[\s\S]{0,100}?Errors:\s*(\d+)/)
  if (pluginsBlock) {
    const [, loaded, imported, disabled, errors] = pluginsBlock
    items.push({
      level: Number(errors) > 0 ? 'error' : 'info',
      title: `插件状态：已加载 ${loaded} 个 · 已导入 ${imported} 个 · 已禁用 ${disabled} 个 · 错误 ${errors} 个`,
      detail: Number(disabled) > 0 ? `${disabled} 个插件被禁用属于正常情况（未启用对应功能）` : undefined,
    })
  }

  // 3. Missing requirements
  const missingReq = stdout.match(/Missing requirements:\s*(\d+)/)
  if (missingReq) {
    const n = Number(missingReq[1])
    items.push({
      level: n > 0 ? 'warning' : 'success',
      title: n > 0 ? `缺失依赖 ${n} 项` : '依赖完整',
      detail: n > 0 ? '可能影响部分功能，建议查看原始输出确认' : undefined,
    })
  }

  // 4. Blocked by allowlist
  const blocked = stdout.match(/Blocked by allowlist:\s*(\d+)/)
  if (blocked && Number(blocked[1]) > 0) {
    items.push({
      level: 'info',
      title: `白名单拦截 ${blocked[1]} 项`,
      detail: '这是 plugins.allow 安全策略主动拦截，通常无需处理',
    })
  }

  // 5. Doctor warnings 段落
  if (stdout.includes('Doctor warnings')) {
    const warningSection = stdout.split('Doctor warnings')[1]?.split(/[─┤├╯]{3,}/)[0] || ''
    if (warningSection.includes('plugins.allow is restrictive')) {
      items.push({
        level: 'warning',
        title: '插件白名单较严格',
        detail: '部分内置插件因 plugins.allow 限制未启用，但已在 legacy 兼容模式下仍可被识别',
        suggestion: '若确认不需要被拦截的插件，可在 openclaw.json 中将 plugins.bundledDiscovery 改为 "allowlist"',
      })
    }
    if (warningSection.includes('bundled provider discovery')) {
      // 已经在上面提到了，跳过
    }
  }

  // 6. stderr 中的 skill symlink-escape
  if (stderr.includes('symlink-escape')) {
    const escapeMatches = stderr.match(/symlink-escape/g) || []
    items.push({
      level: 'info',
      title: `技能软链接越界已跳过：${escapeMatches.length} 项`,
      detail: '部分技能的软链接指向了配置根目录之外的位置，OpenClaw 为安全起见跳过了它们',
      suggestion: '如果某个技能不工作，检查 ~/.openclaw/skills、~/.openclaw/plugin-skills 或你的自定义工作区里的技能链接是否正确',
    })
  }

  // 7. stderr 中的其他常见模式
  if (stderr.includes('ERR_MODULE_NOT_FOUND')) {
    items.push({
      level: 'error',
      title: '模块未找到错误',
      detail: 'Node.js 找不到某个 OpenClaw 内部模块，可能是版本不匹配',
      suggestion: '尝试 brew upgrade openclaw 或 npm i -g openclaw@latest',
    })
  }
  if (stderr.match(/EADDRINUSE|address already in use/i)) {
    items.push({
      level: 'error',
      title: '端口被占用',
      detail: 'Gateway 想监听的端口已被其他进程占用',
      suggestion: '运行 lsof -i :18789 查看占用进程，然后 kill 或换端口',
    })
  }
  if (stderr.match(/permission denied|EACCES/i)) {
    items.push({
      level: 'error',
      title: '权限不足',
      detail: 'OpenClaw 没有权限读写某个文件或目录',
      suggestion: '检查 ~/.openclaw 目录的所有权和读写权限',
    })
  }

  // 8. 命令信息
  items.push({
    level: 'info',
    title: `执行命令：${result.value.command}`,
    detail: `平台：${result.value.platform}`,
  })

  return items
})

// Status states: 'idle' | 'running' | 'success' | 'failed'
const status = ref<'idle' | 'running' | 'success' | 'failed'>('idle')

const statusText = computed(() => {
  switch (status.value) {
    case 'idle': return '等待执行...'
    case 'running': return `正在执行诊断命令（已 ${elapsedSec.value} 秒，通常需要 20-40 秒）...`
    case 'success': return '诊断完成'
    case 'failed': return '诊断失败'
    default: return ''
  }
})

const statusClass = computed(() => {
  switch (status.value) {
    case 'running': return 'status-running'
    case 'success': return 'status-success'
    case 'failed': return 'status-failed'
    default: return 'status-idle'
  }
})

const statusIconClass = computed(() => {
  switch (status.value) {
    case 'success': return 'icon-success'
    case 'failed': return 'icon-failed'
    case 'running': return 'icon-running'
    default: return 'icon-idle'
  }
})

const statusIcon = computed(() => {
  switch (status.value) {
    case 'running': return Loading
    case 'success': return CircleCheck
    case 'failed': return CircleClose
    default: return Document
  }
})

watch(() => props.visible, async (val) => {
  if (val) {
    // Reset state
    status.value = 'idle'
    result.value = null
    errorDetail.value = ''
    showRaw.value = false  // 重新打开时折叠原始输出

    // Auto-run doctor on open
    await nextTick()
    runDiagnosis()
  } else {
    // 关闭时清理计时器
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
  }
})

async function runDiagnosis(): Promise<void> {
  // 防止重复触发
  if (running.value) return
  running.value = true
  status.value = 'running'
  result.value = null
  errorDetail.value = ''
  elapsedSec.value = 0
  // 启动计时器
  if (elapsedTimer) clearInterval(elapsedTimer)
  elapsedTimer = setInterval(() => { elapsedSec.value += 1 }, 1000)

  try {
    const data = await runDoctor()  // 现在错误会 throw
    result.value = data
    status.value = data.success ? 'success' : 'failed'
    if (data.success) {
      ElMessage.success(`诊断完成（用时 ${elapsedSec.value} 秒）`)
    } else {
      ElMessage.warning('诊断完成，但检测到问题')
    }
  } catch (e: any) {
    console.error('[GatewayDoctorDialog] diagnosis failed')
    status.value = 'failed'
    errorDetail.value = e?.message || String(e)
    ElMessage.error('诊断失败：' + errorDetail.value.slice(0, 120))
  } finally {
    running.value = false
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
  }
}

</script>

<style scoped>
/* ── 状态栏 ── */
.doctor-status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  margin-bottom: 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  font-size: 14px;
}

.status-idle {
  border-color: var(--border-color);
}

.status-running {
  border-color: rgba(10, 132, 255, 0.4);
  background: rgba(10, 132, 255, 0.08);
}

.status-success {
  border-color: rgba(48, 209, 88, 0.4);
  background: rgba(48, 209, 88, 0.08);
}

.status-failed {
  border-color: rgba(255, 69, 58, 0.4);
  background: rgba(255, 69, 58, 0.08);
}

.status-text {
  flex: 1;
  color: var(--text-primary);
  font-weight: 500;
}

.icon-idle { color: var(--text-secondary); }
.icon-running { color: #0a84ff; }
.icon-success { color: #30d158; }
.icon-failed { color: #ff453a; }

/* ── 执行信息 ── */
.doctor-info {
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--bg-elevated);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.info-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
}

.info-row:not(:last-child) {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 8px;
  margin-bottom: 4px;
}

.info-label {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 48px;
  flex-shrink: 0;
}

.info-value {
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
}

.info-value.code {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: var(--accent, #0a84ff);
}

.error-text {
  color: #ff453a;
}

/* ── 诊断输出 ── */
.doctor-output {
  margin-bottom: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  overflow: hidden;
}

.doctor-output-error {
  border-color: rgba(255, 69, 58, 0.3);
}

.output-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.output-content {
  margin: 0;
  padding: 14px 16px;
  max-height: 300px;
  overflow-y: auto;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--bg-card);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 滚动条样式 */
.output-content::-webkit-scrollbar {
  width: 6px;
}

.output-content::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.output-content::-webkit-scrollbar-track {
  background: transparent;
}

/* ── Footer ── */
.dialog-footer,
.doctor-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.doctor-fix-btns {
  display: flex;
  gap: 6px;
}
.doctor-footer-right {
  display: flex;
  gap: 8px;
}

/* ── 中文解读摘要 ── */
.doctor-cn-summary {
  margin-bottom: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--fill-subtle);
  overflow: hidden;
}
.cn-summary-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: rgba(10, 132, 255,0.08);
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: 600;
  color: #6cb2ff;
}
.cn-item {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
}
.cn-item:last-child { border-bottom: none; }
.cn-item-success { background: rgba(48, 209, 88,0.04); }
.cn-item-warning { background: rgba(255, 159, 10,0.04); }
.cn-item-error { background: rgba(255, 69, 58,0.05); }
.cn-item-icon {
  font-size: 17px;
  line-height: 1.2;
  flex-shrink: 0;
  margin-top: 1px;
}
.cn-icon-success { color: #30d158; }
.cn-icon-error { color: #ff453a; }
.cn-icon-warning { color: #ff9f0a; }
.cn-icon-info { color: #409cff; }
.cn-item-body { flex: 1; min-width: 0; }
.cn-item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.5;
}
.cn-item-detail {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.cn-item-suggest {
  margin-top: 6px;
  font-size: 12px;
  color: #ffb340;
  background: rgba(255, 159, 10,0.06);
  padding: 4px 8px;
  border-radius: 4px;
  border-left: 2px solid #ffb340;
  display: flex;
  align-items: flex-start;
  gap: 5px;
}
.cn-item-suggest .suggest-icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 13px;
}

/* ── 原始输出切换 ── */
.doctor-raw-toggle {
  margin: 8px 0 12px;
  text-align: center;
}

/* ── 错误详情 ── */
.doctor-error-box {
  margin-top: 12px;
  padding: 14px 16px;
  background: rgba(255, 69, 58, 0.06);
  border: 1px solid rgba(255, 69, 58, 0.25);
  border-radius: 8px;
}
.doctor-error-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #ff6961;
  margin-bottom: 8px;
}
.doctor-error-text {
  margin: 0 0 8px 0;
  padding: 10px 12px;
  background: rgba(0,0,0,0.25);
  border-radius: 6px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
  color: #fca5a5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}
.doctor-error-hint {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.6;
  padding-top: 4px;
}

/* ── 弹框样式 ── */
:deep(.doctor-dialog.el-dialog) {
  background-color: var(--bg-card) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}

:deep(.doctor-dialog .el-dialog__header) {
  background-color: var(--bg-card) !important;
  border-bottom: 1px solid var(--border-color) !important;
  padding: 16px 20px !important;
  margin-right: 0 !important;
}

:deep(.doctor-dialog .el-dialog__title) {
  color: var(--text-primary) !important;
}

:deep(.doctor-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  max-height: 75vh !important;
  overflow-y: auto !important;
}

:deep(.doctor-dialog .el-dialog__footer) {
  background-color: var(--bg-card) !important;
  padding: 12px 20px 20px !important;
  border-top: none !important;
}

:deep(.doctor-dialog .el-dialog__close) {
  color: var(--text-primary) !important;
}

:deep(.doctor-dialog .el-dialog__close):hover {
  color: var(--accent, #0a84ff) !important;
}

.doctor-dialog-modal {
  background-color: rgba(0, 0, 0, 0.5);
}
</style>
