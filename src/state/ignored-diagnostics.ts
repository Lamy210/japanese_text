/**
 * Session-only, document-scoped diagnostic suppression.
 *
 * This module contains no storage or UI dependencies. A suppression targets
 * one rule + source + exact highlighted phrase in a specific document, NOT a
 * position. Moving text does not reinstate it; other documents and rules are
 * unaffected. The user must explicitly restore it to reactivate that warning.
 */
import type { Diagnostic, DiagnosticSource } from '../core/types'

export interface IgnoredDiagnostic {
  key: string
  ruleId: string
  source: DiagnosticSource
  excerpt: string
}

export const MAX_IGNORED_PER_DOCUMENT = 100
const MAX_EXCERPT_LENGTH = 240

export function documentIgnoreScope(workspaceId?: string, documentId?: string): string | null {
  if (!workspaceId || !documentId) return null
  return JSON.stringify([workspaceId, documentId])
}

export function createIgnoredDiagnostic(
  diagnostic: Pick<Diagnostic, 'ruleId' | 'source' | 'start' | 'end'>,
  text: string
): IgnoredDiagnostic | null {
  if (!diagnostic.ruleId || !['core', 'textlint', 'user'].includes(diagnostic.source)) return null
  if (!Number.isSafeInteger(diagnostic.start) || !Number.isSafeInteger(diagnostic.end) ||
      diagnostic.start < 0 || diagnostic.end <= diagnostic.start || diagnostic.end > text.length ||
      diagnostic.end - diagnostic.start > MAX_EXCERPT_LENGTH) return null
  const excerpt = text.slice(diagnostic.start, diagnostic.end)
  if (!excerpt.trim() || excerpt.includes('\uFFFF')) return null
  return {
    key: JSON.stringify([diagnostic.source, diagnostic.ruleId, excerpt]),
    ruleId: diagnostic.ruleId,
    source: diagnostic.source,
    excerpt
  }
}

export function isIgnoredDiagnostic(
  diagnostic: Pick<Diagnostic, 'ruleId' | 'source' | 'start' | 'end'>,
  text: string,
  ignored: readonly IgnoredDiagnostic[]
): boolean {
  if (ignored.length === 0) return false
  const entry = createIgnoredDiagnostic(diagnostic, text)
  return entry !== null && ignored.some(item => item.key === entry.key)
}
