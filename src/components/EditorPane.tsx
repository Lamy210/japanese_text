/**
 * EditorPane — CodeMirror 6 マウント + 診断の反映 (§9.1 Main Editor)
 *
 * - Worker由来のDiagnosticを setDiagnostics でEditorへ反映 (underline / marker / gutter)
 * - 行番号表示は設定から toggle (Compartmentで再構成)
 * - Editor の初期化は1回のみ行う (Solid onMount)
 */

import { onMount, onCleanup, createEffect, Show } from 'solid-js'
import { EditorView, lineNumbers } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { setDiagnostics } from '@codemirror/lint'
import { createEditorExtensions, toCodeMirrorDiagnostics, lineNumbersCompartment } from '../editor/cm-extensions'
import { setEditorView } from '../editor/editor-adapter'
import { appState } from '../state/app-state'
import { lintController } from '../state/lint-controller'
import { formatDocumentAction, persistDocumentDebounced } from '../state/actions'

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
            appState.onDocumentEdited(update.state.doc.toString())
            lintController.scheduleLint()
            persistDocumentDebounced()
          },
          onFormatShortcut: () => {
            void formatDocumentAction()
          },
          showLineNumbers: appState.config.editor.showLineNumbers
        })
      ]
    })
    setEditorView(view)

    // 診断 → CodeMirror (Worker結果をUIへ統合)
    createEffect(() => {
      const diagnostics = appState.diagnostics()
      view.dispatch(setDiagnostics(view.state, toCodeMirrorDiagnostics(diagnostics)))
    })

    // プログラマティックな文書変更 (ファイルOpen / 起動時復元) をエディタへ反映。
    // エディタ由来の変更は signal と一致するため再dispatchされない (ループなし)。
    // 復元・OpenはUndo履歴に残さない (§42: ユーザーの編集単位のみをHistoryへ)。
    createEffect(() => {
      const text = appState.documentText()
      if (view.state.doc.toString() === text) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: [Transaction.addToHistory.of(false)]
      })
    })

    // 行番号トグル
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
