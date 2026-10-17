import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import { appState } from '../state/app-state'
import { historyController, workspaceController } from '../state/workspace-runtime'
import {
  historyReasonLabel,
  restoreDialogKeyboardAction,
  shouldDisableHistoryMutation
} from './history-panel-model'
import './HistoryPanel.css'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatSnapshotTime(value: number): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value))
}

export function HistoryPanel() {
  const [policyEnabled, setPolicyEnabled] = createSignal(false)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = createSignal(false)
  let restoreTrigger: HTMLButtonElement | undefined
  let cancelRestoreButton: HTMLButtonElement | undefined
  let confirmRestoreButton: HTMLButtonElement | undefined

  const pending = createMemo(() => shouldDisableHistoryMutation(
    appState.documentMutationPending(),
    appState.workspaceMutationPending(),
    appState.historyMutationPending()
  ))

  const selected = () => appState.selectedHistorySnapshot()

  const refreshPolicy = async (): Promise<void> => {
    const active = await (await workspaceController.getService()).getActive()
    if (active.workspace.id === appState.activeWorkspaceId()) {
      setPolicyEnabled(active.workspace.snapshotPolicy.enabled)
    }
  }

  onMount(() => {
    void refreshPolicy().catch(() => setPolicyEnabled(false))
  })

  const closePanel = (): void => {
    historyController.closeHistory()
    queueMicrotask(() => document.getElementById('history-toggle')?.focus())
  }

  const saveSnapshot = async (): Promise<void> => {
    try {
      await historyController.saveManualSnapshot()
      appState.pushToast('success', '現在の本文を履歴へ保存しました。')
    } catch (error) {
      appState.pushToast('error', `履歴の保存に失敗しました: ${errorMessage(error)}`)
    }
  }

  const preview = async (snapshotId: string): Promise<void> => {
    try {
      await historyController.previewSnapshot(snapshotId)
    } catch (error) {
      appState.pushToast('error', `履歴の読み込みに失敗しました: ${errorMessage(error)}`)
    }
  }

  const closeRestoreDialog = (): void => {
    setRestoreConfirmOpen(false)
    queueMicrotask(() => restoreTrigger?.focus())
  }

  const confirmRestore = async (): Promise<void> => {
    const snapshot = selected()
    if (snapshot === undefined) return
    setRestoreConfirmOpen(false)
    try {
      await historyController.restoreSnapshot(snapshot.id)
      appState.pushToast('success', '選択した履歴へ本文を復元しました。')
    } catch (error) {
      appState.pushToast('error', `履歴からの復元に失敗しました: ${errorMessage(error)}`)
    } finally {
      queueMicrotask(() => restoreTrigger?.focus())
    }
  }

  const handleRestoreDialogKeyDown = (event: KeyboardEvent): void => {
    const focus = document.activeElement === confirmRestoreButton ? 'restore' : 'cancel'
    const action = restoreDialogKeyboardAction(event.key, event.shiftKey, focus)
    if (action === 'none') return
    event.preventDefault()
    event.stopPropagation()
    if (action === 'close') {
      closeRestoreDialog()
    } else if (action === 'focus-restore') {
      confirmRestoreButton?.focus()
    } else {
      cancelRestoreButton?.focus()
    }
  }

  return (
    <>
      <button
        type="button"
        class="history-panel-backdrop"
        aria-label="Historyを閉じる"
        onClick={closePanel}
      />
      <aside class="history-panel" aria-label="Document history">
        <header class="history-panel-header">
          <div>
            <h2>History</h2>
            <p>{appState.documentName()}</p>
          </div>
          <button type="button" class="btn btn-small" onClick={closePanel} aria-label="Historyを閉じる">×</button>
        </header>

        <div class="history-panel-actions">
          <button
            type="button"
            class="btn btn-small btn-primary"
            disabled={pending() || !policyEnabled()}
            onClick={() => void saveSnapshot()}
          >
            Save snapshot
          </button>
          <Show when={!policyEnabled()}>
            <button
              type="button"
              class="btn btn-small"
              disabled={appState.workspaceMutationPending()}
              onClick={() => appState.setWorkspaceManagerOpen(true)}
            >
              Enable in Workspace
            </button>
          </Show>
        </div>

        <Show when={appState.historyLoading()}>
          <p class="history-empty" role="status">Loading history…</p>
        </Show>

        <Show when={!appState.historyLoading()}>
          <Show
            when={appState.historyEntries().length > 0}
            fallback={<p class="history-empty">履歴はまだありません。</p>}
          >
            <ul class="history-list">
              <For each={appState.historyEntries()}>
                {(entry) => (
                  <li>
                    <button
                      type="button"
                      class={`history-row${selected()?.id === entry.id ? ' active' : ''}`}
                      disabled={pending()}
                      aria-pressed={selected()?.id === entry.id}
                      onClick={() => void preview(entry.id)}
                    >
                      <span class="history-row-topline">
                        <strong>r{entry.revision} · {historyReasonLabel(entry.reason)}</strong>
                        <time datetime={new Date(entry.createdAt).toISOString()}>{formatSnapshotTime(entry.createdAt)}</time>
                      </span>
                      <span class="history-row-preview">{entry.preview}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>

        <Show when={selected()}>
          {(snapshot) => (
            <section class="history-preview" aria-label="Snapshot preview">
              <div class="history-preview-heading">
                <strong>Preview</strong>
                <button
                  ref={restoreTrigger}
                  type="button"
                  class="btn btn-small btn-primary"
                  disabled={pending()}
                  onClick={() => {
                    setRestoreConfirmOpen(true)
                    queueMicrotask(() => cancelRestoreButton?.focus())
                  }}
                >
                  Restore
                </button>
              </div>
              <pre>{snapshot().content.length === 0 ? '(empty)' : snapshot().content}</pre>
            </section>
          )}
        </Show>
      </aside>

      <Show when={restoreConfirmOpen()}>
        <div class="history-restore-backdrop" role="presentation" onKeyDown={handleRestoreDialogKeyDown}>
          <div class="history-restore-dialog" role="alertdialog" aria-modal="true" aria-labelledby="history-restore-title">
            <h2 id="history-restore-title">この履歴へ復元しますか？</h2>
            <p>現在の本文は復元前履歴として退避してから、選択した本文へ置き換えます。</p>
            <div class="history-restore-actions">
              <button ref={cancelRestoreButton} type="button" class="btn" onClick={closeRestoreDialog}>Cancel</button>
              <button ref={confirmRestoreButton} type="button" class="btn btn-primary" onClick={() => void confirmRestore()}>Restore</button>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
