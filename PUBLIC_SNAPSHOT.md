# 公开源码快照候选

本目录是从固定基线 `89b29e0bce3da8b2cf63867109817b8209ba4593` 导出的干净公开源码快照候选。当前 Git 历史保持干净，仅包含中性提交，不继承旧私有历史、refs、tags 或 remotes。

## 包含

- 构建、测试和本地运行所需的应用源码、锁文件、示例配置、公共 CI 与安全测试。
- 用于准确识别兼容客户端、模型、技能和工具的现有第三方 Logo，以及对应的来源、第三方通知和商标说明。
- 仓库原生的中性几何 favicon 与 PWA app icon。

## 排除

- `.git` 历史、备份、`node_modules/`、`dist/`、真实日志、会话、运行配置、token、cache、profile 与恢复材料。
- `.claude/`、内部阶段文档与交接文档。
- 9 份 `skill-translations/` 文件：暂未随首个公开候选分发，待权利状态确认。
- 未使用或待处理的 `public/icons.svg`、`src/assets/vite.svg`、`src/assets/vue.svg` 与 `src/assets/hero.png`。

## 发布状态

本公开快照中的原创及获授权代码按项目根目录的 MIT 许可证发布；第三方内容继续适用各自的许可证与权利规则。正式公开仓库只发布这条干净的 `main` 历史，不携带旧私有历史、内部阶段分支或旧标签。

`PUBLIC_FILES.txt` 是当前提交中公开文件的排序清单。`SHA256SUMS.txt` 对除 `.git/` 与 `SHA256SUMS.txt` 自身以外的清单文件提供 SHA-256 校验值；路径均相对于仓库根目录。
