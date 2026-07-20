<template>
  <div class="agent-voice-stage" :class="[`state-${callState}`, stageThemeClass, { 'is-muted': isMuted }]">
    <div class="voice-stage-inner">
      <div class="voice-stage-surface" />

      <canvas
        ref="canvasRef"
        class="voice-canvas"
        width="600"
        height="600"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
      />

      <button class="voice-agent-chip voice-agent-chip--clickable" type="button" title="点击打开语音设置" @click="openVoiceSettings">
        <span class="voice-agent-status-dot" :class="statusDotClass" :title="stateLabel" />
        <img v-if="avatarSrc" :src="avatarSrc" :alt="agentName" @error="setDefaultAvatar" />
        <span class="voice-agent-name">{{ agentName }}</span>
        <el-icon class="voice-agent-gear"><Setting /></el-icon>
      </button>

      <div class="voice-wave-meter" :class="{ 'is-active': micWaveActive }" aria-hidden="true">
        <span
          v-for="(height, idx) in waveBars"
          :key="idx"
          :style="{ '--bar-height': `${height}px` }"
        />
      </div>

      <div class="voice-controls">
        <div class="voice-control-buttons">
          <button
            v-if="callState !== 'idle'"
            class="voice-icon-btn"
            :class="{ active: isMuted }"
            type="button"
            :title="isMuted ? '取消静音' : '静音'"
            @click="$emit('toggleMute')"
          >
            <el-icon><Mic v-if="isMuted" /><Mute v-else /></el-icon>
          </button>

          <button
            class="voice-primary-btn"
            :class="{ active: callState !== 'idle' }"
            type="button"
            :title="callState === 'idle' ? '开始语音对话' : '结束语音对话'"
            @click="callState === 'idle' ? $emit('start') : $emit('end')"
          >
            <el-icon><Microphone v-if="callState !== 'idle'" /><Headset v-else /></el-icon>
          </button>

          <button
            v-if="callState === 'thinking' || callState === 'speaking'"
            class="voice-icon-btn"
            type="button"
            title="打断"
            @click="$emit('interrupt')"
          >
            <el-icon><VideoPause /></el-icon>
          </button>
        </div>

        <button
          v-if="callState === 'listening'"
          class="voice-finish-btn"
          type="button"
          title="我说完了，立刻识别"
          @click="$emit('finish')"
        >
          <el-icon><Check /></el-icon>
          <span>我说完了</span>
        </button>

        <div class="voice-status">
          <span class="voice-state">{{ stateLabel }}</span>
          <span class="voice-subtitle">{{ subtitle }}</span>
          <span v-if="callState !== 'idle'" class="voice-time">{{ elapsedLabel }}</span>
        </div>
      </div>

      <div v-if="settingsOpen" class="voice-settings-popover" @click.self="settingsOpen = false">
        <section class="voice-settings-card">
          <header class="voice-settings-head">
            <div>
              <strong>语音设置</strong>
              <span>{{ agentName }}</span>
            </div>
            <button type="button" @click="settingsOpen = false">×</button>
          </header>

          <!-- 选声音：选哪个音色（放最上面）-->
          <div class="voice-setting-field" v-if="clonedVoices.length > 0">
            <span>当前使用的音色</span>
            <el-select class="voice-el-select" :teleported="false" :model-value="settingsDraft.provider === 'backend' ? settingsDraft.backendVoiceId : ''" @change="applyClonedVoice" placeholder="选择一个音色">
              <el-option label="不使用（走浏览器音色）" value="" />
              <el-option v-for="v in clonedVoices" :key="v.voiceId" :label="v.name" :value="v.voiceId" />
            </el-select>
          </div>

          <div class="voice-setting-field" v-if="clonedVoices.length > 0">
            <span>管理音色（删掉不要的）</span>
            <ul class="voice-clone-list">
              <li v-for="v in (voicesExpanded ? clonedVoices : clonedVoices.slice(0, 3))" :key="v.voiceId" :class="{ active: settingsDraft.backendVoiceId === v.voiceId }">
                <span class="vcl-name">{{ v.name }}</span>
                <span class="vcl-tag">{{ v.provider === 'cosyvoice' ? '云端' : v.provider === 'gptsovits' ? '本地' : v.provider }}</span>
                <button type="button" class="vcl-del" :disabled="deletingVoiceId === v.voiceId" @click="deleteClonedVoice(v)" title="删除此音色">
                  <el-icon><Delete /></el-icon>
                </button>
              </li>
            </ul>
            <button v-if="clonedVoices.length > 3" type="button" class="voice-list-toggle" @click="voicesExpanded = !voicesExpanded">
              {{ voicesExpanded ? '收起' : `展开全部 ${clonedVoices.length} 个` }}
            </button>
          </div>

          <!-- 调：语速 / 音调（两端标签，无刻度避免重叠）-->
          <div class="voice-sliders">
            <div class="voice-slider-row">
              <div class="voice-slider-top">
                <span class="voice-slider-label">语速</span>
                <span class="voice-slider-val">{{ settingsDraft.rate.toFixed(2) }}×</span>
              </div>
              <div class="voice-slider-track">
                <span class="voice-slider-end">慢</span>
                <el-slider v-model="settingsDraft.rate" :min="0.5" :max="1.5" :step="0.05" size="small" />
                <span class="voice-slider-end">快</span>
              </div>
            </div>
            <div class="voice-slider-row">
              <div class="voice-slider-top">
                <span class="voice-slider-label">音调</span>
                <span class="voice-slider-val">{{ settingsDraft.pitch.toFixed(2) }}</span>
              </div>
              <div class="voice-slider-track">
                <span class="voice-slider-end">低</span>
                <el-slider v-model="settingsDraft.pitch" :min="0.7" :max="1.3" :step="0.05" size="small" />
                <span class="voice-slider-end">高</span>
              </div>
            </div>
          </div>

          <!-- 情绪 / 语气（CosyVoice instruct，不靠改音调）-->
          <div class="voice-setting-field">
            <span>情绪 / 语气</span>
            <el-select class="voice-el-select" :teleported="false" v-model="settingsDraft.emotion" placeholder="平静（默认）">
              <el-option v-for="e in EMOTIONS" :key="e.code" :label="e.label" :value="e.code" />
            </el-select>
          </div>

          <!-- 试听：输入文本 + 紧挨着的试听按钮 -->
          <label class="voice-setting-field">
            <span>试听文本（输入一段话听效果，留空用默认句）</span>
            <el-input v-model="previewText" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" class="voice-test-input" placeholder="例：今天辛苦啦，早点休息呀。" />
          </label>
          <button type="button" class="voice-preview-btn" @click="previewVoiceSettings">
            <el-icon><VideoPause v-if="previewing" /><VideoPlay v-else /></el-icon>
            <span>{{ previewing ? '停止试听' : '试听这段' }}</span>
          </button>

          <p class="voice-settings-note">
            {{ voiceSettingsNote }}
            <a v-if="previewRawError" class="voice-show-raw" @click="showRawError = !showRawError">{{ showRawError ? '收起原文' : '显示原文' }}</a>
          </p>
          <pre v-if="previewRawError && showRawError" class="voice-raw-error">{{ previewRawError }}</pre>

          <!-- 录新音色：放下面（不常用）-->
          <section class="voice-clone-card" :class="{ 'is-recording': cloneRecording, 'is-busy': cloneBusy }">
            <div class="voice-clone-title">
              <span>录制 / 上传新音色</span>
              <small>{{ cloneStatusText }}</small>
            </div>

            <!-- #5 录音中指示 -->
            <div v-if="cloneRecording" class="voice-rec-indicator">
              <span class="rec-dot"></span>
              <span class="rec-wave"><i></i><i></i><i></i><i></i><i></i></span>
              <span class="rec-time">录音中 {{ cloneRecordingSeconds }}s</span>
            </div>

            <div class="voice-clone-actions">
              <button
                type="button"
                class="primary"
                :disabled="cloneBusy"
                @click="cloneRecording ? stopCloneRecording() : startCloneRecording()"
              >
                {{ cloneRecording ? '停止录音' : cloneBusy ? '正在处理' : '开始录音' }}
              </button>
              <label class="voice-clone-upload" :class="{ disabled: cloneBusy || cloneRecording }">
                上传音频文件
                <input type="file" accept="audio/*" :disabled="cloneBusy || cloneRecording" @change="onVoiceSampleChange" />
              </label>
            </div>

            <!-- #6 待确认录音：试听后再决定删/克隆 -->
            <div v-if="pendingRecordings.length" class="pending-rec">
              <div class="pending-rec-title">我的录音（试听 / 用来克隆 / 删除，克隆后保留可见）</div>
              <ul>
                <li v-for="r in (recsExpanded ? pendingRecordings : pendingRecordings.slice(0, 3))" :key="r.id">
                  <button type="button" class="prec-btn play" :title="playingPendingId === r.id ? '停止' : '试听'" @click="playPending(r)">
                    <el-icon><VideoPause v-if="playingPendingId === r.id" /><VideoPlay v-else /></el-icon>
                  </button>
                  <span class="prec-label">{{ r.label }}{{ r.seconds ? ` · ${r.seconds}s` : '' }}</span>
                  <span v-if="r.cloned" class="prec-cloned-tag">已克隆</span>
                  <template v-else>
                    <button type="button" class="prec-btn clone" :disabled="cloneBusy" @click="cloneFromPending(r)">用这条克隆</button>
                    <button type="button" class="prec-btn del" title="删除这条录音" @click="deletePending(r)"><el-icon><Delete /></el-icon></button>
                  </template>
                </li>
              </ul>
              <button v-if="pendingRecordings.length > 3" type="button" class="voice-list-toggle" @click="recsExpanded = !recsExpanded">
                {{ recsExpanded ? '收起' : `展开全部 ${pendingRecordings.length} 条` }}
              </button>
            </div>

            <p class="voice-clone-tip">
              {{ cloneRecording ? `自然说话 15-30 秒后点「停止录音」。` : '自然说话 15-30 秒或上传音频 → 先试听 → 满意再克隆。' }}
            </p>
          </section>

          <footer class="voice-settings-actions">
            <button type="button" @click="settingsOpen = false">取消</button>
            <button type="button" class="primary" @click="saveVoiceSettingsDraft">保存</button>
          </footer>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Check, Headset, Mic, Microphone, Mute, Setting, VideoPause } from '@element-plus/icons-vue'
import type { BrowserVoiceCallState } from '../composables/useBrowserVoiceCall'
import {
  availableBrowserVoices,
  loadAgentVoiceSettings,
  saveAgentVoiceSettings,
  type AgentVoiceSettings,
} from '../composables/useAgentVoiceSettings'
import { setDefaultAvatar } from '../utils/avatarFallback'

const props = defineProps<{
  agentKey?: string
  agentName: string
  avatarSrc?: string
  callState: BrowserVoiceCallState
  audioLevel: number
  transcript?: string
  responseText?: string
  error?: string
  isMuted: boolean
  elapsedSeconds: number
}>()

defineEmits<{
  (e: 'start'): void
  (e: 'end'): void
  (e: 'interrupt'): void
  (e: 'toggleMute'): void
  (e: 'finish'): void
}>()

interface Particle {
  bx: number
  by: number
  bz: number
  x: number
  y: number
  z: number
  size: number
  kind: 'signal' | 'core' | 'void'
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const particles: Particle[] = []
const rotation = { x: -0.18, y: 0 }
const pointer = { active: false, x: 0, y: 0 }
const isLightTheme = ref(false)
const settingsOpen = ref(false)
const voiceOptions = ref<SpeechSynthesisVoice[]>([])
const clonedVoices = ref<Array<{ voiceId: string; name: string; provider: string }>>([])
// 当前 Agent 的 id（key 形如 agent:main:main → main），音色按它归属
function currentAgentId(): string {
  return (props.agentKey || '').split(':')[1] || props.agentName || ''
}
async function loadClonedVoices(): Promise<void> {
  try {
    const resp = await fetch(`/api/voice/voices?agentId=${encodeURIComponent(currentAgentId())}`)
    if (!resp.ok) return
    const data = await resp.json()
    clonedVoices.value = Array.isArray(data.cloned) ? data.cloned : []
  } catch { /* ignore */ }
}
function applyClonedVoice(voiceId: string): void {
  const v = clonedVoices.value.find((x) => x.voiceId === voiceId)
  if (!v) return
  settingsDraft.value = {
    ...settingsDraft.value,
    provider: 'backend',
    backendVoiceId: v.voiceId,
    backendProvider: String(v.provider || 'gptsovits'),
    clonedVoiceName: v.name,
    cloneStatus: 'ready',
  }
}
const settingsDraft = ref<AgentVoiceSettings>(loadAgentVoiceSettings(props.agentKey || props.agentName))
const settingsNotice = ref('')

// 试听：用当前草稿里的音色 + 语速/音调合成一句话播放
const previewing = ref(false)
const previewRawError = ref('')   // 原始报错，给「显示原文」用
const showRawError = ref(false)
const previewText = ref('')       // 自定义试听文本
const deletingVoiceId = ref('')   // 正在删除的音色
const voicesExpanded = ref(false) // 音色管理列表是否全展开
const recsExpanded = ref(false)   // 我的录音列表是否全展开
// 待确认录音：录/传完上传后端持久保存（不克隆），刷新不丢；用户试听后决定删/克隆
interface PendingRec { id: string; sampleUrl: string; mimeType: string; seconds: number; label: string; cloned?: boolean }
const pendingRecordings = ref<PendingRec[]>([])
const playingPendingId = ref('')
let pendingAudio: HTMLAudioElement | null = null

async function loadPendingRecordings() {
  try {
    const aid = currentAgentId()
    const [pr, vr] = await Promise.all([
      fetch(`/api/voice/pending?agentId=${encodeURIComponent(aid)}`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/voice/voices?agentId=${encodeURIComponent(aid)}`).then(r => r.json()).catch(() => ({})),
    ])
    const pending: PendingRec[] = (Array.isArray(pr.pending) ? pr.pending : []).map((p: any) => ({ ...p, cloned: false }))
    // 已克隆音色的源录音（含本地 GPT-SoVITS）也列出来，可试听
    const seen = new Set(pending.map(p => p.sampleUrl))
    const fromVoices: PendingRec[] = (Array.isArray(vr.cloned) ? vr.cloned : [])
      .filter((v: any) => v.sampleUrl && !seen.has(v.sampleUrl))
      .map((v: any) => ({ id: 'voice_' + v.voiceId, sampleUrl: v.sampleUrl, mimeType: 'audio/wav', seconds: 0, label: v.name, cloned: true }))
    pendingRecordings.value = [...pending, ...fromVoices]
  } catch { /* ignore */ }
}
async function addPendingRecording(blob: Blob, mimeType: string, seconds: number, label = '录音') {
  try {
    const audioBase64 = await blobToBase64(blob)
    const resp = await fetch('/api/voice/pending', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType, seconds, label, agentId: currentAgentId(), filename: label }),
    })
    const d = await resp.json().catch(() => ({}))
    if (!resp.ok || d.ok === false) throw new Error(d.error || `HTTP ${resp.status}`)
    await loadPendingRecordings()
  } catch (e: any) {
    settingsNotice.value = '保存录音失败：' + (e?.message || '未知错误')
  }
}
function playPending(r: PendingRec) {
  if (playingPendingId.value === r.id && pendingAudio) {
    pendingAudio.pause(); pendingAudio = null; playingPendingId.value = ''; return
  }
  if (pendingAudio) { pendingAudio.pause(); pendingAudio = null }
  const a = new Audio(r.sampleUrl)
  a.onended = () => { if (playingPendingId.value === r.id) playingPendingId.value = '' }
  a.onerror = () => { playingPendingId.value = '' }
  pendingAudio = a; playingPendingId.value = r.id
  void a.play().catch(() => { playingPendingId.value = '' })
}
async function deletePending(r: PendingRec) {
  if (playingPendingId.value === r.id && pendingAudio) { pendingAudio.pause(); pendingAudio = null; playingPendingId.value = '' }
  try { await fetch('/api/voice/pending/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id }) }) } catch { /* ignore */ }
  await loadPendingRecordings()
}
async function cloneFromPending(r: PendingRec) {
  if (cloneBusy.value) return
  cloneBusy.value = true
  settingsNotice.value = '正在用这条录音克隆音色…'
  try {
    const resp = await fetch('/api/voice/clone', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleUrl: r.sampleUrl, name: `${props.agentName} 的声音`, provider: settingsDraft.value.backendProvider || 'auto', agentId: currentAgentId() }),
    })
    const d = await resp.json().catch(() => ({}))
    if (!resp.ok || d.ok === false) throw new Error(d.error || `HTTP ${resp.status}`)
    if (d.voiceId) {
      settingsDraft.value = { ...settingsDraft.value, provider: 'backend', backendVoiceId: d.voiceId, backendProvider: String(d.provider || 'cosyvoice'), clonedVoiceName: d.name || '' }
    }
    await loadClonedVoices()
    // 不删录音：保留在"我的录音"里，方便你看到所有在用的克隆录音
    settingsNotice.value = `已用这条录音生成音色：${d.name || ''}`
  } catch (e: any) {
    settingsNotice.value = '克隆失败：' + (e?.message || '未知错误')
  } finally {
    cloneBusy.value = false
  }
}
let previewAudio: HTMLAudioElement | null = null

// 删除一个克隆音色
async function deleteClonedVoice(v: { voiceId: string; name: string }): Promise<void> {
  if (deletingVoiceId.value) return
  if (!window.confirm(`确定删除音色「${v.name}」？删了不可恢复。`)) return
  deletingVoiceId.value = v.voiceId
  try {
    const resp = await fetch('/api/voice/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId: v.voiceId }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`)
    // 如果删的是当前选中的音色，清掉绑定
    if (settingsDraft.value.backendVoiceId === v.voiceId) {
      settingsDraft.value = { ...settingsDraft.value, provider: 'browser', backendVoiceId: '', clonedVoiceName: '' }
    }
    await loadClonedVoices()
    settingsNotice.value = `已删除音色「${v.name}」`
  } catch (e: any) {
    settingsNotice.value = '删除失败：' + (e?.message || '未知错误')
  } finally {
    deletingVoiceId.value = ''
  }
}

// 把常见英文/JSON 报错翻成通俗中文
function friendlyVoiceError(raw: string): string {
  const s = String(raw || '')
  if (/3-10 ?second|3–10 ?second|outside the 3/i.test(s)) return '参考音频时长要在 3–10 秒之间，当前这条不符合（本地 GPT-SoVITS 的限制）。建议选「云端」音色，或换更短的参考音。'
  if (/insufficient|余额|balance|arrears|欠费/i.test(s)) return '账户余额不足，请先到对应平台充值。'
  if (/invalid api key|api[_ ]?key|unauthorized|鉴权|\b401\b/i.test(s)) return 'API Key 无效或未授权，检查一下配置里的 key。'
  if (/未配置|not configured|no .*key|缺少/i.test(s)) return '还没配置对应的 key 或服务地址，先在 .env 配好。'
  if (/timeout|超时|ETIMEDOUT/i.test(s)) return '合成超时了，稍后再试一次。'
  if (/ECONNREFUSED|fetch failed|connect|network|连不上/i.test(s)) return '连不上合成服务，检查本地 GPT-SoVITS(9880 端口) 或网络。'
  if (/HTTP ?4\d\d|HTTP ?5\d\d/i.test(s)) return '合成服务返回错误，换个音色或稍后再试。'
  return '试听失败了，换个音色或稍后再试。'
}

let pitchDebounce: ReturnType<typeof setTimeout> | null = null
function clampRate(r: number): number { return Math.min(2, Math.max(0.5, Number(r) || 1)) }

// 情绪：用 CosyVoice 自然语言指令(instruct)实现，模型按情绪重生成，不靠改音调
const EMOTIONS = [
  { code: 'auto', label: '自动（AI 判断）', instruction: '' },
  { code: '', label: '平静（默认）', instruction: '' },
  { code: 'happy', label: '开心', instruction: '用开心、上扬的语气说' },
  { code: 'gentle', label: '温柔关心', instruction: '用温柔、关心的语气说' },
  { code: 'excited', label: '兴奋', instruction: '用兴奋、热情的语气说' },
  { code: 'serious', label: '严肃', instruction: '用严肃、认真的语气说' },
  { code: 'sad', label: '低落', instruction: '用低落、难过的语气说' },
]
function emotionInstruction(code: string): string {
  return EMOTIONS.find(e => e.code === code)?.instruction || ''
}
// 自动情绪：调后端用 LLM 判断该用什么情绪 → 转成指令
async function resolveInstruction(emotionCode: string, text: string): Promise<string> {
  if (emotionCode !== 'auto') return emotionInstruction(emotionCode)
  try {
    const r = await fetch('/api/voice/auto-emotion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(res => res.json())
    return emotionInstruction(r.emotion || '')
  } catch { return '' }
}

// 合成并播放：语速不烤进音频(用 playbackRate 实时控制)，音调烤进合成
async function synthAndPlayPreview(): Promise<void> {
  const d = settingsDraft.value
  if (d.provider !== 'backend' || !d.backendVoiceId) {
    settingsNotice.value = '请先在「已有克隆音色」里选一个音色,再试听'
    return
  }
  // 用所选音色"自己的"通道(云端音色→cosyvoice)，避免误用本地 GPT-SoVITS
  const matched = clonedVoices.value.find(v => v.voiceId === d.backendVoiceId)
  const provider = matched?.provider || d.backendProvider || 'cosyvoice'
  if (previewAudio) { previewAudio.pause(); previewAudio = null }
  previewing.value = true
  previewRawError.value = ''
  showRawError.value = false
  try {
    const theText = (previewText.value || '').trim() || '你好呀，我是你的语音助手，这是当前音色和语速的试听效果。'
    settingsNotice.value = d.emotion === 'auto' ? '判断情绪 + 合成中…' : '合成中…'
    const instruction = await resolveInstruction(d.emotion, theText)
    const resp = await fetch('/api/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: theText,
        voiceId: d.backendVoiceId,
        provider,
        instruction,
        pitch: d.pitch,   // 音调烤进合成；语速不烤，靠 playbackRate 实时调
      }),
    })
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}))
      throw new Error(e.error || `HTTP ${resp.status}`)
    }
    const url = URL.createObjectURL(await resp.blob())
    const audio = new Audio(url)
    audio.preservesPitch = true
    ;(audio as any).mozPreservesPitch = true
    ;(audio as any).webkitPreservesPitch = true
    audio.playbackRate = clampRate(d.rate)
    audio.onended = () => { previewing.value = false; URL.revokeObjectURL(url); if (previewAudio === audio) previewAudio = null }
    audio.onerror = () => { previewing.value = false; settingsNotice.value = '试听播放失败' }
    previewAudio = audio
    settingsNotice.value = '试听中…（拖语速实时变，音调拖完自动重听）'
    await audio.play()
  } catch (e: any) {
    previewing.value = false
    const raw = e?.message || '未知错误'
    previewRawError.value = raw
    settingsNotice.value = '试听失败：' + friendlyVoiceError(raw)
  }
}

async function previewVoiceSettings(): Promise<void> {
  if (previewing.value && previewAudio) {
    previewAudio.pause(); previewAudio = null; previewing.value = false; return
  }
  await synthAndPlayPreview()
}

// 语速：实时改播放速度，不重新合成（preservesPitch 保持音色不变调）
watch(() => settingsDraft.value.rate, (r) => {
  if (previewAudio) previewAudio.playbackRate = clampRate(r)
})
// 音调：浏览器无法不重合成就变调，拖停 500ms 后自动重合成（不用手动停了再放）
watch(() => settingsDraft.value.pitch, () => {
  if (!previewAudio && !previewing.value) return
  if (pitchDebounce) clearTimeout(pitchDebounce)
  pitchDebounce = setTimeout(() => { void synthAndPlayPreview() }, 500)
})
const cloneRecording = ref(false)
const cloneBusy = ref(false)
const cloneRecordingSeconds = ref(0)
const micEnvelopeLevel = ref(0)
const wavePhase = ref(0)
let frame = 0
let sphereScale = 1
let micHoldUntil = 0
let themeObserver: MutationObserver | null = null
let cloneRecorder: MediaRecorder | null = null
let cloneStream: MediaStream | null = null
let cloneTimer: ReturnType<typeof setInterval> | null = null

interface VoicePalette {
  particles: Record<BrowserVoiceCallState, [string, string, string]>
}

const VOICE_PALETTES: Record<'dark' | 'light', VoicePalette> = {
  dark: {
    particles: {
      idle: ['#6e747e', '#d7dde7', '#8c929d'],
      connecting: ['#15171c', '#8fbaff', '#d7dde7'],
      listening: ['#15171c', '#8fbaff', '#d7dde7'],
      thinking: ['#68a0ff', '#b29cff', '#d7dde7'],
      speaking: ['#f4fbff', '#49baff', '#d7dde7'],
      passive: ['#15171c', '#8fbaff', '#d7dde7'],
    },
  },
  light: {
    particles: {
      idle: ['#20242b', '#5c6674', '#a4acb7'],
      connecting: ['#111318', '#1d6fd8', '#6b7280'],
      listening: ['#111318', '#1d6fd8', '#6b7280'],
      thinking: ['#2467d1', '#7961c9', '#5c6674'],
      speaking: ['#111318', '#0d7ed8', '#5c6674'],
      passive: ['#111318', '#1d6fd8', '#6b7280'],
    },
  },
}

const stageThemeClass = computed(() => isLightTheme.value ? 'theme-light' : 'theme-dark')
const voiceSettingsKey = computed(() => props.agentKey || props.agentName)

const statusDotClass = computed(() => {
  if (props.error) return 'is-error'
  if (props.callState === 'thinking') return 'is-thinking'
  if (props.callState === 'idle') return 'is-standby'
  return 'is-active'
})

const stateLabel = computed(() => {
  const map: Record<BrowserVoiceCallState, string> = {
    idle: '语音对话',
    connecting: '连接中',
    listening: '正在听',
    thinking: '思考中',
    speaking: '正在说',
    passive: '待机中',
  }
  return map[props.callState]
})

const subtitle = computed(() => {
  const wakeWord = props.agentName.trim() || 'OpenClaw'
  if (props.callState === 'idle') return '点击开始和当前 Agent 说话'
  if (props.callState === 'listening') return `直接说话，或说「${wakeWord}」确认唤醒`
  if (props.callState === 'thinking') return '正在等待 Agent 回复'
  if (props.callState === 'speaking') return '可以随时打断'
  if (props.callState === 'passive') return `说「${wakeWord}」唤醒当前 Agent`
  return '正在准备麦克风'
})

const elapsedLabel = computed(() => {
  const m = Math.floor(props.elapsedSeconds / 60)
  const s = props.elapsedSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const captionTone = computed(() => props.error ? 'error' : props.transcript ? 'live' : 'info')

const captionText = computed(() => {
  if (props.error) return localizeVoiceMessage(props.error)
  if (props.transcript) return `“${props.transcript}”`
  if (props.responseText) return localizeVoiceMessage(props.responseText)
  return ''
})

const cloneStatusText = computed(() => {
  if (cloneBusy.value) return '处理中'
  if (cloneRecording.value) return '录音中'
  if (settingsDraft.value.provider === 'backend' && settingsDraft.value.backendVoiceId) {
    const provider = settingsDraft.value.backendProvider || 'auto'
    return `${settingsDraft.value.clonedVoiceName || '已绑定音色'} · ${provider}`
  }
  if (settingsDraft.value.sampleUrl) return '样本已保存'
  return '未克隆'
})

const currentVoiceSummary = computed(() => {
  if (settingsDraft.value.provider === 'backend' && settingsDraft.value.backendVoiceId) {
    return `当前音色：${settingsDraft.value.clonedVoiceName || settingsDraft.value.backendVoiceId}`
  }
  if (settingsDraft.value.sampleName) {
    return `当前样本：${settingsDraft.value.sampleName}`
  }
  return '当前 Agent 暂无声音样本'
})

const fallbackVoiceSummary = computed(() => {
  if (!settingsDraft.value.browserVoiceURI) return '系统默认'
  const selected = voiceOptions.value.find((voice) => voice.voiceURI === settingsDraft.value.browserVoiceURI)
  return selected ? `${selected.name} · ${selected.lang}` : '已选择'
})

const voiceSettingsNote = computed(() => {
  if (settingsNotice.value) return settingsNotice.value
  if (settingsDraft.value.provider === 'backend' && settingsDraft.value.backendVoiceId) {
    return `已绑定 ${settingsDraft.value.clonedVoiceName || '克隆音色'}。通话回复会优先使用该音色，失败时回退浏览器兜底音色。`
  }
  if (settingsDraft.value.sampleName) return `已保存声音样本：${settingsDraft.value.sampleName}`
  return '克隆需要后端 TTS：DashScope/CosyVoice、本地 GPT-SoVITS，或 OPENCLAW_VOICE_TTS_COMMAND。'
})

const isLiveParticleState = computed(() => ['connecting', 'listening', 'passive', 'speaking'].includes(props.callState))

const micWaveActive = computed(() => {
  if (props.isMuted) return false
  if (!['listening', 'passive'].includes(props.callState)) return false
  return micEnvelopeLevel.value > 0.025
})

const waveBars = computed(() => {
  const base = [8, 13, 19, 24, 18, 27, 21, 15, 24, 17, 12, 8]
  const idleHeight = 5
  if (!micWaveActive.value) return base.map(() => idleHeight)
  const level = Math.min(1, Math.max(0, micEnvelopeLevel.value))
  const phase = wavePhase.value
  return base.map((height, index) => {
    const edgeSoftness = index <= 1 || index >= base.length - 2 ? 0.72 : 1
    const flow = 0.84
      + Math.sin(phase * 0.006 + index * 0.78) * 0.16
      + Math.sin(phase * 0.0028 + index * 1.62) * 0.08
    return Math.round(idleHeight + height * (0.26 + level * 0.74) * flow * edgeSoftness)
  })
})

function localizeVoiceMessage(message: string): string {
  const raw = String(message || '').trim()
  const normalized = raw.toLowerCase()
  const map: Record<string, string> = {
    network: '语音识别网络连接失败，请检查当前网络或稍后重试。',
    'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏里允许麦克风。',
    'service-not-allowed': '浏览器语音识别服务不可用，请切换到可信 HTTPS 入口后重试。',
    'audio-capture': '没有检测到可用麦克风，请检查输入设备。',
    'bad-grammar': '语音识别语法配置不可用。',
    'language-not-supported': '当前浏览器不支持中文语音识别。',
  }
  if (map[normalized]) return map[normalized]
  return raw
}

function syncTheme() {
  isLightTheme.value = document.documentElement.classList.contains('light-theme')
}

function updateVoiceOptions() {
  voiceOptions.value = availableBrowserVoices()
}

function openVoiceSettings() {
  settingsDraft.value = loadAgentVoiceSettings(voiceSettingsKey.value)
  settingsNotice.value = ''
  updateVoiceOptions()
  settingsOpen.value = true
  void refreshVoiceProviderAvailability()
}

function saveVoiceSettingsDraft() {
  saveAgentVoiceSettings(voiceSettingsKey.value, settingsDraft.value)
  settingsNotice.value = '已保存当前 Agent 的语音设置。'
  settingsOpen.value = false
}

async function refreshVoiceProviderAvailability() {
  if (settingsDraft.value.provider !== 'backend' || !settingsDraft.value.backendVoiceId) return
  try {
    const resp = await fetch('/api/voice/capabilities')
    const data = await resp.json().catch(() => ({}))
    const provider = settingsDraft.value.backendProvider || 'cosyvoice'
    const tts = data?.tts || {}
    const ready = provider === 'cosyvoice'
      ? Boolean(tts.dashscopeConfigured)
      : provider === 'command'
        ? Boolean(tts.localCommandConfigured)
        : Boolean(tts.gptSoVitsConfigured)
    if (ready) return
    settingsDraft.value = {
      ...settingsDraft.value,
      provider: 'browser',
      cloneStatus: 'pending-config',
    }
    saveAgentVoiceSettings(voiceSettingsKey.value, settingsDraft.value)
    settingsNotice.value = '声音样本已保存，但当前没有配置可用的克隆音色合成引擎，已先切回浏览器兜底播放。'
  } catch {
    // 能力检测失败时不打断设置面板。
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return window.btoa(binary)
}

function preferredRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function stopCloneStream() {
  cloneStream?.getTracks().forEach((track) => track.stop())
  cloneStream = null
}

function clearCloneTimer() {
  if (cloneTimer) {
    clearInterval(cloneTimer)
    cloneTimer = null
  }
}

async function uploadAndCloneVoice(blob: Blob, filename: string, mimeType: string) {
  cloneBusy.value = true
  settingsNotice.value = '正在上传声音样本...'
  try {
    const audioBase64 = await blobToBase64(blob)
    const uploadResp = await fetch('/api/voice/samples', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64,
        mimeType: mimeType || blob.type || 'audio/webm',
        filename,
      }),
    })
    const uploadData = await uploadResp.json().catch(() => ({}))
    if (!uploadResp.ok || !uploadData.url) {
      throw new Error(uploadData.error || '声音样本上传失败')
    }

    settingsNotice.value = '样本已上传，正在创建克隆音色...'
    const cloneResp = await fetch('/api/voice/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleUrl: uploadData.url,
        name: `${props.agentName} 的声音`,
        provider: settingsDraft.value.backendProvider || 'auto',
        agentId: currentAgentId(),  // 归属当前 Agent，只在它的面板显示
      }),
    })
    const cloneData = await cloneResp.json().catch(() => ({}))
    if (!cloneResp.ok || !cloneData.voiceId) {
      throw new Error(cloneData.error || '克隆音色创建失败')
    }

    const synthesisReady = cloneData.synthesisReady === true
      || (cloneData.status === 'ready' && cloneData.provider !== 'local-reference')
    settingsDraft.value = {
      ...settingsDraft.value,
      provider: synthesisReady ? 'backend' : 'browser',
      backendVoiceId: String(cloneData.voiceId),
      backendProvider: String(cloneData.provider || settingsDraft.value.backendProvider || ''),
      clonedVoiceName: String(cloneData.name || `${props.agentName} 的声音`),
      cloneStatus: String(cloneData.status || 'ready'),
      sampleName: String(uploadData.filename || filename),
      sampleUrl: String(uploadData.url || ''),
      sampleDataUrl: '',
    }
    saveAgentVoiceSettings(voiceSettingsKey.value, settingsDraft.value)
    settingsNotice.value = cloneData.message
      || (!synthesisReady
        ? '声音样本已保存；配置本地 GPT-SoVITS、CosyVoice 或 TTS 命令后即可用它发声。'
        : '语音克隆已完成，并已绑定到当前 Agent。')
  } catch (e: any) {
    settingsNotice.value = e?.message || '语音克隆失败，请检查后端配置。'
  } finally {
    cloneBusy.value = false
  }
}

void captionTone.value
void captionText.value
void currentVoiceSummary.value
void fallbackVoiceSummary.value
void uploadAndCloneVoice

async function startCloneRecording() {
  if (cloneBusy.value || cloneRecording.value) return
  if (!navigator.mediaDevices?.getUserMedia) {
    settingsNotice.value = '当前浏览器没有麦克风录音接口，请用 HTTPS 或 127.0.0.1 打开工作台。'
    return
  }
  if (typeof MediaRecorder === 'undefined') {
    settingsNotice.value = '当前浏览器不支持 MediaRecorder，无法录制声音样本。'
    return
  }

  try {
    const mimeType = preferredRecordingMimeType()
    cloneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const chunks: BlobPart[] = []
    cloneRecorder = new MediaRecorder(cloneStream, mimeType ? { mimeType } : undefined)
    cloneRecorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data)
    }
    cloneRecorder.onstop = () => {
      clearCloneTimer()
      const secs = cloneRecordingSeconds.value
      cloneRecording.value = false
      cloneRecorder = null
      stopCloneStream()
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
      if (blob.size < 500) {
        settingsNotice.value = '没录到声音，再试一次。'
        return
      }
      // 不自动克隆：进"待确认录音"列表，让用户试听后决定删/克隆
      addPendingRecording(blob, mimeType || 'audio/webm', secs, '录音')
      settingsNotice.value = '录好了，在下面试听，满意再点「用这条克隆」。'
    }
    cloneRecordingSeconds.value = 0
    cloneRecording.value = true
    settingsNotice.value = '正在录音，请自然说话 15-30 秒。'
    cloneTimer = setInterval(() => {
      cloneRecordingSeconds.value += 1
      if (cloneRecordingSeconds.value >= 60) stopCloneRecording()
    }, 1000)
    cloneRecorder.start()
  } catch (e: any) {
    stopCloneStream()
    clearCloneTimer()
    cloneRecording.value = false
    settingsNotice.value = e?.message || '无法启动声音样本录制。'
  }
}

function stopCloneRecording() {
  if (cloneRecorder?.state === 'recording') {
    try {
      cloneRecorder.stop()
    } catch {
      cloneRecording.value = false
      stopCloneStream()
      clearCloneTimer()
    }
  }
}

function onVoiceSampleChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 32 * 1024 * 1024) {
    settingsNotice.value = '声音样本建议小于 32MB，请换一个更短的音频。'
    input.value = ''
    return
  }
  // 上传的文件也进"待确认"，试听后再决定克隆
  addPendingRecording(file, file.type || 'audio/webm', 0, file.name.replace(/\.[^.]+$/, ''))
  settingsNotice.value = '已加入待确认，在下面试听，满意再点「用这条克隆」。'
  input.value = ''
}

function initParticles() {
  particles.length = 0
  const count = 2200
  const sphereRadius = 180
  for (let i = 0; i < count; i++) {
    const u = Math.random()
    const v = Math.random()
    const theta = Math.PI * 2 * u
    const phi = Math.acos(2 * v - 1)
    const radius = Math.pow(Math.random(), 1 / 3) * sphereRadius
    const bx = Math.sin(phi) * Math.cos(theta) * radius
    const by = Math.sin(phi) * Math.sin(theta) * radius
    const bz = Math.cos(phi) * radius
    const seed = Math.random()
    particles.push({
      bx,
      by,
      bz,
      x: bx,
      y: by,
      z: bz,
      size: Math.random() * 1.5 + 0.5,
      kind: seed < 0.4 ? 'signal' : seed < 0.8 ? 'core' : 'void',
    })
  }
}

function currentPalette(): VoicePalette {
  return isLightTheme.value ? VOICE_PALETTES.light : VOICE_PALETTES.dark
}

function stateColor(kind: Particle['kind'], time: number, baseX: number): string {
  const visualState = isLiveParticleState.value ? 'listening' : props.callState
  const palette = currentPalette().particles[visualState]
  if (kind === 'core') return palette[1]
  if (kind === 'void') return palette[2]
  if (visualState === 'thinking') {
    const hue = Math.sin(time * 0.0005 + baseX * 0.03) * 18 + (isLightTheme.value ? 216 : 202)
    return `hsl(${hue}, ${isLightTheme.value ? 74 : 86}%, ${isLightTheme.value ? 45 : 66}%)`
  }
  return palette[0]
}

function updateMicWaveFeedback(time: number) {
  const canListen = !props.isMuted && ['listening', 'passive'].includes(props.callState)
  const rawLevel = canListen ? Math.max(0, props.audioLevel - 0.01) * 10 : 0
  const target = Math.min(1, rawLevel)
  if (target > 0.025) {
    micHoldUntil = time + 720
  }

  const heldTarget = canListen && time < micHoldUntil ? Math.max(target, 0.22) : target
  const smoothing = heldTarget > micEnvelopeLevel.value ? 0.34 : 0.045
  const next = micEnvelopeLevel.value + (heldTarget - micEnvelopeLevel.value) * smoothing
  micEnvelopeLevel.value = next < 0.008 ? 0 : next
  wavePhase.value = time
}

function render(time: number) {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return

  updateMicWaveFeedback(time)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const currentCallState = props.callState
  const liveParticleState = isLiveParticleState.value
  const syntheticVoiceLevel = liveParticleState
    ? 0.22 + Math.sin(time * 0.004) * 0.06
    : currentCallState === 'thinking'
      ? 0.08
      : 0
  const targetScale = liveParticleState ? 1.02 : currentCallState === 'thinking' ? 1.01 : 1
  sphereScale += (targetScale - sphereScale) * 0.05

  if (!pointer.active) {
    const speedFactor = currentCallState === 'thinking'
      ? 4
      : liveParticleState
        ? 2.2
        : 1
    rotation.y += 0.005 * speedFactor
    rotation.x += 0.002 * speedFactor
  }

  const cosX = Math.cos(rotation.x)
  const sinX = Math.sin(rotation.x)
  const cosY = Math.cos(rotation.y)
  const sinY = Math.sin(rotation.y)

  for (const p of particles) {
    const radialUnit = Math.sqrt(p.bx ** 2 + p.by ** 2 + p.bz ** 2) + 0.001
    const audioWave = syntheticVoiceLevel * 50
    const wave = Math.sin(time * 0.002 + (p.bx + p.by + p.bz) * 0.01) * (15 + audioWave)
    const factor = (radialUnit * sphereScale + wave) / radialUnit
    let x = p.bx * factor
    let y = p.by * factor
    let z = p.bz * factor

    const y1 = y * cosX - z * sinX
    const z1 = y * sinX + z * cosX
    y = y1
    z = z1
    const x1 = x * cosY + z * sinY
    const z2 = -x * sinY + z * cosY
    p.x = x1
    p.y = y
    p.z = z2
  }

  particles.sort((a, b) => a.z - b.z)

  for (const p of particles) {
    const pz = Math.max(-300, Math.min(p.z, 590))
    const perspective = 600 / (600 - pz)
    const x = cx + p.x * perspective
    const y = cy + p.y * perspective
    const size = p.size * perspective
    const alpha = Math.max(0.1, Math.min(1, perspective - 0.4))
    if (p.kind === 'void') {
      ctx.globalAlpha = isLightTheme.value ? 0.28 : 0.22
      ctx.strokeStyle = stateColor(p.kind, time, p.bx)
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.globalAlpha = p.kind === 'signal' ? alpha : alpha * 0.78
      ctx.fillStyle = stateColor(p.kind, time, p.bx)
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
      if (liveParticleState && p.kind === 'signal') {
        ctx.globalAlpha = alpha * 0.16
        ctx.beginPath()
        ctx.arc(x, y, size * 2.4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.globalAlpha = 1

  frame = requestAnimationFrame(render)
}

function onPointerDown(event: PointerEvent) {
  pointer.active = true
  pointer.x = event.clientX
  pointer.y = event.clientY
}

function onPointerMove(event: PointerEvent) {
  if (!pointer.active) return
  const dx = event.clientX - pointer.x
  const dy = event.clientY - pointer.y
  rotation.y += dx * 0.008
  rotation.x -= dy * 0.008
  pointer.x = event.clientX
  pointer.y = event.clientY
}

function onPointerUp() {
  pointer.active = false
}

onMounted(() => {
  loadClonedVoices()
  loadPendingRecordings()
  syncTheme()
  updateVoiceOptions()
  window.speechSynthesis?.addEventListener?.('voiceschanged', updateVoiceOptions)
  themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  initParticles()
  frame = requestAnimationFrame(render)
})

onUnmounted(() => {
  themeObserver?.disconnect()
  window.speechSynthesis?.removeEventListener?.('voiceschanged', updateVoiceOptions)
  if (frame) cancelAnimationFrame(frame)
  clearCloneTimer()
  if (cloneRecorder?.state === 'recording') {
    try { cloneRecorder.stop() } catch { /* noop */ }
  }
  stopCloneStream()
})
</script>

<style scoped>
.agent-voice-stage {
  position: fixed;
  z-index: 3001;
  top: 0;
  left: 0;
  bottom: 0;
  width: clamp(340px, 22vw, 420px);
  max-width: 420px;
  min-width: 340px;
  pointer-events: auto;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  color: var(--voice-text);
  overflow: hidden;
  backdrop-filter: blur(18px) saturate(1.08);
  border-right: 1px solid var(--voice-stage-border);
  box-shadow: 10px 0 26px var(--voice-stage-shadow);
  background: var(--voice-stage-bg);
  --voice-stage-bg: #161617;
  --voice-stage-border: rgba(255, 255, 255, 0.08);
  --voice-stage-shadow: rgba(0, 0, 0, 0.14);
  --voice-panel-border: rgba(255, 255, 255, 0.1);
  --voice-panel-bg: #161617;
  --voice-panel-shadow: rgba(0, 0, 0, 0.12);
  --voice-text: rgba(242, 247, 246, 0.92);
  --voice-muted: rgba(220, 232, 230, 0.58);
  --voice-soft: rgba(220, 232, 230, 0.42);
  --voice-chip-bg: rgba(18, 19, 22, 0.68);
  --voice-chip-border: rgba(255, 255, 255, 0.12);
  --voice-control-bg: rgba(24, 25, 29, 0.66);
  --voice-control-border: rgba(255, 255, 255, 0.14);
  --voice-control-color: rgba(235, 240, 248, 0.88);
  --voice-primary-bg: rgba(18, 20, 24, 0.96);
  --voice-primary-color: rgba(245, 248, 252, 0.96);
  --voice-primary-shadow: 0 0 30px rgba(143, 186, 255, 0.18);
  --voice-primary-idle-bg: rgba(29, 31, 36, 0.58);
  --voice-primary-idle-color: rgba(237, 247, 245, 0.78);
  --voice-active-bg: rgba(255, 255, 255, 0.08);
  --voice-active-color: #8fbaff;
  --voice-caption-bg: rgba(18, 19, 22, 0.72);
  --voice-caption-border: rgba(255, 255, 255, 0.12);
  --voice-error: #f0a36f;
  --voice-dot-standby: #0a84ff;
  --voice-dot-active: #30d158;
  --voice-dot-thinking: #ffcc00;
  --voice-dot-error: #ff453a;
  --voice-agent-y: 63%;
  --voice-wave-gap: 54px;
  --voice-control-gap: 112px;
  --voice-speaking-shadow-a: 0 0 28px rgba(73, 186, 255, 0.24);
  --voice-speaking-shadow-b: 0 0 48px rgba(143, 186, 255, 0.26);
}

.agent-voice-stage.theme-light {
  --voice-stage-bg: #ffffff;
  --voice-stage-border: rgba(24, 27, 32, 0.12);
  --voice-stage-shadow: rgba(33, 37, 44, 0.06);
  --voice-panel-border: rgba(24, 27, 32, 0.1);
  --voice-panel-bg: #ffffff;
  --voice-panel-shadow: rgba(33, 37, 44, 0.06);
  --voice-text: rgba(30, 43, 52, 0.9);
  --voice-muted: rgba(68, 83, 96, 0.62);
  --voice-soft: rgba(83, 98, 110, 0.48);
  --voice-chip-bg: rgba(255, 255, 255, 0.7);
  --voice-chip-border: rgba(24, 27, 32, 0.12);
  --voice-control-bg: rgba(255, 255, 255, 0.74);
  --voice-control-border: rgba(24, 27, 32, 0.12);
  --voice-control-color: rgba(34, 49, 60, 0.86);
  --voice-primary-bg: rgba(19, 22, 27, 0.92);
  --voice-primary-color: #ffffff;
  --voice-primary-shadow: 0 0 30px rgba(24, 27, 32, 0.16);
  --voice-primary-idle-bg: rgba(255, 255, 255, 0.76);
  --voice-primary-idle-color: rgba(43, 64, 78, 0.78);
  --voice-active-bg: rgba(24, 27, 32, 0.08);
  --voice-active-color: #1d6fd8;
  --voice-caption-bg: rgba(255, 255, 255, 0.82);
  --voice-caption-border: rgba(24, 27, 32, 0.12);
  --voice-error: #b35f2f;
  --voice-dot-standby: #0a84ff;
  --voice-dot-active: #30c75a;
  --voice-dot-thinking: #d88a00;
  --voice-dot-error: #ff3b30;
  --voice-speaking-shadow-a: 0 0 26px rgba(24, 27, 32, 0.14);
  --voice-speaking-shadow-b: 0 0 40px rgba(29, 111, 216, 0.18);
}

.agent-voice-stage.theme-dark.state-thinking {
  --voice-panel-border: rgba(104, 160, 255, 0.2);
  --voice-primary-bg: rgba(104, 160, 255, 0.94);
  --voice-primary-color: rgba(7, 18, 34, 0.96);
  --voice-primary-shadow: 0 0 36px rgba(104, 160, 255, 0.26);
}

.agent-voice-stage.theme-dark.state-speaking {
  --voice-panel-border: rgba(255, 255, 255, 0.12);
  --voice-primary-bg: rgba(18, 20, 24, 0.98);
  --voice-primary-color: rgba(245, 248, 252, 0.96);
  --voice-primary-shadow: 0 0 38px rgba(143, 186, 255, 0.24);
}

.agent-voice-stage.theme-dark.state-passive {
  --voice-panel-border: rgba(150, 164, 162, 0.12);
  --voice-primary-bg: rgba(149, 164, 162, 0.68);
  --voice-primary-shadow: none;
}

.agent-voice-stage.theme-light.state-thinking {
  --voice-panel-border: rgba(36, 103, 209, 0.18);
  --voice-primary-bg: rgba(36, 103, 209, 0.92);
  --voice-primary-shadow: 0 0 30px rgba(36, 103, 209, 0.2);
}

.agent-voice-stage.theme-light.state-speaking {
  --voice-panel-border: rgba(24, 27, 32, 0.12);
  --voice-primary-bg: rgba(19, 22, 27, 0.94);
  --voice-primary-shadow: 0 0 34px rgba(24, 27, 32, 0.18);
}

.agent-voice-stage.theme-light.state-passive {
  --voice-panel-border: rgba(123, 133, 140, 0.14);
  --voice-primary-bg: rgba(123, 133, 140, 0.74);
  --voice-primary-shadow: none;
}

.voice-stage-inner {
  pointer-events: auto;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 0;
}

.voice-stage-surface {
  position: absolute;
  inset: 0;
  border-right: 1px solid var(--voice-panel-border);
  border-radius: 0;
  background: var(--voice-panel-bg);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    inset 0 0 70px var(--voice-panel-shadow);
}

.voice-settings-trigger {
  position: absolute;
  z-index: 4;
  top: clamp(58px, 8vh, 92px);
  right: 34px;
  width: 34px;
  height: 34px;
  border: 1px solid var(--voice-chip-border);
  border-radius: 50%;
  background: var(--voice-chip-bg);
  color: var(--voice-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(12px);
  transition: transform 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.voice-settings-trigger:hover {
  transform: translateY(-1px);
  color: var(--voice-active-color);
  border-color: color-mix(in srgb, var(--voice-active-color) 38%, var(--voice-chip-border));
}

.voice-stage-inner::before {
  display: none;
}

.voice-stage-inner::after {
  display: none;
}

.voice-canvas {
  position: absolute;
  z-index: 2;
  top: clamp(140px, 18vh, 200px);
  left: 50%;
  transform: translateX(-50%);
  width: min(96%, 540px);
  aspect-ratio: 1;
  cursor: grab;
}

.voice-canvas:active {
  cursor: grabbing;
}

.voice-agent-chip {
  position: absolute;
  z-index: 4;
  left: 50%;
  top: var(--voice-agent-y);
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 0;
  padding: 6px 10px 6px 7px;
  border: 1px solid var(--voice-chip-border);
  border-radius: 999px;
  background: var(--voice-chip-bg);
  backdrop-filter: blur(14px);
  color: var(--voice-muted);
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 10px 30px var(--voice-panel-shadow);
}

.voice-agent-chip img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

.voice-agent-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.voice-agent-kicker {
  font-size: 10px;
  color: var(--voice-soft);
  font-weight: 700;
}

.voice-agent-name {
  max-width: 112px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--voice-text);
  font-weight: 800;
}

.voice-agent-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--voice-dot-standby);
  box-shadow: 0 0 11px var(--voice-dot-standby);
}

.voice-agent-status-dot.is-active {
  background: var(--voice-dot-active);
  box-shadow: 0 0 12px var(--voice-dot-active);
}

.voice-agent-status-dot.is-thinking {
  background: var(--voice-dot-thinking);
  box-shadow: 0 0 12px var(--voice-dot-thinking);
}

.voice-agent-status-dot.is-error {
  background: var(--voice-dot-error);
  box-shadow: 0 0 12px var(--voice-dot-error);
}

.voice-wave-meter {
  position: absolute;
  z-index: 4;
  left: 50%;
  top: calc(var(--voice-agent-y) + var(--voice-wave-gap));
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  min-width: 116px;
}

.voice-wave-meter span {
  width: 4px;
  height: var(--bar-height);
  border-radius: 999px;
  background: var(--voice-active-color);
  opacity: 0.32;
  box-shadow: 0 0 12px color-mix(in srgb, var(--voice-active-color) 42%, transparent);
  transition: height 0.16s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease-out, background 0.18s ease;
}

.voice-wave-meter.is-active span {
  opacity: 0.88;
}

.voice-controls {
  position: absolute;
  z-index: 4;
  left: 50%;
  top: calc(var(--voice-agent-y) + var(--voice-control-gap));
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: min(82%, 320px);
}

.voice-control-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 58px;
}

.voice-icon-btn,
.voice-primary-btn {
  border: 1px solid var(--voice-control-border);
  background: var(--voice-control-bg);
  color: var(--voice-control-color);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.voice-icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  opacity: 0.82;
}

.voice-primary-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--voice-primary-bg);
  color: var(--voice-primary-color);
  box-shadow: var(--voice-primary-shadow);
}

.voice-primary-btn:not(.active) {
  background: var(--voice-primary-idle-bg);
  color: var(--voice-primary-idle-color);
  box-shadow: none;
}

.voice-icon-btn:hover,
.voice-primary-btn:hover {
  transform: translateY(-1px);
}

.voice-icon-btn.active {
  background: var(--voice-active-bg);
  color: var(--voice-active-color);
}

.voice-finish-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--voice-active-color);
  border-radius: 999px;
  background: rgba(143, 186, 255, 0.08);
  color: var(--voice-active-color);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease, transform 0.14s ease;
}

.voice-finish-btn:hover {
  background: rgba(143, 186, 255, 0.18);
  transform: translateY(-1px);
}

.agent-voice-stage.theme-light .voice-finish-btn {
  background: rgba(29, 111, 216, 0.07);
  border-color: var(--voice-active-color);
  color: var(--voice-active-color);
}

.agent-voice-stage.theme-light .voice-finish-btn:hover {
  background: rgba(29, 111, 216, 0.14);
}

.voice-status {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}

.voice-state {
  font-size: 13px;
  font-weight: 800;
  color: var(--voice-muted);
}

.voice-subtitle {
  font-size: 12px;
  color: var(--voice-soft);
  white-space: normal;
  line-height: 1.45;
}

.voice-time {
  font-size: 11px;
  color: var(--voice-active-color);
  font-variant-numeric: tabular-nums;
}

.voice-caption {
  position: absolute;
  z-index: 4;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  width: fit-content;
  max-width: min(82%, 340px);
  min-height: 0;
  padding: 9px 13px;
  border-radius: 999px;
  background: var(--voice-caption-bg);
  border: 1px solid var(--voice-caption-border);
  color: var(--voice-text);
  text-align: center;
  font-size: 12px;
  line-height: 1.45;
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 28px var(--voice-panel-shadow);
}

.voice-caption--error {
  color: var(--voice-error);
  border-color: rgba(240, 163, 111, 0.28);
}

.voice-settings-popover {
  position: absolute;
  z-index: 12;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: clamp(94px, 13vh, 128px) 22px 22px;
  background: rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(8px);
}

.voice-settings-card {
  width: min(94%, 430px);
  max-height: min(78vh, 720px);
  overflow-y: auto;
  border: 1px solid var(--voice-chip-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--voice-stage-bg) 88%, transparent);
  box-shadow: 0 18px 54px var(--voice-panel-shadow);
  padding: 16px;
  color: var(--voice-text);
}

.voice-settings-head,
.voice-settings-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.voice-settings-head {
  margin-bottom: 14px;
}

.voice-settings-head div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.voice-settings-head strong {
  font-size: 15px;
}

.voice-settings-head span,
.voice-settings-note {
  color: var(--voice-muted);
  font-size: 12px;
  line-height: 1.45;
}
.voice-show-raw {
  margin-left: 6px;
  color: #409eff;
  cursor: pointer;
  text-decoration: underline;
  white-space: nowrap;
}
.voice-raw-error {
  margin: 6px 0 0;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--voice-muted);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow: auto;
}
.voice-clone-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 132px;
  overflow-y: auto;
}
.voice-clone-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--voice-control-border);
  border-radius: 8px;
  background: var(--voice-control-bg);
}
.voice-clone-list li.active {
  border-color: #409eff;
}
.vcl-name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vcl-tag { font-size: 11px; color: var(--voice-muted); flex-shrink: 0; }
.vcl-del {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: #f56c6c;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 2px;
}
.vcl-del:disabled { opacity: 0.4; cursor: default; }
.voice-test-input {
  width: 100%;
}
.voice-test-input :deep(.el-textarea__inner) {
  font-size: 13px;
}
.voice-preview-btn {
  margin-top: 8px;
  width: 100%;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #409eff;
  border-radius: 10px;
  background: rgba(64, 158, 255, 0.08);
  color: #409eff;
  font-size: 14px;
  cursor: pointer;
}
.voice-preview-btn:hover { background: rgba(64, 158, 255, 0.15); }

.voice-settings-head button,
.voice-settings-actions button {
  border: 1px solid var(--voice-control-border);
  border-radius: 999px;
  background: var(--voice-control-bg);
  color: var(--voice-control-color);
  cursor: pointer;
}

.voice-settings-head button {
  width: 30px;
  height: 30px;
  font-size: 18px;
}

.voice-clone-card {
  position: relative;
  overflow: hidden;
  margin-bottom: 14px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--voice-active-color) 22%, var(--voice-chip-border));
  border-radius: 18px;
  background:
    radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--voice-active-color) 12%, transparent), transparent 46%),
    color-mix(in srgb, var(--voice-control-bg) 76%, transparent);
}

.voice-clone-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  color: var(--voice-text);
  font-size: 13px;
  font-weight: 800;
}

.voice-clone-title small {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--voice-muted);
  font-size: 11px;
  font-weight: 700;
}

.voice-clone-visual {
  display: flex;
  justify-content: center;
  padding: 4px 0 18px;
}

.voice-clone-orb {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--voice-active-color) 30%, transparent);
  background:
    radial-gradient(circle at 42% 38%, rgba(255, 255, 255, 0.16), transparent 38%),
    color-mix(in srgb, var(--voice-active-color) 18%, var(--voice-stage-bg));
  color: var(--voice-active-color);
  font-size: 34px;
  box-shadow:
    inset 0 0 24px color-mix(in srgb, var(--voice-active-color) 16%, transparent),
    0 18px 36px var(--voice-panel-shadow);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.voice-clone-card.is-recording .voice-clone-orb {
  animation: clone-recording-pulse 1.2s ease-in-out infinite;
  color: var(--voice-dot-active);
  border-color: color-mix(in srgb, var(--voice-dot-active) 45%, transparent);
}

.voice-clone-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.voice-clone-actions button,
.voice-clone-upload {
  height: 38px;
  border: 1px solid var(--voice-control-border);
  border-radius: 999px;
  background: var(--voice-control-bg);
  color: var(--voice-control-color);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.voice-clone-actions button.primary {
  border-color: transparent;
  background: var(--voice-active-color);
  color: #fff;
}

.voice-clone-actions button:disabled,
.voice-clone-upload.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.voice-clone-upload input {
  display: none;
}

.voice-clone-tip {
  margin: 12px 0 0;
  color: var(--voice-muted);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

/* #5 录音中指示 */
.voice-rec-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 4px 0 10px;
  color: #f56c6c;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.rec-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: #f56c6c;
  animation: rec-blink 1s ease-in-out infinite;
}
@keyframes rec-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
.rec-wave { display: inline-flex; align-items: center; gap: 2px; height: 16px; }
.rec-wave i {
  width: 2px; background: #f56c6c; border-radius: 1px;
  animation: rec-wave 0.9s ease-in-out infinite;
}
.rec-wave i:nth-child(1){ height: 6px; animation-delay: 0s; }
.rec-wave i:nth-child(2){ height: 12px; animation-delay: .15s; }
.rec-wave i:nth-child(3){ height: 16px; animation-delay: .3s; }
.rec-wave i:nth-child(4){ height: 10px; animation-delay: .45s; }
.rec-wave i:nth-child(5){ height: 7px; animation-delay: .6s; }
@keyframes rec-wave { 0%,100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }

/* #6 待确认录音列表 */
.pending-rec { margin-top: 12px; }
.pending-rec-title { font-size: 12px; color: var(--voice-muted); margin-bottom: 6px; }
.pending-rec ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pending-rec li {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border: 1px solid var(--voice-control-border); border-radius: 10px;
  background: var(--voice-control-bg);
}
.prec-label { flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prec-btn { border: none; background: transparent; cursor: pointer; display: inline-flex; align-items: center; padding: 2px 4px; font-size: 12px; }
.prec-btn.play { color: #409eff; }
.prec-btn.clone { color: #409eff; border: 1px solid #409eff; border-radius: 999px; padding: 2px 10px; flex-shrink: 0; }
.prec-btn.clone:disabled { opacity: 0.4; cursor: default; }
.prec-btn.del { color: #f56c6c; flex-shrink: 0; }
.prec-cloned-tag { flex-shrink: 0; font-size: 11px; color: #67c23a; border: 1px solid #67c23a; border-radius: 999px; padding: 1px 8px; }

.voice-clone-current {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--voice-control-border) 82%, transparent);
  background: color-mix(in srgb, var(--voice-stage-bg) 70%, transparent);
  color: var(--voice-muted);
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
}

.voice-clone-current span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-fallback-settings {
  margin: 0 0 12px;
  border: 1px solid var(--voice-control-border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--voice-control-bg) 68%, transparent);
}

.voice-fallback-settings summary {
  min-height: 38px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--voice-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  list-style: none;
}

.voice-fallback-settings summary::-webkit-details-marker {
  display: none;
}

.voice-fallback-settings summary::after {
  content: '展开';
  flex: 0 0 auto;
  color: var(--voice-soft);
  font-size: 11px;
  font-weight: 700;
}

.voice-fallback-settings[open] summary::after {
  content: '收起';
}

.voice-fallback-settings summary small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--voice-soft);
  font-size: 11px;
  font-weight: 700;
}

.voice-fallback-settings .voice-setting-field {
  padding: 0 12px 12px;
  margin-bottom: 0;
}

.voice-setting-field,
.voice-upload-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 12px;
  color: var(--voice-muted);
  font-size: 12px;
  font-weight: 700;
}

.voice-setting-field select,
.voice-setting-field input[type='range'],
.voice-upload-field input {
  width: 100%;
}

.voice-setting-field select {
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--voice-control-border);
  background: var(--voice-control-bg);
  color: var(--voice-text);
  padding: 0 10px;
  outline: none;
}

.voice-setting-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.voice-el-select {
  width: 100%;
}
.voice-list-toggle {
  margin-top: 6px;
  border: none;
  background: transparent;
  color: #409eff;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}
.voice-sliders {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 10px 0 22px;   /* 与下方文本拉开距离，消除压迫感 */
}
.voice-slider-row {
  padding: 0 6px;
}
.voice-slider-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 2px;
}
.voice-slider-label {
  font-size: 13px;
  color: var(--voice-control-color);
}
.voice-slider-val {
  font-size: 12px;
  color: #409eff;
  font-variant-numeric: tabular-nums;
}
.voice-slider-track {
  display: flex;
  align-items: center;
  gap: 10px;
}
.voice-slider-track :deep(.el-slider) {
  flex: 1;
}
.voice-slider-end {
  font-size: 11px;
  color: var(--voice-muted);
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.voice-upload-field input {
  color: var(--voice-soft);
}

.voice-settings-note {
  min-height: 34px;
  margin: 2px 0 14px;
}

.voice-settings-actions {
  justify-content: flex-end;
}

.voice-settings-actions button {
  min-width: 72px;
  height: 34px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  line-height: 1;
}
.voice-settings-actions button.btn-icon .el-icon {
  font-size: 15px;
  display: inline-flex;
}

.voice-settings-actions button.primary {
  background: var(--voice-active-color);
  color: #fff;
  border-color: transparent;
}

@keyframes clone-recording-pulse {
  0%, 100% {
    transform: scale(1);
    box-shadow:
      inset 0 0 24px color-mix(in srgb, var(--voice-dot-active) 16%, transparent),
      0 18px 36px var(--voice-panel-shadow);
  }
  50% {
    transform: scale(1.045);
    box-shadow:
      inset 0 0 30px color-mix(in srgb, var(--voice-dot-active) 26%, transparent),
      0 18px 46px color-mix(in srgb, var(--voice-dot-active) 20%, var(--voice-panel-shadow));
  }
}

.state-speaking .voice-primary-btn {
  animation: speaking-breathe 1.55s ease-in-out infinite;
}

@keyframes speaking-breathe {
  0%, 100% {
    box-shadow: var(--voice-speaking-shadow-a);
    transform: scale(1);
  }
  50% {
    box-shadow: var(--voice-speaking-shadow-b);
    transform: scale(1.035);
  }
}

@media (max-width: 1380px) {
  .agent-voice-stage {
    display: none;
  }
}

.voice-agent-chip--clickable {
  cursor: pointer;
  border-style: solid;
  font: inherit;
  transition: box-shadow 0.15s, filter 0.15s;
}
.voice-agent-chip--clickable:hover {
  /* 不动 transform(它负责居中),改用阴影+轻微提亮表达hover */
  box-shadow: 0 4px 14px rgba(0,0,0,0.14);
  filter: brightness(1.04);
}
.voice-agent-gear {
  margin-left: 6px;
  font-size: 13px;
  opacity: 0.6;
}
</style>
