import type { WorkerResponse } from './protocol'

/**
 * Obsolescence applies only to interactive (nonnegative) document revisions.
 * Shadow-format lints are negative and must always complete independently.
 * Do not cancel work already running synchronously; skip between await/tier boundaries.
 */
export class RevisionGate {
  private newestUIRevision = -1

  receive(revision: number): void {
    if (revision >= 0 && revision > this.newestUIRevision) {
      this.newestUIRevision = revision
    }
  }

  isObsolete(revision: number): boolean {
    return revision >= 0 && revision < this.newestUIRevision
  }
}

export function isTierCompletion(
  message: WorkerResponse
): message is Extract<WorkerResponse, { type: 'result' | 'skipped' | 'error' }> {
  return message.type === 'result' || message.type === 'skipped' || message.type === 'error'
}
