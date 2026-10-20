import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { appState } from '../state/app-state'
import { workspaceController } from '../state/workspace-runtime'
import type { RuleProfileSummary } from '../workspace/workspace-service'

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
  const [ruleProfiles, setRuleProfiles] = createSignal<RuleProfileSummary[]>([])
  const [ruleProfilesLoaded, setRuleProfilesLoaded] = createSignal(false)
  const [selectedRuleProfileId, setSelectedRuleProfileId] = createSignal('')
  const [snapshotEnabled, setSnapshotEnabled] = createSignal(false)
  const [snapshotMax, setSnapshotMax] = createSignal(20)
  const [snapshotPolicyLoaded, setSnapshotPolicyLoaded] = createSignal(false)

  const active = createMemo(() =>
    appState.workspaceSummaries().find((workspace) => workspace.id === appState.activeWorkspaceId())
  )
  const capability = () => appState.storageCapability()
  const pending = () => appState.workspaceMutationPending() || appState.historyMutationPending()
  const snapshotMaxValid = () => Number.isInteger(snapshotMax()) && snapshotMax() >= 1 && snapshotMax() <= 1000

  createEffect(() => {
    if (!appState.workspaceManagerOpen()) return
    const workspaceId = active()?.id
    setRenameValue(active()?.name ?? '')
    setSnapshotPolicyLoaded(false)
    setRuleProfilesLoaded(false)
    if (workspaceId === undefined) return

    void workspaceController.listRuleProfiles().then((profiles) => {
      if (appState.workspaceManagerOpen() && appState.activeWorkspaceId() === workspaceId) {
        setRuleProfiles(profiles)
        setSelectedRuleProfileId(profiles.find((profile) => profile.active)?.id ?? '')
        setRuleProfilesLoaded(true)
      }
    }).catch((error) => {
      appState.pushToast('warning', `RuleProfile一覧の読み込みに失敗しました: ${errorMessage(error)}`)
    })

    void workspaceController.getService().then((service) => service.getActive()).then((context) => {
      if (
        appState.workspaceManagerOpen() &&
        appState.activeWorkspaceId() === workspaceId &&
        context.workspace.id === workspaceId
      ) {
        setSnapshotEnabled(context.workspace.snapshotPolicy.enabled)
        setSnapshotMax(context.workspace.snapshotPolicy.maxSnapshots)
        setSnapshotPolicyLoaded(true)
      }
    }).catch((error) => {
      appState.pushToast('warning', `履歴設定の読み込みに失敗しました: ${errorMessage(error)}`)
    })
  })

  const refreshRuleProfiles = async (): Promise<void> => {
    const profiles = await workspaceController.listRuleProfiles()
    setRuleProfiles(profiles)
    setSelectedRuleProfileId(profiles.find((profile) => profile.active)?.id ?? '')
    setRuleProfilesLoaded(true)
  }

  const duplicateRuleProfile = (): void => {
    const name = window.prompt('複製するRuleProfileの名前', 'New RuleProfile')
    if (name === null) return
    void workspaceController.duplicateRuleProfile(name).then(async () => {
      await refreshRuleProfiles()
      appState.pushToast('success', 'RuleProfileを複製しました。')
    }).catch((error) => {
      appState.pushToast('error', `RuleProfile複製に失敗しました: ${errorMessage(error)}`)
    })
  }

  const switchRuleProfile = (): void => {
    const targetId = selectedRuleProfileId()
    if (targetId.length === 0) return
    void workspaceController.switchRuleProfile(targetId).then(async () => {
      await refreshRuleProfiles()
      appState.pushToast('success', 'RuleProfileを切り替えました。')
    }).catch((error) => {
      appState.pushToast('error', `RuleProfile切替に失敗しました: ${errorMessage(error)}`)
    })
  }

  const rename = (): void => {
    const workspace = active()
    if (workspace === undefined) return
    void workspaceController.renameWorkspace(workspace.id, renameValue()).then(() => {
      appState.pushToast('success', 'ワークスペース名を変更しました。')
    }).catch((error) => {
      appState.pushToast('error', `名前変更に失敗しました: ${errorMessage(error)}`)
    })
  }

  const saveSnapshotPolicy = (): void => {
    if (!snapshotMaxValid()) return
    void workspaceController.setSnapshotPolicy({
      enabled: snapshotEnabled(),
      maxSnapshots: snapshotMax()
    }).then(() => {
      appState.pushToast('success', '履歴設定を保存しました。')
    }).catch((error) => {
      appState.pushToast('error', `履歴設定の保存に失敗しました: ${errorMessage(error)}`)
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
    if (!window.confirm(`ワークスペース「${workspace.name}」を削除しますか？保存済み本文と履歴は削除されますが、RuleProfile設定（NGワード等）は互換性のため残ります。`)) return
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
                    <legend>RuleProfiles</legend>
                    <Show when={ruleProfilesLoaded()} fallback={<p class="settings-note">RuleProfile一覧を読み込んでいます…</p>}>
                      <label class="setting-row">
                        <span>利用するルール設定</span>
                        <select
                          aria-label="RuleProfileを選択"
                          value={selectedRuleProfileId()}
                          disabled={pending()}
                          onChange={(event) => setSelectedRuleProfileId(event.currentTarget.value)}
                        >
                          <For each={ruleProfiles()}>
                            {(profile) => <option value={profile.id}>{profile.name}{profile.active ? ' (active)' : ''}</option>}
                          </For>
                        </select>
                      </label>
                      <div class="button-row">
                        <button
                          type="button"
                          class="btn btn-primary"
                          disabled={pending() || selectedRuleProfileId().length === 0 || ruleProfiles().some((profile) => profile.id === selectedRuleProfileId() && profile.active)}
                          onClick={switchRuleProfile}
                        >
                          このProfileに切り替え
                        </button>
                        <button type="button" class="btn" disabled={pending()} onClick={duplicateRuleProfile}>
                          現在のProfileを複製
                        </button>
                      </div>
                      <p class="settings-note">RuleProfileには校正ルール、NGワード、用語、引用、Formatter設定が含まれます。本文や履歴は複製されません。</p>
                    </Show>
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
                    <legend>Document History</legend>
                    <Show when={snapshotPolicyLoaded()} fallback={<p class="settings-note">履歴設定を読み込んでいます…</p>}>
                      <label class="setting-checkbox">
                        <input
                          type="checkbox"
                          checked={snapshotEnabled()}
                          disabled={pending()}
                          onChange={(event) => setSnapshotEnabled(event.currentTarget.checked)}
                        />
                        <span>Snapshot / History を有効にする</span>
                      </label>
                      <label class="setting-row">
                        <span>1文書あたりの最大履歴数</span>
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          step="1"
                          value={snapshotMax()}
                          disabled={pending()}
                          onInput={(event) => setSnapshotMax(Number(event.currentTarget.value))}
                          aria-label="1文書あたりの最大履歴数"
                        />
                      </label>
                      <Show when={!snapshotMaxValid()}>
                        <p class="settings-note status-warn">1〜1000の整数を指定してください。</p>
                      </Show>
                      <button
                        type="button"
                        class="btn btn-primary"
                        disabled={pending() || !snapshotMaxValid()}
                        onClick={saveSnapshotPolicy}
                      >
                        履歴設定を保存
                      </button>
                      <p class="settings-note">
                        Private Sessionの履歴はメモリのみ、Local Libraryの履歴はIndexedDBへ保存します。無効化しても既存履歴は削除しません。
                      </p>
                    </Show>
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
