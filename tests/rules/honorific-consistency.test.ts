import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import { getPreset } from '../../src/core/config/presets'
import { formatDocument } from '../../src/core/formatter/formatter'

const scan = (text: string) => runSingleRule('style/honorific-consistency', text, testConfig())

describe('honorific consistency', () => {
  test('reports same name with inconsistent suffix without replacing it', () => {
    const text = '山田太郎さんが参加しました。\n山田太郎くんが確認しました。'
    const ds = scan(text)
    expect(ds).toHaveLength(1)
    expect(text.slice(ds[0]!.start, ds[0]!.end)).toBe('山田太郎くん')
    expect(ds[0]!.fixKind).toBe('none')
    expect(ds[0]!.replacement).toBeUndefined()
    expect(formatDocument(text, ds).text).toBe(text)
  })

  test.each([
    '山田太郎さんが参加。山田太郎さんが回答。',
    '山田太郎さんと佐藤次郎くんが参加。',
    '山田さんが参加。山田太郎くんが回答。',
    '「山田太郎くん」という例文です。山田太郎さんが参加。',
    '```\n山田太郎くん\n```\n山田太郎さんが参加。',
    '> 山田太郎くんが発言。\n山田太郎さんが参加。',
    '名前を確認しました。'
  ])('avoids guessing or code/quotation false positives: %s', text => {
    expect(scan(text)).toEqual([])
  })

  test('retains UTF-16 character offsets following emojis', () => {
    const text = '📃山田太郎さんです。\n山田太郎くんです。'
    const ds = scan(text)
    expect(ds).toHaveLength(1)
    expect(ds[0]!.start).toBe(text.indexOf('山田太郎くん'))
  })

  test('enabled in default profiles but not minimal', () => {
    for (const preset of ['general', 'technical', 'strict'] as const) {
      expect(getPreset(preset)?.rules['style/honorific-consistency']).toEqual({enabled:true,severity:'info'})
    }
    expect(getPreset('minimal')?.rules['style/honorific-consistency']).toBeUndefined()
  })
})
