import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readGatewayCredentials } from './security/gateway-credentials.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const browserRoots = [path.join(repo, 'src'), path.join(repo, 'public'), path.join(repo, 'dist')]

function filesUnder(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else files.push(full)
    }
  }
  visit(root)
  return files
}

function readLocalDashboardToken() {
  const configured = process.env.OPENCLAW_DASHBOARD_TOKEN_FILE
  const file = configured || path.join(os.homedir(), '.openclaw', 'dashboard-local-token')
  try { return fs.readFileSync(file, 'utf8').trim() } catch { return '' }
}

const credentials = readGatewayCredentials()
const secrets = [...new Set([
  credentials.token,
  readLocalDashboardToken(),
  process.env.OPENCLAW_SYNTHETIC_BROWSER_SECRET,
].filter(value => value && value.length >= 8))]
const files = browserRoots.flatMap(filesUnder)
const findings = []
const forbiddenSourcePatterns = [
  /VITE_GATEWAY_TOKEN/,
  /VITE_BACKEND_URL/,
  /getAuthToken\s*\(/,
  /https?:\/\/(?:127\.0\.0\.1|localhost):31022/,
  /[?#&]token=/,
  /import\.meta\.env(?!\.DEV\b)/,
]

for (const file of files) {
  let content
  try { content = fs.readFileSync(file) } catch { continue }
  const text = content.toString('utf8')
  if (file.includes(`${path.sep}src${path.sep}`)) {
    for (const pattern of forbiddenSourcePatterns) {
      if (pattern.test(text)) findings.push(`${path.relative(repo, file)}: forbidden browser credential pattern`)
    }
  }
  for (const secret of secrets) {
    if (content.includes(Buffer.from(secret))) findings.push(`${path.relative(repo, file)}: configured secret value present`)
  }
}

if (findings.length > 0) {
  console.error(`Secret scan failed (${findings.length} finding(s))`)
  for (const finding of findings) console.error(`- ${finding}`)
  process.exitCode = 1
} else {
  console.log(`Secret scan passed: ${files.length} browser/source files checked; ${secrets.length} configured secret value(s) compared without printing them.`)
}
