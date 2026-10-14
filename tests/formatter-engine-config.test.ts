/**
 * Formatter / Engine / Config のテスト — 仕様書 §18 / §30 / §32 / §36 / §50
 */

import { describe, expect, it } from 'vitest'
import { formatDocument, collectSafeFixes, planFixes, applyFixes } from '../src/core/formatter/formatter'
import { runTier, testConfig } from './helpers'
import { validateAppConfig, createDefaultConfig, ConfigValidationError } from '../src/core/config/validate'
import { migrateConfig } from '../src/core/config/validate'
import { BUILTIN_PRESETS, getPreset } from '../src/core/config/presets'
import { runTextlint } from '../src/core/engine/textlint-adapter'
import { buildRuleRegistry, TEXTLINT_RULE_META } from '../src/core/rules/registry'
import type { Diagnostic } from '../src/core/types'

function fakeDiag(start: number, end: number, replacement: string | undefined, fixKind: Diagnostic['fixKind']): Diagnostic {
  return {
    id: `test@${start}-${end}`,
    ruleId: 'test/rule',
    severity: 'warning',
    message: 'test',
    start,
    end,
    line: 1,
    column: start + 1,
    fixKind,
    replacement,
    source: 'core'
  }
}

describe('Formatter core (§18)', () => {
  it('Safe Fixのみを収集する (§18.1)', () => {
    const fixes = collectSafeFixes([
      fakeDiag(0, 1, 'あ', 'safe'),
      fakeDiag(2, 3, 'い', 'suggestion'), // 除外
      fakeDiag(4, 5, undefined, 'safe'), // replacementなし → 除外
      fakeDiag(6, 7, 'う', 'none') // 除外
    ])
    expect(fixes.length).toBe(1)
  })

  it('offset競合を検査し後方offsetから適用する (§18.2-4)', () => {
    const plan = planFixes([
      fakeDiag(0, 5, 'A', 'safe'),
      fakeDiag(3, 8, 'B', 'safe'), // 競合 → スキップ
      fakeDiag(10, 12, 'C', 'safe')
    ])
    expect(plan.fixes.length).toBe(2)
    expect(plan.skippedConflicts.length).toBe(1)
    // 降順ソート (後方から適用)
    expect(plan.fixes[0].start).toBe(10)
    expect(plan.fixes[1].start).toBe(0)

    const result = applyFixes('0123456789AB', plan.fixes)
    expect(result).toBe('A56789C') // 後方から: 10-12→C, 0-5→A
  })

  it('隣接する (重ならない) 修正は両方適用する [boundary]', () => {
    const plan = planFixes([fakeDiag(0, 2, 'X', 'safe'), fakeDiag(2, 4, 'Y', 'safe')])
    expect(plan.fixes.length).toBe(2)
    expect(applyFixes('abcd', plan.fixes)).toBe('XY')
  })
})

describe('Formatter Idempotency (§50: format(format(x)) === format(x))', () => {
  const SAMPLE = [
    'これは　全角と，句読点．のテストです。',
    'Github と ユーザ と ＡＢＣ１２３ のテスト。',
    '段落内 に スペースが あります 。',
    '```\n　コード内　は無視　，される\n```',
    '[textlint](https://textlint.github.io/) へ。未定義 [リンク][nope] も。'
  ]

  it('一度Formatした文書を再度Formatしても変更されない', async () => {
    const config = testConfig()
    const text = SAMPLE.join('\n\n')

    const first = formatDocument(text, runTier(text, config, 'fast').diagnostics)
    expect(first.appliedCount).toBeGreaterThan(0)
    expect(first.text).not.toBe(text)

    // 再Lint → 再Format (実際のフローと同じ)
    const second = formatDocument(first.text, runTier(first.text, config, 'fast').diagnostics)
    expect(second.text).toBe(first.text) // 冪等性
    expect(second.appliedCount).toBe(0)
  })

  it('実ドキュメントで複数カテゴリのSafe Fixが適用される', () => {
    const config = testConfig()
    const text = 'ＡＢＣ の　スペース，を直します。'
    const result = formatDocument(text, runTier(text, config, 'fast').diagnostics)
    expect(result.appliedCount).toBeGreaterThanOrEqual(3)
    expect(result.text).toBe('ABC のスペース、を直します。')
  })
})

describe('Engine determinism (§36)', () => {
  it('同一入力・同一設定で同一結果 (順序含む)', () => {
    const config = testConfig()
    const text = ' Github の　スペース，ＡＢＣ (73% の統計) です．未定義[リンク][nope]。\n\n# h1\n\n### h3'
    const run1 = runTier(text, config, 'fast')
    const run2 = runTier(text, config, 'fast')
    expect(JSON.stringify(run1.diagnostics)).toBe(JSON.stringify(run2.diagnostics))

    const deep1 = runTier(text, config, 'deep')
    const deep2 = runTier(text, config, 'deep')
    expect(JSON.stringify(deep1.diagnostics)).toBe(JSON.stringify(deep2.diagnostics))
  })

  it('ルール設定OFFで該当診断が消える (§3.1 ルールON/OFF)', () => {
    const config = testConfig()
    const text = 'Github です。'
    const before = runTier(text, config, 'fast').diagnostics.filter((d) => d.ruleId === 'wording/terminology')
    expect(before.length).toBe(1)
    config.rules['wording/terminology'] = { ...config.rules['wording/terminology']!, enabled: false }
    const after = runTier(text, config, 'fast').diagnostics.filter((d) => d.ruleId === 'wording/terminology')
    expect(after.length).toBe(0)
  })

  it('severity変更が診断へ反映される (§3.1 severity変更)', () => {
    const config = testConfig()
    const text = 'Github です。'
    config.rules['wording/terminology'] = { enabled: true, severity: 'error' }
    const diags = runTier(text, config, 'fast').diagnostics.filter((d) => d.ruleId === 'wording/terminology')
    expect(diags[0].severity).toBe('error')
  })
})

describe('textlint adapter (§23 Deep Engine / §61 PoC-3, PoC-4)', () => {
  it('textlint kernelが動作しDiagnostic形式へ正規化される', async () => {
    const config = testConfig()
    const longSentence = '非常に長い一文になっています。' + 'この文章は人為的に長くしてあり、'.repeat(15) + '上限を超えることを確認します。'
    const text =
      longSentence + '\n\nですます調で書きます。しかし次の段落はである調で書く。混在の検出。\n\n半角ｶﾀｶﾅも検出します。'
    const result = await runTextlint(text, config, 'markdown')
    expect(result.ruleErrors.length).toBe(0)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    // 全診断が正規化された形式を持つ
    for (const d of result.diagnostics) {
      expect(d.source).toBe('textlint')
      expect(d.line).toBeGreaterThanOrEqual(1)
      expect(d.column).toBeGreaterThanOrEqual(1)
      expect(d.start).toBeLessThanOrEqual(d.end)
    }
    // sentence-length検出を含む
    expect(result.diagnostics.some((d) => d.ruleId === 'style/sentence-length')).toBe(true)
  })

  it('severity設定がkernelへ渡される', async () => {
    const config = testConfig()
    config.rules['style/sentence-length'] = { enabled: true, severity: 'error', options: { max: 10 } }
    const text = 'これは短い文ですが上限10文字を超えているため検出されます。'
    const result = await runTextlint(text, config, 'markdown')
    const sentenceLength = result.diagnostics.filter((d) => d.ruleId === 'style/sentence-length')
    expect(sentenceLength.length).toBeGreaterThan(0)
    expect(sentenceLength.every((d) => d.severity === 'error')).toBe(true)
  })

  it('ルール無効時は空結果を返す', async () => {
    const config = testConfig()
    config.rules['style/sentence-length'] = { enabled: false, severity: 'warning' }
    config.rules['style/mixed-tone'] = { enabled: false, severity: 'warning' }
    config.rules['typography/nfd'] = { enabled: false, severity: 'warning' }
    config.rules['typography/hankaku-kana'] = { enabled: false, severity: 'warning' }
    const result = await runTextlint('テスト', config, 'markdown')
    expect(result.diagnostics.length).toBe(0)
  })

  it('plain text (ext .txt) でも動作する', async () => {
    const config = testConfig()
    const result = await runTextlint('ｶﾞﾝﾀﾞﾑです。', config, 'text')
    expect(result.diagnostics.some((d) => d.ruleId === 'typography/hankaku-kana')).toBe(true)
  })
})

describe('Config validation / migration (§30 / §32)', () => {
  it('不正なconfigを拒否し例外メッセージを返す', () => {
    expect(() => validateAppConfig('not an object')).toThrow(ConfigValidationError)
    expect(() => validateAppConfig({ preset: 'unknown' })).toThrow(ConfigValidationError)
    expect(() => validateAppConfig({ ngWords: [{ word: '' }] })).toThrow(ConfigValidationError)
    expect(() => validateAppConfig({ ngWords: [{ word: '(bad', isRegex: true }] })).toThrow(ConfigValidationError)
    expect(() => validateAppConfig({ theme: 'blue' })).toThrow(ConfigValidationError)
    expect(() => validateAppConfig({ schemaVersion: 999 })).toThrow(ConfigValidationError)
  })

  it('部分的なconfigはデフォルトで補完される (寛容な読み込み)', () => {
    const config = validateAppConfig({ preset: 'technical' })
    expect(config.preset).toBe('technical')
    expect(config.terminology.length).toBeGreaterThan(0) // デフォルト用語集
    expect(config.theme).toBe('system')
  })

  it('未知のルールIDは無視される (将来互換)', () => {
    const config = validateAppConfig({ rules: { 'future/rule': { enabled: true } } })
    expect(config.rules['future/rule']).toBeUndefined()
  })

  it('schemaVersion付きconfigがmigrationを通る', () => {
    const migrated = migrateConfig({ schemaVersion: 1, preset: 'minimal' })
    const config = validateAppConfig(migrated)
    expect(config.preset).toBe('minimal')
  })

  it('font sizeはクランプされる [boundary]', () => {
    expect(validateAppConfig({ editor: { fontSize: 999 } }).editor.fontSize).toBe(32)
    expect(validateAppConfig({ editor: { fontSize: 1 } }).editor.fontSize).toBe(10)
  })
})

describe('Presets (§31)', () => {
  it('4つのBuilt-in Presetが定義され、全ルールIDが実在する', () => {
    const config = createDefaultConfig()
    const known = new Set([...buildRuleRegistry(config).keys(), ...Object.keys(TEXTLINT_RULE_META)])
    expect(BUILTIN_PRESETS.length).toBe(4)
    for (const preset of BUILTIN_PRESETS) {
      expect(['general', 'technical', 'strict', 'minimal']).toContain(preset.id)
      for (const ruleId of Object.keys(preset.rules)) {
        expect(known.has(ruleId)).toBe(true)
      }
    }
  })

  it('Strict は General より厳格 (sentence-length上限)', () => {
    const general = getPreset('general')
    const strict = getPreset('strict')
    expect(
      (strict?.rules['style/sentence-length'].options?.max as number) <
        (general?.rules['style/sentence-length'].options?.max as number)
    ).toBe(true)
  })

  it('Minimal は evidence系ルールを無効化する', () => {
    const minimal = getPreset('minimal')
    expect(minimal?.citation.detectNumbers).toBe(false)
    expect(minimal?.rules['evidence/citation-number']).toBeUndefined()
  })
})
