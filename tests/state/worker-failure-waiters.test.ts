import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { LintRequest, WorkerResponse } from '../../src/worker/protocol'
import { appState } from '../../src/state/app-state'

class FakeWorker {
  static current: FakeWorker | null = null
  static failPost = false
  static failConstruction = false
  readonly requests: LintRequest[] = []
  private readonly messages = new Set<(event: MessageEvent<WorkerResponse>) => void>()
  private readonly errors = new Set<(event: ErrorEvent) => void>()
  terminated = false

  constructor() {
    if (FakeWorker.failConstruction) throw new Error('Worker constructor failure')
    FakeWorker.current = this
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.messages.add(listener as (event: MessageEvent<WorkerResponse>) => void)
    if (type === 'error') this.errors.add(listener as (event: ErrorEvent) => void)
  }

  postMessage(request: LintRequest): void {
    if (FakeWorker.failPost) throw new Error('Worker postMessage failure')
    this.requests.push(request)
  }

  emit(revision: number, tier: 'fast' | 'deep' | 'idle'): void {
    const response: WorkerResponse = {
      type: 'result', revision, tier, diagnostics: [], ruleErrors: [], durationMs: 1
    }
    for (const callback of this.messages) callback({ data: response } as MessageEvent<WorkerResponse>)
  }

  crash(): void {
    const event = { message: 'synthetic crash', preventDefault: vi.fn() } as unknown as ErrorEvent
    for (const callback of this.errors) callback(event)
  }

  terminate(): void { this.terminated = true }
}

let controller: typeof import('../../src/state/lint-controller').lintController

beforeAll(async () => {
  vi.stubGlobal('Worker', FakeWorker)
  const imported = await import('../../src/state/lint-controller')
  controller = imported.lintController
})

beforeEach(() => {
  vi.useFakeTimers()
  FakeWorker.failPost = false
  FakeWorker.failConstruction = false
  controller.restartWorker()
  appState.setDocument('Worker障害後の本文を確認します。')
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

async function settleImmediately(
  promise: Promise<Map<'fast' | 'deep' | 'idle', unknown>>
): Promise<'settled' | 'pending'> {
  let settled = false
  void promise.then(() => { settled = true })
  await Promise.resolve()
  await Promise.resolve()
  return settled ? 'settled' : 'pending'
}

function worker(): FakeWorker {
  if (!FakeWorker.current) throw new Error('missing fake worker')
  return FakeWorker.current
}

describe('Worker fatal error and restart must not strand lint waiters', () => {
  test('fatal Worker error settles pending manual lint immediately, without waiting for the 10s watchdog', async () => {
    const pending = controller.lintAllNow()
    expect(worker().requests).toHaveLength(1)
    worker().crash()
    expect(worker().terminated).toBe(true)
    expect(await settleImmediately(pending)).toBe('settled')
    expect((await pending).size).toBe(0)
    expect(appState.workerStatus()).toBe('error')
    expect(appState.analysisStatus()).toBe('error')
  })

  test('failed Worker settles partial shadow lint without treating previously completed tiers as verified', async () => {
    const shadow = controller.lintShadowText('変更後の本文。')
    const revision = worker().requests.at(-1)!.revision
    expect(revision).toBeLessThan(0)
    worker().emit(revision, 'fast')
    worker().crash()
    expect(await settleImmediately(shadow)).toBe('settled')
    expect((await shadow).size).toBe(0)
  })

  test('explicit Worker restart settles waiters and ignores delayed messages from retired Worker', async () => {
    const first = worker()
    const pending = controller.lintAllNow()
    const revision = first.requests.at(-1)!.revision
    controller.restartWorker()
    expect(first.terminated).toBe(true)
    expect(await settleImmediately(pending)).toBe('settled')
    expect((await pending).size).toBe(0)
    // A delayed terminal message from the previous worker must not be
    // reflected in the app or decrement the new worker's in-flight count.
    const next = controller.lintAllNow()
    expect(worker()).not.toBe(first)
    first.emit(revision, 'fast')
    first.emit(revision, 'deep')
    first.emit(revision, 'idle')
    expect(await settleImmediately(next)).toBe('pending')
    const current = worker()
    current.emit(revision, 'fast')
    current.emit(revision, 'deep')
    current.emit(revision, 'idle')
    expect((await next).size).toBe(3)
  })

  test('postMessage throwing settles manual lint and marks Worker as failed', async () => {
    FakeWorker.failPost = true
    const pending = controller.lintAllNow()
    expect(await settleImmediately(pending)).toBe('settled')
    expect((await pending).size).toBe(0)
    expect(appState.workerStatus()).toBe('error')
  })

  test('Worker construction failure settles waiting requests rather than hanging', async () => {
    worker().crash()
    FakeWorker.failConstruction = true
    controller.restartWorker()
    const pending = controller.lintAllNow()
    expect(await settleImmediately(pending)).toBe('settled')
    expect((await pending).size).toBe(0)
    expect(appState.workerStatus()).toBe('error')
  })
})
