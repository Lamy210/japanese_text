import { For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js'
import type { DocumentSummary } from '../document/types'
import { appState } from '../state/app-state'
import { documentController } from '../state/workspace-runtime'
import './DocumentSidebar.css'

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

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth
}

function formatDocumentType(summary: DocumentSummary): string {
  return summary.docType === 'text' ? 'TXT' : 'MD'
}

export function DocumentSidebar() {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false)
  let cancelDeleteButton: HTMLButtonElement | undefined

  const filtered = createMemo(() =>
    filterDocumentSummaries(appState.documentSummaries(), appState.documentFilter())
  )

  const activeSummary = createMemo(() =>
    appState.documentSummaries().find((summary) => summary.id === appState.activeDocumentId())
  )

  const closeSidebar = (): void => {
    appState.setDocumentSidebarOpen(false)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        document.getElementById('documents-toggle')?.focus()
      })
    }
  }

  const closeOverlayAfterNavigation = (): void => {
    if (viewportWidth() < 1280) closeSidebar()
  }

  const createDocument = async (): Promise<void> => {
    await documentController.createDocument()
    closeOverlayAfterNavigation()
  }

  const renameDocument = async (): Promise<void> => {
    const active = activeSummary()
    if (active === undefined) return
    const nextName = window.prompt('ドキュメント名', active.name)
    if (nextName === null) return
    await documentController.renameActiveDocument(nextName)
  }

  const deleteDocument = async (): Promise<void> => {
    setDeleteConfirmOpen(false)
    await documentController.deleteActiveDocument()
    closeOverlayAfterNavigation()
  }

  createEffect(() => {
    if (deleteConfirmOpen()) queueMicrotask(() => cancelDeleteButton?.focus())
  })

  onMount(() => {
    if (viewportWidth() < 1280 && appState.documentSidebarOpen()) {
      appState.setDocumentSidebarOpen(false)
    }
  })

  return (
    <>
      <button
        type="button"
        class="document-sidebar-backdrop"
        aria-label="Documentsを閉じる"
        onClick={closeSidebar}
      />
      <nav id="document-sidebar" class="document-sidebar" aria-label="Documents">
        <div class="document-sidebar-header">
          <div class="document-sidebar-title-row">
            <h2 class="document-sidebar-title">Documents</h2>
            <button type="button" class="btn btn-small document-sidebar-close" onClick={closeSidebar} aria-label="Documentsを閉じる">
              ×
            </button>
          </div>
          <div class="document-sidebar-actions">
            <button
              type="button"
              class="btn btn-small btn-primary"
              disabled={appState.documentMutationPending() || !appState.documentLibraryReady()}
              onClick={() => void createDocument()}
            >
              New
            </button>
            <button
              type="button"
              class="btn btn-small"
              disabled={appState.activeDocumentId() === undefined || appState.documentMutationPending()}
              onClick={() => void renameDocument()}
            >
              Rename
            </button>
            <button
              type="button"
              class="btn btn-small"
              disabled={appState.activeDocumentId() === undefined || appState.documentMutationPending()}
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Delete
            </button>
          </div>
          <label class="document-filter-label">
            <span class="visually-hidden">ドキュメントを絞り込む</span>
            <input
              type="search"
              class="document-filter-input"
              placeholder="Filter documents"
              value={appState.documentFilter()}
              onInput={(event) => appState.setDocumentFilter(event.currentTarget.value)}
            />
          </label>
        </div>

        <Show
          when={appState.documentLibraryReady()}
          fallback={<p class="document-sidebar-empty" role="status">Loading documents…</p>}
        >
          <Show
            when={filtered().length > 0}
            fallback={<p class="document-sidebar-empty">一致するドキュメントはありません。</p>}
          >
            <ul class="document-list">
              <For each={filtered()}>
                {(summary) => {
                  const active = () => isDocumentRowActive(summary, appState.activeDocumentId())
                  return (
                    <li class="document-list-item">
                      <button
                        type="button"
                        class={`document-row${active() ? ' active' : ''}`}
                        aria-current={active() ? 'page' : undefined}
                        disabled={appState.documentMutationPending()}
                        onClick={() => {
                          void documentController.switchDocument(summary.id).then(closeOverlayAfterNavigation)
                        }}
                      >
                        <span class="document-row-name" title={summary.name}>{summary.name}</span>
                        <span class="document-row-meta">{formatDocumentType(summary)}</span>
                      </button>
                    </li>
                  )
                }}
              </For>
            </ul>
          </Show>
        </Show>
      </nav>

      <Show when={deleteConfirmOpen()}>
        <div class="document-delete-backdrop" role="presentation">
          <div class="document-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="document-delete-title">
            <h2 id="document-delete-title">ドキュメントを削除しますか？</h2>
            <p>「{activeSummary()?.name ?? 'このドキュメント'}」を削除します。Local Libraryでは保存済み本文も削除されます。</p>
            <div class="document-delete-actions">
              <button
                ref={cancelDeleteButton}
                type="button"
                class="btn"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Cancel
              </button>
              <button type="button" class="btn btn-primary" onClick={() => void deleteDocument()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
