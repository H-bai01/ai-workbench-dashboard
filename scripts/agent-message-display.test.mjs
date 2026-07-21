import test from 'node:test'
import assert from 'node:assert/strict'

import {
  cleanAgentContent,
  cleanUserContent,
  displayCronMessage,
  localizeAgentMessage,
  localizeUserVisibleMessage,
  stripInlineSystemNotice,
  translateTimeLine,
} from '../src/utils/agent-message-display.ts'

test('Agent消息清理隐藏思考和工具内部标签', () => {
  const input = '开头<thinking>秘密思考</thinking>\n\n\n结尾<toolCall>参数</toolCall>'
  assert.equal(cleanAgentContent(input), '开头\n\n结尾')
})

test('用户消息清理技术前缀并保留任务名称', () => {
  assert.equal(cleanUserContent('[cron:abc Morning greeting] 正文'), '定时任务「Morning greeting」触发：\n正文')
  assert.equal(cleanUserContent('[message_id: x] 正文'), '正文')
  assert.equal(cleanUserContent('ou_1234567890abcdef: 你好'), '你好')
})

test('系统提示从消息正文中分离', () => {
  assert.deepEqual(
    stripInlineSystemNotice('正文[System: 内部提示]<system>第二条</system>'),
    { content: '正文', notice: '内部提示\n\n第二条' },
  )
})

test('时间和常见系统文案保持中文显示', () => {
  assert.equal(translateTimeLine('Sunday, July 21st 8:00 AM'), '周日, 7月 21日 8:00 上午')
  assert.equal(
    localizeUserVisibleMessage('Current time: Sunday, July 21st\nReference UTC: 2026-07-21'),
    '当前时间：周日, 7月 21日\nUTC 参考时间：2026-07-21',
  )
  assert.equal(localizeAgentMessage('Final answer'), '最终回复')
  assert.equal(displayCronMessage('[cron:abc Daily report] Final answer'), '定时任务「Daily report」触发：\n最终回复')
})
