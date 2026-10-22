/**
 * Generate unique negative lint revisions per tab without relying on clocks
 * or randomness. Negative revisions are reserved for formatter shadow work.
 */
let lastIssued = 0

export function nextShadowLintRevision(): number {
  if (lastIssued <= -Number.MAX_SAFE_INTEGER) {
    throw new Error('Shadow lint revision space exhausted')
  }
  return --lastIssued
}
