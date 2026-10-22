import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import { getPreset } from '../../src/core/config/presets'

const scan = (text: string) => runSingleRule('style/business-document-structure', text, testConfig())

describe('opt-in business document structure', () => {
  test.each([
    ['# 問い合わせ回答\n回答：可能です。', '質問・問い合わせ内容'],
    ['相談メモ\n相談内容：方式を選ぶ', '前提条件・背景'],
    ['# 社内連絡\n本文です。', '要件・結論']
  ])('flags absent structured section for %s', (text, expected) => {
    const results = scan(text)
    expect(results).toHaveLength(1)
    expect(results[0]!.message).toContain(expected)
    expect(results[0]!.fixKind).toBe('none')
    expect(results[0]!.replacement).toBeUndefined()
  })

  test.each([
    '# 問い合わせ回答\n回答：可能です。\n質問：可能でしょうか？',
    '# 相談メモ\n相談内容: 実装方針\n前提条件: 期限内',
    '社内連絡\n連絡事項：休業日の案内'
  ])('accepts explicitly present sections', text => {
    expect(scan(text)).toEqual([])
  })


  test('provides an informational hint when a question precedes the answer', () => {
    const results = scan('# 問い合わせ回答\n質問：対応できますか？\n回答：対応できます。')
    expect(results).toHaveLength(1)
    expect(results[0]!.message).toContain('結論')
    expect(results[0]!.fixKind).toBe('none')
  })

  test('does not infer an ordering problem when only one section is present', () => {
    const results = scan('# 問い合わせ回答\n質問：対応できますか？')
    expect(results).toHaveLength(1)
    expect(results[0]!.message).toContain('回答・結論')
  })


  test('accepts Markdown bullet and numbered section labels', () => {
    expect(scan('# 問い合わせ回答\n- 回答：対応できます。\n1. 質問：可能ですか？')).toEqual([])
    expect(scan('相談メモ\n* 相談内容：方式の検討\n+ 前提：期限あり')).toEqual([])
    expect(scan('社内連絡\n2) 連絡事項：休業について')).toEqual([])
  })

  test('reports missing sections despite prose mentions in list items', () => {
    const diagnostics = scan('# 問い合わせ回答\n- 本文で回答：可能と説明します。\n- 質問：実施しますか？')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.message).toContain('回答・結論')
  })

  test('still checks answer-first order for labeled list items', () => {
    const diagnostics = scan('# 問い合わせ回答\n- 質問：可能ですか？\n- 回答：可能です。')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.message).toContain('結論')
    expect(diagnostics[0]!.fixKind).toBe('none')
  })

  test('does not count list-shaped code examples as real sections', () => {
    const text = '# 問い合わせ回答\n```md\n- 質問：サンプル\n- 回答：サンプル\n```'
    expect(scan(text)).toHaveLength(2)
  })

  test('does not guess a document kind from body mentions', () => {
    expect(scan('議事録\n問い合わせ回答の例です。')).toEqual([])
    expect(scan('この問い合わせ回答を確認しました。')).toEqual([])
    expect(scan('')).toEqual([])
  })

  test('does not count fenced code examples as actual sections', () => {
    const text = '# 問い合わせ回答\n```md\n質問：テスト\n回答：テスト\n```'
    expect(scan(text)).toHaveLength(2)
  })

  test('keeps emoji offsets and remains an informational non-fix rule', () => {
    const text = '# 問い合わせ回答 📧\n'
    const diagnostics = scan(text)
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]!.start).toBe(2)
    expect(diagnostics[0]!.end).toBe(2 + '問い合わせ回答'.length)
  })

  test('enabled only in nonminimal profiles', () => {
    for (const id of ['general', 'technical', 'strict'] as const) {
      expect(getPreset(id)?.rules['style/business-document-structure']).toEqual({ enabled: true, severity: 'info' })
    }
    expect(getPreset('minimal')?.rules['style/business-document-structure']).toBeUndefined()
  })
})
