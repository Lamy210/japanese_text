import { describe, expect, test } from 'vitest'
import { extractProseRegions } from '../../src/core/nlp/prose-regions'
import type { ProseRegion } from '../../src/core/nlp/types'
import { Utf8OffsetMap } from '../../src/core/nlp/offset-map'

function assertExactSlices(source: string, regions: readonly ProseRegion[]): void {
  let previousEnd = -1
  const ids = new Set<string>()
  for (const region of regions) {
    expect(region.sourceStartUtf16).toBeGreaterThanOrEqual(0)
    expect(region.sourceEndUtf16).toBeGreaterThan(region.sourceStartUtf16)
    expect(region.sourceStartUtf16).toBeGreaterThanOrEqual(previousEnd)
    expect(region.sourceEndUtf16).toBeLessThanOrEqual(source.length)
    expect(region.text).toBe(source.slice(region.sourceStartUtf16, region.sourceEndUtf16))
    expect(ids.has(region.id)).toBe(false)
    expect(() => new Utf8OffsetMap(region.text)).not.toThrow()
    previousEnd = region.sourceEndUtf16
    ids.add(region.id)
  }
}

describe('AP-09 conservative original-text prose region extraction', () => {
  test('excludes Markdown source syntax and masked code/URL while retaining text labels', () => {
    const source = [
      '---',
      'title: private frontmatter',
      '---',
      '# 見出し📚 ###',
      'これは**重要**です。[表示](https://example.com/secret)を確認。',
      '- 一番目です。',
      '  - [x] 二番目です。',
      '> 引用しない。',
      '| ヘッダー | 本文 |',
      '| --- | --- |',
      '| セル | 内部 |',
      '```ts',
      'const secret = "skip fenced code"',
      '```',
      '普通の`console.log(secret)`文章。',
      '<!-- secret metadata -->残りの文章。',
      '末尾の文章。'
    ].join('\n')
    const regions = extractProseRegions(source)
    assertExactSlices(source, regions)
    const strings = regions.map(region => region.text)
    for (const included of ['見出し📚', 'これは', '重要', 'です。', '表示',
      'を確認。', '一番目です。', '二番目です。', '普通の', '文章。', '残りの文章。', '末尾の文章。']) {
      expect(strings).toContain(included)
    }
    expect(regions.find(x => x.text === '見出し📚')?.kind).toBe('heading')
    expect(regions.find(x => x.text === '一番目です。')?.kind).toBe('list')
    expect(regions.find(x => x.text === '二番目です。')?.kind).toBe('list')
    expect(regions.find(x => x.text === '表示')?.kind).toBe('link-label')
    expect(strings.join(' ')).not.toMatch(/frontmatter|secret|console|引用しない|ヘッダー|セル|metadata|https|---|\*\*/)
    expect(Object.isFrozen(regions)).toBe(true)
    expect(Object.isFrozen(regions[0])).toBe(true)
  })

  test('does not cross code boundaries, formatting markers or repeated phrases', () => {
    const source = '文章**強調**文章と[文章](https://example.org/a)そして文章。'
    const regions = extractProseRegions(source)
    assertExactSlices(source, regions)
    expect(regions.map(x => x.text)).toEqual([
      '文章', '強調', '文章と', '文章', 'そして文章。'
    ])
    expect(regions.filter(x => x.text === '文章').map(x => x.sourceStartUtf16))
      .toEqual([0, source.indexOf('[文章]') + 1])
    expect(regions.find(x => x.kind === 'link-label')?.text).toBe('文章')
  })

  test('keeps offsets in original CRLF source with emoji, combining marks and variant selectors', () => {
    const source = '第一行📚。\r\n- 第二行👩‍💻とe\u0301、☃\uFE0F。\r\n最後の行。'
    const regions = extractProseRegions(source)
    assertExactSlices(source, regions)
    expect(regions.map(x => x.text)).toEqual([
      '第一行📚。', '第二行👩‍💻とe\u0301、☃\uFE0F。', '最後の行。'
    ])
    expect(regions[1]?.sourceStartUtf16).toBe(source.indexOf('第二行'))
    expect(regions[1]?.sourceEndUtf16).toBe(source.indexOf('第二行') + '第二行👩‍💻とe\u0301、☃\uFE0F。'.length)
  })

  test('treats unfinished code fences and ambiguous backticks as nonprose', () => {
    const source = ['文章です。', '```', '秘密です。', '未閉じのコードです。'].join('\n')
    const regions = extractProseRegions(source)
    assertExactSlices(source, regions)
    expect(regions.map(x => x.text)).toEqual(['文章です。'])
    const dangling = extractProseRegions('安全です。\nこれは`未閉じコードです。')
    expect(dangling.map(x => x.text)).toEqual(['安全です。'])
  })

  test('does not interpret blockquotes, table cells or raw HTML as ordinary prose', () => {
    const source = [
      '> 引用テキスト。',
      '  > 引用です。',
      '- > ネスト引用。',
      '<div>HTMLの本文</div>',
      '| 説明 | 文章 |',
      '見える普通の文章。'
    ].join('\n')
    const regions = extractProseRegions(source)
    assertExactSlices(source, regions)
    expect(regions.map(x => x.text)).toEqual(['見える普通の文章。'])
  })

  test('skips a whole unsafe Unicode line instead of coercing lone surrogates', () => {
    const source = '正しい📚文章。\n壊れた\uD800文。\n続く文章。'
    const regions = extractProseRegions(source)
    assertExactSlices(source, regions)
    expect(regions.map(x => x.text)).toEqual(['正しい📚文章。', '続く文章。'])
  })

  test('plain text does not treat Markdown punctuation as syntax', () => {
    const source = 'そのまま**文章**です。\n![図]と(文)。\n'
    const regions = extractProseRegions(source, 'text')
    assertExactSlices(source, regions)
    expect(regions.map(x => x.text)).toEqual(['そのまま**文章**です。', '![図]と(文)。'])
    expect(regions.every(x => x.kind === 'paragraph')).toBe(true)
  })

  test('empty and structural-only documents have zero regions without false positives', () => {
    expect(extractProseRegions('')).toEqual([])
    expect(extractProseRegions('   \r\n')).toEqual([])
    expect(extractProseRegions('> 引用\n| 表 | 表 |\n```\nコード\n```')).toEqual([])
  })
})
