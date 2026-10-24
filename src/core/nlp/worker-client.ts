/**
 * AP-10 part 2 — lazy, independent NLP Worker transport.
 *
 * No Worker exists until request() is explicitly called. This client never
 * touches the Fast/Deep/Idle worker or Formatter Shadow revisions.
 * Provider results are checked against every AP-09 prose region/token before
 * the caller can observe a successful MorphToken batch.
 */
import { NlpSessionCoordinator, type NlpRunIdentity, type NlpSnapshotIdentity, type NlpTerminal } from './session-coordinator'
import { validateNlpWorkerBatch, type NlpAnalyzeRequest, type NlpWorkerResponse, type NlpRegionTokens } from './worker-protocol'
import type { MorphToken } from './types'

export type NlpClientOutcome =
  | NlpTerminal<readonly MorphToken[]>
  | { readonly status: 'rejected'; readonly reason: 'invalid-input' | 'snapshot-stale' | 'disposed' }

export interface NlpWorkerClientOptions {
  /** Must check live document text generation, Profile, provider, asset hash and consent. */
  readonly isCurrent: (snapshot: NlpSnapshotIdentity) => boolean
  readonly createWorker?: () => Worker
  /** Watchdog for each request, not the existing lint Worker's watchdog. */
  readonly timeoutMs?: number
}

interface Pending {
  readonly identity: NlpRunIdentity
  readonly text: string
  readonly timer: ReturnType<typeof setTimeout>
  readonly resolve: (value: NlpClientOutcome) => void
}

export class NlpWorkerClient {
  private readonly coordinator: NlpSessionCoordinator<readonly NlpRegionTokens[]>
  private readonly workerFactory: () => Worker
  private readonly timeoutMs: number
  private worker: Worker | null = null
  private pending: Pending | null = null
  private disposed = false

  constructor(options: NlpWorkerClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000) {
      throw new Error('Invalid NLP Worker watchdog timeout')
    }
    this.coordinator = new NlpSessionCoordinator(options.isCurrent)
    this.workerFactory = options.createWorker ??
      (() => new Worker(new URL('../../worker/nlp.worker.ts', import.meta.url), { type: 'module' }))
  }

  private finish(result: NlpClientOutcome): void {
    const pending = this.pending
    if (pending === null) return
    clearTimeout(pending.timer)
    this.pending = null
    pending.resolve(result)
  }

  private retireWorker(): void {
    const old = this.worker
    this.worker = null
    if (old !== null) {
      try { old.terminate() } catch { /* already stopped */ }
      this.coordinator.restartWorker()
    }
  }

  private failCurrent(reason: 'worker-unavailable' | 'timeout'): void {
    const pending = this.pending
    if (pending !== null) {
      const terminal = reason === 'timeout'
        ? this.coordinator.timeout(pending.identity)
        : this.coordinator.fail(pending.identity, 'worker-unavailable')
      if (terminal !== null) this.finish(terminal)
    }
    this.retireWorker()
  }

  private handleWorkerReply(message: NlpWorkerResponse): void {
    if (this.pending === null || message === null ||
        typeof message !== 'object' || (message.type !== 'error' && message.type !== 'result')) return

    const delivery = this.coordinator.deliver(
      message.type === 'error'
        ? { type: 'error', identity: message.identity }
        : { type: 'result', identity: message.identity, value: message.regions }
    )
    if (delivery.status !== 'accepted') return
    const terminal = delivery.terminal
    if (terminal.status !== 'completed') {
      this.finish(terminal)
      return
    }
    let validated: ReturnType<typeof validateNlpWorkerBatch>
    try {
      validated = validateNlpWorkerBatch(
        this.pending.text, terminal.identity.snapshot.documentType, terminal.value
      )
    } catch {
      validated = { status: 'invalid', reason: 'invalid-token' }
    }
    if (validated.status !== 'valid') {
      this.finish({
        status: 'failed', identity: terminal.identity, reason: 'invalid-payload'
      })
    } else {
      this.finish({ status: 'completed', identity: terminal.identity, value: validated.tokens })
    }
  }

  private startWorker(): Worker {
    if (this.worker !== null) return this.worker
    const worker = this.workerFactory()
    this.worker = worker
    worker.addEventListener('message', (event: MessageEvent<NlpWorkerResponse>) => {
      // A message from a terminated/replaced Worker is never authoritative.
      if (this.worker === worker) this.handleWorkerReply(event.data)
    })
    worker.addEventListener('error', (event: ErrorEvent) => {
      if (this.worker !== worker) return
      event.preventDefault()
      this.failCurrent('worker-unavailable')
    })
    return worker
  }

  /** A locally verified provider and explicit consent are prerequisites for caller usage. */
  request(snapshot: NlpSnapshotIdentity, text: string): Promise<NlpClientOutcome> {
    if (this.disposed) return Promise.resolve({ status: 'rejected', reason: 'disposed' })
    if (typeof text !== 'string' || text.length !== snapshot?.sourceUtf16Length) {
      return Promise.resolve({ status: 'rejected', reason: 'invalid-input' })
    }
    const started = this.coordinator.begin(snapshot)
    if (started.status === 'rejected') return Promise.resolve(started)
    if (started.superseded !== null) this.finish(started.superseded)

    return new Promise<NlpClientOutcome>((resolve) => {
      const identity = started.identity
      const timer = setTimeout(() => this.failCurrentIfMatch(identity), this.timeoutMs)
      this.pending = { identity, text, timer, resolve }
      try {
        const worker = this.startWorker()
        worker.postMessage({ type: 'analyze', identity, text } satisfies NlpAnalyzeRequest)
      } catch {
        this.failCurrent('worker-unavailable')
      }
    })
  }

  private failCurrentIfMatch(identity: NlpRunIdentity): void {
    // An older watchdog must never terminate a newer request.
    if (this.pending?.identity !== identity) return
    this.failCurrent('timeout')
  }

  /** Cancel current work and terminate the Worker rather than queueing behind it. */
  cancel(): void {
    const current = this.pending
    if (current !== null) {
      const terminal = this.coordinator.cancel(current.identity)
      if (terminal !== null) this.finish(terminal)
    }
    this.retireWorker()
  }

  /** Terminate without touching the existing Fast/Deep/Idle Worker. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
  }
}
