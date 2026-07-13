#!/bin/zsh
set -euo pipefail

# 复制为 scripts/start-local-dashboard.sh 后，按自己的 OpenClaw / Agent 配置填写。

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

NVM_NODE_DIR="$(ls "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1 || true)"
if [[ -n "$NVM_NODE_DIR" ]]; then
  export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$NVM_NODE_DIR/bin:/usr/bin:/bin:/usr/sbin:/sbin"
else
  export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
fi

# Gateway 地址和凭据只供本机服务端读取，不使用 VITE_ 前缀。
export OPENCLAW_GATEWAY_URL="http://127.0.0.1:18789"
# 可把 Gateway token 单独保存到该 0600 文件；未设置时服务端会读取 OpenClaw 配置。
export OPENCLAW_GATEWAY_TOKEN_FILE="${OPENCLAW_GATEWAY_TOKEN_FILE:-$HOME/.openclaw/dashboard-gateway-token}"
# 浏览器公开设置走服务端白名单接口，不使用 VITE_ 变量。
export OPENCLAW_PUBLIC_ELECTRICITY_PER_HOUR="2"
# export OPENCLAW_PUBLIC_SHARE_REPO_URL="https://github.com/your-name/your-repo"

export FRONTEND_HOST="127.0.0.1"
export BACKEND_HOST="127.0.0.1"

exec npm run start:v2
