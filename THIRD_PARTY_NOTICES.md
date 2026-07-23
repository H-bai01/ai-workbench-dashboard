# 第三方通知

## 结论

AI Workbench Dashboard 包含或引用第三方项目、名称和品牌资源。本文件记录已知来源与限制，不构成项目级许可证，也不授予超出原权利人条款的权利。

## OpenClaw

- 固定来源提交：`7570831ee1ac40db183c610cde4c80ef6a769642`
- 固定 MIT 许可证：<https://github.com/openclaw/openclaw/blob/7570831ee1ac40db183c610cde4c80ef6a769642/LICENSE>
- 已识别的六份上游技能内容列于 [来源说明](SOURCE_PROVENANCE.md)。

OpenClaw 的 MIT 许可仅适用于已识别的上游内容。本地中文翻译、新增解释和其他改写仍需确认权利归属；9 份 `skill-translations/` 文件因此未进入首个公开候选。

## Anthropic PDF Skill

- 固定来源提交：`4e6907a33c3c0c9ce7c1836980546aaba78a34b5`
- 固定 PDF Skill：<https://github.com/anthropics/skills/blob/4e6907a33c3c0c9ce7c1836980546aaba78a34b5/skills/pdf/SKILL.md>
- 固定限制条款：<https://github.com/anthropics/skills/blob/4e6907a33c3c0c9ce7c1836980546aaba78a34b5/skills/pdf/LICENSE.txt>

基线中的 `skill-translations/pdf.md` 属于公开阻断项，因此未进入本候选。补入它引用的条款文本也不会自动获得复制、派生或分发许可。

## 基线中的 Vite 模板资源

- 固定来源提交：`5d95f1631bfde08ee2613a53517dd5ea5d388cda`
- 基线中的旧 `public/favicon.svg` 与 Vite `template-vue-ts/public/favicon.svg` 的 blob 完全一致。
- 基线中的 `public/icons.svg` 与 Vite `template-vue-ts/public/icons.svg` 的 blob 完全一致。
- 基线中的旧 `public/app-icon.svg` 复用了 Vite favicon 的主路径。

这些 Vite 衍生或未使用资源没有进入当前版本。当前应用图标的规范原图保存在 `assets/branding/ai-workbench-icon-master.png`，浏览器、PWA 与 Apple touch icon 均由该原图生成并集中存放在 `public/brand/`；这些文件不包含第三方标识，也不用于代替 OpenClaw、ClawHub、taskflow 或 skill-creator 等标识。

## Markdown Mark

- 固定来源：<https://github.com/dcurtis/markdown-mark/tree/99572b4a4f71b4ea2b1186a30f440ff2fcf66d27>
- 原 Markdown Mark 使用 CC0 公共领域贡献。
- `public/skill-logos/markdown.svg` 在该标识外增加了本项目卡片样式，应作为修改版本登记。

## Simple Icons 与品牌权利

`public/model-logos/openai.svg` 与 Simple Icons 历史 OpenAI 路径匹配，相关删除提交为：

<https://github.com/simple-icons/simple-icons/commit/6ad4d3add5ed668b4a3ad061ef7a18fb2a5309af>

Simple Icons 的 CC0 或来源记录不自动授予 OpenAI 或其他品牌的商标、Logo 或再分发许可。所有品牌文件仍需遵守各权利人的规则。

## 完整清单

本候选保留的品牌文件路径、用途、来源状态、权利状态和当前决定记录在：

[`release/brand-assets.json`](release/brand-assets.json)
