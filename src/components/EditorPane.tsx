/**
 * EditorPane — CodeMirror 6 マウント + 診断の反映 (§9.1 Main Editor)
 */

import { onMount, onCleanup, createEffect, createSignal, For, Show } from 'solid-js'
import { MarkdownPreview } from './MarkdownPreview'
import './MarkdownPreview.css'
import { EditorView, lineNumbers } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { setDiagnostics } from '@codemirror/lint'
import { createEditorExtensions, toCodeMirrorDiagnostics, lineNumbersCompartment } from '../editor/cm-extensions'
import { setEditorView, applyMarkdownCommand } from '../editor/editor-adapter'
import type { MarkdownCommand } from '../editor/markdown-commands'
import { appState } from '../state/app-state'
import { lintController } from '../state/lint-controller'
import { formatDocumentAction, persistDocumentDebounced } from '../state/actions'

const MARKDOWN_TOOLS: ReadonlyArray<{ command: MarkdownCommand; label: string; title: string }> = [
  { command: 'heading', label: 'H2', title: '見出しを挿入' },
  { command: 'bold', label: 'B', title: '太字' },
  { command: 'italic', label: 'I', title: '斜体' },
  { command: 'inline-code', label: 'Code', title: 'インラインコード' },
  { command: 'quote', label: '引用', title: '引用' },
  { command: 'list', label: 'リスト', title: '箇条書き' },
  { command: 'table', label: '表', title: '表のテンプレート（選択なし）' },
  { command: 'mermaid', label: '図の記法', title: 'Mermaidのソースを挿入（描画未対応）' }
]

export function EditorPane() {
  let container: HTMLDivElement | undefined
  const [markdownMode, setMarkdownMode] = createSignal<'edit' | 'split' | 'preview'>('edit')
  const mode = () => appState.docType() === 'markdown' ? markdownMode() : 'edit'
  const showPreview = () => mode() !== 'edit'
  const showEditor = () => mode() !== 'preview'

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
            const documentId = appState.activeDocumentId()
            if (workspaceId !== undefined && documentId !== undefined) {
              const summary = appState.documentSummaries().find((value) => value.id === documentId)
              if (summary !== undefined && summary.workspaceId === workspaceId) {
                persistDocumentDebounced({
                  workspaceId,
                  documentId,
                  name: appState.documentName(),
                  content: text,
                  docType: appState.docType(),
                  sourceKind: summary.sourceKind,
                  createdAt: summary.createdAt,
                  updatedAt: Date.now()
                })
              }
            }
          },
          onFormatShortcut: () => {
            void formatDocumentAction()
          },
          showLineNumbers: appState.config.editor.showLineNumbers
        })
      ]
    })
    setEditorView(view, () => {
      if (!showEditor()) setMarkdownMode('split')
    })

    createEffect(() => {
      if (showEditor()) view.requestMeasure()
    })

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
      <Show when={appState.docType() === 'markdown'}>
        <div class="markdown-view-toolbar" role="group" aria-label="Markdown表示">
          <button type="button" class="btn btn-small" aria-pressed={mode() === 'edit'} onClick={() => setMarkdownMode('edit')}>編集</button>
          <button type="button" class="btn btn-small" aria-pressed={mode() === 'split'} onClick={() => setMarkdownMode('split')}>分割プレビュー</button>
          <button type="button" class="btn btn-small" aria-pressed={mode() === 'preview'} onClick={() => setMarkdownMode('preview')}>プレビューのみ</button>
        </div>
      </Show>
      <Show when={appState.docType() === 'markdown' && showEditor()}>
        <div class="markdown-format-toolbar" role="group" aria-label="Markdown編集支援">
          <For each={MARKDOWN_TOOLS}>{tool => (
            <button type="button" class="btn btn-small" title={tool.title} aria-label={tool.title}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                if (!applyMarkdownCommand(tool.command)) {
                  appState.pushToast('info', 'この選択範囲では挿入できません。選択範囲を調整してください。')
                }
              }}>{tool.label}</button>
          )}</For>
        </div>
      </Show>
      <div class="markdown-editor-layout" classList={{ 'markdown-split': mode() === 'split', 'markdown-preview-only': mode() === 'preview' }}>
        <div class="editor-container" hidden={!showEditor()} ref={container} role="textbox" aria-multiline="true" aria-label="文書編集領域" />
        <Show when={showPreview()}>
          <MarkdownPreview text={appState.documentText()} />
        </Show>
      </div>
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
