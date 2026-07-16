import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NOTIFICATION_MAX_ITEMS,
  NOTIFICATION_STORAGE_KEY,
  NOTIFICATION_TTL_MS,
  clearPersistedNotifications,
  loadPersistedNotifications,
  normalizeNotification,
  persistNotifications,
  sanitizeNotificationText,
} from '../src/utils/notification-center.mjs'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
    dump() { return Object.fromEntries(values) },
  }
}

test('通知详情文本会移除凭据、本机路径与控制字符', () => {
  const sanitized = sanitizeNotificationText([
    'token=secret-value',
    'Bearer abcdefghijklmnopqrstuvwxyz',
    'npm_abcdefghijklmnopqrstuvwxyz123456',
    '/Users/example/private/session.jsonl',
    '/var/folders/aa/private/session.jsonl',
    '/private/var/folders/aa/private/session.jsonl',
    '/tmp/ai-workbench/private.log',
    'C:\\Users\\example\\secret.txt',
    'C:\\Temp\\ai-workbench\\private.log',
    'VITE_GATEWAY_TOKEN=another-secret',
    `${String.fromCharCode(0)}done`,
  ].join(' '))
  assert.doesNotMatch(sanitized, /secret-value|another-secret|abcdefghijklmnopqrstuvwxyz|\/Users\/example|\/var\/folders|\/private\/var\/folders|\/tmp\/ai-workbench|C:\\Users\\example|C:\\Temp\\ai-workbench/)
  assert.equal(sanitized.includes(String.fromCharCode(0)), false)
  assert.match(sanitized, /\[已脱敏\]|\[本机路径\]/)
})

test('旧通知可以规范化且缺失详情时保持兼容', () => {
  const item = normalizeNotification({
    id: 'legacy-1',
    type: 'error',
    agentId: 'usage-summary',
    agentName: '费用统计',
    message: '完整统计加载失败',
    timestamp: 1000,
    read: false,
  }, { now: 2000 })
  assert.equal(item.id, 'legacy-1')
  assert.equal(item.message, '完整统计加载失败')
  assert.equal(item.detail, undefined)
  assert.equal(item.retryAction, undefined)
})

test('通知只允许受支持的状态、HTTP码与重试动作', () => {
  const item = normalizeNotification({
    id: 'safe-1',
    type: 'hostile',
    agentName: '系统',
    message: '失败',
    timestamp: 1000,
    httpStatus: 999,
    retryAction: 'delete-everything',
  }, { now: 2000 })
  assert.equal(item.type, 'info')
  assert.equal(item.httpStatus, undefined)
  assert.equal(item.retryAction, undefined)

  const retryable = normalizeNotification({
    id: 'safe-2',
    type: 'error',
    agentName: '费用统计',
    message: '失败',
    timestamp: 1000,
    httpStatus: 503,
    retryAction: 'refresh-token-usage',
  }, { now: 2000 })
  assert.equal(retryable.httpStatus, 503)
  assert.equal(retryable.retryAction, 'refresh-token-usage')
})

test('通知本地保存最多50条且只保留七天', () => {
  const now = 10 * NOTIFICATION_TTL_MS
  const storage = memoryStorage()
  const notifications = Array.from({ length: NOTIFICATION_MAX_ITEMS + 10 }, (_, index) => ({
    id: `notification-${index}`,
    type: 'info',
    agentId: 'system',
    agentName: '系统',
    message: `message-${index}`,
    timestamp: now - index * 1000,
    read: index % 2 === 0,
  }))
  notifications.push({
    id: 'expired',
    type: 'error',
    agentId: 'system',
    agentName: '系统',
    message: 'expired',
    timestamp: now - NOTIFICATION_TTL_MS - 1,
    read: false,
  })

  assert.equal(persistNotifications(storage, notifications, now), true)
  const loaded = loadPersistedNotifications(storage, now)
  assert.equal(loaded.length, NOTIFICATION_MAX_ITEMS)
  assert.equal(loaded.some(item => item.id === 'expired'), false)
  assert.equal(loaded[0].id, 'notification-0')
})

test('损坏存储与不可用localStorage会安全降级', () => {
  const broken = memoryStorage({ [NOTIFICATION_STORAGE_KEY]: '{broken' })
  assert.deepEqual(loadPersistedNotifications(broken), [])
  const hostile = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
    removeItem() { throw new Error('blocked') },
  }
  assert.deepEqual(loadPersistedNotifications(hostile), [])
  assert.equal(persistNotifications(hostile, []), false)
  assert.equal(clearPersistedNotifications(hostile), false)
})

test('清空通知同时删除本地记录', () => {
  const storage = memoryStorage({ [NOTIFICATION_STORAGE_KEY]: '[]' })
  assert.equal(clearPersistedNotifications(storage), true)
  assert.equal(storage.getItem(NOTIFICATION_STORAGE_KEY), null)
})
