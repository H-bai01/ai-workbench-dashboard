#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  -h|--help)
    printf '%s\n' \
      '用法：./stop.sh' \
      '用途：只退出 Dashboard 自有 LaunchAgent。' \
      '参数：无。' \
      '默认安装根：$HOME/Library/Application Support/AI Workbench Dashboard'
    exit 0
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/macos/common.sh
source "$SCRIPT_DIR/scripts/macos/common.sh"

initialize
require_launchctl
[[ $# -eq 0 ]] || die "用法：./stop.sh"
stop_dashboard
info "已停止。"
