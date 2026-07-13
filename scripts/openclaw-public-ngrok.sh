#!/usr/bin/env bash
set -euo pipefail

echo "此公网入口已禁用：当前安全模型只支持 127.0.0.1 本机单用户访问。" >&2
echo "请使用 npm run start:v2；不要通过 ngrok 或其他隧道公开工作台。" >&2
exit 1
