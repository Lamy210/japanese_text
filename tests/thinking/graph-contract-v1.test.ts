import { describe, expect, test } from 'vitest'
import { parseBrainstormSnapshot, validateSourceSpan } from '../../src/core/thinking/validate'

function node(id: string) {
  return {
    id,
    kind: 'idea',
    text: '問い合わせの回答漏れを減らす',
    origin: 'user-stated',
    status: 'draft',
    sourceSpans: [{
      documentId: 'doc1', revision: 2, startUtf16: 0,
      endUtf16: 4, excerpt: '質問です'
    }],
    createdAt: '2026-10-27T00:00:00Z',
    updatedAt: '2026-10-27T00:00:00Z'
  }
}

function fixture() {
  return {
    schemaVersion: 1,
    session: {
      id: 'session1', workspaceId: 'workspace1',
      theme: '問い合わせ回答品質を上げる',
      goal: null,
      constraints: ['オフライン', 'ユーザー本文を送らない'],
      phase: 'discover', historyRevision: 0
    },
    nodes: [node('idea1'), node('idea2')],
    edges: [{
      id: 'edge1', fromNodeId: 'idea1', toNodeId: 'idea2',
      relation: 'supports', origin: 'user-stated'
    }]
  }
}

describe('Thought Graph V1 untrusted snapshot gate', () => {
  test('accepts a valid graph and preserves source evidence, ordering and phase', () => {
    const input = fixture()
    const result = parseBrainstormSnapshot(input)
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') return
    expect(result.snapshot.schemaVersion).toBe(1)
    expect(result.snapshot.nodes.map(n => n.id)).toEqual(['idea1', 'idea2'])
    expect(result.snapshot.edges.map(e => [e.fromNodeId, e.toNodeId])).toEqual([['idea1', 'idea2']])
    expect(result.snapshot.session.constraints).toEqual(['オフライン', 'ユーザー本文を送らない'])
    expect(result.snapshot.nodes[0]?.sourceSpans[0]?.excerpt).toBe('質問です')
  })

  test('owns immutable copies so mutations of the caller cannot change accepted data', () => {
    const input = fixture()
    const result = parseBrainstormSnapshot(input)
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') return
    input.nodes[0]!.text = 'あとから書き換え'
    input.session.constraints[0] = '送信を許可'
    input.edges[0]!.toNodeId = 'not-existent'
    expect(result.snapshot.nodes[0]?.text).toBe('問い合わせの回答漏れを減らす')
    expect(result.snapshot.session.constraints[0]).toBe('オフライン')
    expect(result.snapshot.edges[0]?.toNodeId).toBe('idea2')
    expect(Object.isFrozen(result.snapshot.nodes[0])).toBe(true)
    expect(Object.isFrozen(result.snapshot.nodes[0]?.sourceSpans[0])).toBe(true)
  })

  test('rejects invalid and future schema shapes rather than silently migrating', () => {
    expect(parseBrainstormSnapshot(null)).toEqual({status: 'invalid', reason: 'shape'})
    const a = fixture()
    a.schemaVersion = 2
    expect(parseBrainstormSnapshot(a)).toEqual({status: 'invalid', reason: 'schema-version'})
    const b = {...fixture(), unexpected: 'payload'}
    expect(parseBrainstormSnapshot(b)).toEqual({status: 'invalid', reason: 'shape'})
  })

  test('rejects duplicate node IDs and cross-type edge ID collisions', () => {
    const a = fixture()
    a.nodes[1]!.id = 'idea1'
    expect(parseBrainstormSnapshot(a)).toEqual({status: 'invalid', reason: 'duplicate-id'})
    const b = fixture()
    b.edges[0]!.id = 'idea1'
    expect(parseBrainstormSnapshot(b)).toEqual({status: 'invalid', reason: 'duplicate-id'})
  })

  test('rejects missing edge endpoints, self-links and duplicate relations', () => {
    const a = fixture()
    a.edges[0]!.toNodeId = 'missing'
    expect(parseBrainstormSnapshot(a)).toEqual({status: 'invalid', reason: 'dangling-edge'})
    const b = fixture()
    b.edges[0]!.toNodeId = 'idea1'
    expect(parseBrainstormSnapshot(b)).toEqual({status: 'invalid', reason: 'edge'})
    const c = fixture()
    c.edges.push({...c.edges[0]!, id: 'edge2'})
    expect(parseBrainstormSnapshot(c)).toEqual({status: 'invalid', reason: 'duplicate-edge'})
  })

  test('rejects unreviewed model proposals being silently marked accepted', () => {
    const a = fixture()
    a.nodes[0]!.origin = 'model-suggested'
    a.nodes[0]!.status = 'accepted'
    expect(parseBrainstormSnapshot(a)).toEqual({status: 'invalid', reason: 'provenance'})
    a.nodes[0]!.status = 'draft'
    expect(parseBrainstormSnapshot(a).status).toBe('valid')
  })

  test('rejects invalid node classification and timestamp ordering', () => {
    const a = fixture()
    a.nodes[0]!.kind = 'unknown-node-type'
    expect(parseBrainstormSnapshot(a)).toEqual({status: 'invalid', reason: 'node'})
    const b = fixture()
    b.nodes[0]!.updatedAt = '2026-10-26T00:00:00Z'
    expect(parseBrainstormSnapshot(b)).toEqual({status: 'invalid', reason: 'node'})
  })

  test('rejects malformed source geometries and extra fields', () => {
    const a = fixture()
    a.nodes[0]!.sourceSpans[0]!.endUtf16 = 3
    expect(parseBrainstormSnapshot(a)).toEqual({status: 'invalid', reason: 'source-span'})
    const b = fixture()
    ;(b.nodes[0] as Record<string, unknown>).customHtml = '<script>bad()</script>'
    expect(parseBrainstormSnapshot(b)).toEqual({status: 'invalid', reason: 'node'})
  })

  test('rejects oversized snapshots before traversing their nodes', () => {
    const a = fixture()
    a.nodes = Array.from({length: 1001}, (_, i) => node('idea' + i))
    expect(parseBrainstormSnapshot(a)).toEqual({status: 'invalid', reason: 'limits'})
  })

  test('does not prematurely outlaw cycles: warnings belong to a later graph analyzer', () => {
    const a = fixture()
    a.edges[0]!.relation = 'depends-on'
    a.edges.push({
      id: 'edge2', fromNodeId: 'idea2', toNodeId: 'idea1',
      relation: 'depends-on', origin: 'user-stated'
    })
    expect(parseBrainstormSnapshot(a).status).toBe('valid')
  })
})

describe('SourceSpan original document evidence', () => {
  const document = {documentId: 'doc1', revision: 2, text: 'a😀b'}

  test('accepts exact UTF-16 emoji geometry with current revision', () => {
    expect(validateSourceSpan({
      documentId: 'doc1', revision: 2, startUtf16: 1,
      endUtf16: 3, excerpt: '😀'
    }, document)).toBe('current')
  })

  test('rejects a span that cuts a UTF-16 surrogate pair', () => {
    expect(validateSourceSpan({
      documentId: 'doc1', revision: 2, startUtf16: 2,
      endUtf16: 3, excerpt: '\ude00'
    }, document)).toBe('invalid')
  })

  test('reports stale references after revision change or content mismatch', () => {
    const span = {documentId: 'doc1', revision: 2, startUtf16: 1, endUtf16: 3, excerpt: '😀'}
    expect(validateSourceSpan(span, {...document, revision: 3})).toBe('stale')
    expect(validateSourceSpan(span, {...document, text: 'a🌸b'})).toBe('stale')
  })

  test('rejects negative and nonintegral offsets', () => {
    expect(validateSourceSpan({
      documentId: 'doc1', revision: 2, startUtf16: -1,
      endUtf16: 1, excerpt: 'a'
    }, document)).toBe('invalid')
    expect(validateSourceSpan({
      documentId: 'doc1', revision: 2, startUtf16: 1.5,
      endUtf16: 3.5, excerpt: '😀'
    }, document)).toBe('invalid')
  })
})
