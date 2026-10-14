/**
 * EditorPane — CodeMirror 6 マウント + 診断の反映 (§9.1 Main Editor)
 */

import { onMount, onCleanup, createEffect, Show } from 'solid-js'
import { EditorView, lineNumbers } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { setDiagnostics } from '@codemirror/lint'
import { createEditorExtensions, toCodeMirrorDiagnostics, lineNumbersCompartment } from '../editor/cm-extensions'
import { setEditorView } from '../editor/editor-adapter'
import { appState } from '../state/app-state'
import { lintController } from '../state/lint-controller'
import { formatDocumentAction, persistWorkspaceDocumentDebounced } from '../state/actions'

export function EditorPane() {
  let container: HTMLDivElement | undefined

  onMount(() => {
    if (container === undefined) return
    const view = new EditorView({
      doc: appState.documentText(),
      parent: container,
      extensions: [
        ...createEditorExtensions({
          onDocumentChanged: (update) => {
            if (!update.docChanged) return
            const text = update.state.doc.toString()
            appState.onDocumentEdited(text)
            lintController.scheduleLint()

            const workspaceId = appState.activeWorkspaceId()
            if (workspaceId !== undefined) {
              persistWorkspaceDocumentDebounced(workspaceId, {
                name: appState.documentName(),
                content: text,
                docType: appState.docType(),
                updatedAt: Date.now()
              })
            }
          },
          onFormatShortcut: () => {
            void formatDocumentAction()
          },
          showLineNumbers: appState.config.editor.showLineNumbers
        })
      ]
    })
    setEditorView(view)

    createEffect(() => {
      const diagnostics = appState.diagnostics()
      view.dispatch(setDiagnostics(view.state, toCodeMirrorDiagnostics(diagnostics)))
    })

    createEffect(() => {
      const text = appState.documentText()
      if (view.state.doc.toString() === text) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: [Transaction.addToHistory.of(false)]
      })
    })

    createEffect(() => {
      const show = appState.config.editor.showLineNumbers
      view.dispatch({
        effects: lineNumbersCompartment.reconfigure(show ? lineNumbers() : [])
      })
    })

    onCleanup(() => {
      view.destroy()
      setEditorView(null)
    })
  })

  return (
    <section class="editor-pane" aria-label="文書エディタ">
      <div class="editor-container" ref={container} role="textbox" aria-multiline="true" aria-label="文書編集領域" />
      <Show when={appState.workerStatus() === 'error'}>
        <div class="editor-worker-error" role="alert">
          解析Workerが停止しています。Editorは引き続き利用できます。
          <button type="button" class="btn btn-small" onClick={() => lintController.restartWorker()}>
            Workerを再生成
          </button>
        </div>
      </Show>
    </section>
  )
}
