import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const repo = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))

test('npm 发布元数据与运行时依赖完整', () => {
  assert.equal(pkg.name, 'ai-workbench-dashboard')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.bin?.['ai-workbench-dashboard'], 'scripts/npm-cli.mjs')
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org/')
  assert.equal(pkg.publishConfig?.access, 'public')

  for (const dependency of [
    '@vitejs/plugin-vue',
    'dotenv',
    'unplugin-auto-import',
    'unplugin-element-plus',
    'unplugin-vue-components',
    'vite',
  ]) {
    assert.equal(typeof pkg.dependencies?.[dependency], 'string', dependency)
  }

  const mode = fs.statSync(path.join(repo, pkg.bin['ai-workbench-dashboard'])).mode & 0o777
  assert.equal(mode, 0o755)
})

test('npm 包只包含审核后的发布文件范围', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const [result] = JSON.parse(output)
  const files = new Set(result.files.map(item => item.path))

  for (const required of [
    'LICENSE',
    'README.md',
    'package.json',
    'index.html',
    'scripts/npm-cli.mjs',
    'scripts/start-versioned.js',
    'scripts/unified-service.js',
    'src/main.ts',
    'public/manifest.webmanifest',
  ]) {
    assert.equal(files.has(required), true, required)
  }

  for (const file of files) {
    assert.equal(file.startsWith('.github/'), false, file)
    assert.equal(file.startsWith('.vscode/'), false, file)
    assert.equal(file.startsWith('backups/'), false, file)
    assert.equal(file.startsWith('node_modules/'), false, file)
    assert.equal(file.startsWith('dist/'), false, file)
    assert.notEqual(file, 'public/versions-cache.json')
    assert.notEqual(file, 'PUBLIC_FILES.txt')
    assert.notEqual(file, 'SHA256SUMS.txt')
    assert.notEqual(file, 'package-lock.json')
  }
})

test('npm 命令入口可独立输出帮助和版本', () => {
  const cli = path.join(repo, 'scripts/npm-cli.mjs')
  const help = execFileSync(process.execPath, [cli, '--help'], { cwd: repo, encoding: 'utf8' })
  const version = execFileSync(process.execPath, [cli, '--version'], { cwd: repo, encoding: 'utf8' })
  assert.match(help, /npx ai-workbench-dashboard/)
  assert.equal(version.trim(), pkg.version)
})
