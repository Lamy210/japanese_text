import { describe, expect, test } from 'vitest'
import {
  NlpSessionCoordinator,
  type NlpSnapshotIdentity
} from '../../src/core/nlp/session-coordinator'

const sha = 'a'.repeat(64)
function snapshot(changes: Partial<NlpSnapshotIdentity> = {}): NlpSnapshotIdentity {
  return {
    documentRevision: 7,
    workspaceId: 'workspace-1',
    documentId: 'document-1',
    profileId: 'profile-1',
    documentType: 'markdown',
    providerId: 'lindera-ipadic',
    dictionarySha256: sha,
    contentNonce: 'editor-generation-7',
    sourceUtf16Length: 18,
    ...changes
  }
}

function fixture() {
  let live: NlpSnapshotIdentity = snapshot()
  const isCurrent = (input: NlpSnapshotIdentity) =>
    Object.keys(live).every(key =>
      input[key as keyof NlpSnapshotIdentity] === live[key as keyof NlpSnapshotIdentity]
    )
  const coordinator = new NlpSessionCoordinator<readonly string[]>(isCurrent)
  const setLive = (next: NlpSnapshotIdentity) => { live = next }
  const start = () => {
    const result = coordinator.begin(live)
    expect(result.status).toBe('started')
    if (result.status !== 'started') throw new Error('Expected a started NLP run')
    return result
  }
  return { coordinator, setLive, start }
}

describe('AP-10 NLP snapshot-bound lifecycle', () => {
  test('one success terminal consumes the request; duplicate replies are ignored', () => {
    const { coordinator, start } = fixture()
    const { identity } = start()
    const value = Object.freeze(['猫', 'です'])
    const first = coordinator.deliver({ type: 'result', identity, value })
    expect(first).toEqual({
      status: 'accepted',
      terminal: { status: 'completed', identity, value }
    })
    expect(coordinator.activeRun).toBeNull()
    expect(coordinator.deliver({ type: 'result', identity, value }))
      .toEqual({ status: 'ignored', reason: 'no-active-request' })
    expect(coordinator.timeout(identity)).toBeNull()
    expect(coordinator.cancel(identity)).toBeNull()
  })

  test('a new request supersedes the prior request exactly once', () => {
    const { coordinator, start } = fixture()
    const first = start()
    const second = start()
    expect(second.identity.requestId).toBe(first.identity.requestId + 1)
    expect(second.superseded).toEqual({
      status: 'skipped', identity: first.identity, reason: 'superseded'
    })
    expect(coordinator.deliver({ type: 'result', identity: first.identity, value: ['stale'] }))
      .toEqual({ status: 'ignored', reason: 'stale-request' })
    expect(coordinator.activeRun).toEqual(second.identity)
    expect(coordinator.deliver({ type: 'result', identity: second.identity, value: ['fresh'] }))
      .toMatchObject({ status: 'accepted', terminal: { status: 'completed', value: ['fresh'] } })
  })

  test('stale Profile, document, or asset identity cannot publish old provider output', () => {
    for (const change of [
      { profileId: 'profile-2' },
      { documentId: 'document-2' },
      { workspaceId: 'workspace-2' },
      { dictionarySha256: 'b'.repeat(64) },
      { providerId: 'kuromojin-ipadic' as const },
      { documentRevision: 8 },
      { contentNonce: 'editor-generation-8' },
      { sourceUtf16Length: 19 }
    ]) {
      const { coordinator, start, setLive } = fixture()
      const { identity } = start()
      setLive(snapshot(change))
      const received = coordinator.deliver({ type: 'result', identity, value: ['old'] })
      expect(received).toEqual({
        status: 'accepted',
        terminal: { status: 'skipped', identity, reason: 'snapshot-stale' }
      })
      expect(coordinator.deliver({ type: 'result', identity, value: [] }))
        .toEqual({ status: 'ignored', reason: 'no-active-request' })
    }
  })

  test('cannot start a stale scheduling attempt or supersede the current run with it', () => {
    const { coordinator, start, setLive } = fixture()
    const active = start()
    setLive(snapshot({ documentRevision: 8, contentNonce: 'generation-8' }))
    expect(coordinator.begin(snapshot())).toEqual({ status: 'rejected', reason: 'snapshot-stale' })
    expect(coordinator.activeRun).toEqual(active.identity)
    const next = coordinator.begin(snapshot({ documentRevision: 8, contentNonce: 'generation-8' }))
    expect(next.status).toBe('started')
    if (next.status === 'started') expect(next.superseded).toEqual({
      status: 'skipped', identity: active.identity, reason: 'superseded'
    })
  })

  test('a mismatched echoed snapshot does not consume the real active request', () => {
    const { coordinator, start } = fixture()
    const { identity } = start()
    const forged = { ...identity, snapshot: { ...identity.snapshot, providerId: 'kuromojin-ipadic' as const } }
    expect(coordinator.deliver({ type: 'result', identity: forged, value: ['forged'] }))
      .toEqual({ status: 'ignored', reason: 'identity-mismatch' })
    const wrongEpoch = { ...identity, workerEpoch: identity.workerEpoch + 1 }
    expect(coordinator.deliver({ type: 'result', identity: wrongEpoch, value: [] }))
      .toEqual({ status: 'ignored', reason: 'stale-request' })
    expect(coordinator.activeRun).toEqual(identity)
    expect(coordinator.deliver({ type: 'error', identity }))
      .toEqual({ status: 'accepted', terminal: { status: 'failed', identity, reason: 'provider-error' } })
  })

  test('explicit timeout and cancellation are terminal, never a successful empty token batch', () => {
    const { coordinator, start } = fixture()
    const first = start()
    expect(coordinator.timeout(first.identity)).toEqual({
      status: 'failed', identity: first.identity, reason: 'timeout'
    })
    expect(coordinator.deliver({ type: 'result', identity: first.identity, value: [] }))
      .toEqual({ status: 'ignored', reason: 'no-active-request' })
    const second = start()
    expect(coordinator.cancel(second.identity)).toEqual({
      status: 'skipped', identity: second.identity, reason: 'cancelled'
    })
    expect(coordinator.cancel(second.identity)).toBeNull()
  })

  test('Worker restart increments epoch, invalidates active and rejects late old replies', () => {
    const { coordinator, start } = fixture()
    const first = start()
    expect(coordinator.workerEpoch).toBe(0)
    expect(coordinator.restartWorker()).toEqual({
      status: 'skipped', identity: first.identity, reason: 'worker-restarted'
    })
    expect(coordinator.workerEpoch).toBe(1)
    const second = start()
    expect(second.identity.workerEpoch).toBe(1)
    expect(second.identity.requestId).toBeGreaterThan(first.identity.requestId)
    expect(coordinator.deliver({ type: 'result', identity: first.identity, value: ['old'] }))
      .toEqual({ status: 'ignored', reason: 'stale-request' })
    expect(coordinator.deliver({ type: 'result', identity: second.identity, value: ['new'] }))
      .toMatchObject({ status: 'accepted', terminal: { status: 'completed' } })
    expect(coordinator.restartWorker()).toBeNull()
    expect(coordinator.workerEpoch).toBe(2)
  })

  test('snapshot inputs are copied and frozen before sending to a Worker', () => {
    const { coordinator } = fixture()
    const supplied = snapshot() as { -readonly [K in keyof NlpSnapshotIdentity]: NlpSnapshotIdentity[K] }
    const started = coordinator.begin(supplied)
    expect(started.status).toBe('started')
    if (started.status !== 'started') return
    expect(started.identity.snapshot).not.toBe(supplied)
    expect(Object.isFrozen(started.identity.snapshot)).toBe(true)
    expect(Object.isFrozen(started.identity)).toBe(true)
    supplied.contentNonce = 'modified-after-queueing'
    expect(started.identity.snapshot.contentNonce).toBe('editor-generation-7')
  })

  test('rejects invalid UTF-16 revision and unverified dictionary identity', () => {
    const { coordinator } = fixture()
    for (const value of [
      { documentRevision: -1 },
      { documentRevision: Number.NaN },
      { documentRevision: Number.MAX_SAFE_INTEGER + 1 },
      { sourceUtf16Length: 0 },
      { sourceUtf16Length: Number.POSITIVE_INFINITY },
      { dictionarySha256: 'short' },
      { dictionarySha256: 'B'.repeat(64) },
      { contentNonce: '' },
      { contentNonce: 'contains private text' },
      { documentType: 'html' as 'markdown' }
    ]) {
      expect(() => coordinator.begin(snapshot(value))).toThrow('Invalid NLP snapshot')
    }
    expect(coordinator.activeRun).toBeNull()
  })

  test('snapshot freshness failures are fail-closed even if caller throws', () => {
    const coordinator = new NlpSessionCoordinator(() => { throw new Error('context closed') })
    expect(coordinator.begin(snapshot())).toEqual({ status: 'rejected', reason: 'snapshot-stale' })
    expect(coordinator.activeRun).toBeNull()
  })
})
