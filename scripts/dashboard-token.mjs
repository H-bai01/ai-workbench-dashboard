import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { assertSecureSecretFile } from './security/gateway-credentials.mjs'

const TOKEN_FILE = path.join(os.homedir(), '.openclaw', 'dashboard-local-token')

function readValidatedToken(tokenFile) {
  const safeFile = assertSecureSecretFile(tokenFile)
  const token = fs.readFileSync(safeFile, 'utf8').trim()
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('Dashboard 本地 token 格式无效')
  return token
}

export function getOrCreateLocalToken({ tokenFile = TOKEN_FILE } = {}) {
  try {
    return readValidatedToken(tokenFile)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const token = crypto.randomBytes(32).toString('hex')
  try {
    const parent = path.dirname(tokenFile)
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
    const parentStat = fs.lstatSync(parent)
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('Dashboard token 目录不安全')
    const fd = fs.openSync(tokenFile, 'wx', 0o600)
    try {
      fs.writeFileSync(fd, token)
    } finally {
      fs.closeSync(fd)
    }
    return token
  } catch (e) {
    if (e && e.code === 'EEXIST') return readValidatedToken(tokenFile)
    throw e
  }
}
