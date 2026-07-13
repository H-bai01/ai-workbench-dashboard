#!/usr/bin/env bash
# =============================================================================
# AI 工作台总控后端回归测试（Backend Regression Test）
# 用途：验证 unified-service.js 关键接口（API）是否正常，防止改了 A 功能
#       导致 B 功能悄悄坏掉（Regression — 功能退化检测）
# 用法：bash scripts/regression-test.sh [端口，默认 31022]
# =============================================================================

BASE_URL="http://127.0.0.1:${1:-31022}"
TOKEN=$(cat "$HOME/.openclaw/dashboard-local-token" 2>/dev/null || true)
PASS=0
FAIL=0
ERRORS=()

curl_local() {
  if [ -n "$TOKEN" ]; then
    curl --noproxy 127.0.0.1,localhost -H "X-Dashboard-Token: $TOKEN" "$@"
  else
    curl --noproxy 127.0.0.1,localhost "$@"
  fi
}

curl_no_token() {
  curl --noproxy 127.0.0.1,localhost "$@"
}

# ── 颜色输出 ──
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo ""
echo "========================================"
echo "  AI 工作台总控后端回归测试"
echo "  目标：$BASE_URL"
echo "========================================"
echo ""

# ── 辅助函数 ──

# assert_json_field <测试名称> <curl命令输出> <jq查询> <期望值>
assert_json() {
  local name="$1"
  local body="$2"
  local jq_query="$3"
  local expected="$4"

  local actual
  actual=$(echo "$body" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
      try { const v = require('vm'); const obj=JSON.parse(d);
        const path='$jq_query'.split('.').filter(Boolean);
        let cur=obj; for(const k of path) cur=cur?.[k]; console.log(String(cur??'__undef__'));
      } catch(e){ console.log('__parse_err__'); }
    });
  " 2>/dev/null)

  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}✅ PASS${RESET}  $name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}❌ FAIL${RESET}  $name"
    echo -e "       期望（Expected）: ${YELLOW}$expected${RESET}"
    echo -e "       实际（Actual）  : ${RED}$actual${RESET}"
    FAIL=$((FAIL + 1))
    ERRORS+=("$name")
  fi
}

# assert_http_status <测试名称> <HTTP状态码> <期望状态码>
assert_status() {
  local name="$1"
  local actual_status="$2"
  local expected_status="$3"
  if [ "$actual_status" = "$expected_status" ]; then
    echo -e "  ${GREEN}✅ PASS${RESET}  $name  (HTTP $actual_status)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}❌ FAIL${RESET}  $name"
    echo -e "       期望（Expected）: HTTP ${YELLOW}$expected_status${RESET}"
    echo -e "       实际（Actual）  : HTTP ${RED}$actual_status${RESET}"
    FAIL=$((FAIL + 1))
    ERRORS+=("$name")
  fi
}

# assert_contains <测试名称> <内容> <期望包含的字符串>
assert_contains() {
  local name="$1"
  local body="$2"
  local needle="$3"
  if echo "$body" | grep -q "$needle" 2>/dev/null; then
    echo -e "  ${GREEN}✅ PASS${RESET}  $name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}❌ FAIL${RESET}  $name（未找到：$needle）"
    FAIL=$((FAIL + 1))
    ERRORS+=("$name")
  fi
}

# ================================================================
# 测试 0：本地 token 鉴权（Local Token Auth）
# 确保 P0 门禁没有被绕开，且回归脚本使用 token 后仍可访问
# ================================================================
echo -e "${CYAN}[0/9] 本地 token 鉴权（Local Token Auth）${RESET}"
if [ -n "$TOKEN" ]; then
  echo -e "  ${GREEN}✅ PASS${RESET}  dashboard-local-token 已读取"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}❌ FAIL${RESET}  缺少 $HOME/.openclaw/dashboard-local-token"
  FAIL=$((FAIL + 1))
  ERRORS+=("dashboard-local-token 已读取")
fi

STATUS_NO_TOKEN=$(curl_no_token -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/usage")
assert_status "无 token 请求 /api/usage 返回 401" "$STATUS_NO_TOKEN" "401"

STATUS_WRITE_NO_TOKEN=$(curl_no_token -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: text/plain" \
  -d '{}' \
  "$BASE_URL/api/file-manager/write")
assert_status "无 token POST /api/file-manager/write 返回 401" "$STATUS_WRITE_NO_TOKEN" "401"

STATUS_WITH_TOKEN=$(curl_local -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/usage")
assert_status "带 token 请求 /api/usage 返回 200" "$STATUS_WITH_TOKEN" "200"
echo ""

# ================================================================
# 测试 1：健康检查（Health Check）
# 确保服务在线，基础路由正常
# ================================================================
echo -e "${CYAN}[1/9] 健康检查（Health Check）${RESET}"
STATUS=$(curl_local -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health")
assert_status "GET /api/health 返回 200" "$STATUS" "200"

BODY=$(curl_local -s "$BASE_URL/api/health")
assert_contains "GET /api/health 响应包含 ok 或 status 字段" "$BODY" '"ok"\|"status"'
echo ""

# ================================================================
# 测试 2：GPU VRAM（显存接口）— 确保即使没有 GPU 也不崩溃
# ================================================================
echo -e "${CYAN}[2/9] GPU VRAM 接口（不崩溃即通过）${RESET}"
STATUS=$(curl_local -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/gpu-vram")
if [ "$STATUS" = "200" ] || [ "$STATUS" = "503" ]; then
  echo -e "  ${GREEN}✅ PASS${RESET}  GET /api/gpu-vram 返回 $STATUS（200=有GPU，503=无GPU，均正常）"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}❌ FAIL${RESET}  GET /api/gpu-vram 返回意外状态 $STATUS"
  FAIL=$((FAIL + 1))
  ERRORS+=("GET /api/gpu-vram 不崩溃")
fi
echo ""

# ================================================================
# 测试 3：已配置 Agent 列表（Configured Agents List）
# 确保返回 agents 数组，且格式正确
# ================================================================
echo -e "${CYAN}[3/9] 已配置 Agent 列表（/api/agents-configured）${RESET}"
BODY=$(curl_local -s "$BASE_URL/api/agents-configured")
STATUS=$(curl_local -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/agents-configured")
assert_status "GET /api/agents-configured 返回 200" "$STATUS" "200"
assert_contains "响应包含 agents 字段" "$BODY" '"agents"'

# 检查 agents 是数组
IS_ARRAY=$(echo "$BODY" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
    try { const p=JSON.parse(d); console.log(Array.isArray(p.agents)?'yes':'no'); }
    catch(e){ console.log('parse_err'); }
  });
" 2>/dev/null)
if [ "$IS_ARRAY" = "yes" ]; then
  echo -e "  ${GREEN}✅ PASS${RESET}  agents 字段是数组（Array）"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}❌ FAIL${RESET}  agents 字段不是数组（IS_ARRAY=$IS_ARRAY）"
  FAIL=$((FAIL + 1))
  ERRORS+=("agents 字段是数组")
fi
echo ""

# ================================================================
# 测试 4：文件管理器（File Manager）— 目录树 + 文件备份列表
# ================================================================
echo -e "${CYAN}[4/9] 文件管理器（/api/file-manager/tree 和 /backups）${RESET}"

# 4a: 目录树接口
BODY=$(curl_local -s "$BASE_URL/api/file-manager/tree")
STATUS=$(curl_local -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/file-manager/tree")
assert_status "GET /api/file-manager/tree 返回 200" "$STATUS" "200"
assert_contains "tree 响应包含 tree 或 children 字段" "$BODY" '"tree"\|"children"\|"name"'

# 4b: 备份列表接口（需要 path 参数，传一个 OpenClaw 安全目录内的文件路径）
TEST_FILE="$HOME/.openclaw/update-check.json"
BODY_BK=$(curl_local -s "$BASE_URL/api/file-manager/backups?path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TEST_FILE'))")")
STATUS_BK=$(curl_local -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/file-manager/backups?path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TEST_FILE'))")")
assert_status "GET /api/file-manager/backups?path=... 返回 200" "$STATUS_BK" "200"
assert_contains "backups 响应包含 backups 数组" "$BODY_BK" '"backups"'
echo ""

# ================================================================
# 测试 5：dist 备份列表（Dist Backup List — 版本回退）
# ================================================================
echo -e "${CYAN}[5/9] dist 备份列表（/api/system/dist-backups）${RESET}"
BODY=$(curl_local -s "$BASE_URL/api/system/dist-backups")
STATUS=$(curl_local -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/system/dist-backups")
assert_status "GET /api/system/dist-backups 返回 200" "$STATUS" "200"
assert_contains "响应包含 backups 数组字段" "$BODY" '"backups"'

IS_ARRAY_BK=$(echo "$BODY" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
    try { const p=JSON.parse(d); console.log(Array.isArray(p.backups)?'yes':'no'); }
    catch(e){ console.log('parse_err'); }
  });
" 2>/dev/null)
if [ "$IS_ARRAY_BK" = "yes" ]; then
  BACKUP_COUNT=$(echo "$BODY" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
      try { const p=JSON.parse(d); console.log(p.backups.length); }
      catch(e){ console.log(0); }
    });
  " 2>/dev/null)
  echo -e "  ${GREEN}✅ PASS${RESET}  backups 是数组，当前备份数量：$BACKUP_COUNT"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}❌ FAIL${RESET}  backups 字段不是数组"
  FAIL=$((FAIL + 1))
  ERRORS+=("backups 字段是数组")
fi
echo ""

# ================================================================
# 测试 6：dist 回退安全校验（Rollback Security — 路径越界拦截）
# ================================================================
echo -e "${CYAN}[6/9] dist 回退安全校验（路径越界攻击防护）${RESET}"
# 6a：空 body
BODY_EMPTY=$(curl_local -s -X POST "$BASE_URL/api/system/dist-rollback" \
  -H "Content-Type: application/json" -d '{}')
assert_contains "POST /dist-rollback 空 body → error 提示" "$BODY_EMPTY" '"error"'

# 6b：路径越界（Path Traversal）
BODY_TRAV=$(curl_local -s -X POST "$BASE_URL/api/system/dist-rollback" \
  -H "Content-Type: application/json" \
  -d '{"backupPath": "/tmp/evil-backup"}')
assert_contains "POST /dist-rollback 越界路径 → Invalid backup path" "$BODY_TRAV" 'Invalid backup path'

# 6c：ok=false（非 ok 响应）
IS_OK=$(echo "$BODY_TRAV" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
    try { const p=JSON.parse(d); console.log(p.ok?'yes':'no'); }
    catch(e){ console.log('parse_err'); }
  });
" 2>/dev/null)
if [ "$IS_OK" = "no" ]; then
  echo -e "  ${GREEN}✅ PASS${RESET}  越界路径请求 ok=false（拒绝执行）"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}❌ FAIL${RESET}  越界路径请求 ok 应为 false，实际：$IS_OK"
  FAIL=$((FAIL + 1))
  ERRORS+=("越界路径 ok=false")
fi
echo ""

# ================================================================
# 测试 7：用量统计（Usage Stats）
# ================================================================
echo -e "${CYAN}[7/9] 用量统计（/api/usage）${RESET}"
BODY=$(curl_local -s "$BASE_URL/api/usage")
STATUS=$(curl_local -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/usage")
assert_status "GET /api/usage 返回 200" "$STATUS" "200"
assert_contains "响应包含数据字段（agents 或 totalTokens 或 data）" "$BODY" '"agents"\|"totalTokens"\|"data"\|"sessions"'
echo ""

# ================================================================
# 测试 8：404 路由（Not Found — 未注册路由返回 404）
# ================================================================
echo -e "${CYAN}[8/9] 404 路由处理（未注册路由）${RESET}"
STATUS_404=$(curl_local -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/this-endpoint-does-not-exist-xyz")
assert_status "访问不存在路由返回 404" "$STATUS_404" "404"

BODY_404=$(curl_local -s "$BASE_URL/api/this-endpoint-does-not-exist-xyz")
assert_contains "404 响应包含 error 字段" "$BODY_404" '"error"'
echo ""

# ================================================================
# 结果汇总（Summary）
# ================================================================
TOTAL=$((PASS + FAIL))
echo "========================================"
if [ $FAIL -eq 0 ]; then
  echo -e "  ${GREEN}全部通过（All Passed）${RESET}  $PASS / $TOTAL 个测试"
else
  echo -e "  ${RED}存在失败（Failed）${RESET}  通过 $PASS / $TOTAL，失败 $FAIL 个"
  echo ""
  echo "  失败的测试（Failed Tests）："
  for err in "${ERRORS[@]}"; do
    echo -e "    ${RED}✗${RESET} $err"
  done
fi
echo "========================================"
echo ""

# 以失败数量作为退出码（Exit Code）——0=全部通过，>0=有失败
exit $FAIL
