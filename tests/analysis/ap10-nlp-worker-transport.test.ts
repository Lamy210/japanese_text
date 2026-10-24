import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NlpWorkerClient } from '../../src/core/nlp/worker-client'
import { extractProseRegions } from '../../src/core/nlp/prose-regions'
import type { MorphToken } from '../../src/core/nlp/types'
import type { NlpSnapshotIdentity, NlpRunIdentity } from '../../src/core/nlp/session-coordinator'
import type { NlpAnalyzeRequest, NlpWorkerResponse, NlpRegionTokens } from '../../src/core/nlp/worker-protocol'
import { validateNlpWorkerBatch } from '../../src/core/nlp/worker-protocol'

const text = '猫です。'
const sha = 'a'.repeat(64)
function snapshot(changes: Partial<NlpSnapshotIdentity> = {}): NlpSnapshotIdentity {
  return {
    documentRevision: 3, workspaceId: 'workspace-1', documentId: 'document-1',
    profileId: 'profile-1', documentType: 'text',
    providerId: 'lindera-ipadic', dictionarySha256: sha,
    contentNonce: 'generation-3', sourceUtf16Length: text.length,
    ...changes
  }
}
function token(): MorphToken {
  return {
    surface: '猫', lemma: '猫', reading: 'ネコ', pos: 'noun',
    posDetails: ['名詞'], conjugationType: null, conjugationForm: null,
    isUnknown: false, startUtf16: 0, endUtf16: 1,
    regionId: 'prose:0-4', sentenceId: 'sentence-1',
    originalFeatures: ['名詞']
  }
}
function regions(tokens: MorphToken[] = [token()]): NlpRegionTokens[] {
  return extractProseRegions(text, 'text').map(region => ({ region, tokens }))
}

class FakeWorker {
  readonly requests: NlpAnalyzeRequest[] = []
  readonly listeners = new Map<string, Set<(event: never) => void>>()
  terminated = false
  shouldThrowOnPost = false

  addEventListener(type: string, callback: (event: never) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: never) => void>()
    listeners.add(callback)
    this.listeners.set(type, listeners)
  }
  postMessage(value: NlpAnalyzeRequest): void {
    if (this.shouldThrowOnPost) throw new Error('postMessage failed')
    this.requests.push(value)
  }
  terminate(): void { this.terminated = true }

  reply(message: NlpWorkerResponse): void {
    for (const callback of this.listeners.get('message') ?? []) {
      callback({ data: message } as never)
    }
  }
  crash(): void {
    for (const callback of this.listeners.get('error') ?? []) {
      callback({ preventDefault() {} } as never)
    }
  }
}

function context(options: { timeoutMs?: number; throwOnCreate?: boolean } = {}) {
  let active = snapshot()
  const workers: FakeWorker[] = []
  const client = new NlpWorkerClient({
    isCurrent: value => Object.keys(active).every(key =>
      active[key as keyof NlpSnapshotIdentity] === value[key as keyof NlpSnapshotIdentity]
    ),
    createWorker: () => {
      if (options.throwOnCreate) throw new Error('Worker creation forbidden')
      const w = new FakeWorker()
      workers.push(w)
      return w as unknown as Worker
    },
    timeoutMs: options.timeoutMs ?? 100
  })
  return { client, workers, setCurrent(next: NlpSnapshotIdentity) { active = next } }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('AP-10 Worker transport and validation', () => {
  test('is lazy, sends unmodified text to the independent worker, accepts verified tokens once', async () => {
    const { client, workers } = context()
    expect(workers).toHaveLength(0)
    const result = client.request(snapshot(), text)
    expect(workers).toHaveLength(1)
    expect(workers[0]!.requests).toMatchObject([{ type: 'analyze', text }])
    const identity = workers[0]!.requests[0]!.identity
    workers[0]!.reply({ type: 'result', identity, regions: regions() })
    expect(await result).toMatchObject({
      status: 'completed', identity, value: [{ surface: '猫', startUtf16: 0, endUtf16: 1 }]
    })
    workers[0]!.reply({ type: 'result', identity, regions: regions() })
    expect(workers[0]!.terminated).toBe(false)
    client.dispose()
    expect(workers[0]!.terminated).toBe(true)
  })

  test('rejects invalid NLP geometry atomically even if other regions/tokens are correct', async () => {
    const { client, workers } = context()
    const result = client.request(snapshot(), text)
    const identity = workers[0]!.requests[0]!.identity
    workers[0]!.reply({ type: 'result', identity, regions: regions([
      token(), { ...token(), surface: '犬', startUtf16: 1, endUtf16: 2 }
    ]) })
    expect(await result).toEqual({ status: 'failed', identity, reason: 'invalid-payload' })
    client.dispose()
  })

  test('a missing, shifted or forged original region cannot be accepted as success', () => {
    expect(validateNlpWorkerBatch(text, 'text', [])).toEqual({
      status: 'invalid', reason: 'region-mismatch'
    })
    const original = regions()
    expect(validateNlpWorkerBatch(text, 'text', [
      { region: { ...original[0]!.region, sourceStartUtf16: 1 }, tokens: [token()] }
    ])).toEqual({ status: 'invalid', reason: 'region-mismatch' })
    expect(validateNlpWorkerBatch(text, 'text', original)).toMatchObject({
      status: 'valid', tokens: [{ surface: '猫' }]
    })
  })

  test('provider-unavailable is explicit failure, not a successful empty batch', async () => {
    const { client, workers } = context()
    const run = client.request(snapshot(), text)
    const identity = workers[0]!.requests[0]!.identity
    workers[0]!.reply({ type: 'error', identity, code: 'provider-unavailable' })
    expect(await run).toEqual({ status: 'failed', identity, reason: 'provider-error' })
    client.dispose()
  })

  test('ignores old replies after supersession, and old run gets skipped', async () => {
    const { client, workers } = context()
    const first = client.request(snapshot(), text)
    const old = workers[0]!.requests[0]!.identity
    const second = client.request(snapshot(), text)
    const next = workers[0]!.requests[1]!.identity
    expect(await first).toEqual({ status: 'skipped', identity: old, reason: 'superseded' })
    workers[0]!.reply({ type: 'result', identity: old, regions: regions() })
    workers[0]!.reply({ type: 'result', identity: next, regions: regions() })
    expect(await second).toMatchObject({ status: 'completed', identity: next })
    client.dispose()
  })

  test('Profile switch while a Worker runs discards the old snapshot result', async () => {
    const { client, workers, setCurrent } = context()
    const run = client.request(snapshot(), text)
    const identity = workers[0]!.requests[0]!.identity
    setCurrent(snapshot({ profileId: 'profile-2' }))
    workers[0]!.reply({ type: 'result', identity, regions: regions() })
    expect(await run).toEqual({ status: 'skipped', identity, reason: 'snapshot-stale' })
    client.dispose()
  })

  test('mismatched echo cannot complete a request; watchdog fails after timeout', async () => {
    const { client, workers } = context({ timeoutMs: 50 })
    const result = client.request(snapshot(), text)
    const identity = workers[0]!.requests[0]!.identity
    const forged: NlpRunIdentity = {
      ...identity, snapshot: { ...identity.snapshot, documentRevision: 7 }
    }
    workers[0]!.reply({ type: 'result', identity: forged, regions: regions() })
    await vi.advanceTimersByTimeAsync(50)
    expect(await result).toEqual({ status: 'failed', identity, reason: 'timeout' })
    expect(workers[0]!.terminated).toBe(true)
    client.dispose()
  })

  test('Worker crash settles the active run and a later run creates a new Worker', async () => {
    const { client, workers } = context()
    const first = client.request(snapshot(), text)
    const old = workers[0]!.requests[0]!.identity
    workers[0]!.crash()
    expect(await first).toEqual({ status: 'failed', identity: old, reason: 'worker-unavailable' })
    expect(workers[0]!.terminated).toBe(true)
    const second = client.request(snapshot(), text)
    expect(workers).toHaveLength(2)
    const next = workers[1]!.requests[0]!.identity
    expect(next.workerEpoch).toBe(old.workerEpoch + 1)
    workers[0]!.reply({ type: 'result', identity: old, regions: regions() })
    workers[1]!.reply({ type: 'result', identity: next, regions: regions() })
    expect(await second).toMatchObject({ status: 'completed', identity: next })
    client.dispose()
  })

  test('constructor or postMessage failure reports worker-unavailable without hanging', async () => {
    const broken = context({ throwOnCreate: true })
    expect(await broken.client.request(snapshot(), text)).toMatchObject({
      status: 'failed', reason: 'worker-unavailable'
    })
    broken.client.dispose()
    const { client, workers } = context()
    const one = client.request(snapshot(), text)
    workers[0]!.reply({
      type: 'error', identity: workers[0]!.requests[0]!.identity, code: 'provider-error'
    })
    await one
    workers[0]!.shouldThrowOnPost = true
    expect(await client.request(snapshot(), text)).toMatchObject({
      status: 'failed', reason: 'worker-unavailable'
    })
    client.dispose()
  })

  test('cancel and dispose are terminal and do not start Workers for invalid inputs', async () => {
    const { client, workers } = context()
    expect(await client.request(snapshot(), text + '追加')).toEqual({
      status: 'rejected', reason: 'invalid-input'
    })
    expect(workers).toHaveLength(0)
    const current = client.request(snapshot(), text)
    const identity = workers[0]!.requests[0]!.identity
    client.cancel()
    expect(await current).toEqual({ status: 'skipped', identity, reason: 'cancelled' })
    expect(workers[0]!.terminated).toBe(true)
    client.dispose()
    expect(await client.request(snapshot(), text)).toEqual({
      status: 'rejected', reason: 'disposed'
    })
    expect(workers).toHaveLength(1)
  })
})
