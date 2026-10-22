import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import { getPreset } from '../../src/core/config/presets'

const scan = (text: string) => runSingleRule('style/meeting-minutes-sections', text, testConfig())

describe('meeting minutes sections', () => {
  test('checks an explicitly titled minutes document', () => {
    const text = '# 議事録\n日時：今日\n'
    const ds = scan(text)
    expect(ds.map(d => d.message)).toEqual([
      expect.stringContaining('参加者'), expect.stringContaining('決定事項')
    ])
    expect(ds.every(d => d.fixKind === 'none')).toBe(true)
  })

  test('accepts both sections with explicit labels', () => {
    expect(scan('議事録\n参加者：Aさん\n決定事項：対応する')).toEqual([])
    expect(scan('# 議事録\n出席者: Aさん\n決まったこと: 採用')).toEqual([])
  })

  test('avoids unrelated documents and mentions in ordinary prose', () => {
    expect(scan('# 報告書\n議事録を参照してください。')).toEqual([])
    expect(scan('これは議事録についての説明です。')).toEqual([])
    expect(scan('')).toEqual([])
  })

  test('does not count code examples as actual sections', () => {
    const text = '# 議事録\n```md\n参加者：A\n決定事項：承認\n```'
    expect(scan(text)).toHaveLength(2)
  })

  test('preserves UTF-16 diagnostic offsets', () => {
    const text = '📋\n# 議事録\n'
    // Explicit minutes title must be the first nonempty line.
    expect(scan(text)).toEqual([])
    const ds = scan('  # 議事録\n')
    expect(ds[0]?.start).toBe(4)
  })

  test('requires explicit section labels rather than mentions in prose', () => {
    const ds = scan('# 議事録\n本文に参加者：Aと決定事項：Bを記載。')
    expect(ds).toHaveLength(2)
  })

  test('flags action items without an owner section', () => {
    const ds = scan('# 議事録\n参加者：A\n決定事項：採用\n対応事項：テスト\n期限：未定')
    expect(ds).toHaveLength(1)
    expect(ds[0]!.message).toContain('担当者')
    expect(scan('# 議事録\n参加者：A\n決定事項：採用\n対応事項：テスト\n担当者：A\n期限：未定')).toEqual([])
  })

  test('does not count a section inside inline code', () => {
    expect(scan('# 議事録\n`参加者：A`\n決定事項：B')).toHaveLength(1)
  })

  test('recognizes section labels formatted as Markdown bullets', () => {
    const text = ['# 議事録', '- 参加者：A', '- 決定事項：採用', '- 対応事項：テスト', '- 担当者：A', '- 期限：未定'].join('\n')
    expect(scan(text)).toEqual([])
  })

  test('does not treat list mentions as section headings', () => {
    const text = ['# 議事録', '- 今回は参加者：Aと決定事項：Bを説明'].join('\n')
    expect(scan(text)).toHaveLength(2)
  })


  test('guides action deadlines but not documents with no action items', () => {
    const base = ['# 議事録', '参加者：A', '決定事項：採用', '対応事項：検証', '担当者：A'].join('\n')
    const results = scan(base)
    expect(results).toHaveLength(1)
    expect(results[0]!.message).toContain('対応期限')
    expect(results[0]!.fixKind).toBe('none')
    expect(scan(base + '\n期限：未定')).toEqual([])
    expect(scan('# 議事録\n参加者：A\n決定事項：なし')).toEqual([])
  })

  test('does not count deadline mentions in prose or code', () => {
    const text = ['# 議事録', '参加者：A', '決定事項：保留', '未決事項：次回確認', '対応事項：検証', '担当者：A', '期日：を確認する予定', ''].join('\n')
    expect(scan(text)).toEqual([])
    const withoutLabel = text.replace('期日：を確認する予定', '本文中に期日：を記載する')
    expect(scan(withoutLabel)).toHaveLength(1)
  })


  test('flags explicitly pending decisions without pending-items section', () => {
    const base = ['# 議事録', '参加者：A', '決定事項：保留'].join('\n')
    const ds = scan(base)
    expect(ds).toHaveLength(1)
    expect(ds[0]!.message).toContain('未決事項')
    expect(ds[0]!.fixKind).toBe('none')
    expect(scan(base + '\n未決事項：次回判断')).toEqual([])
  })

  test('does not infer pending status from normal decisions or body prose', () => {
    expect(scan('# 議事録\n参加者：A\n決定事項：採用。保留なし')).toEqual([])
    expect(scan('# 議事録\n参加者：A\n決定事項：採用\n本文では保留を説明')).toEqual([])
    expect(scan('# 議事録\n参加者：A\n決定事項：保留解除')).toEqual([])
  })

  test('is informational in main presets only', () => {
    for (const id of ['general', 'technical', 'strict'] as const) {
      expect(getPreset(id)?.rules['style/meeting-minutes-sections']).toEqual({enabled:true,severity:'info'})
    }
    expect(getPreset('minimal')?.rules['style/meeting-minutes-sections']).toBeUndefined()
  })
})
