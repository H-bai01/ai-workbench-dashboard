#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'start'

function printHelp() {
  process.stdout.write(`AI Workbench Dashboard v${pkg.version}\n\n`)
  process.stdout.write('用法：\n')
  process.stdout.write('  npx ai-workbench-dashboard\n')
  process.stdout.write('  ai-workbench-dashboard start\n\n')
  process.stdout.write('选项：\n')
  process.stdout.write('  --help       显示帮助\n')
  process.stdout.write('  --version    显示版本\n\n')
  process.stdout.write('工作台仅监听本机回环地址，默认入口：http://127.0.0.1:31021\n')
}

if (args.includes('--help') || args.includes('-h') || command === 'help') {
  printHelp()
  process.exit(0)
}

if (args.includes('--version') || args.includes('-v') || command === 'version') {
  process.stdout.write(`${pkg.version}\n`)
  process.exit(0)
}

if (command !== 'start') {
  process.stderr.write('不支持的命令。请使用 --help 查看可用命令。\n')
  process.exit(1)
}

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  process.stderr.write('需要 Node.js 22.13.0 或更高版本。\n')
  process.exit(1)
}

if (!process.env.OPENCLAW_DASHBOARD_DATA_ROOT) {
  process.env.OPENCLAW_DASHBOARD_DATA_ROOT = path.join(os.homedir(), '.openclaw', 'ai-workbench-dashboard-data')
}

process.chdir(packageRoot)
process.argv = [process.execPath, path.join(packageRoot, 'scripts', 'start-versioned.js'), ...args]
await import('./start-versioned.js')
