# AI 工具适配器开发指南

## 目标

新 AI 工具通过同一份描述和能力接口接入工作台，不需要在首页、任务看板、搜索、时间线或管理入口中增加工具名称判断。

## 接入结构

适配器由两部分组成：

1. `descriptor`：工具名称、图标、监控对象名称及真实支持的能力。
2. `providers`：每项已声明能力对应的数据或操作函数。

工作台只展示适配器明确声明并实现的能力。未声明的能力不会显示入口，也不会用其他工具的实现代替。

## 能力与接口

| 能力 | 接口 | 用途 |
|---|---|---|
| `monitor` | `listObjects` | 读取监控对象 |
| `usage` | `getUsage` | 读取 Token 与费用 |
| `details` | `getObjectDetail` | 读取对象详情 |
| `sessions` | `listSessions` | 读取执行记录 |
| `files` | `listFileRoots` | 读取已确认工作目录 |
| `tasks` | `listTasks` | 读取项目和任务 |
| `automation` | `listAutomations` | 读取自动任务 |
| `messages` | `sendMessage` | 发送消息 |
| `skills` | `listSkills` | 读取技能 |
| `version` | `getVersion` | 读取版本能力 |
| `nativeUi` | `getNativeUiUrl` | 获取受控本地控制台地址 |
| `search` | `search` | 搜索工具对象 |
| `timeline` | `listActivity` | 读取活动时间线 |

## 最小示例

```js
registerAiToolAdapter(registry, {
  descriptor: {
    id: 'future-ai',
    name: 'Future AI',
    iconSrc: '/avatars/default.svg',
    objectLabel: '工作区',
    capabilities: {
      monitor: true,
      usage: true,
      files: true,
    },
  },
  providers: {
    listObjects: async () => [],
    getUsage: async () => ({ tokens: 0, cost: 0 }),
    listFileRoots: async () => [],
  },
})
```

## 验收规则

- 工具标识必须安全、唯一。
- 每项已声明能力必须提供对应接口。
- 未声明能力不得偷偷提供接口。
- 新工具注册后由通用页面自动呈现，不新增工具专属首页分支。
- 文件、消息、更新和原生控制台仍需各自通过现有安全边界。
- 适配器只在受审查的源码中注册，不从用户目录动态执行第三方代码。
