#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  -h|--help)
    printf '%s\n' \
      '用法：./install.sh <本地源码目录>' \
      '用途：把明确指定的本地源码安装为新的 Dashboard release，并生成自有 LaunchAgent。' \
      '参数：本地源码目录（必填，可使用绝对或相对路径）。' \
      '默认安装根：$HOME/Library/Application Support/AI Workbench Dashboard'
    exit 0
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/macos/common.sh
source "$SCRIPT_DIR/scripts/macos/common.sh"

initialize
require_install_tooling
[[ $# -eq 1 ]] || die "用法：./install.sh /绝对/或/相对/源码目录"
source_dir="$(canonical_source "$1")"
validate_source "$source_dir"
[[ ! -e "$AI_WORKBENCH_CURRENT_LINK" ]] || die "Dashboard 已安装；请使用 upgrade.sh。"
warn_if_openclaw_unavailable

release_id="$(prepare_release "$source_dir")"
set_release_link "$AI_WORKBENCH_CURRENT_LINK" "releases/$release_id"
clear_release_link "$AI_WORKBENCH_PREVIOUS_LINK"
write_launch_agent
info "已安装版本 ${release_id}。运行 ./start.sh 启动。"
