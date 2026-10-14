/**
 * Fast Engine ルール群のテスト — 仕様書 §48 (positive / negative / exception / boundary / Unicode)
 * §49 Golden Test: 全角 / 半角 / 絵文字 / surrogate pair / Markdown code / URL / inline code / quote / table
 */

import { describe, expect, it } from 'vitest'
import { runSingleRule, testConfig } from './helpers'

describe('typography/full-width-space (§3.1 全角スペース)', () => {
  it('全角スペースを検出しSafe Fixを提示する [positive]', () => {
    const diags = runSingleRule('typography/full-width-space', 'データ　200件を処理。', testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].fixKind).toBe('safe')
    expect(diags[0].replacement).toBe(' ')
  })

  it('日本語文字に挟まれた全角スペースは不要スペースルール側で削除扱い [協調動作]', () => {
    expect(runSingleRule('typography/full-width-space', 'これは　全角スペースです。', testConfig()).length).toBe(0)
    const diags = runSingleRule('typography/unnecessary-space', 'これは　全角スペースです。', testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].replacement).toBe('')
  })

  it('半角スペースは検出しない [negative]', () => {
    expect(runSingleRule('typography/full-width-space', '半角 space です。', testConfig()).length).toBe(0)
  })

  it('コードブロック内の全角スペースは検出しない [exception]', () => {
    const text = '```\n　indent\n```'
    expect(runSingleRule('typography/full-width-space', text, testConfig()).length).toBe(0)
  })
})

describe('typography/unnecessary-space (§3.1 不要スペース)', () => {
  it('日本語文字間のスペースを検出する [positive]', () => {
    const diags = runSingleRule('typography/unnecessary-space', '今日 は良い天気です。', testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].replacement).toBe('')
    expect(diags[0].fixKind).toBe('safe')
  })

  it('句読点の前のスペースを検出する [positive]', () => {
    const diags = runSingleRule('typography/unnecessary-space', 'です 、ました。', testConfig())
    expect(diags.length).toBeGreaterThanOrEqual(1)
  })

  it('英数字と日本語の間のスペースは検出しない [negative]', () => {
    expect(
      runSingleRule('typography/unnecessary-space', '日本語 English 日本語', testConfig()).length
    ).toBe(0)
  })

  it('行末2連続スペース (Markdown hard break) は検出しない [exception]', () => {
    const text = '一行目  \n二行目'
    const diags = runSingleRule('typography/unnecessary-space', text, testConfig())
    // 行末の2スペースは保持される
    expect(diags.filter((d) => d.message.includes('行末'))).toHaveLength(0)
  })

  it('行末の単一スペースは検出する [boundary]', () => {
    const text = '一行目 \n二行目'
    const diags = runSingleRule('typography/unnecessary-space', text, testConfig())
    expect(diags.filter((d) => d.message.includes('行末'))).toHaveLength(1)
  })

  it('inline code内のスペースは検出しない [exception §49]', () => {
    const text = 'テスト `foo bar` テスト'
    expect(runSingleRule('typography/unnecessary-space', text, testConfig()).length).toBe(0)
  })
})

describe('typography/punctuation (§3.1 句読点 / §17 句読点形式=Safe Fix)', () => {
  it('全角カンマ(，)を読点(、)へ変換する [positive]', () => {
    const diags = runSingleRule('typography/punctuation', '今日は晴れ，明日は雨です。', testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].fixKind).toBe('safe')
    expect(diags[0].replacement).toBe('、')
  })

  it('全角ピリオド(．)を句点(。)へ変換する [positive]', () => {
    const diags = runSingleRule('typography/punctuation', '終わりです．', testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].replacement).toBe('。')
  })

  it('全角数字に挟まれた小数点(１２．３４)は変換しない [exception]', () => {
    expect(runSingleRule('typography/punctuation', '値は１２．３４です。', testConfig()).length).toBe(0)
  })

  it('半角数字の小数点(12.34)は検出しない [negative]', () => {
    expect(runSingleRule('typography/punctuation', '値は12.34です。', testConfig()).length).toBe(0)
  })

  it('日本語に隣接する半角!?をSuggestionとして検出する [positive]', () => {
    const diags = runSingleRule('typography/punctuation', 'すごい!ですか?', testConfig())
    expect(diags.length).toBe(2)
    expect(diags[0].fixKind).toBe('suggestion')
  })

  it('英語語句の直後の!?は検出しない [negative]', () => {
    expect(runSingleRule('typography/punctuation', 'This is great!', testConfig()).length).toBe(0)
  })
})

describe('typography/brackets (§3.1 括弧対応)', () => {
  it('閉じられていない括弧を検出する [positive]', () => {
    const diags = runSingleRule('typography/brackets', 'これは（閉じていません。', testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].message).toContain('（')
  })

  it('対応した括弧は検出しない [negative]', () => {
    expect(runSingleRule('typography/brackets', 'これは（閉じている）。', testConfig()).length).toBe(0)
  })

  it('種類の不一致を検出する [positive]', () => {
    const diags = runSingleRule('typography/brackets', 'これは（ミスマッチ]です。', testConfig())
    expect(diags.length).toBeGreaterThanOrEqual(1)
  })

  it('Markdownリンク構文は括弧対応として扱う [exception §49]', () => {
    expect(
      runSingleRule('typography/brackets', '[リンク](https://example.com) です。', testConfig()).length
    ).toBe(0)
  })

  it('段落をまたいだ閉じ括弧は検出する', () => {
    const text = '段落1（閉じてない。\n\n新しい段落。）'
    const diags = runSingleRule('typography/brackets', text, testConfig())
    expect(diags.length).toBeGreaterThanOrEqual(1)
  })

  it('引用・テーブル内の括弧も検査する [§49 quote/table]', () => {
    const text = '> 引用（未閉じ\n\n| 表 | 値 |\n|---|---|\n| 内容 | ３ |'
    const diags = runSingleRule('typography/brackets', text, testConfig())
    expect(diags.length).toBeGreaterThanOrEqual(1)
  })
})

describe('typography/alnum-width (§3.1 英数字表記)', () => {
  it('全角英数字を検出し半角へ変換する [positive]', () => {
    const diags = runSingleRule('typography/alnum-width', 'バージョン２．０ではなくＶ２です。', testConfig())
    expect(diags.length).toBeGreaterThanOrEqual(2)
    for (const d of diags) {
      expect(d.fixKind).toBe('safe')
      expect(d.replacement).not.toContain(/[０-９Ａ-Ｚａ-ｚ]/.source)
    }
  })

  it('半角英数字は検出しない [negative]', () => {
    expect(runSingleRule('typography/alnum-width', 'Version 2.0 です。', testConfig()).length).toBe(0)
  })

  it('絵文字・漢字を誤検出しない [Unicode]', () => {
    expect(runSingleRule('typography/alnum-width', '🎉東京都。', testConfig()).length).toBe(0)
  })
})

describe('wording/ng-word (§15)', () => {
  it('NGワードを検出する [positive]', () => {
    const config = testConfig()
    config.ngWords = [
      { id: 'ng1', word: 'させていただきます', severity: 'warning' },
      { id: 'ng2', word: '至急', severity: 'error', replacement: 'できるだけ早く' }
    ]
    const text = '確認をさせていただきます。至急お願いします。'
    const diags = runSingleRule('wording/ng-word', text, config)
    expect(diags.length).toBe(2)
    expect(diags[0].severity).toBe('warning')
    expect(diags[0].message).toContain('させていただきます')
    const urgent = diags.find((d) => text.slice(d.start, d.end) === '至急')
    expect(urgent?.severity).toBe('error')
    expect(urgent?.replacement).toBe('できるだけ早く')
  })

  it('replacement付きNGワードはSafe Fixを提示する', () => {
    const config = testConfig()
    config.ngWords = [{ id: 'ng1', word: '至急', severity: 'error', replacement: 'できるだけ早く' }]
    const diags = runSingleRule('wording/ng-word', '至急お願いします。', config)
    expect(diags[0].fixKind).toBe('safe')
    expect(diags[0].replacement).toBe('できるだけ早く')
  })

  it('caseSensitive=false は大文字小文字を無視する [boundary]', () => {
    const config = testConfig()
    config.ngWords = [{ id: 'ng1', word: 'TODO', severity: 'warning', caseSensitive: false }]
    expect(runSingleRule('wording/ng-word', 'これはtodoです。', config).length).toBe(1)
  })

  it('caseSensitive=true (default) は区別する [boundary]', () => {
    const config = testConfig()
    config.ngWords = [{ id: 'ng1', word: 'TODO', severity: 'warning', caseSensitive: true }]
    expect(runSingleRule('wording/ng-word', 'これはtodoです。', config).length).toBe(0)
    expect(runSingleRule('wording/ng-word', 'これはTODOです。', config).length).toBe(1)
  })

  it('wholeWord はASCII単語境界を要求する [boundary]', () => {
    const config = testConfig()
    config.ngWords = [{ id: 'ng1', word: 'fix', severity: 'warning', wholeWord: true }]
    expect(runSingleRule('wording/ng-word', 'fix the bug', config).length).toBe(1)
    expect(runSingleRule('wording/ng-word', 'prefix and suffix', config).length).toBe(0)
  })

  it('正規表現モード (Advanced) が機能する', () => {
    const config = testConfig()
    config.ngWords = [{ id: 'ng1', word: '完了し(ています|ました)', severity: 'warning', isRegex: true }]
    expect(runSingleRule('wording/ng-word', '実装が完了しています。', config).length).toBe(1)
    expect(runSingleRule('wording/ng-word', '実装が完了しました。', config).length).toBe(1)
    expect(runSingleRule('wording/ng-word', '実装が完了します。', config).length).toBe(0)
  })

  it('不正な正規表現は例外を投げずスキップされる [exception §41]', () => {
    const config = testConfig()
    config.ngWords = [{ id: 'bad', word: '[invalid(', severity: 'warning', isRegex: true }]
    expect(() => runSingleRule('wording/ng-word', 'テスト', config)).not.toThrow()
    expect(runSingleRule('wording/ng-word', 'テスト', config).length).toBe(0)
  })

  it('コードブロック内のNGワードは検出しない [exception §49]', () => {
    const config = testConfig()
    config.ngWords = [{ id: 'ng1', word: 'FIXME', severity: 'warning' }]
    const text = '```\n// FIXME: あとで直す\n```'
    expect(runSingleRule('wording/ng-word', text, config).length).toBe(0)
  })
})

describe('wording/terminology (§16 表記統一)', () => {
  it('Rejected表記を検出しPreferred表記のSafe Fixを提示する [positive]', () => {
    const config = testConfig()
    config.terminology = [
      { id: 't1', preferred: 'GitHub', rejected: ['Github', 'github'], caseSensitive: true }
    ]
    const diags = runSingleRule('wording/terminology', 'Githubへpushします。', config)
    expect(diags.length).toBe(1)
    expect(diags[0].fixKind).toBe('safe')
    expect(diags[0].replacement).toBe('GitHub')
  })

  it('Preferred表記そのものは検出しない [negative]', () => {
    const config = testConfig()
    config.terminology = [
      { id: 't1', preferred: 'GitHub', rejected: ['Github', 'github'], caseSensitive: true }
    ]
    expect(runSingleRule('wording/terminology', 'GitHubへpushします。', config).length).toBe(0)
  })

  it('「ユーザー」内の「ユーザ」を誤検出しない (長音境界) [exception]', () => {
    const config = testConfig()
    config.terminology = [{ id: 't1', preferred: 'ユーザー', rejected: ['ユーザ'], caseSensitive: false }]
    expect(runSingleRule('wording/terminology', 'ユーザーが入力します。', config).length).toBe(0)
    expect(runSingleRule('wording/terminology', 'ユーザが入力します。', config).length).toBe(1)
  })

  it('「サーバー」内の「サーバ」を誤検出しない [exception]', () => {
    const config = testConfig()
    config.terminology = [{ id: 't1', preferred: 'サーバー', rejected: ['サーバ'], caseSensitive: false }]
    expect(runSingleRule('wording/terminology', 'サーバーが落ちました。', config).length).toBe(0)
  })

  it('コード・URL内の表記は検出しない [exception §49]', () => {
    const config = testConfig()
    config.terminology = [
      { id: 't1', preferred: 'GitHub', rejected: ['github'], caseSensitive: true }
    ]
    const text = '詳細は [github](https://github.com) を参照。'
    // URL内のgithubはマスク済み。リンクテキストのgithubは検出される
    const diags = runSingleRule('wording/terminology', text, config)
    expect(diags.length).toBe(1)
    expect(text.slice(diags[0].start, diags[0].end)).toBe('github')
  })

  it('caseSensitive=false は全ケースを検出する', () => {
    const config = testConfig()
    config.terminology = [{ id: 't1', preferred: 'Docker', rejected: ['docker'], caseSensitive: false }]
    expect(runSingleRule('wording/terminology', 'docker run と DOCKER build。', config).length).toBe(2)
  })
})

describe('wording/redundancy (§3.1 冗長表現)', () => {
  it('「することができる」を検出する [positive]', () => {
    const diags = runSingleRule('wording/redundancy', '編集することができます。', testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].message).toContain('することができます')
  })

  it('「行なう」表記ゆれはSafe Fix [positive]', () => {
    const diags = runSingleRule('wording/redundancy', 'テストを行なう。', testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].fixKind).toBe('safe')
    expect(diags[0].replacement).toBe('行う')
  })

  it('「できる」単体は検出しない [negative]', () => {
    expect(runSingleRule('wording/redundancy', '編集できます。', testConfig()).length).toBe(0)
  })
})

describe('wording/ambiguity (§3.1 曖昧表現)', () => {
  it('「と思われます」を検出する [positive]', () => {
    const diags = runSingleRule('wording/ambiguity', 'この方法が安全だと思われます。', testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].severity).toBe('info')
  })

  it('断定表現は検出しない [negative]', () => {
    expect(runSingleRule('wording/ambiguity', 'この方法は安全です。', testConfig()).length).toBe(0)
  })
})

describe('style/comma-count (§3.1 読点数)', () => {
  it('読点が多い文を検出する [positive]', () => {
    const text = '本日は、晴天なり、かつ、気持ちも、良い一日です、本当に。'
    const diags = runSingleRule('style/comma-count', text, testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].message).toContain('読点')
  })

  it('読点が少ない文は検出しない [negative]', () => {
    expect(runSingleRule('style/comma-count', '本日は、晴天なり。', testConfig()).length).toBe(0)
  })

  it('max オプションで上限を変更できる [options]', () => {
    const config = testConfig()
    config.rules['style/comma-count'] = { enabled: true, severity: 'warning', options: { max: 1 } }
    expect(runSingleRule('style/comma-count', '本日は、晴天、なり。', config).length).toBe(1)
    expect(runSingleRule('style/comma-count', '本日は、晴天なり。', config).length).toBe(0)
  })

  it('見出し行は検査しない [exception]', () => {
    expect(runSingleRule('style/comma-count', '# 本日は、晴天、かつ、良い、一日、です。', testConfig()).length).toBe(0)
  })
})

describe('markdown/heading-order (§14)', () => {
  it('レベルスキップを検出する [positive]', () => {
    const text = '# 見出し1\n\n### 見出し3 (スキップ)'
    const diags = runSingleRule('markdown/heading-order', text, testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].message).toContain('スキップ')
  })

  it('正しい階層は検出しない [negative]', () => {
    const text = '# 見出し1\n\n## 見出し2\n\n### 見出し3'
    expect(runSingleRule('markdown/heading-order', text, testConfig()).length).toBe(0)
  })

  it('コードブロック内の#は無視する [exception §49]', () => {
    const text = '# 見出し1\n\n```\n### コード内見出し風\n```\n\n## 見出し2'
    expect(runSingleRule('markdown/heading-order', text, testConfig()).length).toBe(0)
  })
})

describe('style/mixed-tone (§3.1 文体 / §22 形態素解析なしの決定論的実装)', () => {
  it('ですます調とである調の混在を検出する [positive]', () => {
    const text = 'このアプリは便利です。とても高速である。'
    const diags = runSingleRule('style/mixed-tone', text, testConfig())
    expect(diags.length).toBe(1)
    expect(diags[0].message).toContain('文体の混在')
  })

  it('ですます調のみは検出しない [negative]', () => {
    expect(runSingleRule('style/mixed-tone', 'このアプリは便利です。とても高速です。', testConfig()).length).toBe(0)
  })

  it('である調のみは検出しない [negative]', () => {
    expect(runSingleRule('style/mixed-tone', 'このアプリは便利だ。とても高速である。', testConfig()).length).toBe(0)
  })

  it('段落が異なれば検出しない [boundary]', () => {
    const text = 'このアプリは便利です。\n\nこのアプリは高速である。'
    expect(runSingleRule('style/mixed-tone', text, testConfig()).length).toBe(0)
  })

  it('少数派の文体のみを報告する', () => {
    const text = 'です。ます。ました。です。である。'
    const diags = runSingleRule('style/mixed-tone', text, testConfig())
    expect(diags.length).toBe(1)
    expect(text.slice(diags[0].start, diags[0].end)).toBe('である')
  })

  it('コード内の文言は無視する [exception §49]', () => {
    const text = '本文です。\n\n```\nconst msg = "処理が完了した"\n```'
    expect(runSingleRule('style/mixed-tone', text, testConfig()).length).toBe(0)
  })
})
