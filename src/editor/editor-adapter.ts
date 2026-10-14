/**
 * Editor Adapter — 仕様書 §63 (Editor Adapter → Core の境界を維持)
 *
 * CodeMirror固有の操作をここに隔離する。CoreはCodeMirrorの型に依存させない。
 * - Undo統合: Format / Quick Fix はそれぞれ1つのtransactionとしてEditor Historyへ統合 (§42)
 */

import { EditorView } from '@codemirror/view'

let editorView: EditorView | null = null

export function setEditorView(view: EditorView | null): void {
  editorView = view
}

export function getEditorView(): EditorView | null {
  return editorView
}

/** 該当範囲へ選択を移動し、画面中央にスクロールする */
export function jumpToPosition(from: number, to: number): void {
  const view = editorView
  if (view === null) return
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
