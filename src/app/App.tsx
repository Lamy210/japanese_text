/**
 * App — 3領域レイアウト (§9.1 Desktop) + レスポンシブ (§10)
 */

import { onMount, createEffect, Show } from 'solid-js'
import { Header } from '../components/Header'
import { EditorPane } from '../components/EditorPane'
import { DiagnosticsPanel } from '../components/DiagnosticsPanel'
import { StatusBar } from '../components/StatusBar'
import { SettingsDialog } from '../components/SettingsDialog'
import { WorkspaceManageDialog } from '../components/WorkspaceManageDialog'
import { Toasts } from '../components/Toasts'
import { appState } from '../state/app-state'
import { lintController } from '../state/lint-controller'
import { applyTheme, persistConfigDebounced } from '../state/actions'
import { workspaceController } from '../state/workspace-runtime'

export function App() {
  onMount(() => {
    void workspaceController.bootstrap().catch((error) => {
      appState.setWorkspaceReady(true)
      appState.setConfigLoaded(true)
      appState.pushToast(
        'error',
        `ワークスペースの起動に失敗しました: ${error instanceof Error ? error.message : String(error)}`
      )
      lintController.relintAll()
    })
  })

  createEffect(() => {
    void appState.config
    if (appState.configLoaded()) persistConfigDebounced()
  })

  createEffect(() => {
    applyTheme(appState.config.theme)
  })

  createEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', `${appState.config.editor.fontSize}px`)
  })

  return (
    <div class="app-shell">
      <Header />
      <main class="app-main">
        <EditorPane />
        <Show when={appState.panelOpen()}>
          <DiagnosticsPanel />
        </Show>
      </main>
      <StatusBar />
      <SettingsDialog />
      <WorkspaceManageDialog />
      <Toasts />
    </div>
  )
}
