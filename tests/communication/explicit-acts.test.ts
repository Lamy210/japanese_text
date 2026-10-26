import { describe, expect, test } from 'vitest'
import { detectExplicitCommunicationActs } from '../../src/core/communication/explicit-acts'

function first(text: string, type: 'text' | 'markdown' = 'text') {
  const result = detectExplicitCommunicationActs(text, type)
  expect(result.status).toBe('analyzed')
  return result.status === 'analyzed' ? result.acts[0] : undefined
}

describe('explicit communication acts v1 (high-precision rule baseline)', () => {
  test('separates grammatical Yes/No form from a confirmation action request', () => {
    expect(first('資料をご確認いただけますか？')).toMatchObject({
      intent: 'confirmation_request',
      surfaceForm: 'interrogative',
      expectedAnswer: 'binary',
      answerCompletesRequest: false
    })
    expect(first('この仕様で問題ありませんか？')).toMatchObject({
      intent: 'confirmation_question',
      surfaceForm: 'interrogative',
      expectedAnswer: 'binary',
      answerCompletesRequest: 'unknown'
    })
  })

  test.each([
    ['ログを確認してください。', 'confirmation_request', 'action'],
    ['資料の承認をお願いします。', 'approval_request', 'action'],
    ['金曜日までに修正してください。', 'action_request', 'action'],
    ['回答をお願いいたします。', 'action_request', 'action'],
    ['この案のご承認いただけますか？', 'approval_request', 'binary']
  ] as const)('detects explicit request: %s', (text, intent, expectedAnswer) => {
    expect(first(text)).toMatchObject({
      intent, expectedAnswer, answerCompletesRequest: false
    })
  })

  test.each([
    ['A案とB案のどちらが良いですか？', 'choice'],
    ['いつまでに対応できますか？', 'date'],
    ['対象は何件ですか？', 'numeric'],
    ['なぜ不具合が発生したのですか？', 'explanation'],
    ['この設定で問題ありませんか？', 'binary']
  ] as const)('classifies expected answer type for %s', (text, expectedAnswer) => {
    expect(first(text)).toMatchObject({expectedAnswer, surfaceForm: 'interrogative'})
  })

  test('anchors each extracted sentence to the unchanged UTF-16 original', () => {
    const source = '前置きです。\n- 💡金曜日までにログを確認してください。\nこの仕様で問題ありませんか？'
    const result = detectExplicitCommunicationActs(source, 'markdown')
    expect(result.status).toBe('analyzed')
    if (result.status !== 'analyzed') return
    expect(result.acts).toHaveLength(2)
    for (const act of result.acts) {
      expect(source.slice(act.startUtf16, act.endUtf16)).toBe(act.evidence)
      expect(act.extractionMethod).toBe('explicit-rule-v1')
    }
    expect(result.acts[0]?.startUtf16).toBe(source.indexOf('💡'))
  })

  test('does not attribute quoted examples, code fences, tables, headings or link labels to the author', () => {
    const source = [
      '# ご確認ください。',
      '> 対応してください。',
      '「ご確認ください。」と書かれています。',
      '```ts',
      '確認してください。',
      '```',
      '| 対象 | ご承認ください。 |',
      '| --- | --- |',
      '| x | ご確認ください。 |',
      '[ご確認ください](https://example.com/path)',
      'ログを確認してください。'
    ].join('\n')
    const result = detectExplicitCommunicationActs(source, 'markdown')
    expect(result.status).toBe('analyzed')
    if (result.status !== 'analyzed') return
    expect(result.acts.map(a => a.evidence)).toEqual(['ログを確認してください。'])
  })

  test('does not classify ordinary statements or reported speech as requests', () => {
    const source = [
      'ログを確認しました。',
      '明日までに報告できそうです。',
      '「承認してください。」と相手が言いました。'
    ].join('\n')
    const result = detectExplicitCommunicationActs(source, 'text')
    expect(result).toEqual({status: 'analyzed', acts: []})
  })

  test('rejects invalid and excessively long input without partial analysis', () => {
    expect(detectExplicitCommunicationActs(null as unknown as string))
      .toEqual({status: 'skipped', reason: 'invalid-input'})
    expect(detectExplicitCommunicationActs('test', 'bad' as 'markdown'))
      .toEqual({status: 'skipped', reason: 'invalid-input'})
    expect(detectExplicitCommunicationActs('あ'.repeat(200_001), 'text'))
      .toEqual({status: 'skipped', reason: 'size-limit'})
  })

  test('preserves deterministic order and freezes returned acts', () => {
    const text = 'ログを確認してください。仕様で問題ありませんか？'
    const a = detectExplicitCommunicationActs(text, 'text')
    const b = detectExplicitCommunicationActs(text, 'text')
    expect(a).toEqual(b)
    expect(a.status).toBe('analyzed')
    if (a.status !== 'analyzed') return
    expect(a.acts.map(x => x.intent)).toEqual([
      'confirmation_request', 'confirmation_question'
    ])
    expect(Object.isFrozen(a.acts)).toBe(true)
    expect(Object.isFrozen(a.acts[0])).toBe(true)
  })
})
