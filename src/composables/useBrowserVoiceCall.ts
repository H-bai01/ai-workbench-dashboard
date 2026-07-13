import { computed, onUnmounted, ref } from 'vue'
import type { AgentVoiceSettings } from './useAgentVoiceSettings'
import { dashboardPublicConfig } from '../config/public'

export type BrowserVoiceCallState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'passive'

type SpeechRecognitionCtor = new () => SpeechRecognition

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string
  message?: string
}

interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
    webkitAudioContext?: typeof AudioContext
  }
}

interface UseBrowserVoiceCallOptions {
  onUtterance: (text: string) => Promise<string | null | undefined>
  onTranscript?: (text: string, isFinal: boolean) => void
  onResponse?: (text: string) => void
  getVoiceSettings?: () => AgentVoiceSettings | null | undefined
  getWakeWords?: () => Array<string | null | undefined>
}

function overlapRatio(a: string, b: string): number {
  const left = a.replace(/\s/g, '').toLowerCase()
  const right = b.replace(/\s/g, '').toLowerCase()
  if (!left || !right) return 0
  if (left.includes(right) || right.includes(left)) return 1
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let overlap = 0
  for (const ch of leftSet) {
    if (rightSet.has(ch)) overlap++
  }
  return overlap / Math.max(leftSet.size, rightSet.size)
}

function isFillerUtterance(text: string): boolean {
  return /^[嗯啊哦呃哼唉呀哈呵嗨喂诶唔嘶啧哎哦哟嘿嘛哇啦嘞][。！？.!?，,～~]*$/.test(text.trim())
}

const DEFAULT_WAKE_WORDS = ['OpenClaw']
function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
}

function normalizeWakeText(text: string): string {
  return text.replace(/[\s，,。.!！?？~～：:；;“”"'「」『』]/g, '').toLowerCase()
}

function splitWakeCommand(text: string, wakeWords: string[]): { woke: boolean; command: string } {
  const raw = text.trim()
  const normalized = normalizeWakeText(raw)
  for (const wakeWord of wakeWords) {
    const wake = normalizeWakeText(wakeWord)
    if (!normalized.startsWith(wake)) continue
    const matcher = new RegExp(`^\\s*${wakeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[，,。.!！?？~～：:；;、-]*\\s*`, 'i')
    return { woke: true, command: raw.replace(matcher, '').trim() }
  }
  return { woke: false, command: raw }
}

function speechRecognitionErrorText(errorCode?: string, fallback?: string): string {
  const code = String(errorCode || '').trim().toLowerCase()
  const map: Record<string, string> = {
    network: '语音识别网络连接失败，请检查当前网络或稍后重试。',
    'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏里允许麦克风。',
    'service-not-allowed': '浏览器语音识别服务不可用，请切换到可信 HTTPS 入口后重试。',
    'audio-capture': '没有检测到可用麦克风，请检查输入设备。',
    'bad-grammar': '语音识别语法配置不可用。',
    'language-not-supported': '当前浏览器不支持中文语音识别。',
  }
  if (map[code]) return map[code]
  return fallback || '语音识别暂时不可用，请稍后重试。'
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

function isBackendVoiceConfigError(message: string): boolean {
  return /未配置|OPENCLAW_|GPT-SoVITS|DashScope|TTS 命令|CosyVoice/.test(message)
}

function secureVoiceUrl(): string {
  const port = window.location.port || '31021'
  const suffix = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (!isLoopbackHost(window.location.hostname)) {
    return dashboardPublicConfig.trustedHttpsOrigin
      ? `${dashboardPublicConfig.trustedHttpsOrigin}${suffix}`
      : ''
  }
  const targetPort = port === '31021' ? '31023' : port
  return `https://${window.location.hostname}:${targetPort}${suffix}`
}

export function useBrowserVoiceCall(options: UseBrowserVoiceCallOptions) {
  function currentWakeWords(): string[] {
    const configured = options.getWakeWords?.() || []
    return [...new Set([...configured, ...DEFAULT_WAKE_WORDS]
      .map(value => String(value || '').trim())
      .filter(value => value.length > 0 && value.length <= 64))]
  }

  const callState = ref<BrowserVoiceCallState>('idle')
  const audioLevel = ref(0)
  const transcript = ref('')
  const responseText = ref('')
  const error = ref('')
  const isMuted = ref(false)
  const elapsedSeconds = ref(0)
  const connectionQuality = ref<'good' | 'fair' | 'poor'>('good')

  const streamRef = ref<MediaStream | null>(null)
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let animationId = 0
  let recognition: SpeechRecognition | null = null
  let mediaRecorder: MediaRecorder | null = null
  let restartingRecognition = false
  let timer: ReturnType<typeof setInterval> | null = null
  let passiveTimer: ReturnType<typeof setTimeout> | null = null
  let segmentTimer: number | null = null
  let segmentPeak = 0
  let usingBackendStt = false
  let backendSttBusy = false
  let currentRun = 0
  // ── VAD：像 ChatGPT 一样，连续听、检测到持续静默才算一轮说完 ──
  const VOICE_THRESHOLD = 0.02      // 音量超过此值算"在说话"
  const END_SILENCE_MS = 1300       // 说完后静默多久算一轮结束
  const MAX_UTTERANCE_MS = 30000    // 单轮最长，防跑飞
  const NO_VOICE_RESET_MS = 8000    // 一直没出声，多久重置这段录音
  let segVoiceDetected = false
  let segLastVoiceAt = 0
  let segStartedAt = 0
  // 浏览器识别：攒齐整段再发的缓冲 + 静默计时
  let browserBuffer = ''
  let browserSilenceTimer: ReturnType<typeof setTimeout> | null = null
  let currentAudio: HTMLAudioElement | null = null
  let currentAudioUrl = ''
  let voiceCapabilitiesCache: any = null
  let voiceCapabilitiesFetchedAt = 0
  const recentSpokenTexts: { text: string; until: number }[] = []

  const isActive = computed(() => callState.value !== 'idle')

  function clearPassiveTimer() {
    if (passiveTimer) {
      clearTimeout(passiveTimer)
      passiveTimer = null
    }
  }

  function armPassiveTimer() {
    clearPassiveTimer()
    passiveTimer = setTimeout(() => {
      if (callState.value === 'listening') callState.value = 'passive'
    }, 25_000)
  }

  function rememberSpokenText(text: string) {
    recentSpokenTexts.push({ text, until: Date.now() + 12_000 })
    while (recentSpokenTexts.length > 20) recentSpokenTexts.shift()
  }

  function isLikelyEcho(text: string): boolean {
    const now = Date.now()
    for (let i = recentSpokenTexts.length - 1; i >= 0; i--) {
      if (recentSpokenTexts[i].until <= now) recentSpokenTexts.splice(i, 1)
    }
    return recentSpokenTexts.some((entry) => overlapRatio(text, entry.text) > 0.55)
  }

  function updateAudioLevel() {
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (const value of data) {
      const v = (value - 128) / 128
      sum += v * v
    }
    audioLevel.value = Math.sqrt(sum / data.length)
    segmentPeak = Math.max(segmentPeak, audioLevel.value)
    // VAD：后端识别时连续录音，靠静默判断一轮何时结束（不再每 4.2s 硬切）
    if (usingBackendStt && mediaRecorder?.state === 'recording') {
      const now = Date.now()
      if (audioLevel.value > VOICE_THRESHOLD) { segVoiceDetected = true; segLastVoiceAt = now }
      const stop = () => { try { mediaRecorder?.stop() } catch { /* noop */ } }
      if (segVoiceDetected && now - segLastVoiceAt > END_SILENCE_MS) stop()        // 说过话且静默够久 → 一轮结束
      else if (!segVoiceDetected && now - segStartedAt > NO_VOICE_RESET_MS) stop()  // 一直没出声 → 重置
      else if (now - segStartedAt > MAX_UTTERANCE_MS) stop()                        // 单轮超长 → 强制结束
    }
    animationId = requestAnimationFrame(updateAudioLevel)
  }

  function secureContextHint(): string {
    const host = window.location.hostname
    const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    if (window.isSecureContext || localHost) return ''
    return `当前页面不是浏览器认可的安全来源，麦克风会被禁用。请用 https://${host}:${window.location.port || '31021'} 打开，或在本机用 http://127.0.0.1:${window.location.port || '31021'} 打开。`
  }

  function mediaDevicesHint(): string {
    const secureHint = secureContextHint()
    if (secureHint) return secureHint
    return '当前浏览器没有开放麦克风接口 navigator.mediaDevices.getUserMedia。请使用 Chrome / Edge，或用本地 HTTPS 模式启动工作台。'
  }

  function switchToSecureVoiceEntry() {
    const host = window.location.hostname
    const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    if (window.location.protocol === 'http:' && !localHost) {
      const target = secureVoiceUrl()
      if (target) window.location.assign(target)
    }
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    if (currentAudio) {
      try {
        currentAudio.pause()
        currentAudio.src = ''
      } catch {
        // Ignore audio element cleanup errors.
      }
      currentAudio = null
    }
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl)
      currentAudioUrl = ''
    }
  }

  function preferredSpeechVoice(settings: AgentVoiceSettings | null | undefined, lang: string): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices?.() || []
    if (!voices.length) return null
    if (settings?.browserVoiceURI) {
      const selected = voices.find((voice) => voice.voiceURI === settings.browserVoiceURI)
      if (selected) return selected
    }
    return voices.find((voice) => voice.lang?.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)))
      || voices.find((voice) => /chinese|mandarin|ting|mei|sinji|yu/i.test(`${voice.name} ${voice.lang}`))
      || voices[0]
  }

  async function loadVoiceCapabilities() {
    const now = Date.now()
    if (voiceCapabilitiesCache && now - voiceCapabilitiesFetchedAt < 30_000) return voiceCapabilitiesCache
    const resp = await fetch('/api/voice/capabilities')
    if (!resp.ok) return null
    voiceCapabilitiesCache = await resp.json().catch(() => null)
    voiceCapabilitiesFetchedAt = now
    return voiceCapabilitiesCache
  }

  async function backendVoiceProviderReady(provider: string): Promise<boolean> {
    const normalized = provider || 'cosyvoice'
    if (!['cosyvoice', 'gptsovits', 'local-reference', 'command'].includes(normalized)) return true
    const caps = await loadVoiceCapabilities().catch(() => null)
    const tts = caps?.tts || {}
    if (normalized === 'cosyvoice') return Boolean(tts.dashscopeConfigured)
    if (normalized === 'command') return Boolean(tts.localCommandConfigured)
    return Boolean(tts.gptSoVitsConfigured)
  }

  // 把回复切成句子，便于逐句流式播放（第一句尽快出声）
  function splitForStreaming(text: string): string[] {
    const parts = text.replace(/\n+/g, ' ').split(/(?<=[。！？!?…；;])/).map(s => s.trim()).filter(Boolean)
    const out: string[] = []
    for (const p of parts) {
      if (out.length && out[out.length - 1].length < 14) out[out.length - 1] += p   // 合并过短片段
      else out.push(p)
    }
    return out.length ? out : [text]
  }

  // 合成一句，返回音频 blob（不播放）
  async function synthOneSentence(text: string, settings: AgentVoiceSettings): Promise<Blob> {
    const resp = await fetch('/api/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceId: settings.backendVoiceId,
        provider: settings.backendProvider || undefined,
        rate: settings.rate,
        pitch: settings.pitch,
      }),
    })
    const contentType = resp.headers.get('content-type') || ''
    if (!resp.ok) {
      const data = contentType.includes('application/json') ? await resp.json().catch(() => ({})) : { error: await resp.text().catch(() => '') }
      throw new Error(data.error || `HTTP ${resp.status}`)
    }
    if (!contentType.startsWith('audio/')) throw new Error('后端没有返回音频数据')
    const blob = await resp.blob()
    if (!blob.size) throw new Error('后端返回了空音频')
    return blob
  }

  // 播放一段音频，播完 resolve
  function playOneBlob(blob: Blob): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      currentAudioUrl = URL.createObjectURL(blob)
      currentAudio = new Audio(currentAudioUrl)
      currentAudio.preload = 'auto'
      currentAudio.volume = 1
      const audioUrl = currentAudioUrl
      const cleanup = () => {
        if (currentAudioUrl === audioUrl) { URL.revokeObjectURL(currentAudioUrl); currentAudioUrl = ''; currentAudio = null }
      }
      currentAudio.onended = () => { cleanup(); resolve() }
      currentAudio.onerror = () => { cleanup(); reject(new Error('克隆音色音频播放失败')) }
      void currentAudio.play().catch((e) => { cleanup(); reject(e) })
    })
  }

  async function speakWithBackend(text: string, settings: AgentVoiceSettings): Promise<boolean> {
    if (settings.provider !== 'backend' || !settings.backendVoiceId) return false
    if (!(await backendVoiceProviderReady(settings.backendProvider))) return false
    const sentences = splitForStreaming(text)
    // 流式：播当前句的同时，已在合成下一句 → 第一句很快出声，后面无缝接上
    let nextBlob: Promise<Blob | null> = synthOneSentence(sentences[0], settings)
    for (let i = 0; i < sentences.length; i++) {
      let blob: Blob | null = null
      try { blob = await nextBlob } catch (e) { if (i === 0) throw e; break }
      nextBlob = i + 1 < sentences.length ? synthOneSentence(sentences[i + 1], settings).catch(() => null) : Promise.resolve(null)
      if (!isActive.value || isMuted.value || callState.value !== 'speaking') break   // 被打断/结束就停
      if (blob) { try { await playOneBlob(blob) } catch { break } }
    }
    return true
  }

  async function speak(text: string, speakOptions: { showSpeakingState?: boolean } = {}): Promise<void> {
    if (!text.trim()) return
    const showSpeakingState = speakOptions.showSpeakingState !== false
    stopSpeech()
    if (showSpeakingState) callState.value = 'speaking'
    responseText.value = text
    options.onResponse?.(text)
    rememberSpokenText(text)

    const settings = options.getVoiceSettings?.()
    if (settings?.provider === 'backend' && settings.backendVoiceId) {
      try {
        const usedBackend = await speakWithBackend(text, settings)
        if (usedBackend) return
      } catch (e: any) {
        const message = e?.message || '后端 TTS 不可用'
        if (!isBackendVoiceConfigError(message)) {
          error.value = `克隆音色播放失败：${message}`
        }
      }
    }

    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        error.value = '当前浏览器没有 speechSynthesis，无法播放语音回复。'
        resolve()
        return
      }

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = /[a-zA-Z]/.test(text) && !/[一-鿿]/.test(text) ? 'en-US' : 'zh-CN'
      const preferredVoice = preferredSpeechVoice(settings, utterance.lang)
      if (preferredVoice) utterance.voice = preferredVoice
      utterance.rate = clampNumber(settings?.rate, 1, 0.65, 1.6)
      utterance.pitch = clampNumber(settings?.pitch, 1, 0.5, 1.6)
      utterance.volume = 1
      utterance.onend = () => resolve()
      utterance.onerror = (event) => {
        if (['interrupted', 'canceled'].includes(String(event.error))) {
          resolve()
          return
        }
        error.value = `语音播放失败：${event.error || '浏览器没有可用朗读声音'}`
        resolve()
      }
      window.speechSynthesis.speak(utterance)
    })
  }

  function switchToBackendStt(reason?: string) {
    if (!isActive.value || usingBackendStt) return
    usingBackendStt = true
    restartingRecognition = false
    if (recognition) {
      try {
        recognition.onend = null
        recognition.onerror = null
        recognition.abort()
      } catch {
        // Ignore browser recognition shutdown errors.
      }
      recognition = null
    }
    error.value = ''
    responseText.value = reason
      ? `${reason} 已切换到工作台本地语音识别通道。`
      : '已切换到工作台本地语音识别通道。'
    if (callState.value === 'connecting') callState.value = 'listening'
    scheduleBackendSegment(120)
  }

  async function announceReady() {
    await speak('语音已连接，我在听。', { showSpeakingState: false })
    if (!isActive.value) return
    callState.value = 'listening'
    armPassiveTimer()
    if (usingBackendStt) scheduleBackendSegment()
  }

  async function acknowledgeWake() {
    await speak('我在，你说。')
    if (!isActive.value) return
    callState.value = 'listening'
    armPassiveTimer()
    if (usingBackendStt) scheduleBackendSegment()
  }

  function startTimer() {
    const started = Date.now()
    elapsedSeconds.value = 0
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      elapsedSeconds.value = Math.floor((Date.now() - started) / 1000)
    }, 1000)
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    elapsedSeconds.value = 0
  }

  function restartRecognitionSoon() {
    if (!recognition || !isActive.value || isMuted.value) return
    if (restartingRecognition) return
    restartingRecognition = true
    window.setTimeout(() => {
      restartingRecognition = false
      if (!recognition || !isActive.value || isMuted.value) return
      try {
        recognition.start()
      } catch {
        // Some browsers throw if recognition is already running.
      }
    }, 350)
  }

  function clearSegmentTimer() {
    if (segmentTimer) {
      window.clearTimeout(segmentTimer)
      segmentTimer = null
    }
  }

  function stopMediaRecorder() {
    clearSegmentTimer()
    if (mediaRecorder) {
      try { mediaRecorder.onstop = null; mediaRecorder.stop() } catch { /* noop */ }
      mediaRecorder = null
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

  async function transcribeWithBackend(blob: Blob): Promise<string> {
    const audioBase64 = await blobToBase64(blob)
    const resp = await fetch('/api/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64,
        mimeType: blob.type || 'audio/webm',
      }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || !data.text) {
      throw new Error(data.error || '本地语音识别没有可用配置')
    }
    return String(data.text)
  }

  function scheduleBackendSegment(delayMs = 250) {
    if (!usingBackendStt || !streamRef.value || !isActive.value || isMuted.value) return
    if (callState.value !== 'listening' && callState.value !== 'passive') return
    clearSegmentTimer()
    segmentTimer = window.setTimeout(() => startBackendSegment(), delayMs)
  }

  function startBackendSegment() {
    if (!streamRef.value || !usingBackendStt || !isActive.value || isMuted.value || backendSttBusy) return
    if (typeof MediaRecorder === 'undefined') {
      error.value = '当前浏览器没有 MediaRecorder，无法使用本地语音识别 fallback。'
      return
    }

    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ].find((type) => MediaRecorder.isTypeSupported(type))
    const chunks: BlobPart[] = []
    segmentPeak = 0

    try {
      mediaRecorder = new MediaRecorder(streamRef.value, mimeType ? { mimeType } : undefined)
    } catch (e: any) {
      error.value = e?.message || '无法启动本地语音录制'
      return
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data)
    }
    mediaRecorder.onstop = () => {
      const hadVoice = segVoiceDetected
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
      mediaRecorder = null
      if (!isActive.value || isMuted.value) return
      // 这一轮没听到人说话 → 不发，直接重新开一段继续听
      if (!hadVoice || blob.size < 1200) {
        scheduleBackendSegment(120)
        return
      }
      backendSttBusy = true
      void transcribeWithBackend(blob)
        .then((text) => handleFinalTranscript(text))
        .catch((e: any) => {
          error.value = e?.message || '本地语音识别失败'
          scheduleBackendSegment(800)
        })
        .finally(() => {
          backendSttBusy = false
          // handleFinalTranscript 提前 return（空文字/filler）时不会重启录音段
          // 此处兜底：没有 recording 也没有等待中的 segment 计时器 → 重新开始听
          if (isActive.value && !isMuted.value && usingBackendStt && !mediaRecorder && !segmentTimer) {
            if (callState.value === 'thinking') callState.value = 'listening'
            armPassiveTimer()
            scheduleBackendSegment(300)
          }
        })
    }

    // 连续录音；何时停由 VAD（updateAudioLevel 里检测持续静默）决定，不再每 4.2s 硬切
    segVoiceDetected = false
    segLastVoiceAt = Date.now()
    segStartedAt = Date.now()
    mediaRecorder.start()
    clearSegmentTimer()
  }

  // 浏览器识别：收到的 final 片段先攒进缓冲，静默够久才真正发出去（避免半句就发）
  function armBrowserSilence() {
    if (browserSilenceTimer) clearTimeout(browserSilenceTimer)
    browserSilenceTimer = setTimeout(() => {
      browserSilenceTimer = null
      const t = browserBuffer.trim()
      browserBuffer = ''
      if (t) void handleFinalTranscript(t)
    }, END_SILENCE_MS)
  }
  function clearBrowserSilence() {
    if (browserSilenceTimer) { clearTimeout(browserSilenceTimer); browserSilenceTimer = null }
    browserBuffer = ''
  }

  async function handleFinalTranscript(text: string) {
    let trimmed = text.trim()
    if (!trimmed || isFillerUtterance(trimmed) || isLikelyEcho(trimmed)) return

    const wake = splitWakeCommand(trimmed, currentWakeWords())
    if (callState.value === 'passive') {
      if (!wake.woke) return
      if (!wake.command) {
        await acknowledgeWake()
        return
      }
      trimmed = wake.command
    } else if (wake.woke) {
      if (!wake.command) {
        await acknowledgeWake()
        return
      }
      trimmed = wake.command
    }

    clearPassiveTimer()
    clearBrowserSilence()
    transcript.value = trimmed
    options.onTranscript?.(trimmed, true)

    const runId = ++currentRun
    stopSpeech()
    callState.value = 'thinking'

    try {
      const answer = await options.onUtterance(trimmed)
      if (runId !== currentRun || !isActive.value) return
      if (answer?.trim()) {
        await speak(answer)
      }
    } catch (e: any) {
      error.value = e?.message || '语音处理失败'
    } finally {
      if (runId === currentRun && isActive.value) {
        callState.value = 'listening'
        transcript.value = ''
        armPassiveTimer()
        if (usingBackendStt) scheduleBackendSegment()
      }
    }
  }

  function createRecognition(): SpeechRecognition {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      throw new Error('当前浏览器不支持 SpeechRecognition，请使用 Chrome / Edge，或后续接入云端 ASR。')
    }
    const rec = new Recognition()
    rec.lang = 'zh-CN'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = (event) => {
      let interim = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript || ''
        if (result.isFinal) finalText += text
        else interim += text
      }
      if (finalText) browserBuffer += finalText
      if (interim || finalText) {
        const shown = (browserBuffer + interim).trim()
        transcript.value = shown
        options.onTranscript?.(shown, false)
        if (callState.value === 'passive') callState.value = 'listening'
        armBrowserSilence()   // 每次有新语音都重置静默计时；静默 1.3s 才整段发出
      }
    }
    rec.onerror = (event) => {
      const msg = speechRecognitionErrorText(event.error, event.message)
      const code = String(event.error || '').toLowerCase()
      if (['network', 'service-not-allowed', 'language-not-supported'].includes(code)) {
        switchToBackendStt(msg)
        return
      }
      if (!['no-speech', 'aborted'].includes(String(event.error))) {
        error.value = msg
      }
      restartRecognitionSoon()
    }
    rec.onend = () => restartRecognitionSoon()
    return rec
  }

  async function startCall() {
    if (isActive.value) return
    error.value = ''
    responseText.value = ''
    transcript.value = ''
    callState.value = 'connecting'
    currentRun++

    try {
      const mediaDevices = navigator.mediaDevices
      if (!mediaDevices?.getUserMedia) {
        switchToSecureVoiceEntry()
        throw new Error(mediaDevicesHint())
      }

      const stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.value = stream
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextCtor) {
        throw new Error('当前浏览器没有 AudioContext，无法分析麦克风音量。')
      }
      audioContext = new AudioContextCtor()
      const source = audioContext.createMediaStreamSource(stream)
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      updateAudioLevel()

      const voiceSettings = options.getVoiceSettings?.()
      if (voiceSettings?.localSttPreferred) {
        // 国内推荐:直接用本地语音识别,跳过会失败的浏览器(Google)通道
        usingBackendStt = true
        recognition = null
      } else {
      try {
        recognition = createRecognition()
        recognition.start()
        usingBackendStt = false
      } catch (recognitionError: any) {
        recognition = null
        usingBackendStt = true
        responseText.value = recognitionError?.message
          ? `${recognitionError.message} 正在使用本地语音识别通道。`
          : '正在使用本地语音识别通道。'
      }
      }
      callState.value = 'listening'
      connectionQuality.value = 'good'
      isMuted.value = false
      startTimer()
      void announceReady()
    } catch (e: any) {
      error.value = e?.message || '无法启动语音会话'
      endCall()
    }
  }

  function endCall() {
    currentRun++
    clearPassiveTimer()
    stopMediaRecorder()
    stopSpeech()
    if (recognition) {
      try { recognition.onend = null; recognition.abort() } catch { /* noop */ }
      recognition = null
    }
    if (streamRef.value) {
      streamRef.value.getTracks().forEach((track) => track.stop())
      streamRef.value = null
    }
    if (audioContext) {
      void audioContext.close()
      audioContext = null
    }
    if (animationId) cancelAnimationFrame(animationId)
    stopTimer()
    isMuted.value = false
    usingBackendStt = false
    backendSttBusy = false
    audioLevel.value = 0
    transcript.value = ''
    callState.value = 'idle'
  }

  function interrupt() {
    if (!isActive.value) return
    currentRun++
    stopSpeech()
    stopMediaRecorder()
    callState.value = 'listening'
    armPassiveTimer()
    if (usingBackendStt) scheduleBackendSegment()
  }

  function toggleMute() {
    isMuted.value = !isMuted.value
    streamRef.value?.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted.value
    })
    if (isMuted.value) {
      try { recognition?.stop() } catch { /* noop */ }
      stopMediaRecorder()
    } else {
      if (usingBackendStt) scheduleBackendSegment()
      else restartRecognitionSoon()
    }
  }

  // 手动结束当前说话轮次（杂音环境下用户主动触发）
  function finishTurn() {
    if (!isActive.value || callState.value !== 'listening') return

    if (usingBackendStt && mediaRecorder?.state === 'recording') {
      // 后端 STT：强制标记说过话，立刻停录；改为 thinking 给即时视觉反馈
      segVoiceDetected = true
      callState.value = 'thinking'
      try { mediaRecorder.stop() } catch { /* noop */ }
      return
    }

    // 浏览器识别：取消静默等待，把已积累的缓冲立刻发出去
    if (browserSilenceTimer) { clearTimeout(browserSilenceTimer); browserSilenceTimer = null }
    const t = browserBuffer.trim()
    browserBuffer = ''
    if (t) {
      void handleFinalTranscript(t)
    } else {
      // 缓冲为空（还没有识别到文字）→ 轻提示
      error.value = '还没听到说话内容，请先说话再点。'
      window.setTimeout(() => { if (error.value.includes('还没听到')) error.value = '' }, 2500)
    }
  }

  onUnmounted(() => endCall())

  return {
    callState,
    audioLevel,
    transcript,
    responseText,
    error,
    isMuted,
    elapsedSeconds,
    connectionQuality,
    startCall,
    endCall,
    interrupt,
    toggleMute,
    finishTurn,
  }
}
