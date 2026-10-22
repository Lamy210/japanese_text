import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { LintRequest, WorkerResponse } from '../../src/worker/protocol'
import { appState } from '../../src/state/app-state'

class FakeAnalysisWorker {
  static current: FakeAnalysisWorker | null = null
  readonly requests: LintRequest[] = []
  private messages = new Set<(event: MessageEvent<WorkerResponse>) => void>()

  constructor() {
    FakeAnalysisWorker.current = this
  }

  addEventListener(type: string, listener: (event: MessageEvent<WorkerResponse>) => void): void {
    if (type === 'message') this.messages.add(listener)
  }

  removeEventListener(type: string, listener: (event: MessageEvent<WorkerResponse>) => void): void {
    if (type === 'message') this.messages.delete(listener)
  }

  postMessage(request: LintRequest): void {
    this.requests.push(request)
  }

  terminate(): void {}

  emit(revision: number, tier: 'fast' | 'deep' | 'idle'): void {
    const response: WorkerResponse = {
      type: 'result', revision, tier, diagnostics: [], ruleErrors: [], durationMs: 1
    }
    for (const callback of this.messages) callback({ data: response } as MessageEvent<WorkerResponse>)
  }
}

let controller: typeof import('../../src/state/lint-controller').lintController

beforeAll(async () => {
  vi.stubGlobal('Worker', FakeAnalysisWorker)
  const module = await import('../../src/state/lint-controller')
  controller = module.lintController
})

beforeEach(() => {
  const worker = FakeAnalysisWorker.current
  if (!worker) throw new Error('Expected mock Worker')
  worker.requests.length = 0
  appState.setDocument('手動解析の再入を確認します。')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

function currentWorker(): FakeAnalysisWorker {
  if (!FakeAnalysisWorker.current) throw new Error('Worker not initialized')
  return FakeAnalysisWorker.current
}

function complete(revision: number): void {
  currentWorker().emit(revision, 'fast')
  currentWorker().emit(revision, 'deep')
  currentWorker().emit(revision, 'idle')
}

describe('duplicate manual lint requests sharing the same revision', () => {
  test('coalesces in-flight repeated clicks into one Worker request and one Promise', async () => {
    const first = controller.lintAllNow()
    const second = controller.lintAllNow()
    expect(second).toBe(first)
    expect(currentWorker().requests).toHaveLength(1)
    const req = currentWorker().requests[0]!
    expect(req.tiers).toEqual(['fast', 'deep', 'idle'])
    complete(req.revision)
    expect([...((await first).keys())]).toEqual(['fast', 'deep', 'idle'])
    expect([...((await second).keys())]).toEqual(['fast', 'deep', 'idle'])
  })

  test('a completed same-revision request can start another independent manual lint', async () => {
    const first = controller.lintAllNow()
    const revision = appState.revision()
    complete(revision)
    await first
    const next = controller.lintAllNow()
    expect(next).not.toBe(first)
    expect(currentWorker().requests).toHaveLength(2)
    complete(revision)
    expect((await next).size).toBe(3)
  })

  test('different revisions remain distinct and can finish out of order', async () => {
    const earlier = controller.lintAllNow()
    const firstRevision = appState.revision()
    appState.setDocument('変更後の本文。')
    const later = controller.lintAllNow()
    const currentRevision = appState.revision()
    expect(later).not.toBe(earlier)
    expect(currentWorker().requests).toHaveLength(2)
    complete(currentRevision)
    expect((await later).size).toBe(3)
    complete(firstRevision)
    expect((await earlier).size).toBe(3)
  })
})
