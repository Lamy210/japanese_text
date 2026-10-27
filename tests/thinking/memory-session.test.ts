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
      {id:'question-note1',kind:'question',origin:'rule-derived',status:'draft'},
      {id:'note1',kind:'problem',origin:'user-stated',status:'draft'}
    ])
    expect(session.snapshot()?.edges).toMatchObject([{
      id:'answer-note1', fromNodeId:'note1', toNodeId:'question-note1', relation:'answers'
    }])
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
    expect(session.snapshot()?.nodes).toHaveLength(2)
    expect(session.snapshot()?.edges).toHaveLength(1)
  })

  test('phase transitions change the semantic kind of newly recorded thoughts', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('改善案','session1')
    expect(session.movePhase('backward')).toBe(false)
    expect(session.movePhase('forward')).toBe(true) // define
    expect(session.movePhase('forward')).toBe(true) // diverge
    expect(session.addThought('idea1','APIで回答漏れを検出',NOW)).toBe(true)
    expect(session.snapshot()?.nodes.find(n => n.id === 'idea1')?.kind).toBe('idea')
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

  test('records question-answer pair atomically and rejects duplicate answer IDs', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('改善案', 'session1')
    expect(session.addThought('reply1', '答え1', NOW)).toBe(true)
    const before = session.snapshot()!
    expect(before.nodes).toHaveLength(2)
    expect(before.edges).toHaveLength(1)
    expect(session.addThought('reply1', '答えを上書きしようとする', NOW)).toBe(false)
    expect(session.snapshot()).toEqual(before)
    expect(session.snapshot()?.session.historyRevision).toBe(1)
    expect(session.snapshot()?.edges[0]).toMatchObject({
      fromNodeId:'reply1', toNodeId:'question-reply1', relation:'answers'
    })
  })

  test('records a free note without a fabricated question once prompts are exhausted', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('改善案', 'session1')
    for (let i = 0; i < 3; i++) expect(session.skipQuestion()).toBe(true)
    expect(session.question()).toBeNull()
    expect(session.addThought('free1','自由なアイデア', NOW)).toBe(true)
    expect(session.snapshot()?.nodes).toMatchObject([{id:'free1',kind:'problem'}])
    expect(session.snapshot()?.edges).toEqual([])
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
      expect(parsed.snapshot.nodes.find(n => n.id === 'thought1')?.text).toBe('質問を抽出したい')
      expect(parsed.snapshot.edges).toHaveLength(1)
    }
  })

  test('restores a valid export only to the same workspace', () => {
    const first = new BrainstormMemorySession()
    first.bindWorkspace('workspace1')
    first.start('安全な復元', 'session1')
    expect(first.addThought('thought1', '検証項目', NOW)).toBe(true)
    const file = JSON.parse(first.exportSnapshot()!) as unknown
    const restored = new BrainstormMemorySession()
    restored.bindWorkspace('workspace1')
    expect(restored.importSnapshot(file)).toBe('imported')
    expect(restored.snapshot()).toEqual(first.snapshot())
    expect(restored.snapshot()?.edges[0]?.relation).toBe('answers')
    expect(restored.addThought('thought2', '復元後の追加', NOW)).toBe(true)
    expect(restored.snapshot()?.session.historyRevision).toBe(2)
  })

  test('rejects imports from other workspaces even when the current workspace is empty', () => {
    const source = new BrainstormMemorySession()
    source.bindWorkspace('workspace1')
    source.start('他のワークスペースの秘密', 'session1')
    const destination = new BrainstormMemorySession()
    destination.bindWorkspace('workspace2')
    expect(destination.importSnapshot(JSON.parse(source.exportSnapshot()!))).toBe('wrong-workspace')
    expect(destination.snapshot()).toBeNull()
    expect(destination.bindWorkspace('workspace1')).toBe(true)
    expect(destination.importSnapshot(JSON.parse(source.exportSnapshot()!))).toBe('imported')
  })

  test('corrupt and unknown-version imports preserve the current graph and prompt history', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('既存のアイデア', 'session1')
    const firstQuestion = session.question()!
    expect(session.skipQuestion()).toBe(true)
    const before = session.snapshot()
    const next = session.question()?.id

    expect(session.importSnapshot(null)).toBe('invalid-snapshot')
    expect(session.importSnapshot({schemaVersion:2})).toBe('invalid-snapshot')
    expect(session.importSnapshot({...before, edges:[{id:'bad'}]})).toBe('invalid-snapshot')
    expect(session.snapshot()).toEqual(before)
    expect(session.question()?.id).toBe(next)
    expect(session.question()?.id).not.toBe(firstQuestion.id)
  })

  test('import isolation: mutating caller JSON does not mutate a restored snapshot', () => {
    const source = new BrainstormMemorySession()
    source.bindWorkspace('workspace1')
    source.start('独立したコピー','session1')
    source.addThought('thought1','記録した内容',NOW)
    const raw = JSON.parse(source.exportSnapshot()!) as {
      nodes: {text:string}[]
    }
    const destination = new BrainstormMemorySession()
    destination.bindWorkspace('workspace1')
    expect(destination.importSnapshot(raw)).toBe('imported')
    raw.nodes[1]!.text = 'あとから改ざん'
    expect(destination.snapshot()?.nodes.find(n=>n.id==='thought1')?.text).toBe('記録した内容')
    expect(Object.isFrozen(destination.snapshot()?.nodes[0])).toBe(true)
  })

  test('workspace switch and clearing drop notes and consumed history', () => {
    const session = new BrainstormMemorySession()
    session.bindWorkspace('workspace1')
    session.start('秘密のテーマ','session1')
    session.addThought('thought1','一時的な内容',NOW)
    session.skipQuestion()
    expect(session.bindWorkspace('workspace1')).toBe(false)
    expect(session.snapshot()?.nodes).toHaveLength(2)
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
