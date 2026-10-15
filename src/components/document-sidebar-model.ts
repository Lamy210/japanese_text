import type { DocumentSummary } from '../document/types'

export interface AuxiliaryPanelsState {
  documentsOpen: boolean
  diagnosticsOpen: boolean
}

export interface AuxiliaryPanelsTransition extends AuxiliaryPanelsState {
  width: number
  target: 'documents' | 'diagnostics'
}

export function filterDocumentSummaries(
  summaries: readonly DocumentSummary[],
  rawFilter: string
): DocumentSummary[] {
  const filter = rawFilter.trim().toLocaleLowerCase()
  if (filter.length === 0) return [...summaries]
  return summaries.filter((summary) => summary.name.toLocaleLowerCase().includes(filter))
}

export function isDocumentRowActive(summary: DocumentSummary, activeDocumentId: string | undefined): boolean {
  return summary.id === activeDocumentId
}

export function documentSidebarDefaultOpen(width: number): boolean {
  return width >= 1280
}

export function reconcileAuxiliaryPanelsForWidth(
  width: number,
  current: AuxiliaryPanelsState
): AuxiliaryPanelsState {
  if (width < 1024 && current.documentsOpen && current.diagnosticsOpen) {
    return { documentsOpen: false, diagnosticsOpen: true }
  }
  return current
}

export function nextAuxiliaryPanels(input: AuxiliaryPanelsTransition): AuxiliaryPanelsState {
  const opening = input.target === 'documents' ? !input.documentsOpen : !input.diagnosticsOpen
  if (!opening) {
    return input.target === 'documents'
      ? { documentsOpen: false, diagnosticsOpen: input.diagnosticsOpen }
      : { documentsOpen: input.documentsOpen, diagnosticsOpen: false }
  }

  if (input.width < 1024) {
    return input.target === 'documents'
      ? { documentsOpen: true, diagnosticsOpen: false }
      : { documentsOpen: false, diagnosticsOpen: true }
  }

  return input.target === 'documents'
    ? { documentsOpen: true, diagnosticsOpen: input.diagnosticsOpen }
    : { documentsOpen: input.documentsOpen, diagnosticsOpen: true }
}
