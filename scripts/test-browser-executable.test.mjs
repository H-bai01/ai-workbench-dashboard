import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  resolveTestBrowserExecutable,
  validateTestBrowserExecutable,
} from './test-browser-executable.mjs'

const roots = []

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-browser-path-')))
  roots.push(root)
  const executable = path.join(root, '浏览器 fixture')
  fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return { root, executable }
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

test('显式浏览器路径优先并支持空格与非 ASCII 路径', () => {
  const { executable } = fixture()
  assert.equal(resolveTestBrowserExecutable({
    env: { OPENCLAW_TEST_BROWSER: executable },
    platform: process.platform,
    defaultCandidates: ['/definitely/not/used'],
  }), executable)
})

test('无效显式路径关闭失败而不静默回退默认浏览器', () => {
  const { root, executable } = fixture()
  assert.throws(() => resolveTestBrowserExecutable({
    env: { OPENCLAW_TEST_BROWSER: path.join(root, 'missing') },
    platform: process.platform,
    defaultCandidates: [executable],
  }), /unavailable/)
})

test('空串和空白显式路径关闭失败而不回退默认浏览器', () => {
  const { executable } = fixture()
  for (const explicit of ['', '   ']) {
    assert.throws(() => resolveTestBrowserExecutable({
      env: { OPENCLAW_TEST_BROWSER: explicit },
      platform: process.platform,
      defaultCandidates: [executable],
    }), /non-empty path/)
  }
})

test('macOS 与 Linux 候选可以使用同一普通可执行文件', () => {
  const { executable } = fixture()
  assert.equal(resolveTestBrowserExecutable({ env: {}, platform: 'darwin', defaultCandidates: [executable] }), executable)
  assert.equal(resolveTestBrowserExecutable({ env: {}, platform: 'linux', defaultCandidates: [executable] }), executable)
  assert.equal(resolveTestBrowserExecutable({ env: {}, platform: 'win32', defaultCandidates: [] }), '')
})

test('相对路径、目录、不可执行文件和不存在路径关闭失败', () => {
  const { root } = fixture()
  const plain = path.join(root, 'plain-file')
  fs.writeFileSync(plain, 'plain', { mode: 0o600 })
  assert.throws(() => validateTestBrowserExecutable('relative/browser'))
  assert.throws(() => validateTestBrowserExecutable(root))
  if (process.platform !== 'win32') assert.throws(() => validateTestBrowserExecutable(plain))
  assert.throws(() => validateTestBrowserExecutable(path.join(root, 'missing')))
})

test('最终链接和链接祖先都不能成为浏览器入口', { skip: process.platform === 'win32' }, () => {
  const first = fixture()
  const second = fixture()
  const finalLink = path.join(first.root, 'browser-link')
  fs.symlinkSync(first.executable, finalLink)
  assert.throws(() => validateTestBrowserExecutable(finalLink), /symbolic link/)

  const linkedParent = path.join(second.root, 'linked-parent')
  fs.symlinkSync(first.root, linkedParent)
  assert.throws(() => validateTestBrowserExecutable(path.join(linkedParent, path.basename(first.executable))), /symbolic-link ancestors/)
})
