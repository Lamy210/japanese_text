import { describe, expect, test } from 'vitest'
import { getPreset } from '../../src/core/config/presets'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { formatDocument } from '../../src/core/formatter/formatter'
import { runSingleRule, runTier, testConfig } from '../helpers'

const id = 'style/paragraph-density'
const sentences = ['確認します。', '調査します。', '分析します。', '検証します。', '評価します。', '報告します。', '共有します。']
function scan(text: string, max = 5) {
  const config = testConfig()
  config.rules[id] = { enabled: true, severity: 'info', options: { max } }
  return runSingleRule(id, text, config)
}

describe('bounded paragraph sentence-density guidance', () => {
  test('marks only the sixth completed prose sentence when the default limit is five', () => {
    const text = sentences.slice(0, 6).join('')
    const results = scan(text)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(text.indexOf('報告します。'))
    expect(text.slice(results[0]!.start, results[0]!.end)).toBe('報告します。')
    expect(results[0]?.message).toContain('6文')
    expect(results[0]?.message).toContain('5文')
    expect(results[0]?.fixKind).toBe('none')
    expect(results[0]?.replacement).toBeUndefined()
  })

  test('five or fewer completed sentences do not trigger a hint', () => {
    expect(scan(sentences.slice(0, 5).join(''))).toEqual([])
    expect(scan('段落の冒頭です。')).toEqual([])
  })

  test('reports a seven-sentence paragraph once, with the final total', () => {
    const result = scan(sentences.join(''))
    expect(result).toHaveLength(1)
    expect(result[0]?.message).toContain('7文')
  })

  test('counts soft line breaks within a single paragraph', () => {
    const text = sentences.slice(0, 6).join('\n')
    const result = scan(text)
    expect(result).toHaveLength(1)
    expect(result[0]?.start).toBe(text.indexOf('報告します。'))
  })

  test('does not combine separate paragraphs across blank lines', () => {
    expect(scan(sentences.slice(0, 3).join('') + '\n\n' + sentences.slice(3, 6).join(''))).toEqual([])
  })

  test('does not combine prose separated by a Markdown heading', () => {
    expect(scan(sentences.slice(0, 3).join('') + '\n## 次の節\n' + sentences.slice(3, 6).join(''))).toEqual([])
  })

  test('does not combine prose separated by list, blockquote, table or indentation', () => {
    const middle = ['\n- 箇条書きです。\n', '\n> これは引用です。\n', '\n| 見出し | 値 |\n', '\n    const value = 1\n']
    for (const line of middle) {
      expect(scan(sentences.slice(0, 3).join('') + line + sentences.slice(3, 6).join(''))).toEqual([])
    }
  })

  test('ignores sentences inside headings, lists, quotes, tables and fenced code', () => {
    const prose = sentences.slice(0, 6).join('')
    for (const text of ['# ' + prose, '- ' + prose, '> ' + prose, '| ' + prose + ' |', '```md\n' + prose + '\n```']) {
      expect(scan(text)).toEqual([])
    }
  })

  test('ignores punctuation inside quoted speech and quoted examples', () => {
    const quote = '「' + sentences.join('') + '」'
    expect(scan(quote)).toEqual([])
    expect(scan('『' + sentences.join('') + '』')).toEqual([])
    expect(scan(sentences.slice(0, 5).join('') + quote)).toEqual([])
  })

  test('a quoted multiline example does not bridge separate prose paragraphs', () => {
    const text = sentences.slice(0, 3).join('') + '\n「' + sentences.join('\n') + '」\n' + sentences.slice(3, 6).join('')
    expect(scan(text)).toHaveLength(1)
    // The quoted material does not add to the count, but six prose sentences remain.
    expect(scan(text)[0]?.message).toContain('6文')
  })

  test('counts only complete sentences, not six unfinished fragments', () => {
    expect(scan('確認、調査、分析、検証、評価、報告')).toEqual([])
    expect(scan('あ。あ。あ。あ。あ。`未終了`')).toEqual([])
  })

  test('handles grouped terminators and Unicode UTF-16 offsets', () => {
    const text = '📊' + ['本当！？', ...sentences.slice(0, 5)].join('')
    const r = scan(text)
    expect(r).toHaveLength(1)
    expect(r[0]?.start).toBe(text.indexOf('評価します。'))
  })

  test('supports a configurable sentence count for different profiles', () => {
    const text = sentences.slice(0, 4).join('')
    expect(scan(text, 3)).toHaveLength(1)
    expect(scan(text, 5)).toEqual([])
  })

  test('never rewrites punctuation or splits a paragraph automatically', () => {
    const text = sentences.join('')
    const result = scan(text)
    expect(formatDocument(text, result).text).toBe(text)
  })

  test('registers idle-tier informational guidance with bounded configuration', () => {
    const r = buildRuleRegistry(testConfig()).get(id)
    expect(r?.tier).toBe('idle')
    expect(r?.defaultSeverity).toBe('info')
    expect(r?.optionDefs).toEqual([{
      key: 'max', type: 'number', label: '1段落の完結文数の目安', defaultValue: 5, min: 2, max: 20
    }])
    for (const preset of ['general', 'technical', 'strict'] as const) {
      expect(getPreset(preset)?.rules[id]).toEqual({ enabled: true, severity: 'info', options: { max: 5 } })
    }
    expect(getPreset('minimal')?.rules[id]).toBeUndefined()
    const engine = runTier(sentences.slice(0, 6).join(''), testConfig(), 'idle')
    expect(engine.ruleErrors).toEqual([])
    expect(engine.diagnostics.some((d) => d.ruleId === id)).toBe(true)
  })
})
