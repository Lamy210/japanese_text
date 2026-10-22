import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import { getPreset } from '../../src/core/config/presets'
import { formatDocument } from '../../src/core/formatter/formatter'

const scan = (id: string, text: string) => runSingleRule(id, text, testConfig())

describe('business-writing review guidance', () => {
  test('flags missing space after Markdown blockquote marker without automatic rewrite', () => {
    const text = '📩\n>質問はありますか？\n> 正しい形式です。'
    const ds = scan('markdown/blockquote-spacing', text)
    expect(ds).toHaveLength(1)
    expect(text.slice(ds[0]!.start, ds[0]!.end)).toBe('質')
    expect(ds[0]!.fixKind).toBe('none')
    expect(formatDocument(text, ds).text).toBe(text)
  })

  test.each(['> 質問です', '>\t質問です', '>> 質問です', '通常の本文', '    >引用'])(
    'does not flag an unsupported or properly formatted line: %s', text => {
      expect(scan('markdown/blockquote-spacing', text)).toEqual([])
    }
  )

  test('does not flag quote-looking text inside a fenced code block', () => {
    expect(scan('markdown/blockquote-spacing', '```md\n>質問\n```')).toEqual([])
  })

  test('reviews a cushion only at a sentence or line start', () => {
    const text = 'お手数をおかけしますが、よろしくお願いします。\nご連絡です。お手数をおかけしますが、確認してください。'
    const ds = scan('wording/request-cushion-review', text)
    expect(ds).toHaveLength(2)
    expect(ds.every(d => d.fixKind === 'none' && d.replacement === undefined)).toBe(true)
    expect(scan('wording/request-cushion-review', '「お手数をおかけしますが」は例文です。')).toEqual([])
  })

  test('does not flag ordinary body text mentioning the expression', () => {
    expect(scan('wording/request-cushion-review', 'この文章にお手数をおかけしますがと書いてあります。')).toEqual([])
  })

  test('enables informational checks in default non-minimal profiles', () => {
    for (const id of ['markdown/blockquote-spacing', 'wording/request-cushion-review']) {
      for (const preset of ['general', 'technical', 'strict'] as const) {
        expect(getPreset(preset)?.rules[id]).toEqual({ enabled: true, severity: 'info' })
      }
      expect(getPreset('minimal')?.rules[id]).toBeUndefined()
    }
  })
})
