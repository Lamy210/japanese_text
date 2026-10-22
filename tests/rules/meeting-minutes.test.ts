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

  test('is informational in main presets only', () => {
    for (const id of ['general', 'technical', 'strict'] as const) {
      expect(getPreset(id)?.rules['style/meeting-minutes-sections']).toEqual({enabled:true,severity:'info'})
    }
    expect(getPreset('minimal')?.rules['style/meeting-minutes-sections']).toBeUndefined()
  })
})
