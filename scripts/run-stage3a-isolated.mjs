import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIsolatedProcessEnv } from './test-isolation-env.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-stage3a-default-'))
const home = path.join(root, 'home')
fs.mkdirSync(home, { recursive: true })

const child = spawn(process.execPath, [
  '--test',
  '--test-concurrency=1',
  'scripts/stage3-session-observation.test.mjs',
  'scripts/stage3-session-observation-browser.test.mjs',
], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: createIsolatedProcessEnv({ isolationRoot: root, homeDir: home }),
  shell: false,
  stdio: 'inherit',
})

const cleanup = () => fs.rmSync(root, { recursive: true, force: true })
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (child.exitCode === null) child.kill(signal)
  })
}

child.once('error', (error) => {
  cleanup()
  console.error(`Stage 3A isolated test failed to start: ${error.message}`)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  cleanup()
  process.exitCode = signal ? 1 : (code ?? 1)
})
