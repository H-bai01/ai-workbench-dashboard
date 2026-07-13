import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'
import { resolveTestBrowserExecutable } from './test-browser-executable.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const mode = process.argv.includes('--pure') ? 'pure' : 'full'
const planOnly = process.argv.includes('--plan')
const buildOnly = process.argv.includes('--build-only')
const environmentProbeOnly = process.argv.includes('--probe-environment')

const unitFiles = [
  'scripts/status-detection.test.mjs',
  'scripts/local-ai-status.test.mjs',
  'scripts/output-redaction.test.mjs',
  'scripts/safe-record.test.mjs',
  'scripts/security-boundary.test.mjs',
  'scripts/security-http-integration.test.mjs',
  'scripts/browser-secret-exposure.test.mjs',
  'scripts/security-browser-media.test.mjs',
  'scripts/security-browser-dynamic-keys.test.mjs',
  'scripts/ci-foundation.test.mjs',
  'scripts/generic-defaults.test.mjs',
  'scripts/public-release-hygiene.test.mjs',
  'scripts/log-privacy.test.mjs',
  'scripts/package-lock-integrity.test.mjs',
  'scripts/stage2-project-details.test.mjs',
  'scripts/stage3-session-observation.test.mjs',
  'scripts/run-public-ci.test.mjs',
  'scripts/test-browser-executable.test.mjs',
  'scripts/version-consistency.test.mjs',
]

const pureFiles = [
  'scripts/run-public-ci.test.mjs',
  'scripts/test-browser-executable.test.mjs',
  'scripts/ci-foundation.test.mjs',
  'scripts/local-ai-status.test.mjs',
  'scripts/output-redaction.test.mjs',
  'scripts/safe-record.test.mjs',
  'scripts/generic-defaults.test.mjs',
  'scripts/public-release-hygiene.test.mjs',
  'scripts/package-lock-integrity.test.mjs',
  'scripts/version-consistency.test.mjs',
]

const securityFiles = [
  'scripts/output-redaction.test.mjs',
  'scripts/safe-record.test.mjs',
  'scripts/security-boundary.test.mjs',
  'scripts/security-http-integration.test.mjs',
  'scripts/browser-secret-exposure.test.mjs',
  'scripts/security-browser-media.test.mjs',
  'scripts/security-browser-dynamic-keys.test.mjs',
  'scripts/package-lock-integrity.test.mjs',
]

const nodeTest = (name, files) => ({
  name,
  args: ['--test', '--test-concurrency=1', ...files],
})

const sharedStages = [
  { name: 'lint', args: ['node_modules/eslint/bin/eslint.js', '.', '--quiet'] },
  { name: 'secret-scan', args: ['scripts/secret-scan.mjs'] },
]

const fullStages = [
  nodeTest('unit', unitFiles),
  nodeTest('security', securityFiles),
  nodeTest('stage2', ['scripts/stage2-project-details.test.mjs', 'scripts/stage2-project-details-browser.test.mjs']),
  { name: 'stage3a', args: ['scripts/run-stage3a-isolated.mjs'] },
  nodeTest('start-isolated', ['scripts/start-isolated.test.mjs']),
  nodeTest('stage4b-generic', ['scripts/generic-defaults.test.mjs', 'scripts/security-browser-dynamic-keys.test.mjs']),
  nodeTest('stage4b-hygiene', ['scripts/public-release-hygiene.test.mjs', 'scripts/security-browser-dynamic-keys.test.mjs']),
  nodeTest('stage4b-logs', ['scripts/log-privacy.test.mjs', 'scripts/security-browser-dynamic-keys.test.mjs']),
  nodeTest('version', ['scripts/version-consistency.test.mjs']),
  ...sharedStages,
]

const pureStages = [
  nodeTest('pure-unit', pureFiles),
  ...sharedStages,
]

const stages = mode === 'pure' ? pureStages : fullStages

if (planOnly) {
  process.stdout.write(`${JSON.stringify({
    mode,
    isolated: true,
    realGateway: false,
    realSessions: false,
    stages: [...stages.map(stage => stage.name), 'build'],
  })}\n`)
  process.exit(0)
}

function sanitizedBaseEnvironment() {
  const environment = Object.create(null)
  const allowedKeys = [
    'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'NO_COLOR', 'FORCE_COLOR', 'TZ',
    'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
  ]
  for (const key of allowedKeys) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key]
  }
  return environment
}

let browser = ''
try {
  if (mode === 'full' && process.platform === 'win32') {
    throw new Error('unsupported platform')
  }
  browser = mode === 'full' ? resolveTestBrowserExecutable() : ''
} catch {
  process.stderr.write('[public-ci] preflight_failed\n')
  process.exit(1)
}

let root = ''
try {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-public-ci-'))
  fs.chmodSync(root, 0o700)
  root = fs.realpathSync(root)

  const home = path.join(root, 'home')
  const temp = path.join(root, 'tmp')
  const xdgConfig = path.join(root, 'xdg-config')
  const xdgData = path.join(root, 'xdg-data')
  const xdgCache = path.join(root, 'xdg-cache')
  const artifacts = path.join(root, 'artifacts')
  const typecheck = path.join(root, 'typecheck')
  for (const directory of [home, temp, xdgConfig, xdgData, xdgCache, artifacts, typecheck]) {
    fs.mkdirSync(directory, { mode: 0o700 })
  }

  const environment = createIsolatedProcessEnv({
    baseEnv: sanitizedBaseEnvironment(),
    isolationRoot: root,
    homeDir: home,
    overrides: {
      CI: '1',
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_DATA_HOME: xdgData,
      XDG_CACHE_HOME: xdgCache,
      OPENCLAW_TEST_ARTIFACT_DIR: artifacts,
      OPENCLAW_VITE_CACHE_DIR: path.join(root, 'vite-cache'),
      ...(browser ? { OPENCLAW_TEST_BROWSER: browser } : {}),
    },
  })

  function runStage(stage) {
    process.stdout.write(`\n[public-ci] ${stage.name}\n`)
    const result = spawnSync(process.execPath, stage.args, {
      cwd: repo,
      env: environment,
      shell: false,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Public CI stage failed: ${stage.name}`)
  }

  if (environmentProbeOnly) {
    const blockedKeys = [
      'NPM_CONFIG__AUTH', 'SSH_AUTH_SOCK', 'GIT_ASKPASS', 'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE', 'DOCKER_CONFIG', 'GITHUB_TOKEN',
      'GH_TOKEN', 'NPM_TOKEN', 'OPENCLAW_GATEWAY_TOKEN', 'VITE_GATEWAY_TOKEN',
    ]
    const probeSource = `
      const path = require('node:path')
      const keys = ${JSON.stringify(blockedKeys)}
      const inside = (parent, candidate) => {
        const relative = path.relative(parent, candidate)
        return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
      }
      process.stdout.write(JSON.stringify({
        present: keys.filter(key => Object.hasOwn(process.env, key)),
        homeMatchesUserProfile: process.env.HOME === process.env.USERPROFILE,
        workbenchInsideHome: inside(process.env.HOME, process.env.AI_WORKBENCH_HOME),
        tokenInsideWorkbench: inside(process.env.AI_WORKBENCH_HOME, process.env.AI_WORKBENCH_LOCAL_TOKEN_FILE),
        dotenvSkipped: process.env.OPENCLAW_SKIP_DOTENV === '1',
      }))
    `
    const probe = spawnSync(process.execPath, ['-e', probeSource], {
      cwd: repo,
      env: environment,
      shell: false,
      encoding: 'utf8',
    })
    if (probe.error) throw probe.error
    if (probe.status !== 0) throw new Error('Public CI environment probe failed')
    process.stdout.write(`${probe.stdout}\n`)
  } else {
    if (!buildOnly) {
      for (const stage of stages) runStage(stage)
    }
    runStage({
      name: 'typecheck-app',
      args: [
        'node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit', '--incremental',
        '-p', 'tsconfig.app.json', '--tsBuildInfoFile', path.join(typecheck, 'app.tsbuildinfo'),
      ],
    })
    runStage({
      name: 'typecheck-node',
      args: [
        'node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit', '--incremental',
        '-p', 'tsconfig.node.json', '--tsBuildInfoFile', path.join(typecheck, 'node.tsbuildinfo'),
      ],
    })
    runStage({
      name: 'build',
      args: ['node_modules/vite/bin/vite.js', 'build', '--outDir', path.join(root, 'dist'), '--emptyOutDir'],
    })
  }
} catch {
  process.stderr.write('[public-ci] failed\n')
  process.exitCode = 1
} finally {
  if (root) fs.rmSync(root, { recursive: true, force: true })
}
