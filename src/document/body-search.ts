import type { DocumentSearchHit, EditableDocument } from './types'

const DEFAULT_PER_DOCUMENT = 3
const DEFAULT_TOTAL = 50

function normalizedQuery(raw: string): string {
  const query = raw.trim()
  if ([...query].length > 80) throw new Error('Search query must be 80 Unicode code points or fewer')
  return query
}

function escapeLiteral(query: string): string {
  return query.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
}

function stableOrder(a: EditableDocument, b: EditableDocument): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

function preview(text: string, start: number, end: number): string {
  let from = Math.max(0, start - 24)
  let to = Math.min(text.length, end + 24)
  // Do not cut a surrogate pair in half at snippet boundaries.
  if (from > 0 && /[\uDC00-\uDFFF]/u.test(text[from]!)) from--
  if (to < text.length && /[\uD800-\uDBFF]/u.test(text[to - 1]!)) to++
  return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/gu, ' ') + (to < text.length ? '…' : '')
}

/** No index, no writes. One bounded, literal scan over the supplied Workspace's documents. */
export function searchDocumentBodies(
  documents: readonly EditableDocument[],
  rawQuery: string,
  limits: { perDocument?: number; total?: number } = {}
): DocumentSearchHit[] {
  const query = normalizedQuery(rawQuery)
  if (query.length === 0) return []
  const perDocument = Math.max(1, Math.min(3, limits.perDocument ?? DEFAULT_PER_DOCUMENT))
  const total = Math.max(1, Math.min(50, limits.total ?? DEFAULT_TOTAL))
  const regex = new RegExp(escapeLiteral(query), 'giu')
  const hits: DocumentSearchHit[] = []
  for (const document of [...documents].sort(stableOrder)) {
    regex.lastIndex = 0
    let count = 0
    let match: RegExpExecArray | null
    while (count < perDocument && hits.length < total && (match = regex.exec(document.content)) !== null) {
      const start = match.index
      const end = start + match[0].length
      hits.push({
        workspaceId: document.workspaceId,
        documentId: document.id,
        name: document.name,
        start,
        end,
        preview: preview(document.content, start, end)
      })
      count++
    }
    if (hits.length >= total) break
  }
  return hits
}

/** Navigation guard: old hit coordinates must not highlight newly modified text. */
export function matchesSearchHit(text: string, hit: DocumentSearchHit, rawQuery: string): boolean {
  const query = normalizedQuery(rawQuery)
  if (query.length === 0 || hit.start < 0 || hit.end > text.length || hit.start >= hit.end) return false
  return new RegExp('^(?:' + escapeLiteral(query) + ')$', 'iu').test(text.slice(hit.start, hit.end))
}
