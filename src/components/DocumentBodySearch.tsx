import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import type { DocumentSearchHit } from '../document/types'
import { matchesSearchHit } from '../document/body-search'
import { getDocumentText, jumpToPosition } from '../editor/editor-adapter'
import { appState } from '../state/app-state'
import { documentController } from '../state/workspace-runtime'
import './DocumentBodySearch.css'

export function DocumentBodySearch() {
  const [query, setQuery] = createSignal('')
  const [lastQuery, setLastQuery] = createSignal('')
  const [hits, setHits] = createSignal<DocumentSearchHit[]>([])
  const [busy, setBusy] = createSignal(false)
  const [searched, setSearched] = createSignal(false)
  const [error, setError] = createSignal('')
  let generation = 0

  createEffect(() => {
    // Do not carry search results into another Workspace.
    void appState.activeWorkspaceId()
    generation++
    setHits([])
    setSearched(false)
    setBusy(false)
    setError('')
  })
  onCleanup(() => { generation++ })

  const updateQuery = (value: string) => {
    generation++
    setQuery(value)
    setHits([])
    setBusy(false)
    setSearched(false)
    setError('')
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (busy() || appState.documentMutationPending() || appState.workspaceMutationPending()) return
    const requestId = ++generation
    const text = query().trim()
    setBusy(true)
    setHits([])
    setError('')
    setSearched(false)
    try {
      const next = await documentController.searchWorkspaceDocuments(text)
      if (requestId !== generation) return
      setLastQuery(text)
      setHits(next)
      setSearched(true)
    } catch (cause) {
      if (requestId !== generation) return
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!/stale/i.test(message)) setError(message)
    } finally {
      if (requestId === generation) setBusy(false)
    }
  }

  const navigate = async (hit: DocumentSearchHit) => {
    const expectedQuery = lastQuery()
    if (appState.activeWorkspaceId() !== hit.workspaceId) return
    try {
      await documentController.switchDocument(hit.documentId)
      if (appState.activeWorkspaceId() !== hit.workspaceId || appState.activeDocumentId() !== hit.documentId) return
      // CodeMirror receives the new document projection via Solid's editor effect.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          if (
            appState.activeWorkspaceId() === hit.workspaceId &&
            appState.activeDocumentId() === hit.documentId &&
            getDocumentText() === appState.documentText() &&
            matchesSearchHit(appState.documentText(), hit, expectedQuery)
          ) {
            jumpToPosition(hit.start, hit.end)
          }
        })
      }
      if (typeof window !== 'undefined' && window.innerWidth < 1280) {
        appState.setDocumentSidebarOpen(false)
      }
    } catch (cause) {
      appState.pushToast('error', '検索結果を開けませんでした: ' + (cause instanceof Error ? cause.message : String(cause)))
    }
  }

  return (
    <section class="document-body-search" aria-label="Search document bodies">
      <form class="document-body-search-form" onSubmit={(event) => void submit(event)}>
        <label class="visually-hidden" for="document-body-search-input">本文検索キーワード</label>
        <input
          id="document-body-search-input"
          type="search"
          placeholder="本文内の語句を検索"
          value={query()}
          onInput={(event) => updateQuery(event.currentTarget.value)}
          aria-label="本文検索キーワード"
        />
        <button
          type="submit"
          class="btn btn-small btn-primary"
          disabled={busy() || appState.documentMutationPending() || appState.workspaceMutationPending() || !appState.documentLibraryReady()}
        >Search</button>
      </form>
      <p class="document-body-search-note">現在のWorkspaceのみ · ローカル検索 · 最大50件</p>
      <Show when={busy()}><p role="status" class="document-body-search-status">検索中…</p></Show>
      <Show when={error().length > 0}><p role="alert" class="document-body-search-error">{error()}</p></Show>
      <Show when={!busy() && searched()}>
        <p role="status" class="document-body-search-status">{hits().length} 件の一致{hits().length === 50 ? '（上限）' : ''}</p>
        <ul class="document-body-search-results">
          <For each={hits()}>
            {(hit) => (
              <li>
                <button
                  type="button"
                  class="document-body-search-hit"
                  disabled={appState.documentMutationPending() || appState.historyMutationPending() || appState.workspaceMutationPending()}
                  onClick={() => void navigate(hit)}
                >
                  <strong>{hit.name}</strong>
                  <span>{hit.preview}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  )
}
