import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { DocumentSummary } from '../document/types'
import { appState } from '../state/app-state'
import { documentController } from '../state/workspace-runtime'
import {
  documentDialogKeyboardAction,
  filterDocumentSummaries,
  isDocumentRowActive,
  shouldFocusDocumentSidebarOnMount
} from './document-sidebar-model'
import './DocumentSidebar.css'

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth
}

function formatDocumentType(summary: DocumentSummary): string {
  return summary.docType === 'text' ? 'TXT' : 'MD'
}

function backgroundTargets(): HTMLElement[] {
  if (typeof document === 'undefined') return []
  return Array.from(document.querySelectorAll<HTMLElement>(
    '.app-header .header-left, .app-header .header-actions > :not(#documents-toggle), .editor-pane, .diagnostics-panel, .status-bar'
  ))
}

export function DocumentSidebar() {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false)
  let newDocumentButton: HTMLButtonElement | undefined
  let deleteActionButton: HTMLButtonElement | undefined
  let cancelDeleteButton: HTMLButtonElement | undefined
  let confirmDeleteButton: HTMLButtonElement | undefined

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

  const closeDeleteDialog = (): void => {
    setDeleteConfirmOpen(false)
    queueMicrotask(() => deleteActionButton?.focus())
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
    closeDeleteDialog()
    await documentController.deleteActiveDocument()
    closeOverlayAfterNavigation()
  }

  const handleDeleteDialogKeyDown = (event: KeyboardEvent): void => {
    const currentFocus = document.activeElement === confirmDeleteButton ? 'delete' : 'cancel'
    const action = documentDialogKeyboardAction(event.key, event.shiftKey, currentFocus)
    if (action === 'none') return

    event.preventDefault()
    event.stopPropagation()
    if (action === 'close') {
      closeDeleteDialog()
      return
    }
    if (action === 'focus-delete') {
      confirmDeleteButton?.focus()
      return
    }
    cancelDeleteButton?.focus()
  }

  onMount(() => {
    let inertTargets: HTMLElement[] = []

    const reconcileOverlayAccessibility = (): void => {
      for (const target of inertTargets) target.inert = false
      inertTargets = []

      if (viewportWidth() >= 1280) return
      inertTargets = backgroundTargets()
      for (const target of inertTargets) target.inert = true
    }

    reconcileOverlayAccessibility()
    if (shouldFocusDocumentSidebarOnMount(viewportWidth())) {
      queueMicrotask(() => newDocumentButton?.focus())
    }

    if (typeof window !== 'undefined') window.addEventListener('resize', reconcileOverlayAccessibility)
    onCleanup(() => {
      if (typeof window !== 'undefined') window.removeEventListener('resize', reconcileOverlayAccessibility)
      for (const target of inertTargets) target.inert = false
    })
  })

  createEffect(() => {
    if (deleteConfirmOpen()) queueMicrotask(() => cancelDeleteButton?.focus())
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
              ref={newDocumentButton}
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
              ref={deleteActionButton}
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
        <div
          class="document-delete-backdrop"
          role="presentation"
          onKeyDown={handleDeleteDialogKeyDown}
        >
          <div class="document-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="document-delete-title">
            <h2 id="document-delete-title">ドキュメントを削除しますか？</h2>
            <p>「{activeSummary()?.name ?? 'このドキュメント'}」を削除します。Local Libraryでは保存済み本文も削除されます。</p>
            <div class="document-delete-actions">
              <button
                ref={cancelDeleteButton}
                type="button"
                class="btn"
                onClick={closeDeleteDialog}
              >
                Cancel
              </button>
              <button
                ref={confirmDeleteButton}
                type="button"
                class="btn btn-primary"
                onClick={() => void deleteDocument()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
