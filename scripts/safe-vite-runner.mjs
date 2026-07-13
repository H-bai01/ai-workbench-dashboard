import { spawn } from 'node:child_process'
import path from 'node:path'
import { installPrivacyConsole, installProcessErrorPrivacy } from '../src/utils/log-privacy.mjs'

installPrivacyConsole(console, { scope: 'vite_runner' })
installProcessErrorPrivacy(process, console, { scope: 'vite_runner' })

const allowedModes = new Set(['dev', 'build', 'preview'])
const mode = String(process.argv[2] || 'dev').toLowerCase()
const forwardedArgs = process.argv.slice(3)
let activeChild = null
let stopping = false

function runChild(role, script, args) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      activeChild = null
      resolve(code)
    }
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    activeChild = child
    child.stdout.on('data', (chunk) => {
      console.info(`[ViteRunner] ${role} output`, chunk.toString('utf8'), { count: chunk.length })
    })
    child.stderr.on('data', (chunk) => {
      console.warn(`[ViteRunner] ${role} diagnostic`, chunk.toString('utf8'), { count: chunk.length })
    })
    child.once('error', (error) => {
      console.error(`[ViteRunner] ${role} failed to start`, error)
      finish(1)
    })
    child.once('exit', (code, signal) => {
      if (stopping) {
        finish(0)
        return
      }
      const exitCode = Number.isInteger(code) ? code : 1
      if (exitCode !== 0 || signal) console.error(`[ViteRunner] ${role} exited`, { code: exitCode, signal: Boolean(signal) })
      finish(exitCode)
    })
  })
}

function stopChild(signal) {
  if (stopping) return
  stopping = true
  if (activeChild && !activeChild.killed) activeChild.kill(signal)
  else process.exit(0)
}

process.on('SIGINT', () => stopChild('SIGINT'))
process.on('SIGTERM', () => stopChild('SIGTERM'))

async function main() {
  if (!allowedModes.has(mode)) {
    console.error('[ViteRunner] invalid mode')
    return 1
  }

  if (mode === 'build') {
    const vueTscBin = path.join(process.cwd(), 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js')
    const typeCheckCode = await runChild('typecheck', vueTscBin, ['-b'])
    if (typeCheckCode !== 0) return typeCheckCode
  }

  const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')
  const viteArgs = mode === 'dev' ? forwardedArgs : [mode, ...forwardedArgs]
  return runChild('vite', viteBin, viteArgs)
}

main()
  .then((code) => { process.exitCode = code })
  .catch(() => {
    console.error('[ViteRunner] unexpected failure')
    process.exitCode = 1
  })
