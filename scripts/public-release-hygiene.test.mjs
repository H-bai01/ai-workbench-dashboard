import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
const mediaExtensions = /\.(?:svg|png|jpe?g|webp|gif|mp4|mov|webm)$/i
const forbiddenPngChunks = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])
const concreteHome = /(?:\/Users\/(?![<$%{])[^/\s]+\/|\/home\/(?![<$%{])[^/\s]+\/|[A-Z]:\\Users\\(?![<$%{])[^\\\s]+\\)/i
const localIdentity = /(?:\b[\w.+-]+@[\w.-]+\.local\b|\b[\w.-]*(?:MacBook|Mac-Pro|iMac)[\w.-]*\b)/i
const reviewedMedia = new Set([
  'public/app-icon.svg',
  'public/app-logos/chatgpt-white-black.svg',
  'public/app-logos/claude-app-orange.png',
  'public/app-logos/codex-app.png',
  'public/app-logos/openclaw-lobster.png',
  'public/avatars/default.svg',
  'public/favicon.svg',
  'public/model-logos/anthropic.svg',
  'public/model-logos/deepseek.svg',
  'public/model-logos/google.svg',
  'public/model-logos/minimax.svg',
  'public/model-logos/openai.svg',
  'public/model-logos/qwen.svg',
  'public/skill-logos/1password.svg',
  'public/skill-logos/apple.svg',
  'public/skill-logos/browser.svg',
  'public/skill-logos/default.svg',
  'public/skill-logos/design.svg',
  'public/skill-logos/excel.svg',
  'public/skill-logos/feishu.png',
  'public/skill-logos/feishu.svg',
  'public/skill-logos/github.svg',
  'public/skill-logos/google.svg',
  'public/skill-logos/health.svg',
  'public/skill-logos/markdown.svg',
  'public/skill-logos/nodejs.svg',
  'public/skill-logos/pdf.svg',
  'public/skill-logos/ppt.svg',
  'public/skill-logos/python.svg',
  'public/skill-logos/search.svg',
  'public/skill-logos/terminal.svg',
  'public/skill-logos/weather.svg',
  'public/skill-logos/word.svg',
])

function trackedFiles(repoDir = repo) {
  const output = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], {
    cwd: repoDir,
    encoding: 'utf8',
  })
  return output.split('\0').filter(Boolean)
}

function stripMarkdownCode(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '')
}

function normalizeReferenceLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function imageReferences(markdown) {
  const text = stripMarkdownCode(markdown)
  const references = []
  const definitions = new Map()
  const occupiedImageRanges = []
  for (const match of text.matchAll(/^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))(?:[ \t]+.*)?$/gm)) {
    const label = normalizeReferenceLabel(match[1])
    if (label && !definitions.has(label)) definitions.set(label, match[2] || match[3])
  }
  for (const match of text.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) {
    references.push({ target: match[1] || match[2], label: '' })
    occupiedImageRanges.push([match.index, match.index + match[0].length])
  }
  for (const match of text.matchAll(/!\[([^\]]*)\]\s*\[([^\]]*)\]/g)) {
    const label = normalizeReferenceLabel(match[2] || match[1])
    references.push({ target: definitions.get(label) || '', label })
    occupiedImageRanges.push([match.index, match.index + match[0].length])
  }
  for (const match of text.matchAll(/!\[([^\]]+)\]/g)) {
    const start = match.index
    const end = start + match[0].length
    if (occupiedImageRanges.some(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd)) continue
    const label = normalizeReferenceLabel(match[1])
    if (definitions.has(label)) references.push({ target: definitions.get(label), label })
  }
  for (const match of text.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    references.push({ target: match[1], label: '' })
  }
  return references
}

function isLocalImageReference(value) {
  return !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)
}

function resolveDocumentImage(repoDir, markdownFile, reference) {
  let clean
  try {
    clean = decodeURIComponent(reference.split(/[?#]/, 1)[0])
  } catch {
    assert.fail(`${markdownFile} 图片引用编码无效`)
  }
  const absolute = clean.startsWith('/')
    ? path.join(repoDir, 'public', clean.slice(1))
    : path.resolve(path.dirname(path.join(repoDir, markdownFile)), clean)
  const relative = path.relative(repoDir, absolute)
  assert.equal(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), false, `${markdownFile} 图片引用越过仓库`)
  return absolute
}

function pngChunkTypes(file) {
  const bytes = fs.readFileSync(file)
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file} 不是有效 PNG`)
  const types = []
  let offset = 8
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, `${file} PNG 块头不完整`)
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    assert.ok(end <= bytes.length, `${file} PNG 块越界`)
    types.push(bytes.toString('ascii', offset + 4, offset + 8))
    offset = end
  }
  assert.equal(offset, bytes.length, `${file} PNG 尾部异常`)
  return types
}

function assertSafeSvg(file) {
  const svg = fs.readFileSync(file, 'utf8')
  const dangerousElements = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'image', 'metadata'])
  assert.equal(concreteHome.test(svg), false, `${file} SVG 含具体用户目录`)
  assert.equal(localIdentity.test(svg), false, `${file} SVG 含本机身份`)
  assert.equal(/<\?xml-stylesheet\b|<!DOCTYPE\b|<!ENTITY\b|@import\b/i.test(svg), false, `${file} SVG 含外部样式或实体结构`)

  for (const match of svg.matchAll(/<\s*(?![!?/])([^\s/>]+)/g)) {
    const localName = match[1].split(':').at(-1).toLowerCase()
    assert.equal(dangerousElements.has(localName), false, `${file} SVG 含危险元素 ${localName}`)
  }
  for (const match of svg.matchAll(/\s([^\s=/>]+)\s*=/g)) {
    const localName = match[1].split(':').at(-1).toLowerCase()
    assert.equal(/^on[a-z]/.test(localName), false, `${file} SVG 含事件处理属性 ${localName}`)
  }

  for (const match of svg.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) {
    assert.match(match[2], /^#[A-Za-z_][\w:.-]*$/, `${file} SVG 含外部资源引用`)
  }
  for (const match of svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    assert.match(match[2], /^#[A-Za-z_][\w:.-]*$/, `${file} SVG 含外部 CSS 资源`)
  }
}

function assertNoEmbeddedMetadata(repoDir, file) {
  const lower = file.toLowerCase()
  const absolute = path.join(repoDir, file)
  if (lower.endsWith('.svg')) {
    assertSafeSvg(absolute)
    return
  }
  if (lower.endsWith('.png')) {
    const forbidden = pngChunkTypes(absolute).filter(type => forbiddenPngChunks.has(type))
    assert.deepEqual(forbidden, [], `${file} 含 EXIF、文本或时间元数据`)
    return
  }
  const bytes = fs.readFileSync(absolute)
  assert.equal(bytes.includes(Buffer.from('Exif\0\0')), false, `${file} 含 EXIF 元数据`)
  assert.equal(bytes.includes(Buffer.from('http://ns.adobe.com/xap/1.0/')), false, `${file} 含 XMP 元数据`)
  assert.equal(/\.(?:gif|mp4|mov|webm)$/i.test(file), false, `${file} 是未经隔离合成审查的动画或视频`)
}

function auditReleaseDocuments(repoDir = repo) {
  const files = trackedFiles(repoDir)
  const releaseTextFiles = files.filter(file => (
    file === 'README.md'
    || file === '.env.example'
    || file === 'src/changelog.json'
    || (file.startsWith('docs/') && file.endsWith('.md'))
  ))

  for (const file of releaseTextFiles) {
    const text = fs.readFileSync(path.join(repoDir, file), 'utf8')
    assert.equal(concreteHome.test(text), false, `${file} 含具体用户目录`)
    assert.equal(localIdentity.test(text), false, `${file} 含本机作者或主机身份`)
    for (const reference of imageReferences(text)) {
      assert.ok(reference.target, `${file} 图片引用定义不存在：${reference.label}`)
      if (!isLocalImageReference(reference.target)) continue
      assert.equal(fs.existsSync(resolveDocumentImage(repoDir, file, reference.target)), true, `${file} 图片引用不存在：${reference.target}`)
    }
  }

  const changelog = JSON.parse(fs.readFileSync(path.join(repoDir, 'src/changelog.json'), 'utf8'))
  for (const entry of changelog.versions || []) {
    if (!entry.image) continue
    assert.equal(fs.existsSync(resolveDocumentImage(repoDir, 'README.md', entry.image)), true, `v${entry.version} 图片引用不存在`)
  }
}

function auditReleaseMedia(repoDir = repo) {
  const files = trackedFiles(repoDir)
  const media = files.filter(file => mediaExtensions.test(file)).sort()
  const unreviewed = media.filter(file => !reviewedMedia.has(file))
  const missing = [...reviewedMedia].filter(file => !media.includes(file))
  assert.deepEqual(unreviewed, [], `发现未审核媒体：${unreviewed.join(', ')}`)
  assert.deepEqual(missing, [], `审核媒体清单缺少文件：${missing.join(', ')}`)
  assert.deepEqual(files.filter(file => file.startsWith('public/avatars/')), ['public/avatars/default.svg'])

  for (const file of media) {
    assert.equal(/(?:screenshots?|screen[-_ ]?record|captures?|demo|截图|演示)/i.test(file), false, `${file} 使用运行现场媒体文件名`)
    assertNoEmbeddedMetadata(repoDir, file)
  }
}

function withTrackedFixture(mutate, verify) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-release-hygiene-fixture-'))
  const fixtureRepo = path.join(root, 'repo')
  try {
    execFileSync('git', ['clone', '--quiet', '--shared', repo, fixtureRepo])
    mutate(fixtureRepo)
    execFileSync('git', ['add', '-A'], { cwd: fixtureRepo })
    verify(fixtureRepo)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('发布文档不含具体用户目录、本机作者身份或断开的本地图片', () => {
  auditReleaseDocuments()
})

test('发布树只保留经审查的中性媒体且不含敏感元数据', () => {
  auditReleaseMedia()
})

test('项目图标不再冒充技能品牌且生态技能使用受控图标', () => {
  const source = fs.readFileSync(path.join(repo, 'src', 'components', 'SkillsDialog.vue'), 'utf8')
  assert.doesNotMatch(source, /return '\/app-icon\.svg'/)
  assert.match(source, /lower === 'openclaw'.*return '\/app-logos\/openclaw-lobster\.png'/)
  assert.match(source, /lower\.includes\('clawhub'\).*lower\.includes\('skill-creator'\).*return '\/skill-logos\/default\.svg'/)
})

test('新增危险 SVG、WebM 和引用式断链全部关闭失败', () => {
  withTrackedFixture((fixtureRepo) => {
    fs.writeFileSync(path.join(fixtureRepo, 'public/personal-screen.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="file:///Users/sample-user/private.png"/></svg>')
  }, (fixtureRepo) => {
    assert.throws(() => assertNoEmbeddedMetadata(fixtureRepo, 'public/personal-screen.svg'), /SVG 含/)
    assert.throws(() => auditReleaseMedia(fixtureRepo), /personal-screen\.svg/)
  })

  withTrackedFixture((fixtureRepo) => {
    fs.writeFileSync(path.join(fixtureRepo, 'public/screen-recording.webm'), Buffer.from('synthetic-webm-fixture'))
  }, (fixtureRepo) => {
    assert.throws(() => auditReleaseMedia(fixtureRepo), /screen-recording\.webm/)
  })

  withTrackedFixture((fixtureRepo) => {
    fs.writeFileSync(path.join(fixtureRepo, 'docs/reference-image.md'), '# Fixture\n\n![shot][ Example ID ]\n\n[example id]: ./missing-image.png\n')
  }, (fixtureRepo) => {
    assert.throws(() => auditReleaseDocuments(fixtureRepo), /图片引用不存在/)
  })
})

test('命名空间危险 SVG 和 Markdown 快捷引用不能绕过护栏', () => {
  withTrackedFixture((fixtureRepo) => {
    fs.writeFileSync(path.join(fixtureRepo, 'public/favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>')
  }, (fixtureRepo) => {
    assert.throws(() => auditReleaseMedia(fixtureRepo), /危险元素 script/)
  })

  withTrackedFixture((fixtureRepo) => {
    fs.writeFileSync(path.join(fixtureRepo, 'public/favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" xmlns:e="urn:fixture"><path e:onload="alert(1)"/></svg>')
  }, (fixtureRepo) => {
    assert.throws(() => auditReleaseMedia(fixtureRepo), /事件处理属性 onload/)
  })

  const shortcutReferences = imageReferences(`
[ First   Label ]: ./first.png

Ordinary text between the definition and image.

![FIRST LABEL]

![Second Label]

More ordinary text between the image and definition.

[ second   label ]: ./second.png

![Undefined Label]
  `)
  assert.deepEqual(shortcutReferences, [
    { target: './first.png', label: 'first label' },
    { target: './second.png', label: 'second label' },
  ])

  withTrackedFixture((fixtureRepo) => {
    fs.writeFileSync(path.join(fixtureRepo, 'docs/shortcut-reference.md'), '[shortcut]: ./missing-shortcut.png\n\nOrdinary text.\n\n![Shortcut]\n')
  }, (fixtureRepo) => {
    assert.throws(() => auditReleaseDocuments(fixtureRepo), /missing-shortcut\.png/)
  })
})
