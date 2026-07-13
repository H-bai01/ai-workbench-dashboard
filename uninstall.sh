#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  -h|--help)
    printf '%s\n' \
      '用法：./uninstall.sh' \
      '用途：退出并删除 Dashboard 自有 LaunchAgent、plist 与安装根。' \
      '参数：无；不会删除或修改 OpenClaw 数据。' \
      '默认安装根：$HOME/Library/Application Support/AI Workbench Dashboard'
    exit 0
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/macos/common.sh
source "$SCRIPT_DIR/scripts/macos/common.sh"

initialize
require_launchctl
[[ $# -eq 0 ]] || die "用法：./uninstall.sh"
stop_dashboard
rm -f "$AI_WORKBENCH_PLIST"
rm -rf "$AI_WORKBENCH_INSTALL_ROOT"
info "已卸载 Dashboard；未访问或修改 ~/.openclaw。"
