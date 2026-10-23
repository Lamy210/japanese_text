import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Diagnostic } from '../../src/core/types'
import type { LintRequest, WorkerResponse } from '../../src/worker/protocol'
import { appState } from '../../src/state/app-state'

class FakeWorker {
  static current: FakeWorker | null = null
  readonly requests: LintRequest[] = []
  private readonly messages = new Set<(event: MessageEvent<WorkerResponse>) => void>()

  constructor() { FakeWorker.current = this }

  addEventListener(type: string, handler: (event: never) => void): void {
    if (type === 'message') {
      this.messages.add(handler as (event: MessageEvent<WorkerResponse>) => void)
    }
  }

  postMessage(request: LintRequest): void { this.requests.push(request) }
  terminate(): void {}

  emit(revision: number, tier: 'fast' | 'deep' | 'idle', diagnostics: Diagnostic[] = []): void {
    const data: WorkerResponse = {
      type: 'result', revision, tier, diagnostics, ruleErrors: [], durationMs: 1
    }
    for (const handler of this.messages) handler({ data } as MessageEvent<WorkerResponse>)
  }
}

let persistAndRelint: typeof import('../../src/state/actions').persistAndRelint

beforeAll(async () => {
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('indexedDB', undefined)
  const actions = await import('../../src/state/actions')
  persistAndRelint = actions.persistAndRelint
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('AP-03c stale Worker result regression', () => {
  test('config re-lint increments generation, clears old diagnostics and rejects late results', () => {
    appState.setDocument('コミニュケーションです。')
    const oldRevision = appState.revision()
    const oldDiagnostic: Diagnostic = {
      id: 'wording/common-typo@0-10',
      ruleId: 'wording/common-typo',
      start: 0, end: 10, line: 1, column: 1,
      source: 'core', severity: 'warning',
      message: '旧Profileに基づく診断', fixKind: 'none'
    }
    appState.applyWorkerResult('fast', {
      revision: oldRevision, diagnostics: [oldDiagnostic], ruleErrors: [], durationMs: 1
    })
    expect(appState.diagnostics().map(x => x.id)).toContain(oldDiagnostic.id)

    // Switching Pack metadata must not rewrite each legacy Rule's own setting.
    const wasEnabled = appState.config.rules['wording/common-typo']?.enabled
    appState.updateConfig(config => {
      config.analysis = {
        ...config.analysis,
        packs: { ...config.analysis.packs, dictionary: false }
      }
    })
    persistAndRelint()

    const currentRevision = appState.revision()
    expect(currentRevision).toBe(oldRevision + 1)
    expect(appState.diagnostics()).toEqual([])
    expect(appState.config.rules['wording/common-typo']?.enabled).toBe(wasEnabled)

    const worker = FakeWorker.current
    if (!worker) throw new Error('Worker did not receive config-triggered lint')
    expect(worker.requests).toHaveLength(1)
    expect(worker.requests[0]).toMatchObject({
      revision: currentRevision,
      config: { analysis: { packs: { dictionary: false } } },
      tiers: ['fast', 'deep', 'idle']
    })
    worker.emit(oldRevision, 'fast', [oldDiagnostic])
    expect(appState.diagnostics()).toEqual([])

    for (const tier of ['fast', 'deep', 'idle'] as const) worker.emit(currentRevision, tier)
    expect(appState.diagnostics()).toEqual([])
  })
})
