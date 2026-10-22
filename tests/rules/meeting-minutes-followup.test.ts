import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'

const scan = (text: string) => runSingleRule('style/meeting-minutes-sections', text, testConfig())

describe('meeting minutes action deadlines and follow-up', () => {
  test('requests deadline and owner only when action items exist', () => {
    const text = '# 議事録\n参加者：A\n決定事項：承認\n対応事項：実装'
    const messages = scan(text).map(d => d.message)
    expect(messages).toHaveLength(2)
    expect(messages.some(x => x.includes('担当者'))).toBe(true)
    expect(messages.some(x => x.includes('対応期限'))).toBe(true)
  })

  test('recognizes explicit owner and deadline including undecided deadlines', () => {
    expect(scan('# 議事録\n参加者：A\n決定事項：承認\n対応事項：実装\n担当者：A\n期限：未定')).toEqual([])
  })

  test('requests follow-up only when open items are explicitly labeled', () => {
    const text = '# 議事録\n参加者：A\n決定事項：承認\n未決事項：方針検討'
    expect(scan(text).map(d => d.message)).toEqual([expect.stringContaining('フォローアップ')])
    expect(scan(text + '\n次回確認：次回会議')).toEqual([])
  })

  test('does not classify prose, masked code or another document as action sections', () => {
    expect(scan('# 議事録\n参加者：A\n決定事項：承認\n本文に対応事項：実装と書いてあります')).toEqual([])
    expect(scan('# 議事録\n参加者：A\n決定事項：承認\n\`\`\`md\n対応事項：実装\n\`\`\`')).toEqual([])
    expect(scan('# 報告書\n対応事項：実装')).toEqual([])
  })

  test('new diagnostics remain informational and do not rewrite content', () => {
    const ds = scan('議事録\n参加者：A\n決定事項：承認\n未決事項：調整')
    expect(ds).toHaveLength(1)
    expect(ds[0]!.fixKind).toBe('none')
    expect(ds[0]!.replacement).toBeUndefined()
  })
})
