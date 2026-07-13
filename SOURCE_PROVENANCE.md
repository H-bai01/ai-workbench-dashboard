# AI Workbench Dashboard 来源说明

## 结论

- 项目级许可证待用户最终确认，当前仍在等待上游来源与权利链确认。
- 本文件只记录已经取得的来源证据，不授予任何额外权利。
- 本文件不是法律意见。

## 已证明

### OpenClaw 固定快照

- 仓库：<https://github.com/openclaw/openclaw>
- 提交：`7570831ee1ac40db183c610cde4c80ef6a769642`
- 同快照许可证：[`LICENSE`](https://github.com/openclaw/openclaw/blob/7570831ee1ac40db183c610cde4c80ef6a769642/LICENSE)
- 许可证 blob：`ebaebf7c416761a32f932ad70ebe5d1d2e214f68`

固定基线中的下列本地翻译可以识别到该快照中的上游内容；这些翻译文件未进入首个公开候选：

| 本地文件 | 固定上游文件 | 上游 blob |
|---|---|---|
| `skill-translations/diagram-maker.md` | `skills/diagram-maker/SKILL.md` | `006329dece78763d72231f1829de8480983648a4` |
| `skill-translations/feishu-doc.md` | `extensions/feishu/skills/feishu-doc/SKILL.md` | `d402233cca3086a4a94154b712a1c1d80235cb07` |
| `skill-translations/feishu-drive.md` | `extensions/feishu/skills/feishu-drive/SKILL.md` | `6b46eec7c8798ef0083348a083d1883d3ed9cf4a` |
| `skill-translations/feishu-perm.md` | `extensions/feishu/skills/feishu-perm/SKILL.md` | `1ce5db8b86c52d53a2687a630e102e8355cfd101` |
| `skill-translations/feishu-wiki.md` | `extensions/feishu/skills/feishu-wiki/SKILL.md` | `ad68d8bffa1ad3c058bec5c1a59b9ad885a4b0ba` |
| `skill-translations/weather.md` | `skills/weather/SKILL.md` | `e84bbea68bae7416d27eede03154b7acd29b3559` |

OpenClaw 的 MIT 许可证覆盖可识别的上游内容。它不会自动证明本地中文翻译、新增解释和其他改写部分的权利归属，也不会覆盖本项目其余代码。

### Anthropic PDF 固定快照

- 仓库：<https://github.com/anthropics/skills>
- 提交：`4e6907a33c3c0c9ce7c1836980546aaba78a34b5`
- PDF Skill：[固定文件](https://github.com/anthropics/skills/blob/4e6907a33c3c0c9ce7c1836980546aaba78a34b5/skills/pdf/SKILL.md)，blob `d3e046a5ae107a6cb23cfb16c219837094ab35d3`
- PDF 条款：[固定文件](https://github.com/anthropics/skills/blob/4e6907a33c3c0c9ce7c1836980546aaba78a34b5/skills/pdf/LICENSE.txt)，blob `c55ab42224874608473643de0a85736b7fec0730`

固定基线中的 `skill-translations/pdf.md` frontmatter 引用 `LICENSE.txt`，但基线没有该文件。该翻译未进入本候选；即使补入 Anthropic 的条款文本，也只会补齐条款可见性，不会取得复制、翻译、派生或分发许可。

## 推断

- 固定基线来源仓库的最早 Git 提交一次性包含主要应用、翻译和资产，可能混合了原创、翻译、改写和第三方来源。
- 固定基线来源仓库原有的 remote 可能是首次公开快照，而不是原始上游。

这些推断不能替代来源证明。

## 尚未验证

- 整套 Dashboard 的确切原始上游。
- 最早提交中各文件的原创作者、翻译作者和授权链。
- `skill-translations/lark-voice.md` 与 `skill-translations/feishu-toolkit.md` 的原始授权。
- 本项目全部原创或改写内容是否可由当前权利人统一选择项目许可证。

GitHub 搜索未命中只表示本次查询没有发现匹配，不能证明上游不存在。

## 机器清单

- 翻译与固定证据：[`release/source-provenance.json`](release/source-provenance.json)
- 品牌资产：[`release/brand-assets.json`](release/brand-assets.json)

上述清单只用于事实盘点，不能据此自动发布本候选或授予额外权利。
