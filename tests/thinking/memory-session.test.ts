import { describe, expect, test } from 'vitest'
import { BrainstormMemorySession, BRAINSTORM_PHASE_LABELS } from '../../src/core/thinking/memory-session'
import { parseBrainstormSnapshot } from '../../src/core/thinking/validate'

const NOW = '2026-10-27T01:00:00.000Z'

describe('memory-only brainstorm session controller', () => {
  test('starts a session with a bounded theme and no storage dependency', () => {
    const session = new BrainstormMemorySession()
    expect(session.start('話題', 'session1')).toBe(false)
    expect(session.bindWorkspace('workspace1')).toBe(true)
    expect(session.start('  問い合わせ回答を改善する  ', 'session1')).toBe(true)
    expect(session.snapshot()?.session).toMatchObject({
      id:'session1', workspaceId:'workspace1', theme:'問い合わせ回答を改善する',
      phase:'discover', historyRevision:0
    })
    expect(session.question()?.strategy).toBe('problem-framing')
    expect(session.exportSnapshot()).toContain('問い合わせ回答を改善する')
  })

  test('answering a suggested question records the note and advances prompt history', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    expect(session.start('改善案', 'session1')).toBe(true)
    const question = session.question()
    expect(question).not.toBeNull()
    expect(session.addThought('note1', '困っている利用者がいる', NOW)).toBe(true)
    expect(session.snapshot()?.nodes).toMatchObject([
      {id:'note1',kind:'problem',origin:'user-stated',status:'draft'}
    ])
    expect(session.snapshot()?.session.historyRevision).toBe(1)
    // The previous prompt is marked consumed. Note addition must never
    // invoke a network request or implicitly create an accepted decision.
    expect(session.question()?.id).not.toBe(question?.id)
  })

  test('invalid notes do not advance history or consume questions', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('改善案','session1')
    const id = session.question()?.id
    expect(session.addThought('note1','', NOW)).toBe(false)
    expect(session.addThought('note1','x'.repeat(4097), NOW)).toBe(false)
    expect(session.snapshot()?.session.historyRevision).toBe(0)
    expect(session.question()?.id).toBe(id)
    expect(session.addThought('note1','仮説', NOW)).toBe(true)
    expect(session.addThought('note1','重複ノード', NOW)).toBe(false)
    expect(session.snapshot()?.nodes).toHaveLength(1)
  })

  test('phase transitions change the semantic kind of newly recorded thoughts', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('改善案','session1')
    expect(session.movePhase('backward')).toBe(false)
    expect(session.movePhase('forward')).toBe(true) // define
    expect(session.movePhase('forward')).toBe(true) // diverge
    expect(session.addThought('idea1','APIで回答漏れを検出',NOW)).toBe(true)
    expect(session.snapshot()?.nodes[0]?.kind).toBe('idea')
    expect(session.snapshot()?.session.phase).toBe('diverge')
    expect(BRAINSTORM_PHASE_LABELS.diverge).toContain('アイデア')
  })

  test('skipping questions preserves graph revision and then exhausts phase prompts', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('改善案','session1')
    const prompts = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const current = session.question()
      expect(current).not.toBeNull()
      prompts.add(current!.id)
      expect(session.skipQuestion()).toBe(true)
    }
    expect(prompts.size).toBe(3)
    expect(session.question()).toBeNull()
    expect(session.skipQuestion()).toBe(false)
    expect(session.snapshot()?.session.historyRevision).toBe(0)
  })

  test('manual export round-trips as a strict V1 snapshot', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('日本語分析','session1')
    session.addThought('thought1','質問を抽出したい',NOW)
    const json = session.exportSnapshot()
    expect(json).not.toBeNull()
    const parsed = parseBrainstormSnapshot(JSON.parse(json!))
    expect(parsed.status).toBe('valid')
    if (parsed.status === 'valid') {
      expect(parsed.snapshot.nodes[0]?.text).toBe('質問を抽出したい')
    }
  })

  test('workspace switch and clearing drop notes and consumed history', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('秘密のテーマ','session1')
    session.addThought('thought1','一時的な内容',NOW)
    session.skipQuestion()
    expect(session.bindWorkspace('workspace1')).toBe(false)
    expect(session.snapshot()?.nodes).toHaveLength(1)
    expect(session.bindWorkspace('workspace2')).toBe(true)
    expect(session.snapshot()).toBeNull()
    expect(session.exportSnapshot()).toBeNull()
    expect(session.question()).toBeNull()
    expect(session.start('別の話題','session2')).toBe(true)
    expect(session.snapshot()?.session.workspaceId).toBe('workspace2')
    expect(session.snapshot()?.nodes).toEqual([])
    expect(session.question()?.id).toBe('discover:affected-person:session')
    session.clear()
    expect(session.snapshot()).toBeNull()
    expect(session.start('改めて開始','session3')).toBe(true)
  })

  test('private session does not persist content implicitly', () => {
    // The memory controller intentionally has no repository/StoragePort.
    // A fresh controller (simulating a page reload) knows nothing of the old graph.
    const first = new BrainstormMemorySession()
    first.bindWorkspace('workspace1')
    first.start('秘密の検討','session1')
    first.addThought('thought1','送信されない情報',NOW)
    const afterReload = new BrainstormMemorySession()
    afterReload.bindWorkspace('workspace1')
    expect(afterReload.snapshot()).toBeNull()
  })
})
