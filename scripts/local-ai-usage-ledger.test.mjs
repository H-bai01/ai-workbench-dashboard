import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLocalAiUsageLedgerStore } from './local-ai-usage-ledger.mjs'

const NOW_MS = Date.parse('2026-07-27T12:00:00Z')

function tempFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-ledger-'))
  fs.chmodSync(root, 0o700)
  const codex = path.join(root, 'home', '.codex', 'sessions')
  const claude = path.join(root, 'home', '.claude', 'projects')
  fs.mkdirSync(codex, { recursive: true, mode: 0o700 })
  fs.mkdirSync(claude, { recursive: true, mode: 0o700 })
  return {
    root,
    home: path.join(root, 'home'),
    codex,
    claude,
    ledgerDir: path.join(root, 'data', 'local-ai-usage-ledger'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

function line(value) {
  return `${JSON.stringify(value)}\n`
}

function codexMeta(id = 'codex-session', model = 'gpt-5.6-sol') {
  return {
    timestamp: '2026-07-27T09:00:00Z',
    type: 'session_meta',
    payload: { id, cwd: '/synthetic/project', model },
  }
}

function codexUsage(timestamp, input, output, marker = '') {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: input,
          output_tokens: output,
          cached_input_tokens: 0,
        },
      },
      message: marker,
    },
  }
}

function codexTitle(message, timestamp = '2026-07-27T09:01:00Z') {
  return {
    timestamp,
    type: 'event_msg',
    payload: { type: 'user_message', message },
  }
}

function claudeUsage(timestamp, id = 'claude-message') {
  return {
    timestamp,
    sessionId: 'claude-session',
    cwd: '/synthetic/claude-project',
    message: {
      id,
      model: 'claude-sonnet-4-5',
      content: 'PRIVATE_MESSAGE_BODY_MUST_NOT_PERSIST',
      usage: { input_tokens: 7, output_tokens: 3 },
    },
  }
}

function createStore(fixture, metrics, retentionMs = 30 * 86400_000) {
  return createLocalAiUsageLedgerStore({
    ledgerDir: fixture.ledgerDir,
    now: () => NOW_MS,
    retentionMs,
    metrics,
    sources: [
      { id: 'codex', boundaryRoot: fixture.home, roots: [fixture.codex], maxDepth: 4 },
      { id: 'claude-code', boundaryRoot: fixture.home, roots: [fixture.claude], maxDepth: 4 },
    ],
  })
}

function totalObservations(snapshot, providerId) {
  const provider = snapshot.providers.find(item => item.providerId === providerId)
  return Object.values(provider?.files || {})
    .reduce((sum, file) => sum + (file.observations?.length || 0), 0)
}

function providerObservations(snapshot, providerId) {
  const provider = snapshot.providers.find(item => item.providerId === providerId)
  return Object.values(provider?.files || {}).flatMap(file => file.observations || [])
}

test('首次完整读取、第二次零正文读取、追加只解析新增字节并单独验证旧前缀', async t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  const codexFile = path.join(fixture.codex, 'session.jsonl')
  const claudeFile = path.join(fixture.claude, 'session.jsonl')
  fs.writeFileSync(codexFile, line(codexMeta()) + line(codexUsage(
    '2026-07-27T10:00:00Z',
    10,
    5,
    'PRIVATE_CODEX_BODY_MUST_NOT_PERSIST',
  )))
  fs.writeFileSync(claudeFile, line(claudeUsage('2026-07-27T10:05:00Z')))

  const metrics = { statCount: 0, bodyReadBytes: 0, bodyReadFiles: new Set(), refreshCount: 0 }
  const store = createStore(fixture, metrics)
  const first = await store.refresh({ force: true })
  assert.equal(totalObservations(first, 'codex'), 1)
  assert.equal(totalObservations(first, 'claude-code'), 1)
  const firstBytes = metrics.bodyReadBytes
  assert.ok(firstBytes > 0)

  metrics.bodyReadBytes = 0
  metrics.verificationReadBytes = 0
  metrics.bodyReadFiles.clear()
  await store.refresh({ force: true })
  assert.equal(metrics.bodyReadBytes, 0)
  assert.equal(metrics.bodyReadFiles.size, 0)

  const appended = line(codexUsage('2026-07-27T11:00:00Z', 4, 2))
  const previousCodexSize = fs.statSync(codexFile).size
  fs.appendFileSync(codexFile, appended)
  metrics.bodyReadBytes = 0
  metrics.bodyReadFiles.clear()
  const third = await store.refresh({ force: true })
  assert.equal(metrics.bodyReadBytes, Buffer.byteLength(appended))
  assert.equal(metrics.verificationReadBytes, previousCodexSize)
  assert.deepEqual([...metrics.bodyReadFiles], [codexFile])
  assert.equal(totalObservations(third, 'codex'), 2)

  const persisted = fs.readFileSync(path.join(fixture.ledgerDir, 'codex.json'), 'utf8')
    + fs.readFileSync(path.join(fixture.ledgerDir, 'claude-code.json'), 'utf8')
  assert.doesNotMatch(persisted, /PRIVATE_(?:CODEX|MESSAGE)_BODY/)
})

test('仅持久化规范化短标题并保持 Codex 与 Claude 的旧标题优先级', async t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  const codexBody = `  Codex 首条\n用户标题 ${'很长内容'.repeat(12)} PRIVATE_CODEX_TITLE_SUFFIX  `
  fs.writeFileSync(path.join(fixture.codex, 'title.jsonl'), [
    line(codexMeta('codex-title-session')),
    line(codexTitle(codexBody)),
    line(codexTitle('不应覆盖首条标题', '2026-07-27T09:02:00Z')),
    line(codexUsage('2026-07-27T10:00:00Z', 10, 5)),
  ].join(''))

  const claudeBody = 'Claude 用户正文 PRIVATE_CLAUDE_BODY_MUST_NOT_PERSIST'
  fs.writeFileSync(path.join(fixture.claude, 'title.jsonl'), [
    line({ type: 'user', timestamp: '2026-07-27T09:00:00Z', sessionId: 'claude-title-session', message: { content: claudeBody } }),
    line({ type: 'ai-title', timestamp: '2026-07-27T09:01:00Z', sessionId: 'claude-title-session', aiTitle: 'AI 自动标题' }),
    line({ type: 'custom-title', timestamp: '2026-07-27T09:02:00Z', sessionId: 'claude-title-session', customTitle: '  自定义\n标题优先  ' }),
    line({ type: 'ai-title', timestamp: '2026-07-27T09:03:00Z', sessionId: 'claude-title-session', aiTitle: '后续 AI 标题不得覆盖' }),
    line(claudeUsage('2026-07-27T10:05:00Z', 'claude-title-message')),
  ].join(''))

  const snapshot = await createStore(fixture).refresh({ force: true })
  const codex = snapshot.providers.find(item => item.providerId === 'codex')
  const claude = snapshot.providers.find(item => item.providerId === 'claude-code')
  const codexFile = Object.values(codex.files)[0]
  const claudeFile = Object.values(claude.files)[0]

  assert.equal(Array.from(codexFile.title).length, 30)
  assert.match(codexFile.title, /^Codex 首条 用户标题/)
  assert.match(codexFile.title, /…$/)
  assert.equal(claudeFile.title, '自定义 标题优先')
  assert.equal(claudeFile.parserState.titleKind, 'custom')

  fs.appendFileSync(
    path.join(fixture.claude, 'title.jsonl'),
    line({
      type: 'custom-title',
      timestamp: '2026-07-27T10:06:00Z',
      sessionId: 'claude-title-session',
      customTitle: '追加后的自定义标题',
    }),
  )
  const appended = await createStore(fixture).refresh({ force: true })
  const appendedClaude = appended.providers.find(item => item.providerId === 'claude-code')
  assert.equal(Object.values(appendedClaude.files)[0].title, '追加后的自定义标题')

  const persisted = fs.readFileSync(path.join(fixture.ledgerDir, 'codex.json'), 'utf8')
    + fs.readFileSync(path.join(fixture.ledgerDir, 'claude-code.json'), 'utf8')
  assert.doesNotMatch(persisted, /PRIVATE_(?:CODEX_TITLE_SUFFIX|CLAUDE_BODY_MUST_NOT_PERSIST)/)
  assert.doesNotMatch(persisted, /不应覆盖首条标题|后续 AI 标题不得覆盖/)
})

test('截断、替换会局部重建，删除会移除旧文件', async t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  const file = path.join(fixture.codex, 'session.jsonl')
  fs.writeFileSync(file, line(codexMeta()) + line(codexUsage('2026-07-27T10:00:00Z', 10, 5)))
  const metrics = { statCount: 0, bodyReadBytes: 0, bodyReadFiles: new Set(), refreshCount: 0 }
  const store = createStore(fixture, metrics)
  await store.refresh({ force: true })

  fs.writeFileSync(file, line(codexMeta()) + line(codexUsage('2026-07-27T10:30:00Z', 2, 1)))
  const truncated = await store.refresh({ force: true })
  assert.equal(totalObservations(truncated, 'codex'), 1)

  const replacement = `${file}.replacement`
  fs.writeFileSync(replacement, line(codexMeta('replacement')) + line(codexUsage('2026-07-27T11:00:00Z', 3, 1)))
  fs.renameSync(replacement, file)
  const replaced = await store.refresh({ force: true })
  const codex = replaced.providers.find(item => item.providerId === 'codex')
  assert.equal(Object.values(codex.files)[0].sessionId, 'replacement')

  fs.unlinkSync(file)
  const deleted = await store.refresh({ force: true })
  assert.equal(Object.keys(deleted.providers.find(item => item.providerId === 'codex').files).length, 0)
})

test('同 inode 的大文件中段等长改写并追加时完整前缀哈希失配并重建', async t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  const file = path.join(fixture.codex, 'session.jsonl')
  const before = [
    line(codexMeta('stable-session')),
    line({ type: 'noise', payload: 'A'.repeat(10 * 1024) }),
    line(codexUsage('2026-07-27T10:00:00Z', 10, 5)),
    line({ type: 'noise', payload: 'Z'.repeat(10 * 1024) }),
  ].join('')
  fs.writeFileSync(file, before)
  const metrics = { statCount: 0, bodyReadBytes: 0, bodyReadFiles: new Set(), refreshCount: 0 }
  const store = createStore(fixture, metrics)
  await store.refresh({ force: true })
  const oldIno = fs.statSync(file).ino

  const rewrittenPrefix = before.replace('"input_tokens":10', '"input_tokens":20')
  assert.equal(Buffer.byteLength(rewrittenPrefix), Buffer.byteLength(before))
  fs.writeFileSync(file, rewrittenPrefix + line(codexUsage('2026-07-27T11:00:00Z', 2, 1)))
  assert.equal(fs.statSync(file).ino, oldIno)

  metrics.bodyReadBytes = 0
  metrics.verificationReadBytes = 0
  const refreshed = await store.refresh({ force: true })
  const observations = providerObservations(refreshed, 'codex')
  assert.equal(observations.length, 2)
  assert.deepEqual(observations.map(item => item.usage.tokens), [25, 3])
  assert.equal(metrics.verificationReadBytes, Buffer.byteLength(before))
  assert.equal(metrics.bodyReadBytes, fs.statSync(file).size)
  const provider = refreshed.providers.find(item => item.providerId === 'codex')
  assert.equal(Object.values(provider.files)[0].sessionId, 'stable-session')
})

test('跨重启从7天扩大到30天时按覆盖缺口恢复旧记录', async t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  const active = path.join(fixture.codex, 'active.jsonl')
  const dormant = path.join(fixture.codex, 'dormant.jsonl')
  fs.writeFileSync(active, [
    line(codexMeta('active-session')),
    line(codexUsage('2026-07-07T10:00:00Z', 10, 5)),
    line(codexUsage('2026-07-26T10:00:00Z', 4, 2)),
  ].join(''))
  fs.writeFileSync(dormant, [
    line(codexMeta('dormant-session')),
    line(codexUsage('2026-07-10T10:00:00Z', 3, 1)),
  ].join(''))
  const dormantTime = new Date('2026-07-10T11:00:00Z')
  fs.utimesSync(dormant, dormantTime, dormantTime)

  const sevenDay = createStore(fixture, undefined, 7 * 86400_000)
  const shortSnapshot = await sevenDay.refresh({ force: true })
  assert.equal(totalObservations(shortSnapshot, 'codex'), 1)

  const metrics = { statCount: 0, bodyReadBytes: 0, bodyReadFiles: new Set(), refreshCount: 0 }
  const thirtyDay = createStore(fixture, metrics, 30 * 86400_000)
  const expanded = await thirtyDay.refresh({ force: true })
  assert.equal(totalObservations(expanded, 'codex'), 3)
  assert.deepEqual(new Set(metrics.bodyReadFiles), new Set([active, dormant]))
  const provider = expanded.providers.find(item => item.providerId === 'codex')
  assert.equal(provider.coverageStartMs, NOW_MS - 30 * 86400_000)
  assert.equal(provider.retentionMs, 30 * 86400_000)
})

test('来源祖先符号链接、硬链接文件与发现后替换都关闭失败', async t => {
  const symlinkFixture = tempFixture()
  t.after(symlinkFixture.cleanup)
  const codexParent = path.dirname(symlinkFixture.codex)
  const codexReal = `${codexParent}-real`
  fs.renameSync(codexParent, codexReal)
  fs.symlinkSync(codexReal, codexParent)
  const symlinkResult = await createStore(symlinkFixture).refresh({ force: true })
  assert.ok(symlinkResult.faults.some(fault => fault.source === 'codex' && fault.category === 'discovery'))

  const hardlinkFixture = tempFixture()
  t.after(hardlinkFixture.cleanup)
  const original = path.join(hardlinkFixture.codex, 'original.jsonl')
  fs.writeFileSync(original, line(codexMeta()) + line(codexUsage('2026-07-27T10:00:00Z', 1, 1)))
  fs.linkSync(original, path.join(hardlinkFixture.codex, 'linked.jsonl'))
  const hardlinkResult = await createStore(hardlinkFixture).refresh({ force: true })
  assert.ok(hardlinkResult.faults.some(fault => fault.source === 'codex' && fault.category === 'refresh'))

  const raceFixture = tempFixture()
  t.after(raceFixture.cleanup)
  const raced = path.join(raceFixture.codex, 'raced.jsonl')
  fs.writeFileSync(raced, line(codexMeta()) + line(codexUsage('2026-07-27T10:00:00Z', 1, 1)))
  let replaced = false
  const raceStore = createLocalAiUsageLedgerStore({
    ledgerDir: raceFixture.ledgerDir,
    now: () => NOW_MS,
    retentionMs: 30 * 86400_000,
    testHooks: {
      beforeOpen(filePath) {
        if (replaced || filePath !== raced) return
        replaced = true
        const replacement = `${raced}.replacement`
        fs.writeFileSync(replacement, line(codexMeta('replacement')) + line(codexUsage('2026-07-27T11:00:00Z', 2, 1)))
        fs.renameSync(replacement, raced)
      },
    },
    sources: [
      { id: 'codex', boundaryRoot: raceFixture.home, roots: [raceFixture.codex], maxDepth: 4 },
      { id: 'claude-code', boundaryRoot: raceFixture.home, roots: [raceFixture.claude], maxDepth: 4 },
    ],
  })
  const raceResult = await raceStore.refresh({ force: true })
  assert.ok(raceResult.faults.some(fault => fault.source === 'codex' && fault.category === 'refresh'))
})

test('超长单行按硬上限跳过且分块读取，Claude 去重状态随保留期裁剪', async t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  const codexFile = path.join(fixture.codex, 'bounded.jsonl')
  fs.writeFileSync(codexFile, `${'x'.repeat(2 * 1024 * 1024 + 1)}\n${line(codexMeta())}${line(codexUsage('2026-07-27T10:00:00Z', 3, 2))}`)
  const claudeFile = path.join(fixture.claude, 'bounded.jsonl')
  fs.writeFileSync(claudeFile, line(claudeUsage('2026-06-01T10:00:00Z', 'expired')) + line(claudeUsage('2026-07-27T10:05:00Z', 'retained')))
  const metrics = { statCount: 0, bodyReadBytes: 0, bodyReadFiles: new Set(), refreshCount: 0 }
  const snapshot = await createStore(fixture, metrics).refresh({ force: true })

  assert.equal(totalObservations(snapshot, 'codex'), 1)
  assert.equal(metrics.skippedOversizedLines, 1)
  assert.ok(metrics.maxReadRequestBytes <= 64 * 1024)
  const claude = snapshot.providers.find(item => item.providerId === 'claude-code')
  const parserState = Object.values(claude.files)[0].parserState
  assert.deepEqual(Object.keys(parserState.seenMessageIds), ['retained'])
  assert.equal(totalObservations(snapshot, 'claude-code'), 1)
})

test('相同刷新窗口和并发请求共享一次扫描', async t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  fs.writeFileSync(
    path.join(fixture.codex, 'session.jsonl'),
    line(codexMeta()) + line(codexUsage('2026-07-27T10:00:00Z', 10, 5)),
  )
  const metrics = { statCount: 0, bodyReadBytes: 0, bodyReadFiles: new Set(), refreshCount: 0 }
  const store = createStore(fixture, metrics)
  const [first, second, third] = await Promise.all([
    store.refresh({ freshMs: 30_000 }),
    store.refresh({ freshMs: 30_000 }),
    store.refresh({ freshMs: 30_000 }),
  ])
  assert.equal(metrics.refreshCount, 1)
  assert.deepEqual(first, second)
  assert.deepEqual(second, third)

  const readBytes = metrics.bodyReadBytes
  await store.refresh({ freshMs: 30_000 })
  assert.equal(metrics.refreshCount, 1)
  assert.equal(metrics.bodyReadBytes, readBytes)
})

test('单一来源故障保留该来源旧账本，另一来源继续更新且故障标识稳定', async t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  const codexFile = path.join(fixture.codex, 'session.jsonl')
  const claudeFile = path.join(fixture.claude, 'session.jsonl')
  fs.writeFileSync(codexFile, line(codexMeta()) + line(codexUsage('2026-07-27T10:00:00Z', 10, 5)))
  fs.writeFileSync(claudeFile, line(claudeUsage('2026-07-27T10:05:00Z')))
  const store = createStore(fixture)
  await store.refresh({ force: true })

  const claudeBackup = `${fixture.claude}.backup`
  fs.renameSync(fixture.claude, claudeBackup)
  fs.writeFileSync(fixture.claude, 'not-a-directory')
  fs.appendFileSync(codexFile, line(codexUsage('2026-07-27T11:00:00Z', 4, 2)))
  const failedOnce = await store.refresh({ force: true })
  const failedTwice = await store.refresh({ force: true })
  assert.equal(totalObservations(failedOnce, 'codex'), 2)
  assert.equal(totalObservations(failedOnce, 'claude-code'), 1)
  assert.equal(failedOnce.faults.length, 1)
  assert.equal(failedOnce.faults[0].source, 'claude-code')
  assert.equal(failedOnce.faults[0].id, failedTwice.faults[0].id)
})

test('损坏账本会重建，目录与账本权限安全，不安全文件关闭失败', async t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  fs.writeFileSync(
    path.join(fixture.codex, 'session.jsonl'),
    line(codexMeta()) + line(codexUsage('2026-07-27T10:00:00Z', 10, 5)),
  )
  const store = createStore(fixture)
  await store.refresh({ force: true })
  assert.equal(fs.statSync(fixture.ledgerDir).mode & 0o777, 0o700)
  assert.equal(fs.statSync(path.join(fixture.ledgerDir, 'codex.json')).mode & 0o777, 0o600)

  fs.writeFileSync(path.join(fixture.ledgerDir, 'codex.json'), '{corrupt', { mode: 0o600 })
  const rebuiltStore = createStore(fixture)
  const rebuilt = await rebuiltStore.refresh({ force: true })
  assert.equal(totalObservations(rebuilt, 'codex'), 1)

  fs.chmodSync(path.join(fixture.ledgerDir, 'codex.json'), 0o644)
  const unsafeStore = createStore(fixture)
  const unsafe = await unsafeStore.refresh({ force: true })
  assert.ok(unsafe.faults.some(fault => (
    fault.source === 'codex' && fault.category === 'ledger_security'
  )))
})

test('符号链接账本目录被拒绝', t => {
  const fixture = tempFixture()
  t.after(fixture.cleanup)
  const target = path.join(fixture.root, 'outside-ledger')
  fs.mkdirSync(target, { mode: 0o700 })
  fs.mkdirSync(path.dirname(fixture.ledgerDir), { recursive: true })
  fs.symlinkSync(target, fixture.ledgerDir)
  assert.throws(() => createStore(fixture), /ledger_directory_unsafe|symbolic|符号链接/i)
})
