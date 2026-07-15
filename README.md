# AI 工作台总控 / AI Workbench Dashboard

本地 AI 工具与多 Agent 可视化管理工作台 —— 一个地方实时掌控 OpenClaw、Codex、Claude Code 等本机 AI 工具的运行状态、对话历史、技能配置与资源消耗。

当前本地正式版本：`v2.9.1`。

当你在本机同时使用 OpenClaw、Codex、Claude Code 等 AI 工具时，本工作台让你：

- 一眼看到 OpenClaw Agent 和本地 AI 项目的活跃情况
- 直接给 OpenClaw Agent 发消息，查看完整对话历史
- 管理 OpenClaw 技能库，查看哪个 Agent 装了哪些技能，一键启用 / 禁用
- 统一监控资源消耗：OpenClaw、Codex、Claude Code 的 Token 用了多少、花了多少钱
- 和 OpenClaw Agent 语音对话（内测）：边说边听，支持克隆音色

---

## 功能特性

- **指挥舱主界面**：Token 总览、APP/Agent 工作脉冲、贡献排行；支持今天 / 3 天 / 7 天 / 30 天 / 本月 / 上个月 / 全部多口径切换，Token 与 API 等价费用可单独或同时显示，并记住当前浏览器最后一次选择。
- **本地 AI 项目监控**：OpenClaw 按 Agent、Codex 与 Claude Code 按项目展示；本机产生的 Token 和费用会合并进入总览、贡献排行、模型排行与计费配置。
- **项目专属明细**：从工作脉冲、贡献排行或监控明细进入同一项目范围，查看该项目的 Token、费用、趋势、模型和会话来源。
- **统一只读执行记录**：OpenClaw 按 Agent、Codex 与 Claude Code 按项目进入统一会话时间线，查看真实用户消息、AI 回复、客户端记录的思考、工具调用、工具结果、结构化状态及安全产出元数据。
- **本机安全边界**：浏览器不持有 Gateway 或后端密钥，本地请求通过同源安全中继，并受来源、路径和内容净化保护。
- **OpenClaw Agent 详情**：查看每个 Agent 的对话历史、客户端实际记录的思考内容、工具调用、模型与上下文 / 历史 Token 消耗。
- **语音对话（内测）**：在 OpenClaw Agent 详情里直接开启语音通话，边说边听；语音识别优先浏览器原生、兜底本地 / 云端 STT，语音合成支持 CosyVoice 克隆音色与本地 GPT-SoVITS，含自动情绪、流式播放、消息朗读。
- **OpenClaw 技能库**：技能按「已配置 / 未安装 / 按 Agent / 对比 / 使用统计」多类型分类管理，一键启用，附中文说明。
- **定时任务（Cron）中心**：查看和管理所有定时任务，显示发起方与任务去向。
- **OpenClaw 项目看板**：项目状态、发起方、产出文件可点击查看。
- **Token / 费用统计**：按模型、按 Agent / 本地项目的消耗明细，支持电费 / 订阅分摊 / 纯 API 三种成本口径。
- **版本迭代说明**：内置更新日志，区分正式版 / 内测版，支持 dist 备份与版本回退。

---

## 界面概览

工作台首页提供 Token 与费用总览、工作脉冲、贡献排行和监控对象明细。OpenClaw 按 Agent 展示，Codex 与 Claude Code 按项目展示；项目专属明细和统一只读执行记录从对应对象入口进入。

仓库不随附真实运行现场截图。文档示例应使用隔离环境生成的中性合成数据，避免把部署者的 Agent、项目、头像、用量或本机界面带入公开发布内容。

---

## 技术栈

Vue 3 · TypeScript · Element Plus · Vite · Pinia

---

## 快速开始

> 前置条件：Node.js 22.13.0 或更高版本；本机已安装并运行 [OpenClaw](https://openclaw.ai) 框架，且已配置好你自己的 Agent。

```bash
git clone <your-repo-url>
cd ai-workbench-dashboard
npm install

# 复制配置模板，按你的环境填写
cp .env.example .env

# 同时启动前端与受保护的本地后端
npm run start:v2
```

默认打开 `http://127.0.0.1:31021`。

### 通过 npm 直接运行

Node.js 22.13.0 或更高版本的用户也可以直接运行 npm 正式包：

```bash
npx ai-workbench-dashboard@latest
```

也可以先全局安装：

```bash
npm install --global ai-workbench-dashboard@latest
ai-workbench-dashboard start
```

npm 入口只启动本机 Dashboard，不会安装、停止或重启 OpenClaw Gateway。服务仍只监听回环地址，按 `Ctrl+C` 可停止前台运行。

macOS 用户如需使用独立的 LaunchAgent 安装、升级、回退与卸载入口，请参阅 [macOS 生命周期工具](docs/macos-lifecycle.md)。

HTTPS 语音包装器当前暂时停用。请统一使用 `npm run start:v2`；远程访问、ngrok 和公网入口默认关闭。

---

## 配置说明

所有配置项见 [`.env.example`](.env.example)，主要包括：

| 配置 | 说明 |
|------|------|
| `OPENCLAW_GATEWAY_URL` | 本机 OpenClaw Gateway 地址（仅允许回环地址） |
| `OPENCLAW_GATEWAY_TOKEN_FILE` | 权限为 0600 的服务端 Gateway 密钥文件 |
| `OPENCLAW_DASHBOARD_DATA_ROOT` | 工作台上传等本地数据目录；默认使用项目下 `data` |
| `OPENCLAW_PUBLIC_ELECTRICITY_PER_HOUR` | 可公开给浏览器的电费单价；不得填写密钥 |
| `OPENCLAW_PUBLIC_SHARE_REPO_URL` | 可公开的项目仓库地址 |
| `OPENCLAW_VOICE_*` | 语音识别（STT）与合成（TTS）配置：本地命令 / OpenAI 兼容 / DashScope CosyVoice / 本地 GPT-SoVITS |
| `OPENCLAW_DASHBOARD_TRUSTED_ORIGINS` | 额外可信的前端来源，逗号分隔；本机使用通常留空 |

> 提示：新部署者必须通过本地 `.env` 与 OpenClaw 配置设置自己的 Agent 名称、头像和凭据。仓库只提供中性默认头像，不分发部署者的 Agent 头像或运行数据。

---

## 版本体系

- **正式版（stable）**：稳定发布版本，版本号 `主.次.修订`，如 `2.5.6`。
- **内测版（beta）**：实验中的新功能，版本号带 `-beta`，如 `2.5.1-beta`（语音对话）；测试稳定后并入下一个正式版。

工作台内的「版本迭代说明」面板会区分展示正式版（绿）与内测版（橙）。

### v2.9.1 当前限制

- 执行记录当前是只读功能；尚不能从工作台继续 Codex 或 Claude Code 会话，也未完成统一发送、停止、取消、恢复和实时流式执行。
- 只显示客户端真实提供的 thinking、reasoning 或思考摘要；客户端没有记录时只显示降级提示，不推测未公开的内部思维。
- 正式验收现场暂无近期 Claude Code 真实项目；Claude 的结构化解析和范围逻辑由隔离 fixture 覆盖。
- 未配置价格的模型显示“价格未配置”，不把未知价格解释为真实零费用。
- 文件管理、doctor、自动修复、HTTPS、远程访问和 Windows 控制仍暂时封存。
- 当前为单机、单用户、本地优先版本，不开放局域网、公网或多用户访问。
- 公开版 Git 历史仅包含中性提交，不继承旧私有历史、内部阶段分支或旧标签。

---

## 公开发布前检查

- 确认 `public/avatars/` 只包含中性默认资源，不包含部署者的 Agent 专属头像。
- 确认仓库保持干净公开历史，提交身份与内容均为中性，且不包含旧私有历史、内部阶段分支或旧标签。
- 确认 `PUBLIC_FILES.txt` 与 `SHA256SUMS.txt` 和当前提交一致。
- 确认新部署所需的名称、头像和凭据只来自本地配置，不把真实值写入源码、示例配置或构建产物。
- 运行凭据扫描、完整测试和生产构建，并以当前命令输出为准确认全部通过。

---

## 许可证

本项目中由项目权利人授权发布的代码采用 [MIT License](LICENSE)。第三方代码、名称、标识和其他资源仍适用其各自的许可证与权利规则。

- OpenClaw 固定上游快照中可识别的内容受其 MIT 许可证覆盖，但这不会自动覆盖本项目全部代码或本地中文改写。
- 9 份 `skill-translations/` 文件暂未随首个公开候选分发，待权利状态确认。
- 除清单中明确列为待处理的资源外，已批准保留方向的第三方标识仅用于准确识别兼容、集成或被监控对象；它们仍属于各自权利人，本项目不隶属于这些厂商，也不表示获得背书。

详见 [来源说明](SOURCE_PROVENANCE.md)、[第三方通知](THIRD_PARTY_NOTICES.md) 和 [商标说明](TRADEMARKS.md)。这些材料用于说明第三方边界，不扩大 MIT 许可证对第三方内容的适用范围。

本候选的包含与排除范围见 [`PUBLIC_SNAPSHOT.md`](PUBLIC_SNAPSHOT.md)，文件清单和校验值分别见 [`PUBLIC_FILES.txt`](PUBLIC_FILES.txt) 与 [`SHA256SUMS.txt`](SHA256SUMS.txt)。
