/**
 * AP-10 (stage 1): pure lifecycle guard for a future, independent NLP Worker.
 *
 * This module neither starts a Worker nor performs network requests, stores
 * document bodies, parses tokens, or changes the existing Fast/Deep/Idle gate.
 * Runtime owns the watchdog timer and must validate provider output with the
 * AP-09 token validators before publishing it as a successful result.
 */
import type { DocumentType } from '../types'

export interface NlpSnapshotIdentity {
  /** The interactive document revision. Negative Formatter shadow IDs are invalid here. */
  readonly documentRevision: number
  readonly workspaceId: string | null
  readonly documentId: string | null
  readonly profileId: string | null
  readonly documentType: DocumentType
  readonly providerId: 'lindera-ipadic' | 'kuromojin-ipadic'
  /** Hash of an installed, locally verified dictionary asset, not of user text. */
  readonly dictionarySha256: string
  /**
   * Opaque per-document-content generation set by the caller; never use
   * document text or a guessable digest of private text as the nonce.
   */
  readonly contentNonce: string
  readonly sourceUtf16Length: number
}

export interface NlpRunIdentity {
  readonly requestId: number
  readonly workerEpoch: number
  readonly snapshot: NlpSnapshotIdentity
}

export type NlpTerminal<T> =
  | { readonly status: 'completed'; readonly identity: NlpRunIdentity; readonly value: T }
  | { readonly status: 'failed'; readonly identity: NlpRunIdentity; readonly reason: 'provider-error' | 'timeout' }
  | { readonly status: 'skipped'; readonly identity: NlpRunIdentity; readonly reason: 'superseded' | 'cancelled' | 'snapshot-stale' | 'worker-restarted' }

export type NlpWorkerReply<T> =
  | { readonly type: 'result'; readonly identity: NlpRunIdentity; readonly value: T }
  | { readonly type: 'error'; readonly identity: NlpRunIdentity }

export type NlpBeginResult =
  | { readonly status: 'started'; readonly identity: NlpRunIdentity; readonly superseded: NlpTerminal<never> | null }
  | { readonly status: 'rejected'; readonly reason: 'snapshot-stale' }

export type NlpDelivery<T> =
  | { readonly status: 'accepted'; readonly terminal: NlpTerminal<T> }
  | { readonly status: 'ignored'; readonly reason: 'no-active-request' | 'stale-request' | 'identity-mismatch' }

const DICTIONARY_SHA256 = /^[a-f0-9]{64}$/u
const NONCE = /^[a-zA-Z0-9_-]{1,128}$/u

function validId(value: string | null): boolean {
  return value === null || (typeof value === 'string' && NONCE.test(value))
}

function validSnapshot(s: NlpSnapshotIdentity): boolean {
  return s !== null && typeof s === 'object' &&
    Number.isSafeInteger(s.documentRevision) && s.documentRevision >= 0 &&
    validId(s.workspaceId) && validId(s.documentId) && validId(s.profileId) &&
    (s.documentType === 'markdown' || s.documentType === 'text') &&
    (s.providerId === 'lindera-ipadic' || s.providerId === 'kuromojin-ipadic') &&
    typeof s.dictionarySha256 === 'string' && DICTIONARY_SHA256.test(s.dictionarySha256) &&
    typeof s.contentNonce === 'string' && NONCE.test(s.contentNonce) &&
    Number.isSafeInteger(s.sourceUtf16Length) && s.sourceUtf16Length > 0
}

function sameSnapshot(a: NlpSnapshotIdentity, b: NlpSnapshotIdentity): boolean {
  return a.documentRevision === b.documentRevision &&
    a.workspaceId === b.workspaceId &&
    a.documentId === b.documentId &&
    a.profileId === b.profileId &&
    a.documentType === b.documentType &&
    a.providerId === b.providerId &&
    a.dictionarySha256 === b.dictionarySha256 &&
    a.contentNonce === b.contentNonce &&
    a.sourceUtf16Length === b.sourceUtf16Length
}

function sameRun(a: NlpRunIdentity, b: NlpRunIdentity): boolean {
  return a.requestId === b.requestId && a.workerEpoch === b.workerEpoch &&
    sameSnapshot(a.snapshot, b.snapshot)
}

function immutableIdentity(requestId: number, workerEpoch: number, snapshot: NlpSnapshotIdentity): NlpRunIdentity {
  return Object.freeze({
    requestId, workerEpoch, snapshot: Object.freeze({
      documentRevision: snapshot.documentRevision,
      workspaceId: snapshot.workspaceId,
      documentId: snapshot.documentId,
      profileId: snapshot.profileId,
      documentType: snapshot.documentType,
      providerId: snapshot.providerId,
      dictionarySha256: snapshot.dictionarySha256,
      contentNonce: snapshot.contentNonce,
      sourceUtf16Length: snapshot.sourceUtf16Length
    })
  })
}

/**
 * Exactly one active NLP request. All terminal outcomes are explicit,
 * one-shot state transitions: completion, error, timeout, cancellation,
 * supersession and Worker replacement cannot all resolve the same request.
 *
 * "isCurrent" must read the live document/Profile/Provider/asset identity.
 * It is evaluated before starting work AND before accepting a Worker reply.
 * No clocks, timers, browser APIs, or Worker references exist in this class.
 */
export class NlpSessionCoordinator<T> {
  private active: NlpRunIdentity | null = null
  private nextRequestId = 1
  private epoch = 0

  constructor(private readonly isCurrent: (snapshot: NlpSnapshotIdentity) => boolean) {}

  get activeRun(): NlpRunIdentity | null {
    return this.active
  }

  get workerEpoch(): number {
    return this.epoch
  }

  private current(snapshot: NlpSnapshotIdentity): boolean {
    try {
      return this.isCurrent(snapshot) === true
    } catch {
      return false
    }
  }

  begin(snapshot: NlpSnapshotIdentity): NlpBeginResult {
    if (!validSnapshot(snapshot)) throw new Error('Invalid NLP snapshot identity')
    if (!this.current(snapshot)) return { status: 'rejected', reason: 'snapshot-stale' }
    if (!Number.isSafeInteger(this.nextRequestId)) throw new Error('NLP request ID exhausted')
    const superseded: NlpTerminal<never> | null = this.active === null ? null :
      { status: 'skipped', identity: this.active, reason: 'superseded' }
    const identity = immutableIdentity(this.nextRequestId++, this.epoch, snapshot)
    this.active = identity
    return { status: 'started', identity, superseded }
  }

  private skip(identity: NlpRunIdentity, reason: Extract<NlpTerminal<T>, {status: 'skipped'}>['reason']): NlpTerminal<T> | null {
    if (this.active === null || !sameRun(this.active, identity)) return null
    this.active = null
    return { status: 'skipped', identity, reason }
  }

  cancel(identity: NlpRunIdentity): NlpTerminal<T> | null {
    return this.skip(identity, 'cancelled')
  }

  /** Invoked by caller's watchdog; the core never sets a timer. */
  timeout(identity: NlpRunIdentity): NlpTerminal<T> | null {
    if (this.active === null || !sameRun(this.active, identity)) return null
    this.active = null
    return { status: 'failed', identity, reason: 'timeout' }
  }

  /** Invalidate the old Worker epoch before a new Worker is available. */
  restartWorker(): NlpTerminal<T> | null {
    if (!Number.isSafeInteger(this.epoch + 1)) throw new Error('NLP worker epoch exhausted')
    const previous: NlpTerminal<T> | null = this.active === null ? null :
      { status: 'skipped', identity: this.active, reason: 'worker-restarted' }
    this.active = null
    this.epoch++
    return previous
  }

  deliver(reply: NlpWorkerReply<T>): NlpDelivery<T> {
    if (this.active === null) return { status: 'ignored', reason: 'no-active-request' }
    if (reply === null || typeof reply !== 'object' || !reply.identity ||
        !Number.isSafeInteger(reply.identity.requestId) ||
        !Number.isSafeInteger(reply.identity.workerEpoch)) {
      return { status: 'ignored', reason: 'identity-mismatch' }
    }
    if (reply.identity.requestId !== this.active.requestId ||
        reply.identity.workerEpoch !== this.active.workerEpoch) {
      return { status: 'ignored', reason: 'stale-request' }
    }
    if (!reply.identity.snapshot || !sameRun(this.active, reply.identity)) {
      return { status: 'ignored', reason: 'identity-mismatch' }
    }
    if (!this.current(this.active.snapshot)) {
      const terminal = this.skip(this.active, 'snapshot-stale')!
      return { status: 'accepted', terminal }
    }
    const identity = this.active
    this.active = null
    if (reply.type === 'error') {
      return { status: 'accepted', terminal: { status: 'failed', identity, reason: 'provider-error' } }
    }
    if (reply.type !== 'result') {
      return { status: 'accepted', terminal: { status: 'failed', identity, reason: 'provider-error' } }
    }
    return { status: 'accepted', terminal: { status: 'completed', identity, value: reply.value } }
  }
}
