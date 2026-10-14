import { For, Show } from 'solid-js'
import { appState } from '../state/app-state'
import { workspaceController } from '../state/workspace-runtime'

function reportError(action: string, error: unknown): void {
  appState.pushToast('error', `${action}に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
}

export function WorkspaceSwitcher() {
  const disabled = () => !appState.workspaceReady() || appState.workspaceMutationPending()

  const createWorkspace = (): void => {
    const name = window.prompt('新しいワークスペース名', 'New Workspace')
    if (name === null) return
    void workspaceController.createWorkspace(name).catch((error) => reportError('ワークスペース作成', error))
  }

  return (
    <div class="workspace-switcher">
      <label for="workspace-select" class="visually-hidden">
        ワークスペース
      </label>
      <select
        id="workspace-select"
        class="preset-select workspace-select"
        value={appState.activeWorkspaceId() ?? ''}
        disabled={disabled()}
        aria-label="ワークスペース"
        title="ワークスペースを切り替える"
        onChange={(event) => {
          const workspaceId = event.currentTarget.value
          void workspaceController.switchWorkspace(workspaceId).catch((error) => reportError('ワークスペース切替', error))
        }}
      >
        <Show when={appState.workspaceSummaries().length === 0}>
          <option value="">読み込み中…</option>
        </Show>
        <For each={appState.workspaceSummaries()}>
          {(workspace) => <option value={workspace.id}>{workspace.name}</option>}
        </For>
      </select>
      <button type="button" class="btn" disabled={disabled()} onClick={createWorkspace} title="ワークスペースを作成">
        ＋
      </button>
      <button
        type="button"
        class="btn"
        disabled={disabled() || appState.activeWorkspaceId() === undefined}
        onClick={() => appState.setWorkspaceManagerOpen(true)}
        title="ワークスペース管理"
      >
        Manage
      </button>
    </div>
  )
}
