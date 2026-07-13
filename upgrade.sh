#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  -h|--help)
    printf '%s\n' \
      '用法：./upgrade.sh <本地源码目录>' \
      '用途：准备并切换到新的 Dashboard release，失败时恢复升级前版本。' \
      '参数：新版本的本地源码目录（必填，可使用绝对或相对路径）。' \
      '默认安装根：$HOME/Library/Application Support/AI Workbench Dashboard'
    exit 0
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/macos/common.sh
source "$SCRIPT_DIR/scripts/macos/common.sh"

initialize
require_install_tooling
[[ $# -eq 1 ]] || die "用法：./upgrade.sh /绝对/或/相对/源码目录"
source_dir="$(canonical_source "$1")"
validate_source "$source_dir"
old_current="$(read_release_link "$AI_WORKBENCH_CURRENT_LINK")" || die "当前版本链接无效；请先安装。"
old_previous="$(read_release_link "$AI_WORKBENCH_PREVIOUS_LINK" || true)"
new_release_id="$(prepare_release "$source_dir")"
new_target="releases/$new_release_id"

set_release_link "$AI_WORKBENCH_PREVIOUS_LINK" "$old_current"
set_release_link "$AI_WORKBENCH_CURRENT_LINK" "$new_target"
write_launch_agent

upgrade_ok=0
if (restart_dashboard) && wait_for_health; then
  upgrade_ok=1
fi

if (( upgrade_ok == 1 )); then
  info "升级成功：${new_release_id}。"
  exit 0
fi

echo "升级后的健康检查失败，正在恢复原版本。" >&2
set_release_link "$AI_WORKBENCH_CURRENT_LINK" "$old_current"
if [[ -n "$old_previous" ]]; then
  set_release_link "$AI_WORKBENCH_PREVIOUS_LINK" "$old_previous"
else
  clear_release_link "$AI_WORKBENCH_PREVIOUS_LINK"
fi
(restart_dashboard) || true
wait_for_health || true
rm -rf "$AI_WORKBENCH_RELEASES_DIR/$new_release_id"
die "升级失败；已恢复升级前的 current。"
