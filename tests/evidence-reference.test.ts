/**
 * Reference Linter / Citation Detector のテスト — 仕様書 §19-21
 */

import { describe, expect, it } from 'vitest'
import { runSingleRule, testConfig } from './helpers'
import type { CitationPolicy } from '../src/core/config/schema'

function citationConfig(scope: CitationPolicy['scope']): ReturnType<typeof testConfig> {
  const config = testConfig()
  config.citation = {
    scope,
    detectNumbers: true,
    detectComparison: true,
    detectExternalFact: true
  }
  return config
}

describe('reference/undefined (§21)', () => {
  it('未定義の参照IDをerrorで検出する [positive]', () => {
    const text = '[テキスト][undefined-id] を参照。'
    const diags = runSingleRule('reference/undefined', text, testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].severity).toBe('error')
    expect(diags[0].message).toContain('undefined-id')
  })

  it('定義済みの参照は検出しない [negative]', () => {
    const text = '[テキスト][ref1] を参照。\n\n[ref1]: https://example.com'
    expect(runSingleRule('reference/undefined', text, testConfig()).length).toBe(0)
  })

  it('collapsed参照 [text][] も定義があれば通す [boundary]', () => {
    const text = '[textlint][] を参照。\n\n[textlint]: https://textlint.github.io/'
    expect(runSingleRule('reference/undefined', text, testConfig()).length).toBe(0)
  })

  it('通常の括弧 [注記] を誤検出しない (ショートカット参照は対象外) [exception]', () => {
    expect(runSingleRule('reference/undefined', '[WIP] この文書は執筆中です。', testConfig()).length).toBe(0)
  })

  it('コードブロック内の参照は検出しない [exception §49]', () => {
    const text = '```\n[link][nope]\n```'
    expect(runSingleRule('reference/undefined', text, testConfig()).length).toBe(0)
  })
})

describe('reference/unused (§21 idle tier)', () => {
  it('未使用の定義を検出する [positive]', () => {
    const text = '[ref1]: https://example.com\n\n本文で[ref1][ref1]を使う。\n\n[unused]: https://example.org'
    const diags = runSingleRule('reference/unused', text, testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].message).toContain('unused')
  })

  it('使用済みの定義は検出しない [negative]', () => {
    const text = '[textlint][ref1]\n\n[ref1]: https://example.com'
    expect(runSingleRule('reference/unused', text, testConfig()).length).toBe(0)
  })
})

describe('reference/empty-url / malformed-url (§21)', () => {
  it('空URL定義を検出する [positive]', () => {
    const text = '[empty]: '
    const diags = runSingleRule('reference/empty-url', text, testConfig())
    expect(diags.length).toBe(1)
  })

  it('空のインラインリンクを検出する [positive]', () => {
    const text = '[リンク]() です。'
    expect(runSingleRule('reference/empty-url', text, testConfig()).length).toBe(1)
  })

  it('引用符なしタイトルをmalformedとして検出する [positive]', () => {
    const text = '[bad]: https://example.com タイトル'
    expect(runSingleRule('reference/malformed-url', text, testConfig()).length).toBe(1)
  })

  it('引用符付きタイトルは正常 [negative]', () => {
    const text = '[good]: https://example.com "タイトル"'
    expect(runSingleRule('reference/malformed-url', text, testConfig()).length).toBe(0)
  })
})

describe('reference/duplicate-id / broken-anchor / duplicate-anchor (§21)', () => {
  it('重複定義を検出する [positive]', () => {
    const text = '[ref]: https://a.example\n[ref]: https://b.example'
    expect(runSingleRule('reference/duplicate-id', text, testConfig()).length).toBe(1)
  })

  it('存在しないアンカーへのリンクを検出する [positive]', () => {
    const text = '# はじめに\n\n[概要](#outline) へ。'
    expect(runSingleRule('reference/broken-anchor', text, testConfig()).length).toBe(1)
  })

  it('存在する見出しアンカーは通す [negative]', () => {
    const text = '# はじめに\n\n[はじめに](#はじめに) へ。'
    expect(runSingleRule('reference/broken-anchor', text, testConfig()).length).toBe(0)
  })

  it('GitHub風スラグ (半角化・ハイフン) を解決する [boundary]', () => {
    const text = '# Getting Started!\n\n[開始](#getting-started) へ。'
    expect(runSingleRule('reference/broken-anchor', text, testConfig()).length).toBe(0)
  })

  it('重複見出しをduplicate-anchorで検出する [positive]', () => {
    const text = '# 詳細\n\n## 詳細'
    expect(runSingleRule('reference/duplicate-anchor', text, testConfig()).length).toBe(1)
  })
})

describe('evidence/citation-number (§19.1 heuristic detector)', () => {
  it('出典なしのパーセンテージを検出する [positive]', () => {
    const diags = runSingleRule('evidence/citation-number', '利用者の73%が満足と回答しました。', citationConfig('paragraph'))
    expect(diags.length).toBe(1)
    expect(diags[0].severity).toBe('info')
  })

  it('同一段落に出典リンクがあれば検出しない [negative]', () => {
    const text = '利用者の73%が満足と回答 ([調査](https://example.com/survey)) しました。'
    expect(runSingleRule('evidence/citation-number', text, citationConfig('paragraph')).length).toBe(0)
  })

  it('金額・倍率・ms・GB・件数・人を検出する [positive]', () => {
    expect(runSingleRule('evidence/citation-number', 'コストが5000円かかります。', citationConfig('paragraph')).length).toBe(1)
    expect(runSingleRule('evidence/citation-number', '処理が3倍高速です。', citationConfig('paragraph')).length).toBe(1)
    expect(runSingleRule('evidence/citation-number', '応答が120msでした。', citationConfig('paragraph')).length).toBe(1)
    expect(runSingleRule('evidence/citation-number', '容量は10GBです。', citationConfig('paragraph')).length).toBe(1)
    expect(runSingleRule('evidence/citation-number', '1,000件のログ。', citationConfig('paragraph')).length).toBe(1)
    expect(runSingleRule('evidence/citation-number', '500人が利用。', citationConfig('paragraph')).length).toBe(1)
    expect(runSingleRule('evidence/citation-number', '市場規模が拡大。', citationConfig('paragraph')).length).toBe(1)
  })

  it('バージョン番号・ポート・HTTPステータス・日付は除外する [exception §19.1]', () => {
    expect(runSingleRule('evidence/citation-number', 'v1.2.3をリリースしました。', citationConfig('paragraph')).length).toBe(0)
    expect(runSingleRule('evidence/citation-number', 'localhost:3000で起動します。', citationConfig('paragraph')).length).toBe(0)
    expect(runSingleRule('evidence/citation-number', 'HTTP 404が返りました。', citationConfig('paragraph')).length).toBe(0)
    expect(runSingleRule('evidence/citation-number', '2024年10月1日に開催します。', citationConfig('paragraph')).length).toBe(0)
    expect(runSingleRule('evidence/citation-number', 'Version 2.0をリリース。', citationConfig('paragraph')).length).toBe(0)
    expect(runSingleRule('evidence/citation-number', 'フェーズ2に移行します。', citationConfig('paragraph')).length).toBe(0)
  })

  it('URL内の数字は検出しない [exception §49]', () => {
    expect(
      runSingleRule('evidence/citation-number', 'https://example.com/page/50%20off を参照。', citationConfig('paragraph')).length
    ).toBe(0)
  })

  it('コードブロック内の数字は検出しない [exception §49]', () => {
    expect(runSingleRule('evidence/citation-number', '```\nconst rate = 50; // 50%\n```', citationConfig('paragraph')).length).toBe(0)
  })

  it('scope=sentence では同一文のみ判定する [§20]', () => {
    const text = '満足度は高いです ([出典](https://example.com))。\n数値は80%です。'
    const diags = runSingleRule('evidence/citation-number', text, citationConfig('sentence'))
    expect(diags.length).toBe(1)
    expect(text.slice(diags[0].start, diags[0].end)).toContain('80%')
  })

  it('scope=section では見出し区切りまで判定する [§20]', () => {
    const text = '# 概要\n\n出典は[こちら](https://example.com)。\n\n## 詳細\n\n評価は90%でした。'
    expect(runSingleRule('evidence/citation-number', text, citationConfig('section')).length).toBe(1)
  })
})

describe('evidence/citation-comparison (§19.2)', () => {
  it('根拠なしの比較表現を検出する [positive]', () => {
    expect(runSingleRule('evidence/citation-comparison', '新方式は従来より高速です。', citationConfig('paragraph')).length).toBe(1)
    expect(runSingleRule('evidence/citation-comparison', 'コストを50%削減しました。', citationConfig('paragraph')).length).toBeGreaterThanOrEqual(1)
    expect(runSingleRule('evidence/citation-comparison', '最も安全な方式です。', citationConfig('paragraph')).length).toBe(1)
  })

  it('計測条件へのリンクがあれば検出しない [negative]', () => {
    const text = '新方式は従来より高速です (計測条件: [ベンチマーク](https://example.com/bench))。'
    expect(runSingleRule('evidence/citation-comparison', text, citationConfig('paragraph')).length).toBe(0)
  })
})

describe('evidence/citation-external-fact (§19.3)', () => {
  it('「調査によると」を出典なしで検出する [positive]', () => {
    expect(runSingleRule('evidence/citation-external-fact', '調査によると、利用者は増えています。', citationConfig('paragraph')).length).toBe(1)
    expect(runSingleRule('evidence/citation-external-fact', '公式によると安全です。', citationConfig('paragraph')).length).toBe(1)
    expect(runSingleRule('evidence/citation-external-fact', '統計では減少しています。', citationConfig('paragraph')).length).toBe(1)
  })

  it('出典リンクがあれば検出しない [negative]', () => {
    const text = '[調査](https://example.com/survey)によると、利用者は増えています。'
    expect(runSingleRule('evidence/citation-external-fact', text, citationConfig('paragraph')).length).toBe(0)
  })

  it('見出し内の表現は検出しない [exception]', () => {
    expect(runSingleRule('evidence/citation-external-fact', '# 調査によると', citationConfig('paragraph')).length).toBe(0)
  })
})
