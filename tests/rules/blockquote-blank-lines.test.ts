import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import { getPreset } from '../../src/core/config/presets'
import { formatDocument } from '../../src/core/formatter/formatter'

const scan = (text: string) => runSingleRule('markdown/blockquote-blank-lines', text, testConfig())

describe('blockquote blank line review', () => {
  test('finds missing space before and after a group of quote lines', () => {
    const text = 'お問い合わせ内容です。\n> 質問その1\n> 質問その2\n回答します。'
    const results = scan(text)
    expect(results).toHaveLength(2)
    expect(results[0]!.message).toContain('前')
    expect(results[1]!.message).toContain('後')
    expect(results.every(d => d.fixKind === 'none')).toBe(true)
    expect(formatDocument(text, results).text).toBe(text)
  })

  test('respects surrounding blank lines', () => {
    expect(scan('本文です。\n\n> 質問です。\n\n回答です。')).toEqual([])
  })

  test('ignores code fences and blockquote-only input', () => {
    expect(scan('```md\n> 引用例\n```')).toEqual([])
    expect(scan('> 一行目\n> 二行目')).toEqual([])
  })

  test('keeps UTF-16 positions after emoji', () => {
    const text = '📩本文です。\n> 質問です。\n回答です。'
    const result = scan(text)
    expect(result).toHaveLength(2)
    expect(result[0]!.start).toBe(text.indexOf('>'))
    expect(result[1]!.start).toBe(text.indexOf('回答です。'))
  })

  test('is informational in general, technical and strict presets', () => {
    for (const id of ['general', 'technical', 'strict'] as const) {
      expect(getPreset(id)?.rules['markdown/blockquote-blank-lines']).toEqual({enabled:true,severity:'info'})
    }
    expect(getPreset('minimal')?.rules['markdown/blockquote-blank-lines']).toBeUndefined()
  })
})
