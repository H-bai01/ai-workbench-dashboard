#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-31021}"
BACKEND_PORT="${BACKEND_PORT:-31022}"
URL="http://127.0.0.1:${FRONTEND_PORT}"
LOG_DIR="/tmp"

cd "$PROJECT_DIR" || { osascript -e 'display notification "找不到工作台目录" with title "AI 工作台总控"'; exit 1; }

NVM_NODE_DIR="$(ls "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
if [ -n "$NVM_NODE_DIR" ]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$NVM_NODE_DIR/bin:$PATH"
else
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
NODE_BIN="$(command -v node)"
[ -z "$NODE_BIN" ] && { osascript -e 'display notification "未找到 node，请检查安装" with title "AI 工作台总控"'; exit 1; }
NODE_MAJOR="$($NODE_BIN -p 'process.versions.node.split(".")[0]')"
BACKEND_NODE_ARGS=()
if [ "$NODE_MAJOR" = "22" ]; then BACKEND_NODE_ARGS=(--experimental-sqlite); fi

port_open() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1; }
health_ok() { curl -fsS --max-time 2 "$1" 2>/dev/null | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true|"status"[[:space:]]*:[[:space:]]*"ok"'; }
page_ok() { curl -fsS --max-time 2 "$URL/" 2>/dev/null | grep -Eq 'id="app"|AI 工作台总控'; }
backend_ok() { health_ok "http://127.0.0.1:${BACKEND_PORT}/api/health"; }
proxy_ok() { health_ok "${URL}/api/health"; }
dashboard_ok() { page_ok && proxy_ok; }
notify_fail() { osascript -e "display notification \"$1\" with title \"AI 工作台总控\""; }

if port_open "$BACKEND_PORT" || port_open "$FRONTEND_PORT"; then
  echo "[启动器] 所需端口已被占用；无法确认服务身份，因此不会接管、结束进程或打开页面。" >&2
  notify_fail "工作台端口被占用，未启动也未打开页面"
  exit 1
fi

BACKEND_HOST=127.0.0.1 BACKEND_PORT=$BACKEND_PORT nohup "$NODE_BIN" "${BACKEND_NODE_ARGS[@]}" scripts/unified-service.js > "$LOG_DIR/v2-backend.log" 2>&1 &
BACKEND_PID=$!
backend_started_ok() { kill -0 "$BACKEND_PID" >/dev/null 2>&1 && backend_ok; }
for _ in $(seq 1 60); do backend_started_ok && break; sleep 0.5; done
if ! backend_started_ok; then
  kill "$BACKEND_PID" >/dev/null 2>&1 || true
  notify_fail "后端启动失败，请查看 /tmp/v2-backend.log"
  exit 1
fi

FRONTEND_HOST=127.0.0.1 FRONTEND_PORT=$FRONTEND_PORT BACKEND_PORT=$BACKEND_PORT nohup "$NODE_BIN" node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort > "$LOG_DIR/v2-vite.log" 2>&1 &
FRONTEND_PID=$!
dashboard_started_ok() { kill -0 "$FRONTEND_PID" >/dev/null 2>&1 && dashboard_ok; }
for _ in $(seq 1 60); do dashboard_started_ok && break; sleep 0.5; done
if ! dashboard_started_ok; then
  kill "$FRONTEND_PID" "$BACKEND_PID" >/dev/null 2>&1 || true
  notify_fail "前端启动失败或代理不健康，请查看 /tmp/v2-vite.log"
  exit 1
fi

open "$URL"
