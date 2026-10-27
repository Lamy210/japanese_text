import { describe, expect, test } from 'vitest'
import { detectExplicitCommunicationActs } from '../../src/core/communication/explicit-acts'
import { extractExplicitCommunicationSlots } from '../../src/core/communication/explicit-slots'
import { describeCommunicationSlot, reviewCurrentCommunication } from '../../src/core/communication/review'

function parse(text: string) {
  const acts = detectExplicitCommunicationActs(text, 'text')
  expect(acts.status).toBe('analyzed')
  if (acts.status !== 'analyzed') throw Error('expected valid acts')
  return extractExplicitCommunicationSlots(text, acts.acts)
}

describe('explicit communication slot candidates v1', () => {
  test('identifies a relative deadline and ambiguous motivation, never claims they are confirmed', () => {
    const text = '💡再発防止のため、金曜日までにログを確認してください。'
    const result = parse(text)
    expect(result.status).toBe('analyzed')
    if (result.status !== 'analyzed') return
    expect(result.slots.map(s=>({kind:s.kind,evidence:s.evidence}))).toEqual([
      {kind:'ambiguous-motivation',evidence:'再発防止のため'},
      {kind:'deadline-candidate',evidence:'金曜日までに'}
    ])
    for (const slot of result.slots) {
      expect(text.slice(slot.startUtf16,slot.endUtf16)).toBe(slot.evidence)
      expect(slot.scope).toBe('sentence-candidate')
      expect(slot.extractionMethod).toBe('explicit-slot-rule-v1')
    }
    expect(result.slots[1]?.needsDateContext).toBe(true)
    expect(describeCommunicationSlot(result.slots[0]!).caution).toContain('理由・目的')
    expect(describeCommunicationSlot(result.slots[1]!).caution).toContain('基準日')
  })

  test.each([
    ['2026年10月31日までにログを確認してください。',false],
    ['2026-10-31までにログを確認してください。',false],
    ['10月31日までにログを確認してください。',true],
    ['明日までにログを確認してください。',true],
    ['来週月曜日までにログを確認してください。',true]
  ] as const)('preserves date-context requirement for %s', (text, needsDateContext) => {
    const result = parse(text)
    expect(result.status).toBe('analyzed')
    if (result.status !== 'analyzed') return
    expect(result.slots[0]).toMatchObject({kind:'deadline-candidate',needsDateContext})
  })

  test('recognizes explicit reason and purpose phrases without inferring veracity', () => {
    const examples = [
      ['障害が原因で、明日までに報告してください。','reason-candidate','障害が原因で'],
      ['品質改善を目的として、金曜日までにログを確認してください。','purpose-candidate','品質改善を目的として']
    ] as const
    for (const [text, kind, evidence] of examples) {
      const result = parse(text)
      expect(result.status).toBe('analyzed')
      if (result.status !== 'analyzed') continue
      expect(result.slots.some(s=>s.kind===kind && s.evidence===evidence)).toBe(true)
    }
  })

  test('retains exact spans through Markdown list and excludes code/blockquote', () => {
    const source = [
      '> 明日までにログを確認してください。',
      '```text',
      '明日までにログを確認してください。',
      '```',
      '- 💡再発防止のため、金曜日までにログを確認してください。'
    ].join('\n')
    const review = reviewCurrentCommunication({
      workspaceId:'w1',documentId:'d1',revision:3,
      text:source,documentType:'markdown'
    })
    expect(review.status).toBe('ready')
    if (review.status !== 'ready') return
    expect(review.snapshot.acts).toHaveLength(1)
    expect(review.snapshot.slots).toHaveLength(2)
    const offset = source.lastIndexOf('金曜日までに')
    expect(review.snapshot.slots.find(s=>s.kind==='deadline-candidate')?.startUtf16).toBe(offset)
  })

  test('does not fabricate deadlines from unrelated prose or absolute dates without まで', () => {
    for (const text of [
      'ログを確認してください。',
      '2026年10月31日はイベントがあります。ログを確認してください。',
      '期限は未定です。ログを確認してください。'
    ]) {
      const result = parse(text)
      expect(result.status).toBe('analyzed')
      if (result.status === 'analyzed') {
        expect(result.slots.filter(s=>s.kind==='deadline-candidate')).toEqual([])
      }
    }
  })

  test('rejects broken evidence rather than returning partial items', () => {
    const text = '明日までにログを確認してください。'
    const acts = detectExplicitCommunicationActs(text,'text')
    expect(acts.status).toBe('analyzed')
    if (acts.status !== 'analyzed') return
    const forged = [{...acts.acts[0]!,evidence:'明後日までにログを確認してください。'}]
    expect(extractExplicitCommunicationSlots(text,forged))
      .toEqual({status:'skipped',reason:'invalid-input'})
    expect(extractExplicitCommunicationSlots('a'.repeat(200001),[]))
      .toEqual({status:'skipped',reason:'size-limit'})
  })

  test('retains immutable sorted candidates and compatible read-only review output', () => {
    const text = '金曜日までに品質改善を目的として、ログを確認してください。'
    const input = {workspaceId:'w',documentId:'d',revision:1,text,documentType:'text' as const}
    const a = reviewCurrentCommunication(input)
    const b = reviewCurrentCommunication(input)
    expect(a).toEqual(b)
    expect(a.status).toBe('ready')
    if (a.status !== 'ready') return
    expect(a.snapshot.slots.map(s=>s.startUtf16)).toEqual(
      [...a.snapshot.slots.map(s=>s.startUtf16)].sort((x,y)=>x-y)
    )
    expect(Object.isFrozen(a.snapshot.slots)).toBe(true)
    expect(Object.isFrozen(a.snapshot.slots[0])).toBe(true)
  })
})
