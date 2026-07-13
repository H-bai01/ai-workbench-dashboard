import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')

function writeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 })
}

function createSource(root, name, { failHealth = false } = {}) {
  const source = path.join(root, name)
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(source, 'src'), { recursive: true })
  fs.mkdirSync(path.join(source, 'public'), { recursive: true })
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: 'ai-workbench-dashboard-fixture',
    version: name,
    private: true,
    scripts: { 'start:v2': 'node scripts/start-versioned.js --profile=v2' },
    engines: { node: '>=22.13.0' },
  }, null, 2))
  fs.writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({
    name: 'ai-workbench-dashboard-fixture',
    version: name,
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'ai-workbench-dashboard-fixture', version: name } },
  }, null, 2))
  fs.writeFileSync(path.join(source, 'index.html'), '<div id="app"></div>')
  fs.writeFileSync(path.join(source, 'vite.config.ts'), 'export default {}\n')
  fs.writeFileSync(path.join(source, 'scripts', 'start-versioned.js'), 'process.stdin.resume()\n')
  fs.writeFileSync(path.join(source, 'scripts', 'unified-service.js'), 'process.stdin.resume()\n')
  fs.writeFileSync(path.join(source, 'src', 'main.ts'), 'export {}\n')
  fs.writeFileSync(path.join(source, 'public', 'fixture.txt'), 'neutral fixture\n')
  fs.writeFileSync(path.join(source, '.env'), 'OPENCLAW_GATEWAY_TOKEN=must-not-migrate\n')
  fs.mkdirSync(path.join(source, '.openclaw'), { recursive: true })
  fs.writeFileSync(path.join(source, '.openclaw', 'sentinel'), 'must-not-copy\n')
  if (failHealth) fs.writeFileSync(path.join(source, 'FAIL_HEALTH'), 'synthetic failure\n')
  return source
}

function run(script, args, env) {
  return spawnSync('/bin/bash', [path.join(repo, script), ...args], {
    cwd: repo,
    env,
    encoding: 'utf8',
  })
}

function expectSuccess(result, action) {
  assert.equal(result.status, 0, `${action}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
}

test('7/7 生命周期入口的 --help 与 -h 在初始化前零副作用返回', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-macos-help-'))
  try {
    const home = path.join(sandbox, 'home-must-not-be-created')
    const installRoot = path.join(home, 'install-must-not-be-created')
    const entries = [
      ['install.sh', '用法：./install.sh <本地源码目录>'],
      ['start.sh', '用法：./start.sh'],
      ['stop.sh', '用法：./stop.sh'],
      ['status.sh', '用法：./status.sh'],
      ['upgrade.sh', '用法：./upgrade.sh <本地源码目录>'],
      ['rollback.sh', '用法：./rollback.sh'],
      ['uninstall.sh', '用法：./uninstall.sh'],
    ]
    for (const [script, usage] of entries) {
      for (const flag of ['--help', '-h']) {
        const result = run(script, [flag], {
          HOME: home,
          PATH: '',
          AI_WORKBENCH_INSTALL_ROOT: 'relative-path-must-not-be-validated',
        })
        assert.equal(result.status, 0, `${script} ${flag}: ${result.stderr}`)
        assert.match(result.stdout, new RegExp(usage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        assert.match(result.stdout, /用途：/)
        assert.match(result.stdout, /参数：/)
        assert.match(result.stdout, /默认安装根：\$HOME\/Library\/Application Support\/AI Workbench Dashboard/)
        assert.equal(result.stderr, '')
      }
    }
    assert.equal(fs.existsSync(home), false)
    assert.equal(fs.existsSync(installRoot), false)
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
})

test('macOS 生命周期在隔离 HOME 中只管理 Dashboard LaunchAgent，并安全升级、回退与卸载', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-macos-lifecycle-'))
  try {
    const home = path.join(sandbox, 'home')
    const installRoot = path.join(sandbox, 'AI Workbench Dashboard')
    const fakeBin = path.join(sandbox, 'fake-bin')
    const launchState = path.join(sandbox, 'launch-state')
    const launchLog = path.join(sandbox, 'launch.log')
    const npmLog = path.join(sandbox, 'npm.log')
    const curlLog = path.join(sandbox, 'curl.log')
    fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true })
    fs.mkdirSync(fakeBin, { recursive: true })
    const sentinel = path.join(home, '.openclaw', 'sentinel')
    fs.writeFileSync(sentinel, 'must remain\n')
    fs.writeFileSync(launchState, 'unloaded\n')

    writeExecutable(path.join(fakeBin, 'launchctl'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_LAUNCHCTL_LOG"
state="$(cat "$FAKE_LAUNCHCTL_STATE")"
case "$1" in
  print) [ "$state" = loaded ] ;;
  bootstrap) printf 'loaded\\n' > "$FAKE_LAUNCHCTL_STATE" ;;
  bootout) printf 'unloaded\\n' > "$FAKE_LAUNCHCTL_STATE" ;;
  kickstart) [ "$state" = loaded ] ;;
  *) exit 64 ;;
esac
`)
    writeExecutable(path.join(fakeBin, 'npm'), `#!/bin/sh
set -eu
printf '%s|%s\\n' "$PWD" "$*" >> "$FAKE_NPM_LOG"
[ "$*" = "ci --ignore-scripts" ]
mkdir -p node_modules
`)
    writeExecutable(path.join(fakeBin, 'curl'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_CURL_LOG"
target="$(readlink "$AI_WORKBENCH_INSTALL_ROOT/current")"
if [ -f "$AI_WORKBENCH_INSTALL_ROOT/$target/FAIL_HEALTH" ]; then
  exit 22
fi
case "$*" in
  */api/health) printf '{"status":"ok"}\\n' ;;
  *) printf '<div id="app"></div>\\n' ;;
esac
`)

    const env = {
      HOME: home,
      PATH: `${fakeBin}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      AI_WORKBENCH_TESTING: '1',
      AI_WORKBENCH_TEST_OS: 'Darwin',
      AI_WORKBENCH_TEST_UID: '501',
      AI_WORKBENCH_TEST_OCCUPIED_PORTS: '',
      AI_WORKBENCH_TEST_HEALTH_ATTEMPTS: '2',
      AI_WORKBENCH_TEST_HEALTH_DELAY: '0',
      AI_WORKBENCH_TEST_PORT_ATTEMPTS: '2',
      AI_WORKBENCH_TEST_PORT_DELAY: '0',
      AI_WORKBENCH_INSTALL_ROOT: installRoot,
      FAKE_LAUNCHCTL_STATE: launchState,
      FAKE_LAUNCHCTL_LOG: launchLog,
      FAKE_NPM_LOG: npmLog,
      FAKE_CURL_LOG: curlLog,
      OPENCLAW_GATEWAY_TOKEN: 'synthetic-gateway-secret-do-not-copy',
      OPENCLAW_DASHBOARD_TOKEN: 'synthetic-dashboard-secret-do-not-copy',
    }
    const sourceV1 = createSource(sandbox, 'source-v1')
    const sourceV2 = createSource(sandbox, 'source-v2')
    const sourceBad = createSource(sandbox, 'source-bad', { failHealth: true })

    const installResult = run('install.sh', [sourceV1], env)
    expectSuccess(installResult, 'install')
    assert.match(installResult.stderr, /OpenClaw 尚未就绪.*Dashboard 仍可启动.*不会生成 Gateway token.*不会启动或重启 Gateway/)
    assert.doesNotMatch(installResult.stderr, /synthetic-gateway-secret|synthetic-dashboard-secret/)
    const currentV1 = fs.readlinkSync(path.join(installRoot, 'current'))
    assert.match(currentV1, /^releases\/[0-9]{14}-[0-9]+$/)
    assert.equal(fs.existsSync(path.join(installRoot, currentV1, 'node_modules')), true)
    assert.equal(fs.existsSync(path.join(installRoot, currentV1, '.env')), false)
    assert.equal(fs.existsSync(path.join(installRoot, currentV1, '.openclaw')), false)
    assert.equal(fs.existsSync(path.join(installRoot, 'previous')), false)
    assert.match(fs.readFileSync(npmLog, 'utf8'), /ci --ignore-scripts/)

    const plist = path.join(home, 'Library', 'LaunchAgents', 'com.ai-workbench.dashboard.plist')
    const plistText = fs.readFileSync(plist, 'utf8')
    assert.match(plistText, /<string>com\.ai-workbench\.dashboard<\/string>/)
    assert.match(plistText, /<string>start:v2<\/string>/)
    assert.match(plistText, /AI Workbench Dashboard\/current/)
    assert.doesNotMatch(plistText, /token|gateway|synthetic-gateway-secret|synthetic-dashboard-secret/i)

    const initiallyStopped = run('status.sh', [], env)
    assert.equal(initiallyStopped.status, 1)
    assert.match(initiallyStopped.stdout, /未加载/)
    const openclawConfig = path.join(home, '.openclaw', 'openclaw.json')
    const configContents = '{"gateway":{"auth":{"token":"must-never-be-read-or-printed"}}}\n'
    fs.writeFileSync(openclawConfig, configContents)
    const startResult = run('start.sh', [], env)
    expectSuccess(startResult, 'start')
    assert.match(startResult.stderr, /127\.0\.0\.1:18789 正在监听.*Dashboard 仍可启动/)
    assert.doesNotMatch(startResult.stderr, /must-never-be-read-or-printed/)
    expectSuccess(run('status.sh', [], env), 'status while loaded')
    expectSuccess(run('stop.sh', [], env), 'stop')
    assert.equal(fs.readFileSync(launchState, 'utf8').trim(), 'unloaded')

    expectSuccess(run('upgrade.sh', [sourceV2], env), 'successful upgrade')
    const currentV2 = fs.readlinkSync(path.join(installRoot, 'current'))
    assert.notEqual(currentV2, currentV1)
    assert.equal(fs.readlinkSync(path.join(installRoot, 'previous')), currentV1)
    assert.match(fs.readFileSync(curlLog, 'utf8'), /127\.0\.0\.1:31021\//)
    assert.match(fs.readFileSync(curlLog, 'utf8'), /127\.0\.0\.1:31022\/api\/health/)

    const failedUpgrade = run('upgrade.sh', [sourceBad], env)
    assert.notEqual(failedUpgrade.status, 0)
    assert.match(failedUpgrade.stderr, /已恢复升级前的 current/)
    assert.equal(fs.readlinkSync(path.join(installRoot, 'current')), currentV2)
    assert.equal(fs.readlinkSync(path.join(installRoot, 'previous')), currentV1)
    assert.equal(fs.readdirSync(path.join(installRoot, 'releases')).length, 2)

    expectSuccess(run('rollback.sh', [], env), 'rollback')
    assert.equal(fs.readlinkSync(path.join(installRoot, 'current')), currentV1)
    assert.equal(fs.readlinkSync(path.join(installRoot, 'previous')), currentV2)

    expectSuccess(run('stop.sh', [], env), 'stop before occupied-port check')
    const bootstrapCountBefore = (fs.readFileSync(launchLog, 'utf8').match(/^bootstrap /gm) || []).length
    for (const port of ['31021', '31022']) {
      const occupied = run('start.sh', [], { ...env, AI_WORKBENCH_TEST_OCCUPIED_PORTS: port })
      assert.notEqual(occupied.status, 0)
      assert.match(occupied.stderr, new RegExp(`端口 ${port} 已被未知服务占用；不会接管或结束`))
    }
    const bootstrapCountAfter = (fs.readFileSync(launchLog, 'utf8').match(/^bootstrap /gm) || []).length
    assert.equal(bootstrapCountAfter, bootstrapCountBefore)

    const launchLines = fs.readFileSync(launchLog, 'utf8').trim().split('\n')
    assert.ok(launchLines.length > 0)
    for (const line of launchLines) {
      assert.match(line, /com\.ai-workbench\.dashboard/)
      assert.doesNotMatch(line, /gateway|openclaw/i)
    }

    expectSuccess(run('uninstall.sh', [], env), 'uninstall')
    assert.equal(fs.existsSync(installRoot), false)
    assert.equal(fs.existsSync(plist), false)
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'must remain\n')
    assert.equal(fs.readFileSync(openclawConfig, 'utf8'), configContents)
    assert.equal(fs.readFileSync(launchState, 'utf8').trim(), 'unloaded')
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
})
