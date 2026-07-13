import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')

test('锁文件的所有 registry 包都有 npm 官方下载地址和完整性校验', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8'))
  const registryEntries = Object.entries(lock.packages || {}).filter(([location, entry]) => (
    location !== '' && entry && entry.link !== true
  ))
  const incomplete = []
  const hosts = new Set()
  for (const [location, entry] of registryEntries) {
    if (typeof entry.resolved !== 'string' || !entry.resolved) incomplete.push(`${location}:resolved`)
    if (typeof entry.integrity !== 'string' || !entry.integrity) incomplete.push(`${location}:integrity`)
    if (entry.resolved) hosts.add(new URL(entry.resolved).hostname)
  }
  assert.ok(registryEntries.length > 0)
  assert.deepEqual(incomplete, [])
  assert.deepEqual([...hosts], ['registry.npmjs.org'])
})

test('公开包声明与当前安全启动边界一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
  assert.equal(pkg.engines?.node, '>=22.13.0')
  assert.equal(Object.hasOwn(pkg.scripts || {}, 'tunnel:v2'), false)
  assert.equal(Object.hasOwn(pkg.dependencies || {}, 'puppeteer'), false)
  assert.equal(Object.hasOwn(pkg.devDependencies || {}, 'puppeteer'), false)
  assert.equal(Object.hasOwn(pkg.overrides || {}, 'js-yaml'), false)
})
