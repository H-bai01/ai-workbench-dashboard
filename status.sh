#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  -h|--help)
    printf '%s\n' \
      '用法：./status.sh' \
      '用途：查看 Dashboard 自有 LaunchAgent 是否已加载。' \
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
[[ $# -eq 0 ]] || die "用法：./status.sh"
if job_loaded; then
  info "LaunchAgent 已加载。"
  exit 0
fi
info "LaunchAgent 未加载。"
exit 1
