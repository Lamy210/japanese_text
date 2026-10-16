import { describe, expect, it } from 'vitest'
import type { DocumentSummary } from '../../src/document/types'
import {
  documentDialogKeyboardAction,
  documentSidebarDefaultOpen,
  filterDocumentSummaries,
  isDocumentRowActive,
  nextAuxiliaryPanels,
  reconcileAuxiliaryPanelsForWidth,
  shouldFocusDocumentSidebarOnMount
} from '../../src/components/document-sidebar-model'

function summary(id: string, name: string, updatedAt: number): DocumentSummary {
  return {
    id,
    workspaceId: 'workspace-a',
    name,
    docType: 'markdown',
    sourceKind: 'local',
    createdAt: updatedAt,
    updatedAt,
    active: false
  }
}

describe('DocumentSidebar pure state model', () => {
  it('filters document names case-insensitively while preserving source order', () => {
    const values = [
      summary('a', 'Alpha.md', 30),
      summary('b', 'beta.md', 20),
      summary('c', 'ALPHABET.md', 10),
      summary('d', 'gamma.md', 40)
    ]

    expect(filterDocumentSummaries(values, 'alp').map((value) => value.id)).toEqual(['a', 'c'])
    expect(filterDocumentSummaries(values, '  ALP  ').map((value) => value.id)).toEqual(['a', 'c'])
    expect(filterDocumentSummaries(values, '').map((value) => value.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('marks the active row by document ID rather than duplicate display name', () => {
    const first = summary('doc-a', 'same.md', 1)
    const second = summary('doc-b', 'same.md', 2)

    expect(isDocumentRowActive(first, 'doc-b')).toBe(false)
    expect(isDocumentRowActive(second, 'doc-b')).toBe(true)
  })

  it('keeps Documents and Diagnostics mutually exclusive below 1024px', () => {
    expect(nextAuxiliaryPanels({ width: 900, target: 'documents', documentsOpen: false, diagnosticsOpen: true }))
      .toEqual({ documentsOpen: true, diagnosticsOpen: false })
    expect(nextAuxiliaryPanels({ width: 900, target: 'diagnostics', documentsOpen: true, diagnosticsOpen: false }))
      .toEqual({ documentsOpen: false, diagnosticsOpen: true })
  })

  it('allows both auxiliary panels at desktop widths and supports toggling the same panel closed', () => {
    expect(nextAuxiliaryPanels({ width: 1280, target: 'documents', documentsOpen: false, diagnosticsOpen: true }))
      .toEqual({ documentsOpen: true, diagnosticsOpen: true })
    expect(nextAuxiliaryPanels({ width: 1280, target: 'diagnostics', documentsOpen: true, diagnosticsOpen: false }))
      .toEqual({ documentsOpen: true, diagnosticsOpen: true })
    expect(nextAuxiliaryPanels({ width: 900, target: 'documents', documentsOpen: true, diagnosticsOpen: false }))
      .toEqual({ documentsOpen: false, diagnosticsOpen: false })
  })

  it('defaults the Sidebar open only on wide desktop without forcing later user toggles closed', () => {
    expect(documentSidebarDefaultOpen(1279)).toBe(false)
    expect(documentSidebarDefaultOpen(1280)).toBe(true)
  })

  it('reconciles an existing dual-panel state after resizing below 1024px', () => {
    expect(reconcileAuxiliaryPanelsForWidth(900, { documentsOpen: true, diagnosticsOpen: true }))
      .toEqual({ documentsOpen: false, diagnosticsOpen: true })
    expect(reconcileAuxiliaryPanelsForWidth(900, { documentsOpen: true, diagnosticsOpen: false }))
      .toEqual({ documentsOpen: true, diagnosticsOpen: false })
    expect(reconcileAuxiliaryPanelsForWidth(1200, { documentsOpen: true, diagnosticsOpen: true }))
      .toEqual({ documentsOpen: true, diagnosticsOpen: true })
  })

  it('focuses the first useful Sidebar control when the Sidebar is mounted as an overlay or drawer', () => {
    expect(shouldFocusDocumentSidebarOnMount(767)).toBe(true)
    expect(shouldFocusDocumentSidebarOnMount(1024)).toBe(true)
    expect(shouldFocusDocumentSidebarOnMount(1279)).toBe(true)
    expect(shouldFocusDocumentSidebarOnMount(1280)).toBe(false)
  })

  it('closes the Delete dialog on Escape and traps Tab between non-destructive and destructive actions', () => {
    expect(documentDialogKeyboardAction('Escape', false, 'cancel')).toBe('close')
    expect(documentDialogKeyboardAction('Tab', false, 'cancel')).toBe('focus-delete')
    expect(documentDialogKeyboardAction('Tab', false, 'delete')).toBe('focus-cancel')
    expect(documentDialogKeyboardAction('Tab', true, 'cancel')).toBe('focus-delete')
    expect(documentDialogKeyboardAction('Tab', true, 'delete')).toBe('focus-cancel')
    expect(documentDialogKeyboardAction('Enter', false, 'cancel')).toBe('none')
  })
})
