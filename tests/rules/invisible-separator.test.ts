import { describe, expect, test } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { getPreset } from '../../src/core/config/presets'
import { formatDocument } from '../../src/core/formatter/formatter'
import { runOwnRules } from '../../src/core/engine/engine'
import { runSingleRule, testConfig } from '../helpers'

const ruleId = 'typography/invisible-separator'
const lint = (text: string) => runSingleRule(ruleId, text, testConfig())

describe('AP-04 invisible Unicode prose separators', () => {
  test.each([
    ['zero-width space', '\u200B', 'U+200B'],
    ['word joiner', '\u2060', 'U+2060'],
    ['embedded BOM', '\uFEFF', 'U+FEFF']
  ])('offers review-only deletion for %s', (_name, character, code) => {
    const text = '日本語' + character + 'の文章です。'
    const result = lint(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      ruleId, source: 'core',
      start: text.indexOf(character), end: text.indexOf(character) + 1,
      fixKind: 'suggestion', replacement: ''
    })
    expect(result[0]!.message).toContain(code)
    // This rule must NEVER remove intentional word-joining/line-break controls automatically.
    expect(formatDocument(text, result).text).toBe(text)
  })

  test('reports exact UTF-16 offsets for several separators after emoji and across lines', () => {
    const text = '📚文章\u200Bです。\n次\u2060です。\n中\uFEFF間'
    const result = lint(text)
    expect(result.map(x => x.start)).toEqual([
      text.indexOf('\u200B'), text.indexOf('\u2060'), text.indexOf('\uFEFF')
    ])
    for (const item of result) {
      expect(text.slice(item.start, item.end).length).toBe(1)
      expect(item.end).toBe(item.start + 1)
    }
    expect(result[0]?.start).toBeGreaterThan(3)
  })

  test('does not warn on file-initial BOM, emoji ZWJ sequences, ZWNJ or variation selectors', () => {
    const text = '\uFEFF正常な文字と👩‍💻と\u200Cと\uFE0Fの文章'
    expect(lint(text)).toEqual([])
  })

  test('excludes code, metadata, comments, URL destinations and reference definitions', () => {
    const tick = String.fromCharCode(96)
    const text = [
      '---',
      'title: "秘密\u200Bの情報"',
      '---',
      tick + '文\u200B章' + tick,
      tick.repeat(3) + 'text',
      '文\u2060章',
      tick.repeat(3),
      '~~~',
      '文\u200B章',
      '~~~',
      '<!-- 文\uFEFF章 -->',
      '[URL](https://example.com/文\u200B章)',
      '<https://example.com/文\u2060章>',
      'https://example.com/文\u200B章',
      '[ref]: https://example.com/文\u200B章',
      '本文\u200Bはこちら。'
    ].join('\n')
    const result = lint(text)
    expect(result).toHaveLength(1)
    expect(result[0]?.start).toBe(text.lastIndexOf('\u200B'))
    expect(result[0]?.message).toContain('U+200B')
  })

  test('disabled rule never runs, and default general config can report only prose findings', () => {
    const text = '文字\u200B列です。'
    const config = createDefaultConfig()
    expect(config.rules[ruleId]).toMatchObject({ enabled: true, severity: 'info' })
    const enabled = runOwnRules(text, config, 'fast', 'text')
    expect(enabled.diagnostics.filter(x => x.ruleId === ruleId)).toHaveLength(1)
    config.rules[ruleId] = { enabled: false, severity: 'info' }
    const disabled = runOwnRules(text, config, 'fast', 'text')
    expect(disabled.diagnostics.filter(x => x.ruleId === ruleId)).toEqual([])
  })

  test('strict mode remains review-only; Minimal intentionally leaves the new rule off', () => {
    expect(getPreset('technical')?.rules[ruleId]).toMatchObject({ enabled: true, severity: 'warning' })
    expect(getPreset('strict')?.rules[ruleId]).toMatchObject({ enabled: true, severity: 'warning' })
    expect(getPreset('minimal')?.rules[ruleId]).toBeUndefined()
    expect(lint('通常の文章です。')).toEqual([])
  })
})
