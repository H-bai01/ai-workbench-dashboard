#!/usr/bin/env bash

set -euo pipefail

AI_WORKBENCH_LABEL="com.ai-workbench.dashboard"
AI_WORKBENCH_FRONTEND_PORT="31021"
AI_WORKBENCH_BACKEND_PORT="31022"

die() {
  echo "错误：$*" >&2
  exit 1
}

info() {
  echo "AI Workbench Dashboard：$*"
}

require_macos() {
  local os_name
  os_name="$(uname -s)"
  if [[ "${AI_WORKBENCH_TESTING:-}" == "1" && -n "${AI_WORKBENCH_TEST_OS:-}" ]]; then
    os_name="$AI_WORKBENCH_TEST_OS"
  fi
  [[ "$os_name" == "Darwin" ]] || die "这些生命周期工具仅支持 macOS。"
}

init_paths() {
  [[ -n "${HOME:-}" && "$HOME" == /* ]] || die "HOME 必须是绝对路径。"

  AI_WORKBENCH_INSTALL_ROOT="${AI_WORKBENCH_INSTALL_ROOT:-$HOME/Library/Application Support/AI Workbench Dashboard}"
  AI_WORKBENCH_INSTALL_ROOT="${AI_WORKBENCH_INSTALL_ROOT%/}"
  [[ -n "$AI_WORKBENCH_INSTALL_ROOT" && "$AI_WORKBENCH_INSTALL_ROOT" == /* ]] || die "AI_WORKBENCH_INSTALL_ROOT 必须是绝对路径。"
  case "$AI_WORKBENCH_INSTALL_ROOT" in
    *$'\n'*|*/../*|*/..|*/./*) die "AI_WORKBENCH_INSTALL_ROOT 包含不安全的路径片段。" ;;
  esac

  local openclaw_root="$HOME/.openclaw"
  case "$AI_WORKBENCH_INSTALL_ROOT/" in
    "$openclaw_root/"*) die "安装目录不得位于 ~/.openclaw 内。" ;;
  esac
  case "$openclaw_root/" in
    "$AI_WORKBENCH_INSTALL_ROOT/"*) die "安装目录不得包含 ~/.openclaw。" ;;
  esac
  case "$AI_WORKBENCH_INSTALL_ROOT" in
    /|/Applications|/Library|/System|/Users|"$HOME") die "拒绝使用过宽的安装目录。" ;;
  esac

  AI_WORKBENCH_RELEASES_DIR="$AI_WORKBENCH_INSTALL_ROOT/releases"
  AI_WORKBENCH_CURRENT_LINK="$AI_WORKBENCH_INSTALL_ROOT/current"
  AI_WORKBENCH_PREVIOUS_LINK="$AI_WORKBENCH_INSTALL_ROOT/previous"
  AI_WORKBENCH_LOG_DIR="$AI_WORKBENCH_INSTALL_ROOT/logs"
  AI_WORKBENCH_PLIST="$HOME/Library/LaunchAgents/$AI_WORKBENCH_LABEL.plist"
  local user_id
  user_id="$(id -u)"
  if [[ "${AI_WORKBENCH_TESTING:-}" == "1" && -n "${AI_WORKBENCH_TEST_UID:-}" ]]; then
    user_id="$AI_WORKBENCH_TEST_UID"
  fi
  AI_WORKBENCH_DOMAIN="gui/$user_id"
  export AI_WORKBENCH_INSTALL_ROOT
}

require_node() {
  command -v node >/dev/null 2>&1 || die "未找到 Node.js；需要 22.13.0 或更高版本。"
  AI_WORKBENCH_NODE_BIN="$(command -v node)"
  local version major minor patch
  version="$($AI_WORKBENCH_NODE_BIN -p 'process.versions.node')" || die "无法读取 Node.js 版本。"
  IFS=. read -r major minor patch <<<"${version%%-*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ && "$patch" =~ ^[0-9]+$ ]] || die "无法解析 Node.js 版本。"
  if (( major < 22 || (major == 22 && minor < 13) )); then
    die "Node.js 版本过低；需要 22.13.0 或更高版本。"
  fi
}

require_npm() {
  command -v npm >/dev/null 2>&1 || die "未找到 npm。"
  AI_WORKBENCH_NPM_BIN="$(command -v npm)"
}

require_launchctl() {
  command -v launchctl >/dev/null 2>&1 || die "未找到 launchctl。"
  AI_WORKBENCH_LAUNCHCTL_BIN="$(command -v launchctl)"
}

require_curl() {
  command -v curl >/dev/null 2>&1 || die "未找到 curl。"
  AI_WORKBENCH_CURL_BIN="$(command -v curl)"
}

require_install_tooling() {
  require_node
  require_npm
  require_launchctl
  require_curl
  command -v tar >/dev/null 2>&1 || die "未找到 tar。"
}

initialize() {
  require_macos
  init_paths
}

canonical_source() {
  local source="${1:-}"
  [[ -n "$source" ]] || die "请明确提供本地源码目录。"
  [[ -d "$source" ]] || die "源码目录不存在：$source"
  (cd "$source" && pwd -P)
}

validate_source() {
  local source="$1" required openclaw_root="$HOME/.openclaw"
  for required in package.json package-lock.json index.html vite.config.ts scripts/start-versioned.js scripts/unified-service.js src public; do
    [[ -e "$source/$required" ]] || die "源码缺少必要文件：$required"
  done
  case "$source/" in
    "$AI_WORKBENCH_INSTALL_ROOT/"*) die "源码目录不得位于安装目录内。" ;;
    "$openclaw_root/"*) die "源码目录不得位于 ~/.openclaw 内。" ;;
  esac
  case "$openclaw_root/" in
    "$source/"*) die "源码目录不得包含 ~/.openclaw。" ;;
  esac
}

new_release_id() {
  date '+%Y%m%d%H%M%S'
  printf -- '-%s\n' "$$"
}

prepare_release() {
  local source="$1" release_id release_dir
  release_id="$(new_release_id | tr -d '\n')"
  release_dir="$AI_WORKBENCH_RELEASES_DIR/$release_id"
  [[ ! -e "$release_dir" ]] || die "版本目录已存在：$release_id"
  mkdir -p "$AI_WORKBENCH_RELEASES_DIR" "$AI_WORKBENCH_LOG_DIR"
  mkdir "$release_dir"

  if ! (
    cd "$source"
    tar -cf - \
      --exclude='.git' \
      --exclude='node_modules' \
      --exclude='dist' \
      --exclude='.env' \
      --exclude='.env.local' \
      --exclude='.env.*.local' \
      --exclude='.openclaw' \
      --exclude='certs' \
      .
  ) | (
    cd "$release_dir"
    tar -xf -
  ); then
    rm -rf "$release_dir"
    die "复制源码失败。"
  fi

  if ! (cd "$release_dir" && "$AI_WORKBENCH_NPM_BIN" ci --ignore-scripts >&2); then
    rm -rf "$release_dir"
    die "npm ci --ignore-scripts 失败。"
  fi
  printf '%s\n' "$release_id"
}

assert_managed_link() {
  local link="$1"
  [[ ! -e "$link" || -L "$link" ]] || die "拒绝覆盖非符号链接：$link"
}

set_release_link() {
  local link="$1" target="$2" temporary
  [[ "$target" == releases/* && "$target" != *..* ]] || die "无效的版本链接目标。"
  [[ -d "$AI_WORKBENCH_INSTALL_ROOT/$target" ]] || die "版本目录不存在：$target"
  assert_managed_link "$link"
  temporary="$link.tmp.$$"
  rm -f "$temporary"
  ln -s "$target" "$temporary"
  rm -f "$link"
  mv "$temporary" "$link"
}

clear_release_link() {
  local link="$1"
  assert_managed_link "$link"
  rm -f "$link"
}

read_release_link() {
  local link="$1" target
  [[ -L "$link" ]] || return 1
  target="$(readlink "$link")"
  [[ "$target" == releases/* && "$target" != *..* && -d "$AI_WORKBENCH_INSTALL_ROOT/$target" ]] || return 1
  printf '%s\n' "$target"
}

xml_escape() {
  local value="$1"
  value=${value//&/&amp;}
  value=${value//</&lt;}
  value=${value//>/&gt;}
  printf '%s' "$value"
}

write_launch_agent() {
  local plist_dir temporary npm_path current_path log_out log_err node_dir safe_path
  plist_dir="$(dirname "$AI_WORKBENCH_PLIST")"
  temporary="$AI_WORKBENCH_PLIST.tmp.$$"
  npm_path="$(xml_escape "$AI_WORKBENCH_NPM_BIN")"
  current_path="$(xml_escape "$AI_WORKBENCH_CURRENT_LINK")"
  log_out="$(xml_escape "$AI_WORKBENCH_LOG_DIR/dashboard.stdout.log")"
  log_err="$(xml_escape "$AI_WORKBENCH_LOG_DIR/dashboard.stderr.log")"
  node_dir="$(dirname "$AI_WORKBENCH_NODE_BIN")"
  safe_path="$(xml_escape "$node_dir:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")"
  mkdir -p "$plist_dir" "$AI_WORKBENCH_LOG_DIR"
  umask 022
  {
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
    printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    printf '%s\n' '<plist version="1.0">'
    printf '%s\n' '<dict>'
    printf '%s\n' '  <key>Label</key>'
    printf '  <string>%s</string>\n' "$AI_WORKBENCH_LABEL"
    printf '%s\n' '  <key>ProgramArguments</key>'
    printf '%s\n' '  <array>'
    printf '    <string>%s</string>\n' "$npm_path"
    printf '%s\n' '    <string>--prefix</string>'
    printf '    <string>%s</string>\n' "$current_path"
    printf '%s\n' '    <string>run</string>'
    printf '%s\n' '    <string>start:v2</string>'
    printf '%s\n' '  </array>'
    printf '%s\n' '  <key>WorkingDirectory</key>'
    printf '  <string>%s</string>\n' "$current_path"
    printf '%s\n' '  <key>EnvironmentVariables</key>'
    printf '%s\n' '  <dict>'
    printf '%s\n' '    <key>PATH</key>'
    printf '    <string>%s</string>\n' "$safe_path"
    printf '%s\n' '  </dict>'
    printf '%s\n' '  <key>RunAtLoad</key>'
    printf '%s\n' '  <true/>'
    printf '%s\n' '  <key>KeepAlive</key>'
    printf '%s\n' '  <true/>'
    printf '%s\n' '  <key>ThrottleInterval</key>'
    printf '%s\n' '  <integer>10</integer>'
    printf '%s\n' '  <key>StandardOutPath</key>'
    printf '  <string>%s</string>\n' "$log_out"
    printf '%s\n' '  <key>StandardErrorPath</key>'
    printf '  <string>%s</string>\n' "$log_err"
    printf '%s\n' '</dict>'
    printf '%s\n' '</plist>'
  } >"$temporary"
  chmod 0644 "$temporary"
  rm -f "$AI_WORKBENCH_PLIST"
  mv "$temporary" "$AI_WORKBENCH_PLIST"
}

job_loaded() {
  "$AI_WORKBENCH_LAUNCHCTL_BIN" print "$AI_WORKBENCH_DOMAIN/$AI_WORKBENCH_LABEL" >/dev/null 2>&1
}

port_in_use() {
  local port="$1"
  if [[ "${AI_WORKBENCH_TESTING:-}" == "1" && "${AI_WORKBENCH_TEST_OCCUPIED_PORTS+x}" == "x" ]]; then
    case ",${AI_WORKBENCH_TEST_OCCUPIED_PORTS:-}," in
      *",$port,"*) return 0 ;;
    esac
    return 1
  fi
  "$AI_WORKBENCH_NODE_BIN" -e '
    const net = require("node:net");
    const socket = net.createConnection({ host: "127.0.0.1", port: Number(process.argv[1]) });
    const done = (code) => { socket.destroy(); process.exit(code); };
    socket.setTimeout(500, () => done(1));
    socket.once("connect", () => done(0));
    socket.once("error", () => done(1));
  ' "$port" >/dev/null 2>&1
}

warn_if_openclaw_unavailable() {
  if [[ ! -f "$HOME/.openclaw/openclaw.json" ]] || ! port_in_use 18789; then
    printf '%s\n' '提示：OpenClaw 尚未就绪（需要 $HOME/.openclaw/openclaw.json 存在且本机 127.0.0.1:18789 正在监听）；Dashboard 仍可启动；本工具不会生成 Gateway token，也不会启动或重启 Gateway。' >&2
  fi
}

assert_ports_available() {
  local port
  for port in "$AI_WORKBENCH_FRONTEND_PORT" "$AI_WORKBENCH_BACKEND_PORT"; do
    if port_in_use "$port"; then
      die "端口 $port 已被未知服务占用；不会接管或结束该进程。"
    fi
  done
}

wait_for_ports_available() {
  local attempts="${AI_WORKBENCH_TEST_PORT_ATTEMPTS:-40}" delay="${AI_WORKBENCH_TEST_PORT_DELAY:-0.25}" count=0
  while (( count < attempts )); do
    if ! port_in_use "$AI_WORKBENCH_FRONTEND_PORT" && ! port_in_use "$AI_WORKBENCH_BACKEND_PORT"; then
      return 0
    fi
    count=$((count + 1))
    sleep "$delay"
  done
  return 1
}

start_dashboard() {
  [[ -L "$AI_WORKBENCH_CURRENT_LINK" ]] || die "尚未安装 Dashboard。"
  [[ -f "$AI_WORKBENCH_PLIST" ]] || die "LaunchAgent 不存在；请先运行 install.sh。"
  if job_loaded; then
    "$AI_WORKBENCH_LAUNCHCTL_BIN" kickstart -k "$AI_WORKBENCH_DOMAIN/$AI_WORKBENCH_LABEL"
    return
  fi
  assert_ports_available
  "$AI_WORKBENCH_LAUNCHCTL_BIN" bootstrap "$AI_WORKBENCH_DOMAIN" "$AI_WORKBENCH_PLIST"
}

stop_dashboard() {
  if job_loaded; then
    "$AI_WORKBENCH_LAUNCHCTL_BIN" bootout "$AI_WORKBENCH_DOMAIN/$AI_WORKBENCH_LABEL"
  fi
}

restart_dashboard() {
  stop_dashboard
  wait_for_ports_available || die "Dashboard 停止后端口仍被占用；不会接管该进程。"
  start_dashboard
}

health_ok() {
  "$AI_WORKBENCH_CURL_BIN" -fsS --max-time 2 "http://127.0.0.1:$AI_WORKBENCH_FRONTEND_PORT/" >/dev/null 2>&1 \
    && "$AI_WORKBENCH_CURL_BIN" -fsS --max-time 2 "http://127.0.0.1:$AI_WORKBENCH_BACKEND_PORT/api/health" 2>/dev/null \
      | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'
}

wait_for_health() {
  local attempts="${AI_WORKBENCH_TEST_HEALTH_ATTEMPTS:-60}" delay="${AI_WORKBENCH_TEST_HEALTH_DELAY:-0.5}" count=0
  while (( count < attempts )); do
    if health_ok; then
      return 0
    fi
    count=$((count + 1))
    sleep "$delay"
  done
  return 1
}
