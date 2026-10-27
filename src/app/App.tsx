/**
 * App — 3領域レイアウト (§9.1 Desktop) + レスポンシブ (§10)
 */

import { onMount, onCleanup, createEffect, createSignal, Show } from 'solid-js'
import { Header } from '../components/Header'
import { BrainstormDialog } from '../components/BrainstormDialog'
import { CommunicationReviewDialog } from '../components/CommunicationReviewDialog'
import { DocumentSidebar } from '../components/DocumentSidebar'
import { HistoryPanel } from '../components/HistoryPanel'
import {
  documentSidebarDefaultOpen,
  reconcileAuxiliaryPanelsForWidth
} from '../components/document-sidebar-model'
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
  let handleResize: (() => void) | undefined
  const [brainstormOpen, setBrainstormOpen] = createSignal(false)
  const [communicationReviewOpen, setCommunicationReviewOpen] = createSignal(false)

  onMount(() => {
    if (typeof window !== 'undefined') {
      appState.setDocumentSidebarOpen(documentSidebarDefaultOpen(window.innerWidth))
      handleResize = () => {
        const next = reconcileAuxiliaryPanelsForWidth(window.innerWidth, {
          documentsOpen: appState.documentSidebarOpen(),
          diagnosticsOpen: appState.panelOpen()
        })
        appState.setDocumentSidebarOpen(next.documentsOpen)
        appState.setPanelOpen(next.diagnosticsOpen)
      }
      window.addEventListener('resize', handleResize)
    }

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

  onCleanup(() => {
    if (typeof window !== 'undefined' && handleResize !== undefined) {
      window.removeEventListener('resize', handleResize)
    }
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
      <Header
        onBrainstormOpen={() => setBrainstormOpen(true)}
        onCommunicationReviewOpen={() => setCommunicationReviewOpen(true)}
      />
      <main class="app-main">
        <Show when={appState.documentSidebarOpen()}>
          <DocumentSidebar />
        </Show>
        <EditorPane />
        <Show when={appState.panelOpen()}>
          <DiagnosticsPanel />
        </Show>
      </main>
      <StatusBar />
      <SettingsDialog />
      <WorkspaceManageDialog />
      <BrainstormDialog open={brainstormOpen()} onClose={() => setBrainstormOpen(false)} />
      <CommunicationReviewDialog open={communicationReviewOpen()} onClose={() => setCommunicationReviewOpen(false)} />
      <Show when={appState.historyOpen()}>
        <HistoryPanel />
      </Show>
      <Toasts />
    </div>
  )
}
