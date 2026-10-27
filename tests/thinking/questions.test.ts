import { describe, expect, test } from 'vitest'
import type {
  BrainstormPhase, BrainstormSnapshotV1, ThoughtNodeV1
} from '../../src/core/thinking/contracts'
import { suggestBrainstormQuestions } from '../../src/core/thinking/questions'

function node(id: string, kind: ThoughtNodeV1['kind'], text: string, status: ThoughtNodeV1['status'] = 'draft'): ThoughtNodeV1 {
  return {
    id, kind, text, status, origin:'user-stated',
    sourceSpans:[], createdAt:'2026-10-27T00:00:00Z', updatedAt:'2026-10-27T00:00:00Z'
  }
}

function graph(phase: BrainstormPhase = 'discover'): BrainstormSnapshotV1 {
  return {
    schemaVersion:1,
    session:{
      id:'session1', workspaceId:'workspace1', theme:'問い合わせ回答を改善する',
      goal:null, constraints:[], phase, historyRevision:0
    },
    nodes:[], edges:[]
  }
}

describe('deterministic one-person brainstorming questions', () => {
  test('guides an empty session without any model or prior notes', () => {
    const result = suggestBrainstormQuestions(graph())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.suggestions).toHaveLength(3)
    expect(result.suggestions[0]?.id).toBe('discover:affected-person:session')
    expect(result.suggestions[0]?.question).toContain('問い合わせ回答を改善する')
    expect(result.suggestions[0]?.focusNodeId).toBeNull()
    expect(result.suggestions.every(s => s.generatedBy === 'builtin-template-v1')).toBe(true)
  })

  test.each([
    ['discover','problem-framing'], ['define','problem-framing'],
    ['diverge','scamper'], ['challenge','premortem'],
    ['evaluate','alternative-check'], ['decide','decision-check'],
    ['act','action-planning']
  ] as const)('selects %s phase strategy: %s', (phase, strategy) => {
    const result = suggestBrainstormQuestions(graph(phase))
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.suggestions[0]?.phase).toBe(phase)
    expect(result.suggestions[0]?.strategy).toBe(strategy)
  })

  test('selects the latest preferred active node, never an archived/rejected one', () => {
    const g: BrainstormSnapshotV1 = {
      ...graph('diverge'),
      nodes: [
        node('problem1','problem','課題'),
        node('idea1','idea','古い案'),
        node('idea2','idea','利用中の案'),
        node('idea3','idea','没案','rejected'),
        node('idea4','idea','アーカイブ','archived')
      ]
    }
    const result = suggestBrainstormQuestions(g,[],1)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.suggestions[0]?.focusNodeId).toBe('idea2')
    expect(result.suggestions[0]?.question).toContain('利用中の案')
    expect(result.suggestions[0]?.question).not.toContain('没案')
  })

  test('uses the session theme when all nodes are archived', () => {
    const g: BrainstormSnapshotV1 = {
      ...graph('challenge'),
      nodes:[node('idea1','idea','古い案','archived')]
    }
    const result = suggestBrainstormQuestions(g)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.suggestions[0]?.focusNodeId).toBeNull()
    expect(result.suggestions[0]?.question).toContain(g.session.theme)
  })

  test('consumed suggestion IDs prevent duplicates and preserve remaining order', () => {
    const g = graph('challenge')
    const initial = suggestBrainstormQuestions(g)
    expect(initial.status).toBe('ready')
    if (initial.status !== 'ready') return
    const ids = initial.suggestions.map(s => s.id)
    const next = suggestBrainstormQuestions(g,[ids[0]!],2)
    expect(next.status).toBe('ready')
    if (next.status !== 'ready') return
    expect(next.suggestions.map(s => s.id)).toEqual(ids.slice(1))
    const exhausted = suggestBrainstormQuestions(g,ids)
    expect(exhausted).toEqual({status:'ready',suggestions:[]})
  })

  test('bounded focus text never splits a surrogate pair', () => {
    const content = '😀'.repeat(120)
    const g: BrainstormSnapshotV1 = {...graph('evaluate'), nodes:[node('idea1','idea',content)]}
    const result = suggestBrainstormQuestions(g, [], 1)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const q = result.suggestions[0]!.question
    expect(q).toContain('😀'.repeat(80)+'…')
    expect(q).not.toContain('😀'.repeat(81))
    expect([...q].some(c => /[\uD800-\uDFFF]/u.test(c))).toBe(false)
  })

  test('rejects invalid import or unbounded consumed history rather than generating output', () => {
    expect(suggestBrainstormQuestions(null))
      .toEqual({status:'skipped',reason:'invalid-snapshot'})
    expect(suggestBrainstormQuestions(graph(),['x'.repeat(257)]))
      .toEqual({status:'skipped',reason:'invalid-options'})
    expect(suggestBrainstormQuestions(graph(),new Array(1025).fill('x')))
      .toEqual({status:'skipped',reason:'invalid-options'})
    expect(suggestBrainstormQuestions(graph(),[],4))
      .toEqual({status:'skipped',reason:'invalid-options'})
  })

  test('returns frozen snapshots and does not mutate input', () => {
    const g = graph()
    const original = JSON.stringify(g)
    const a = suggestBrainstormQuestions(g)
    const b = suggestBrainstormQuestions(g)
    expect(a).toEqual(b)
    expect(JSON.stringify(g)).toBe(original)
    if (a.status !== 'ready') return
    expect(Object.isFrozen(a.suggestions)).toBe(true)
    expect(Object.isFrozen(a.suggestions[0])).toBe(true)
  })
})
