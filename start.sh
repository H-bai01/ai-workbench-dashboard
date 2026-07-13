#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "启动失败：请先安装 Node.js 22.13.0 或更高版本。" >&2
  exit 1
fi

exec npm run start:v2
