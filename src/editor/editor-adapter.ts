/**
 * Editor Adapter — 仕様書 §63 (Editor Adapter → Core の境界を維持)
 *
 * CodeMirror固有の操作をここに隔離する。CoreはCodeMirrorの型に依存させない。
 * - Undo統合: Format / Quick Fix はそれぞれ1つのtransactionとしてEditor Historyへ統合 (§42)
 */

import { EditorView } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import { planMarkdownEdit, type MarkdownCommand } from './markdown-commands'

let editorView: EditorView | null = null
let revealEditor: (() => void) | undefined

export function setEditorView(view: EditorView | null, reveal?: () => void): void {
  editorView = view
  revealEditor = view === null ? undefined : reveal
}

export function getEditorView(): EditorView | null {
  return editorView
}

/** 該当範囲へ選択を移動し、画面中央にスクロールする */
export function jumpToPosition(from: number, to: number): void {
  const view = editorView
  if (view === null) return
  revealEditor?.()
  const docLength = view.state.doc.length
  const safeFrom = Math.max(0, Math.min(from, docLength))
  const safeTo = Math.max(safeFrom, Math.min(to, docLength))
  view.dispatch({
    selection: { anchor: safeFrom, head: safeTo },
    effects: EditorView.scrollIntoView(safeFrom, { y: 'center' }),
    userEvent: 'select.diagnostic'
  })
  view.focus()
}

/** 1つのtransactionとして置換を適用 (Undo 1回で戻る — §42) */
export function applyReplacement(from: number, to: number, insert: string, userEvent: string): void {
  const view = editorView
  if (view === null) return
  revealEditor?.()
  const docLength = view.state.doc.length
  const safeFrom = Math.max(0, Math.min(from, docLength))
  const safeTo = Math.max(safeFrom, Math.min(to, docLength))
  view.dispatch({
    changes: { from: safeFrom, to: safeTo, insert },
    // カーソルを修正後のテキスト末尾へ
    selection: { anchor: safeFrom + insert.length },
    userEvent
  })
  view.focus()
}

/** 複数の修正を1つのtransactionで適用 (Format Document — §42: Undo 1回でFormat前に戻れる) */
export function applyFixesTransaction(
  fixes: Array<{ start: number; end: number; replacement: string }>,
  userEvent: string
): void {
  const view = editorView
  if (view === null || fixes.length === 0) return
  revealEditor?.()
  view.dispatch({
    changes: fixes.map((f) => ({ from: f.start, to: f.end, insert: f.replacement })),
    userEvent
  })
  view.focus()
}

/** 現在のドキュメント本文を取得 */
export function getDocumentText(): string {
  return editorView?.state.doc.toString() ?? ''
}

/** Apply a single undoable Markdown toolbar transaction. */
export function applyMarkdownCommand(command: MarkdownCommand): boolean {
  const view = editorView
  if (view === null || view.state.selection.ranges.length !== 1) return false
  const { from, to } = view.state.selection.main
  const edit = planMarkdownEdit(view.state.doc.toString(), from, to, command)
  if (edit === null) return false
  revealEditor?.()
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.anchor, head: edit.head },
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
    userEvent: 'input.markdown'
  })
  view.focus()
  return true
}
