/**
 * 认知引擎 + 情绪感知模块
 * 用户消息在发往 LLM 之前先过这层：规则分类 + 情绪分析
 * 不调 LLM，纯本地规则，0 token 消耗
 */

// ── 情绪分析 ─────────────────────────────────────────────────────────────────

const POSITIVE = [
  [/谢谢|感谢|多谢|太棒了|很好|不错|太好了|完美|厉害|优秀|棒|赞/, 0.4],
  [/thanks?|thank\s*you|thx|great|awesome|perfect|amazing|excellent/, 0.4],
  [/哈哈|开心|高兴|喜欢|❤|😊|😄|👍/, 0.35],
  [/好的|好|OK|ok|嗯嗯|明白|收到/, 0.2],
]

const NEGATIVE = [
  [/烦|讨厌|垃圾|狗屎|操|妈的|该死|shit|fuck|damn|wtf|awful|terrible/, 0.6],
  [/不行|不对|错了|失败|坏了|崩溃|不能|无法|怎么搞的|怎么回事/, 0.35],
  [/not\s*working|broken|bug|crash|error|fail|wrong|useless/, 0.35],
  [/烦躁|沮丧|头疼|受不了|无语|无奈|算了|放弃/, 0.45],
]

const URGENT = [
  [/快|急|马上|立刻|赶紧|迅速|紧急|urgent|asap|hurry|quick|fast|immediate/, 0.5],
  [/救命|help!|emergency|now!|right\s*now|sos/i, 0.7],
  [/[！!]{2,}/, 0.35],
  [/怎么办[？?]|how\s*do\s*i/i, 0.25],
]

export function analyzeSentiment(text) {
  let valence = 0, urgency = 0, frustration = 0

  for (const [re, w] of POSITIVE) {
    if (re.test(text)) { valence += w; break }
  }
  for (const [re, w] of NEGATIVE) {
    if (re.test(text)) { valence -= w; frustration += w * 0.8; break }
  }
  for (const [re, w] of URGENT) {
    if (re.test(text)) { urgency += w; break }
  }

  valence = Math.max(-1, Math.min(1, valence))
  urgency = Math.min(1, urgency)
  frustration = Math.min(1, frustration)

  let label = '中性'
  if (frustration > 0.4) label = '😤 沮丧'
  else if (urgency >= 0.5) label = '🔥 紧急'
  else if (valence > 0.3) label = '😊 正向'
  else if (valence < -0.2) label = '😕 负向'

  return { valence, urgency, frustration, label }
}

// ── 意图分类 ─────────────────────────────────────────────────────────────────
// type: greeting | time_query | status_check | simple_math | weather_mock | complex

const GREETING_RE = /^(你好|hi|hello|hey|嗨|早上好|晚上好|下午好|早|哈喽|在吗|在不)[！!？?。.，,\s]*$/i
const TIME_RE = /^(现在几点|几点了|现在是几点|今天几号|今天星期几|日期|时间|what time|what date)[？?。.]*$/i
const STATUS_RE = /^(你好不好|你怎么样|最近如何|状态怎么样|how are you)[？?。.]*$/i
const THANKS_RE = /^(谢谢|感谢|多谢|thanks?|thank\s*you)[你了!！。.，,\s]*$/i
const SIMPLE_MATH_RE = /^[\d\s\+\-\*\/\(\)\^%]+[=＝？?]*$/

// 中性的本地秒回池；部署者的 Agent 人格仍由它自己的配置决定。
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

const GREETING_REPLIES = {
  morning: ['早上好。需要我做什么？', '早上好，请告诉我需要处理的事情。'],
  afternoon: ['下午好。需要我做什么？', '下午好，请告诉我需要处理的事情。'],
  evening: ['晚上好。需要我做什么？', '晚上好，请告诉我需要处理的事情。'],
}
const THANKS_REPLIES = ['不客气。', '随时可以继续。']
const STATUS_REPLIES = ['当前状态正常。', '我已就绪，请告诉我下一项任务。']

export function classifyIntent(text) {
  const t = text.trim()
  if (!t) return { type: 'empty', label: '空消息', directResponse: null }

  if (GREETING_RE.test(t)) {
    const hour = new Date().getHours()
    const slot = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
    return { type: 'greeting', label: '问候', directResponse: pick(GREETING_REPLIES[slot]) }
  }

  if (THANKS_RE.test(t)) {
    return { type: 'thanks', label: '致谢', directResponse: pick(THANKS_REPLIES) }
  }

  if (TIME_RE.test(t)) {
    const now = new Date()
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
      weekday: 'long', hour: '2-digit', minute: '2-digit'
    })
    return { type: 'time_query', label: '时间查询', directResponse: `现在是 ${timeStr}` }
  }

  if (STATUS_RE.test(t)) {
    return { type: 'status_check', label: '状态问候', directResponse: pick(STATUS_REPLIES) }
  }

  if (SIMPLE_MATH_RE.test(t) && t.length < 30) {
    try {
      // 安全计算：只允许数字和运算符
      const expr = t.replace(/[^0-9+\-*/().% ]/g, '').trim()
      if (expr) {
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${expr})`)()
        if (typeof result === 'number' && isFinite(result)) {
          return { type: 'simple_math', label: '数学计算', directResponse: `${expr} = ${result} ✨` }
        }
      }
    } catch {}
  }

  // 简单判断是否需要 LLM：短句且无疑问词 → 可能是命令
  const needsLLM = t.length > 10 || /[？?]/.test(t) || /请|帮|能不能|可以|告诉|什么|为什么|怎么|如何|分析|写|生成|查/.test(t)
  return {
    type: 'complex',
    label: needsLLM ? '复杂推理' : '指令',
    directResponse: null
  }
}

// ── 情绪 → Agent 语气提示 ─────────────────────────────────────────────────────
// 返回一段注入 system prompt 的附加说明（追加到正式发送的消息前）

export function buildMoodContext(sentiment) {
  if (sentiment.frustration > 0.5) {
    return '[用户当前情绪：沮丧/不满。请先表达理解和共情，语气温和，避免说教，聚焦帮助解决问题。]'
  }
  if (sentiment.urgency >= 0.5) {
    return '[用户当前情绪：紧急。请直接给出最关键的答案或步骤，省略铺垫，高效简洁。]'
  }
  if (sentiment.valence > 0.4) {
    return '[用户当前情绪：正向。可以轻松愉快地回应。]'
  }
  return ''
}

// ── HTTP 处理器 ───────────────────────────────────────────────────────────────

export function handleCognitiveAnalyze(req, res) {
  const url = new URL(req.url, 'http://x')
  const text = url.searchParams.get('text') || ''
  const intent = classifyIntent(text)
  const sentiment = analyzeSentiment(text)
  const moodContext = buildMoodContext(sentiment)
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: true, intent, sentiment, moodContext }))
}

export function handleCognitiveHistory(req, res, cognitiveLogFile) {
  const { fsSync } = req._deps || {}
  try {
    const raw = fsSync?.existsSync(cognitiveLogFile)
      ? JSON.parse(fsSync.readFileSync(cognitiveLogFile, 'utf8'))
      : []
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, entries: raw.slice(-100) }))
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, entries: [] }))
  }
}
