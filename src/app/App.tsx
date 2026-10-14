/**
 * App — 3領域レイアウト (§9.1 Desktop) + レスポンシブ (§10)
 *
 * Desktop (≥1024px) : Editor + Diagnostics 並列表示
 * Tablet (768-1023px): Diagnostics を Drawer 化
 * Mobile (<768px)   : Editor優先 / Diagnostics は Bottom Sheet / Settings は全画面Dialog
 */

import { onMount, createEffect, Show } from 'solid-js'
import { Header } from '../components/Header'
import { EditorPane } from '../components/EditorPane'
import { DiagnosticsPanel } from '../components/DiagnosticsPanel'
import { StatusBar } from '../components/StatusBar'
import { SettingsDialog } from '../components/SettingsDialog'
import { Toasts } from '../components/Toasts'
import { appState } from '../state/app-state'
import { lintController } from '../state/lint-controller'
import { applyTheme, persistConfigDebounced } from '../state/actions'
import { createWorkspaceController } from '../state/workspace-controller'

const workspaceController = createWorkspaceController({
  relint: () => lintController.relintAll(),
  toast: (kind, message) => appState.pushToast(kind, message)
})

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

  // 設定変更を永続化 (§27)
  createEffect(() => {
    void appState.config
    if (appState.configLoaded()) {
      persistConfigDebounced()
    }
  })

  // テーマ反映 (§39)
  createEffect(() => {
    applyTheme(appState.config.theme)
  })

  // フォントサイズ反映
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
      <Toasts />
    </div>
  )
}
