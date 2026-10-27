import { describe, expect, test } from 'vitest'
import type { BrainstormSnapshotV1, ThoughtNodeV1 } from '../../src/core/thinking/contracts'
import { applyBrainstormCommand } from '../../src/core/thinking/reducer'

const START = '2026-10-27T00:00:00Z'
const LATER = '2026-10-27T00:01:00Z'
const LAST = '2026-10-27T00:02:00Z'

function node(id: string, origin: ThoughtNodeV1['origin'] = 'user-stated'): ThoughtNodeV1 {
  return {
    id, kind: 'idea', text: '質問文の構造化',
    origin, status: 'draft', createdAt: START, updatedAt: START,
    sourceSpans: [{
      documentId: 'doc1', revision: 0,
      startUtf16: 0, endUtf16: 2, excerpt: '質問'
    }]
  }
}

function graph(): BrainstormSnapshotV1 {
  return {
    schemaVersion: 1,
    session: {
      id: 'session1', workspaceId: 'workspace1',
      theme: '問い合わせ回答の改善',
      goal: null, constraints: ['オフライン'],
      phase: 'discover', historyRevision: 0
    },
    nodes: [node('idea1')],
    edges: []
  }
}

describe('Thought Graph transactional reducer', () => {
  test('adds nodes and edges with deterministic, immutable snapshots', () => {
    const input = graph()
    const inserted = applyBrainstormCommand(input, {
      type: 'add-node', expectedRevision: 0, node: node('idea2')
    })
    expect(inserted.status).toBe('applied')
    if (inserted.status !== 'applied') return
    const connected = applyBrainstormCommand(inserted.snapshot, {
      type: 'add-edge', expectedRevision: 1,
      edge: { id: 'edge1', fromNodeId: 'idea1', toNodeId: 'idea2',
        relation: 'supports', origin: 'user-stated' }
    })
    expect(connected.status).toBe('applied')
    if (connected.status !== 'applied') return
    expect(connected.snapshot.nodes.map(n => n.id)).toEqual(['idea1', 'idea2'])
    expect(connected.snapshot.edges).toHaveLength(1)
    expect(connected.snapshot.session.historyRevision).toBe(2)
    expect(input.nodes).toHaveLength(1)
    expect(input.edges).toHaveLength(0)
    expect(Object.isFrozen(connected.snapshot.edges[0])).toBe(true)
  })

  test('rejects stale replays and does not apply a command twice', () => {
    const command = {type:'add-node', expectedRevision:0, node:node('idea2')}
    const once = applyBrainstormCommand(graph(), command)
    expect(once.status).toBe('applied')
    if (once.status !== 'applied') return
    const twice = applyBrainstormCommand(once.snapshot, command)
    expect(twice).toEqual({status:'rejected', reason:'revision-conflict'})
    expect(once.snapshot.nodes).toHaveLength(2)
  })

  test('invalid or duplicate edges are rejected atomically', () => {
    const input = graph()
    const dangling = applyBrainstormCommand(input, {
      type:'add-edge', expectedRevision:0,
      edge:{id:'edge1', fromNodeId:'idea1', toNodeId:'missing', relation:'supports', origin:'user-stated'}
    })
    expect(dangling).toMatchObject({
      status:'rejected', reason:'invalid-command', detail:'dangling-edge'
    })
    expect(input.session.historyRevision).toBe(0)
    expect(input.edges).toEqual([])
    const duplicate = applyBrainstormCommand(input, {
      type:'add-node', expectedRevision:0, node:node('idea1')
    })
    expect(duplicate).toMatchObject({
      status:'rejected', reason:'invalid-command', detail:'duplicate-id'
    })
  })

  test('removes a node and all incident edges without leaving dangling links', () => {
    const two = graph()
    const source: BrainstormSnapshotV1 = {
      ...two, nodes:[...two.nodes, node('idea2'), node('idea3')],
      edges:[
        {id:'edge1', fromNodeId:'idea1', toNodeId:'idea2', relation:'supports', origin:'user-stated'},
        {id:'edge2', fromNodeId:'idea2', toNodeId:'idea3', relation:'challenges', origin:'user-stated'},
        {id:'edge3', fromNodeId:'idea1', toNodeId:'idea3', relation:'derived-from', origin:'user-stated'}
      ]
    }
    const removed = applyBrainstormCommand(source, {
      type:'remove-node', expectedRevision:0, nodeId:'idea2'
    })
    expect(removed.status).toBe('applied')
    if (removed.status !== 'applied') return
    expect(removed.snapshot.nodes.map(n => n.id)).toEqual(['idea1','idea3'])
    expect(removed.snapshot.edges.map(e => e.id)).toEqual(['edge3'])
    expect(source.edges).toHaveLength(3)
  })

  test('edits invalidate old approvals and source evidence instead of laundering provenance', () => {
    const accepted: BrainstormSnapshotV1 = {
      ...graph(),
      nodes:[{...node('idea1'), status:'accepted', updatedAt:LATER}]
    }
    const edited = applyBrainstormCommand(accepted, {
      type:'edit-node', expectedRevision:0, nodeId:'idea1',
      text:'別の方向へ書き直す', updatedAt:LAST
    })
    expect(edited.status).toBe('applied')
    if (edited.status !== 'applied') return
    expect(edited.snapshot.nodes[0]).toMatchObject({
      text:'別の方向へ書き直す', status:'draft', sourceSpans:[]
    })
    expect(accepted.nodes[0]?.status).toBe('accepted')
    expect(accepted.nodes[0]?.sourceSpans).toHaveLength(1)
  })

  test('rejects older timestamps, invalid edits and no-op timestamp-only changes', () => {
    const invalid = applyBrainstormCommand(graph(), {
      type:'edit-node', expectedRevision:0, nodeId:'idea1',
      text:'変更', updatedAt:START
    })
    expect(invalid).toEqual({status:'rejected', reason:'invalid-transition'})
    const noop = applyBrainstormCommand(graph(), {
      type:'edit-node', expectedRevision:0, nodeId:'idea1',
      text:'質問文の構造化', updatedAt:LATER
    })
    expect(noop.status).toBe('unchanged')
    if (noop.status === 'unchanged') expect(noop.snapshot.session.historyRevision).toBe(0)
    const empty = applyBrainstormCommand(graph(), {
      type:'edit-node', expectedRevision:0, nodeId:'idea1',
      text:'', updatedAt:LATER
    })
    expect(empty).toMatchObject({status:'rejected', reason:'invalid-command', detail:'node'})
  })

  test('enforces review-before-accept and model-only draft provenance', () => {
    const direct = applyBrainstormCommand(graph(), {
      type:'review-node', expectedRevision:0, nodeId:'idea1',
      status:'accepted', updatedAt:LATER
    })
    expect(direct).toEqual({status:'rejected', reason:'invalid-transition'})

    const reviewed = applyBrainstormCommand(graph(), {
      type:'review-node', expectedRevision:0, nodeId:'idea1',
      status:'reviewed', updatedAt:LATER
    })
    expect(reviewed.status).toBe('applied')
    if (reviewed.status !== 'applied') return
    const accepted = applyBrainstormCommand(reviewed.snapshot, {
      type:'review-node', expectedRevision:1, nodeId:'idea1',
      status:'accepted', updatedAt:LAST
    })
    expect(accepted.status).toBe('applied')
    if (accepted.status === 'applied') {
      expect(accepted.snapshot.nodes[0]?.status).toBe('accepted')
    }

    const model: BrainstormSnapshotV1 = {...graph(), nodes:[node('idea1', 'model-suggested')]}
    expect(applyBrainstormCommand(model, {
      type:'review-node', expectedRevision:0, nodeId:'idea1',
      status:'reviewed', updatedAt:LATER
    })).toEqual({status:'rejected', reason:'invalid-transition'})
  })

  test('phase movement is reversible and limited to adjacent phases', () => {
    const input = graph()
    const atBeginning = applyBrainstormCommand(input, {
      type:'move-phase', expectedRevision:0, direction:'backward'
    })
    expect(atBeginning.status).toBe('unchanged')
    const next = applyBrainstormCommand(input, {
      type:'move-phase', expectedRevision:0, direction:'forward'
    })
    expect(next.status).toBe('applied')
    if (next.status !== 'applied') return
    expect(next.snapshot.session.phase).toBe('define')
    const back = applyBrainstormCommand(next.snapshot, {
      type:'move-phase', expectedRevision:1, direction:'backward'
    })
    expect(back.status).toBe('applied')
    if (back.status === 'applied') expect(back.snapshot.session.phase).toBe('discover')
    const atEnd: BrainstormSnapshotV1 = {
      ...input, session:{...input.session, phase:'act'}
    }
    expect(applyBrainstormCommand(atEnd, {
      type:'move-phase', expectedRevision:0, direction:'forward'
    }).status).toBe('unchanged')
  })

  test('rejects malformed commands and invalid snapshots without mutation', () => {
    const input = graph()
    const before = JSON.stringify(input)
    expect(applyBrainstormCommand(input, {type:'move-phase', expectedRevision:0,
      direction:'forward', injected:true}))
      .toEqual({status:'rejected', reason:'invalid-command'})
    expect(applyBrainstormCommand(input, {type:'remove-node', expectedRevision:0, nodeId:'missing'}))
      .toEqual({status:'rejected', reason:'not-found'})
    expect(applyBrainstormCommand({...input, schemaVersion:2}, {
      type:'move-phase', expectedRevision:0, direction:'forward'
    })).toEqual({status:'rejected', reason:'invalid-snapshot', detail:'schema-version'})
    expect(JSON.stringify(input)).toBe(before)
  })

  test('rejects history revision overflow', () => {
    const input = graph()
    const near = {...input, session:{...input.session,historyRevision:Number.MAX_SAFE_INTEGER}}
    expect(applyBrainstormCommand(near, {
      type:'move-phase',expectedRevision:Number.MAX_SAFE_INTEGER,direction:'forward'
    })).toEqual({status:'rejected',reason:'revision-limit'})
  })
})
