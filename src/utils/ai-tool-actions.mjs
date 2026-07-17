const ACTIONS = Object.freeze([
  Object.freeze({ id: 'monitor', capability: 'monitor', label: '监控对象', description: '查看该工具当前纳入统计的对象' }),
  Object.freeze({ id: 'usage', capability: 'usage', label: '用量详情', description: '查看 Token 与 API 等价费用' }),
  Object.freeze({ id: 'sessions', capability: 'sessions', label: '执行记录', description: '查看真实会话与活动记录' }),
  Object.freeze({ id: 'files', capability: 'files', label: '工作目录', description: '管理已确认的项目和工作目录' }),
  Object.freeze({ id: 'tasks', capability: 'tasks', label: '项目与任务', description: '查看和管理工具任务' }),
  Object.freeze({ id: 'automation', capability: 'automation', label: '自动任务', description: '查看和管理定时自动任务' }),
  Object.freeze({ id: 'messages', capability: 'messages', label: '快捷消息', description: '向工具内对象发送消息' }),
  Object.freeze({ id: 'skills', capability: 'skills', label: '技能管理', description: '查看和管理工具技能' }),
  Object.freeze({ id: 'version', capability: 'version', label: '版本管理', description: '查看版本并执行受控更新' }),
  Object.freeze({ id: 'nativeUi', capability: 'nativeUi', label: '原生控制台', description: '打开工具自带的本地控制台' }),
  Object.freeze({ id: 'search', capability: 'search', label: '全局搜索', description: '搜索该工具的监控对象' }),
  Object.freeze({ id: 'timeline', capability: 'timeline', label: '活动时间线', description: '按时间查看工具活动' }),
])

const ACTION_BY_ID = new Map(ACTIONS.map(action => [action.id, action]))

export const AI_TOOL_MANAGEMENT_ACTIONS = ACTIONS

export function getAiToolManagementAction(id) {
  return ACTION_BY_ID.get(String(id || ''))
}

export function buildAiToolManagementActions(descriptor) {
  const capabilities = descriptor?.capabilities || {}
  return ACTIONS.filter(action => capabilities[action.capability] === true)
}
