import { describe, expect, test } from 'vitest'
import {
  canNavigateToCommunicationAct,
  describeCommunicationAct,
  isCommunicationReviewCurrent,
  reviewCurrentCommunication,
  type CommunicationReviewInput
} from '../../src/core/communication/review'

const base: CommunicationReviewInput = {
  workspaceId:'workspace1', documentId:'document1', revision:4,
  text:'💡資料をご確認いただけますか？\n- この仕様で問題ありませんか？\n対象は何件ですか？',
  documentType:'markdown'
}

describe('on-demand read-only communication review', () => {
  test('distinguishes polite action requests from answerable binary questions', () => {
    const result = reviewCurrentCommunication(base)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.snapshot.acts).toHaveLength(3)
    const [request, question, numeric] = result.snapshot.acts
    expect(request).toMatchObject({
      intent:'confirmation_request', surfaceForm:'interrogative',
      expectedAnswer:'binary', answerCompletesRequest:false
    })
    expect(question).toMatchObject({
      intent:'confirmation_question', expectedAnswer:'binary',
      answerCompletesRequest:'unknown'
    })
    expect(numeric).toMatchObject({intent:'information_question', expectedAnswer:'numeric'})
    expect(describeCommunicationAct(request!).completion).toContain('回答だけでは')
    expect(describeCommunicationAct(question!).completion).toContain('判定できません')
    expect(describeCommunicationAct(numeric!).expectedAnswer).toBe('数値')
    for (const act of result.snapshot.acts) {
      expect(base.text.slice(act.startUtf16, act.endUtf16)).toBe(act.evidence)
    }
  })

  test('navigates only for an exact current document identity, revision and text', () => {
    const result = reviewCurrentCommunication(base)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const evidence = result.snapshot.acts[0]!
    expect(isCommunicationReviewCurrent(result.snapshot, base)).toBe(true)
    expect(canNavigateToCommunicationAct(result.snapshot, base, evidence)).toBe(true)
    for (const changed of [
      {...base, revision:5},
      {...base, workspaceId:'workspace2'},
      {...base, documentId:'document2'},
      {...base, documentType:'text' as const},
      {...base, text:'変' + base.text.slice(1)},
      {...base, text:base.text + ' '}
    ]) {
      expect(isCommunicationReviewCurrent(result.snapshot, changed)).toBe(false)
      expect(canNavigateToCommunicationAct(result.snapshot, changed, evidence)).toBe(false)
    }
  })

  test('a forged or altered evidence range cannot navigate even if the text appears elsewhere', () => {
    const result = reviewCurrentCommunication(base)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const act = result.snapshot.acts[0]!
    expect(canNavigateToCommunicationAct(result.snapshot, base, {...act})).toBe(false)
    expect(canNavigateToCommunicationAct(result.snapshot, base, {...act, startUtf16:2})).toBe(false)
    expect(canNavigateToCommunicationAct(result.snapshot, base, {...act, endUtf16:base.text.length+1})).toBe(false)
    expect(canNavigateToCommunicationAct(null, base, act)).toBe(false)
  })

  test('skips invalid or uninitialized documents without partial review findings', () => {
    expect(reviewCurrentCommunication({...base,documentId:null}))
      .toEqual({status:'skipped',reason:'missing-document'})
    expect(reviewCurrentCommunication({...base,workspaceId:null}))
      .toEqual({status:'skipped',reason:'missing-document'})
    expect(reviewCurrentCommunication({...base,revision:-1}))
      .toEqual({status:'skipped',reason:'invalid-input'})
    expect(reviewCurrentCommunication({...base,text:'a'.repeat(200001)}))
      .toEqual({status:'skipped',reason:'size-limit'})
  })

  test('reports no matched explicit forms as no findings, not inferred correctness', () => {
    const result = reviewCurrentCommunication({...base,text:'ログを確認しました。'})
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.snapshot.acts).toEqual([])
  })

  test('excludes markdown quotations and code in surfaced findings', () => {
    const content = [
      '# ご確認ください。',
      '> ご承認ください。',
      '```text',
      '確認してください。',
      '```',
      '- ご確認いただけますか？'
    ].join('\n')
    const result = reviewCurrentCommunication({...base,text:content})
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.snapshot.acts.map(x=>x.evidence)).toEqual(['ご確認いただけますか？'])
  })
})
