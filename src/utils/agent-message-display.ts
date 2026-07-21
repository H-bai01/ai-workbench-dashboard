export function cleanAgentContent(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/<\s*thinking[^>]*>[\s\S]*?<\/\s*thinking\s*>/gi, '')
    .replace(/<\s*antThinking[^>]*>[\s\S]*?<\/\s*antThinking\s*>/gi, '')
    .replace(/<\s*toolCall[^>]*>[\s\S]*?<\/\s*toolCall\s*>/gi, '')
    .replace(/<\?\s*toolCall[\s\S]*?\?>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function cleanUserContent(raw: string): string {
  if (!raw) return ''
  let text = raw.trim()
  text = text.replace(/^\[cron:[^\]\s]+(?:\s+([^\]]+))?\]\s*/i, (_match, title) => {
    const name = String(title || '').trim()
    return name ? `定时任务「${name}」触发：\n` : '定时任务触发：\n'
  }).trim()
  text = text.replace(/^\[message_id:\s*[^\]]+\]\s*/i, '').trim()
  text = text.replace(/^\[[a-z_]+:[^\]]+\]\s*/i, '').trim()
  text = text.replace(/^(?:ou|oc|on|open|user|chat)_[A-Za-z0-9_-]{10,}:\s*/i, '').trim()
  text = text.replace(/^miadn:\s*/i, '').trim()
  return text
}

export function stripInlineSystemNotice(raw: string): { content: string; notice: string } {
  if (!raw) return { content: '', notice: '' }
  const notices: string[] = []
  const content = raw
    .replace(/\[System:[\s\S]*?\]/g, match => {
      notices.push(match.replace(/^\[System:\s*/i, '').replace(/\]$/g, '').trim())
      return ''
    })
    .replace(/<system[\s\S]*?<\/system>/gi, match => {
      notices.push(match.replace(/<\/?system[^>]*>/gi, '').trim())
      return ''
    })
  return {
    content: content.replace(/\n{3,}/g, '\n\n').trim(),
    notice: notices.filter(Boolean).join('\n\n'),
  }
}

export function translateTimeLine(value: string): string {
  const days: Record<string, string> = {
    Sunday: '周日', Monday: '周一', Tuesday: '周二', Wednesday: '周三',
    Thursday: '周四', Friday: '周五', Saturday: '周六',
  }
  const months: Record<string, string> = {
    January: '1月', February: '2月', March: '3月', April: '4月', May: '5月', June: '6月',
    July: '7月', August: '8月', September: '9月', October: '10月', November: '11月', December: '12月',
  }
  let line = String(value || '').trim()
  for (const [english, chinese] of Object.entries(days)) line = line.replace(new RegExp(`\\b${english}\\b`, 'g'), chinese)
  for (const [english, chinese] of Object.entries(months)) line = line.replace(new RegExp(`\\b${english}\\b`, 'g'), chinese)
  return line
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1日')
    .replace(/\bAM\b/g, '上午')
    .replace(/\bPM\b/g, '下午')
}

export function localizeUserVisibleMessage(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/Current time:\s*([^\n]+)/gi, (_match, value) => `当前时间：${translateTimeLine(String(value))}`)
    .replace(/Reference UTC:\s*([^\n]+)/gi, (_match, value) => `UTC 参考时间：${String(value).trim()}`)
    .replace(/If you do not send directly, your final plain-text reply will be delivered automatically\./gi, '如果你不直接发送，最终纯文本回复会自动送达。')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const AGENT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Use the message tool if you need to notify the user directly for the current chat\./gi, '如果需要直接通知当前会话里的用户，请使用消息工具'],
  [/If you do not send directly, your final plain-text reply will be delivered automatically\./gi, '如果你不直接发送，最终纯文本回复会自动送达'],
  [/You are ChatGPT, a large language model trained by OpenAI\./gi, '你是 ChatGPT，一个由 OpenAI 训练的大语言模型'],
  [/The user is in an estimated location of\s*/gi, '用户的大致位置：'],
  [/The current date is\s*/gi, '当前日期：'],
  [/Any dates before this are in the past, and any dates after this are in the future\./gi, '早于该日期的是过去时间，晚于该日期的是未来时间'],
  [/When dealing with modern entities\/companies\/people/gi, '涉及现代实体、公司或人物时'],
  [/you MUST carefully confirm/gi, '必须仔细确认'],
  [/You are Codex, a coding agent based on GPT-5\./gi, '你是 Codex，一个基于 GPT-5 的编程 Agent'],
  [/You and the user share one workspace/gi, '你和用户共享同一个工作区'],
  [/Your job is to collaborate with them until their goal is genuinely handled\./gi, '你的任务是和用户协作，直到目标被真正处理好'],
  [/Do not send directly/gi, '不要直接发送'],
  [/plain-text reply/gi, '纯文本回复'],
  [/automatically/gi, '自动'],
  [/Knowledge cutoff:\s*/gi, '知识截止时间：'],
  [/Today's date:\s*/gi, '今天日期：'],
  [/Current date:\s*/gi, '当前日期：'],
  [/Current session/gi, '当前会话'],
  [/Created at/gi, '创建时间'],
  [/Last active/gi, '最后活跃'],
  [/Runtime/gi, '运行时长'],
  [/Used Tokens/gi, '已用 Token'],
  [/Context limit/gi, '上下文上限'],
  [/Usage rate/gi, '使用率'],
  [/System message/gi, '系统消息'],
  [/Developer message/gi, '开发者消息'],
  [/User message/gi, '用户消息'],
  [/Assistant message/gi, 'Agent 回复'],
  [/Tool call/gi, '工具调用'],
  [/Tool result/gi, '工具结果'],
  [/Final answer/gi, '最终回复'],
]

export function localizeAgentMessage(raw: string): string {
  if (!raw) return ''
  let text = raw
    .replace(/^\[message_id:\s*[^\]]+\]\s*/gim, '')
    .replace(/^\[cron:([^\]\s]+)(?:\s+([^\]]+))?\]\s*/gim, (_match, _id, title) => {
      const name = String(title || '').trim()
      return name ? `定时任务「${name}」触发：\n` : '定时任务触发：\n'
    })
    .replace(/^\[[a-z_]+:[^\]]+\]\s*/gim, '')
    .replace(/\[message_id:\s*[^\]]+\]\s*/gi, '')
    .replace(/\[cron:[^\]\s]+(?:\s+([^\]]+))?\]\s*/gi, (_match, title) => {
      const name = String(title || '').trim()
      return name ? `定时任务「${name}」触发：` : '定时任务触发：'
    })
    .replace(/\b(?:ou|oc|on|open|user|chat)_[A-Za-z0-9_-]{12,}:\s*/gi, '')
    .replace(/Current time:\s*([^\n]+)/gi, (_match, value) => `当前时间：${translateTimeLine(String(value))}`)
    .replace(/Reference UTC:\s*([^\n]+)/gi, (_match, value) => `UTC 参考时间：${String(value).trim()}`)

  for (const [pattern, replacement] of AGENT_REPLACEMENTS) text = text.replace(pattern, replacement)
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export function displayCronMessage(raw: string): string {
  return localizeAgentMessage(cleanUserContent(raw || ''))
}
