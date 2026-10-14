import { Show, createEffect, createMemo, createSignal } from 'solid-js'
import { appState } from '../state/app-state'
import { workspaceController } from '../state/workspace-runtime'

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '不明'
  if (value < 1024) return `${value.toLocaleString('ja-JP')} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let amount = value / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && amount >= 1024; index++) {
    amount /= 1024
    unit = units[index]
  }
  return `${amount.toLocaleString('ja-JP', { maximumFractionDigits: 1 })} ${unit}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function WorkspaceManageDialog() {
  const [renameValue, setRenameValue] = createSignal('')

  const active = createMemo(() =>
    appState.workspaceSummaries().find((workspace) => workspace.id === appState.activeWorkspaceId())
  )
  const capability = () => appState.storageCapability()
  const pending = () => appState.workspaceMutationPending()

  createEffect(() => {
    if (appState.workspaceManagerOpen()) setRenameValue(active()?.name ?? '')
  })

  const rename = (): void => {
    const workspace = active()
    if (workspace === undefined) return
    void workspaceController.renameWorkspace(workspace.id, renameValue()).then(() => {
      appState.pushToast('success', 'ワークスペース名を変更しました。')
    }).catch((error) => {
      appState.pushToast('error', `名前変更に失敗しました: ${errorMessage(error)}`)
    })
  }

  const enableLocal = (): void => {
    if (!appState.storageAvailable()) return
    const confirmed = window.confirm(
      'Local Library を有効にすると、このワークスペースの文書本文をこのブラウザのIndexedDBへ保存します。外部サーバーには送信しません。続行しますか？'
    )
    if (!confirmed) return
    void workspaceController.setStorageMode('local-library').then(() => {
      appState.pushToast('success', 'Local Libraryを有効にしました。')
    }).catch((error) => {
      appState.pushToast('error', `Local Libraryの有効化に失敗しました: ${errorMessage(error)}`)
    })
  }

  const makePrivate = (): void => {
    const confirmed = window.confirm(
      '保存データを削除して Private Session へ戻す\n\nこのワークスペースのIndexedDB本文とスナップショットを削除します。現在エディタにある本文は、このタブを閉じるまでメモリ上に保持します。'
    )
    if (!confirmed) return
    void workspaceController.setStorageMode('private-session').then(() => {
      appState.pushToast('success', 'Private Sessionへ戻しました。')
    }).catch((error) => {
      appState.pushToast('error', `Private Sessionへの変更に失敗しました: ${errorMessage(error)}`)
    })
  }

  const deleteWorkspace = (): void => {
    const workspace = active()
    if (workspace === undefined) return
    if (!window.confirm(`ワークスペース「${workspace.name}」を削除しますか？保存済み本文も削除されます。`)) return
    void workspaceController.deleteWorkspace(workspace.id).then(() => {
      appState.pushToast('success', 'ワークスペースを削除しました。')
      setRenameValue(active()?.name ?? '')
    }).catch((error) => {
      appState.pushToast('error', `ワークスペース削除に失敗しました: ${errorMessage(error)}`)
    })
  }

  const requestPersistence = (): void => {
    void workspaceController.requestPersistence().then((result) => {
      if (result.persisted === true) {
        appState.pushToast('success', 'ブラウザが永続ストレージ要求を許可しました。')
      } else if (result.persisted === false) {
        appState.pushToast('info', 'ブラウザは永続ストレージ要求を許可しませんでした。Local Libraryは引き続き利用できます。')
      } else {
        appState.pushToast('warning', '永続ストレージ要求の結果を取得できませんでした。')
      }
    })
  }

  return (
    <Show when={appState.workspaceManagerOpen()}>
      <div class="dialog-backdrop" onClick={(event) => event.target === event.currentTarget && appState.setWorkspaceManagerOpen(false)}>
        <div class="dialog settings-dialog workspace-manage-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-manage-title">
          <div class="dialog-header">
            <h2 id="workspace-manage-title" class="dialog-title">ワークスペース管理</h2>
            <button type="button" class="btn btn-icon" onClick={() => appState.setWorkspaceManagerOpen(false)} aria-label="ワークスペース管理を閉じる">✕</button>
          </div>
          <div class="dialog-body">
            <Show when={active()} fallback={<p class="settings-note">アクティブなワークスペースがありません。</p>}>
              {(workspace) => (
                <div class="settings-section general-section">
                  <fieldset class="field-group">
                    <legend>名前</legend>
                    <div class="button-row">
                      <input
                        type="text"
                        value={renameValue()}
                        maxlength={80}
                        disabled={pending()}
                        onInput={(event) => setRenameValue(event.currentTarget.value)}
                        aria-label="ワークスペース名"
                      />
                      <button type="button" class="btn" disabled={pending() || renameValue().trim() === ''} onClick={rename}>名前を変更</button>
                    </div>
                  </fieldset>

                  <fieldset class="field-group">
                    <legend>本文の保存方式</legend>
                    <p class="settings-note">
                      現在: <strong>{workspace().storageMode === 'local-library' ? 'Local Library' : 'Private Session'}</strong>
                    </p>
                    <Show when={workspace().storageMode === 'private-session'} fallback={
                      <button type="button" class="btn" disabled={pending()} onClick={makePrivate}>
                        保存データを削除して Private Session へ戻す
                      </button>
                    }>
                      <button
                        type="button"
                        class="btn btn-primary"
                        disabled={pending() || !appState.storageAvailable()}
                        onClick={enableLocal}
                      >
                        Local Libraryを有効化
                      </button>
                      <Show when={!appState.storageAvailable()}>
                        <p class="settings-note status-warn">Memory fallback中のためLocal Libraryは有効化できません。</p>
                      </Show>
                    </Show>
                    <p class="settings-note">Private Sessionの本文はこのタブ内のメモリだけに保持されます。Local Libraryの本文も外部サーバーには送信されません。</p>
                  </fieldset>

                  <fieldset class="field-group">
                    <legend>ブラウザストレージ</legend>
                    <p class="settings-note">
                      Backend: <strong>{capability()?.durableBackend ? 'Durable (IndexedDB)' : 'Memory only'}</strong>
                    </p>
                    <p class="settings-note">
                      origin全体の推定使用量: {formatBytes(capability()?.usage)} / 推定上限: {formatBytes(capability()?.quota)}
                    </p>
                    <p class="settings-note">
                      永続ストレージ: {capability()?.persisted === true ? '許可済み' : capability()?.persisted === false ? '未許可' : '不明'}
                    </p>
                    <Show when={capability()?.error !== undefined}>
                      <p class="settings-note status-warn">Storage API: {capability()?.error}</p>
                    </Show>
                    <button
                      type="button"
                      class="btn"
                      disabled={pending() || capability()?.persistenceRequestSupported !== true}
                      onClick={requestPersistence}
                    >
                      永続ストレージを要求
                    </button>
                    <p class="settings-note">拒否されてもLocal Libraryは利用できます。表示値はこのアプリ単体ではなく、同一origin全体の推定値です。</p>
                  </fieldset>

                  <fieldset class="field-group">
                    <legend>削除</legend>
                    <button
                      type="button"
                      class="btn"
                      disabled={pending() || appState.workspaceSummaries().length <= 1}
                      onClick={deleteWorkspace}
                    >
                      このワークスペースを削除
                    </button>
                    <Show when={appState.workspaceSummaries().length <= 1}>
                      <p class="settings-note">最後のワークスペースは削除できません。</p>
                    </Show>
                  </fieldset>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
