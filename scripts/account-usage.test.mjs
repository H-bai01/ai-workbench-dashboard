import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import {
  clearAccountUsageCache,
  collectAccountUsage,
  normalizeClaudeUsageHistory,
  normalizeCodexAccountUsage,
  readClaudeAccountUsage,
  readCodexAccountUsage,
} from './account-usage.mjs'

test('Codex 账号用量保留精确 Token 和额度窗口', () => {
  const result = normalizeCodexAccountUsage({
    summary: {
      lifetimeTokens: 123_456,
      peakDailyTokens: 12_345,
    },
    dailyUsageBuckets: [
      { startDate: '2026-07-18', tokens: 1000 },
      { startDate: '2026-07-19', tokens: 2000 },
    ],
  }, {
    rateLimits: {
      planType: 'plus',
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_800_010_000 },
    },
  })

  assert.equal(result.availability, 'ready')
  assert.equal(result.exactTokenUsage, true)
  assert.equal(result.lifetimeTokens, 123_456)
  assert.deepEqual(result.dailyUsageBuckets.map(row => row.tokens), [1000, 2000])
  assert.deepEqual(result.quotaWindows.map(row => [row.label, row.usedPercent]), [
    ['5 小时额度', 25],
    ['7 天额度', 40],
  ])
})

test('Claude 账号历史只发布额度比例，不伪造 Token', () => {
  const result = normalizeClaudeUsageHistory({
    version: 1,
    samples: [
      { t: 1_700_000_000_000, u: { fh: 12, sd: 34 } },
      { t: 1_700_000_100_000, u: { fh: 23, sd: 45 } },
    ],
  })
  assert.equal(result.exactTokenUsage, false)
  assert.equal('lifetimeTokens' in result, false)
  assert.deepEqual(result.quotaWindows.map(row => row.usedPercent), [23, 45])
})

test('Claude 账号历史仅从安全的本地记录文件读取', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'account-usage-claude-'))
  const file = path.join(root, 'plan-usage-history.json')
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    samples: [{ t: 1_700_000_000_000, u: { fh: 10, sd: 20 }, org: 'not-published' }],
  }), { mode: 0o600 })
  try {
    const result = readClaudeAccountUsage({ candidates: [file] })
    assert.equal(result.availability, 'ready')
    assert.equal(JSON.stringify(result).includes('not-published'), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex app-server 必须初始化后再读取账号级用量', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'account-usage-codex-'))
  const fixture = path.join(root, 'fixture.mjs')
  fs.writeFileSync(fixture, `
    import readline from 'node:readline'
    const lines = readline.createInterface({ input: process.stdin })
    let initialized = false
    lines.on('line', line => {
      const message = JSON.parse(line)
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: 'fixture' } }) + '\\n')
      } else if (message.method === 'initialized') {
        initialized = true
      } else if (message.method === 'account/usage/read') {
        process.stdout.write(JSON.stringify({
          id: message.id,
          result: { summary: { lifetimeTokens: initialized ? 987654 : 0 }, dailyUsageBuckets: [] }
        }) + '\\n')
      } else if (message.method === 'account/rateLimits/read') {
        process.stdout.write(JSON.stringify({
          id: message.id,
          result: { rateLimits: { primary: { usedPercent: 21, windowDurationMins: 300 } } }
        }) + '\\n')
      }
    })
  `, { mode: 0o600 })
  try {
    const result = await readCodexAccountUsage({
      executable: process.execPath,
      spawnImpl: (_executable, _args, options) => spawn(process.execPath, [fixture], options),
      timeoutMs: 3000,
    })
    assert.equal(result.availability, 'ready')
    assert.equal(result.lifetimeTokens, 987_654)
    assert.equal(result.quotaWindows[0].usedPercent, 21)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('账号用量相同请求共享缓存', async () => {
  clearAccountUsageCache()
  let codexReads = 0
  let claudeReads = 0
  const options = {
    now: 1000,
    cacheTtlMs: 60_000,
    codexReader: async () => {
      codexReads += 1
      return { id: 'codex', availability: 'ready' }
    },
    claudeReader: () => {
      claudeReads += 1
      return { id: 'claude', availability: 'ready' }
    },
  }
  const first = await collectAccountUsage(options)
  const second = await collectAccountUsage({ ...options, now: 2000 })
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.equal(codexReads, 1)
  assert.equal(claudeReads, 1)
  clearAccountUsageCache()
})
