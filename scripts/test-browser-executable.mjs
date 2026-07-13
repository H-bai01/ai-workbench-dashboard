import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_CANDIDATES = Object.freeze({
  darwin: Object.freeze([
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ]),
  linux: Object.freeze([
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]),
  win32: Object.freeze([]),
})

function comparable(value, platform) {
  const normalized = path.normalize(value)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function validateTestBrowserExecutable(input, { platform = process.platform } = {}) {
  if (typeof input !== 'string' || input.length === 0 || input.trim() !== input) {
    throw new Error('OPENCLAW_TEST_BROWSER must be a non-empty path without surrounding whitespace')
  }
  if (!path.isAbsolute(input)) throw new Error('OPENCLAW_TEST_BROWSER must be an absolute path')

  const lexical = path.resolve(input)
  let stat
  try {
    stat = fs.lstatSync(lexical)
  } catch (error) {
    throw new Error(`OPENCLAW_TEST_BROWSER is unavailable (${error?.code || 'unknown'})`)
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('OPENCLAW_TEST_BROWSER must be a regular file and not a symbolic link')
  }
  if (platform !== 'win32') {
    try {
      fs.accessSync(lexical, fs.constants.X_OK)
    } catch {
      throw new Error('OPENCLAW_TEST_BROWSER must be executable')
    }
  }

  const physical = fs.realpathSync(lexical)
  if (comparable(physical, platform) !== comparable(lexical, platform)) {
    throw new Error('OPENCLAW_TEST_BROWSER must not traverse symbolic-link ancestors')
  }
  return physical
}

export function resolveTestBrowserExecutable({
  env = process.env,
  platform = process.platform,
  defaultCandidates = DEFAULT_CANDIDATES[platform] || [],
} = {}) {
  if (env && Object.hasOwn(env, 'OPENCLAW_TEST_BROWSER')) {
    return validateTestBrowserExecutable(env.OPENCLAW_TEST_BROWSER, { platform })
  }

  for (const candidate of defaultCandidates) {
    try {
      return validateTestBrowserExecutable(candidate, { platform })
    } catch {
      // A built-in candidate is optional; continue to the next known location.
    }
  }
  return ''
}
