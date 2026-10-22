import { describe, expect, test } from 'vitest'
import { formatDocument } from '../../src/core/formatter/formatter'
import { runSingleRule, testConfig } from '../helpers'

const check = (text: string) => runSingleRule('wording/terminology', text, testConfig())

describe('terminology Safe Fix token boundaries', () => {
  test.each([
    'SuperGithubX',
    'GithubEnterprise',
    'Github_Archive',
    'myGithub',
    'Dockerfile',
    'NodeJSRuntime',
    'ユーザビリティ',
    'サーバレス',
    'サーバル',
    'ブラウザゲーム',
    'コンピュータゲーム',
    'スーパーサーバ',
    'Xサーバ管理'
  ])('does not rewrite fragments of a longer identifier or product name: %s', (name) => {
    const source = `製品名「${name}」の説明です。`
    expect(check(source)).toEqual([])
    expect(formatDocument(source, check(source)).text).toBe(source)
  })

  test('does not modify a Katakana product in unquoted ordinary prose', () => {
    expect(check('ユーザビリティ改善とサーバレス構成の比較。')).toEqual([])
  })

  test.each([
    ['Githubについて', 'GitHub'],
    ['ユーザ一覧', 'ユーザー'],
    ['サーバの設定', 'サーバー'],
    ['ブラウザを起動', 'ブラウザー'],
    ['NodeJSを起動', 'Node.js'],
    ['Dockerを使用', null]
  ])('preserves complete terminology fixes: %s', (source, replacement) => {
    const ds = check(source)
    if (replacement === null) {
      expect(ds).toEqual([])
    } else {
      expect(ds).toHaveLength(1)
      expect(ds[0]?.replacement).toBe(replacement)
      expect(ds[0]?.fixKind).toBe('safe')
    }
  })

  test('keeps UTF-16 spans and avoids name corruption after emoji', () => {
    const source = '🎮サーバレスとGithubを確認'
    const ds = check(source)
    expect(ds).toHaveLength(1)
    expect(source.slice(ds[0]!.start, ds[0]!.end)).toBe('Github')
    expect(ds[0]!.start).toBe(source.indexOf('Github'))
    expect(formatDocument(source, ds).text).toBe('🎮サーバレスとGitHubを確認')
  })
})
