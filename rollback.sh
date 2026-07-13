#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  -h|--help)
    printf '%s\n' \
      '用法：./rollback.sh' \
      '用途：交换 current 与 previous，并重启 Dashboard。' \
      '参数：无。' \
      '默认安装根：$HOME/Library/Application Support/AI Workbench Dashboard'
    exit 0
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/macos/common.sh
source "$SCRIPT_DIR/scripts/macos/common.sh"

initialize
require_node
require_launchctl
require_curl
[[ $# -eq 0 ]] || die "用法：./rollback.sh"
old_current="$(read_release_link "$AI_WORKBENCH_CURRENT_LINK")" || die "当前版本链接无效。"
old_previous="$(read_release_link "$AI_WORKBENCH_PREVIOUS_LINK")" || die "没有可回退的 previous 版本。"

set_release_link "$AI_WORKBENCH_CURRENT_LINK" "$old_previous"
set_release_link "$AI_WORKBENCH_PREVIOUS_LINK" "$old_current"
if (restart_dashboard) && wait_for_health; then
  info "已回退到 ${old_previous#releases/}。"
  exit 0
fi

set_release_link "$AI_WORKBENCH_CURRENT_LINK" "$old_current"
set_release_link "$AI_WORKBENCH_PREVIOUS_LINK" "$old_previous"
(restart_dashboard) || true
wait_for_health || true
die "回退版本未通过健康检查；已恢复回退前的 current。"
