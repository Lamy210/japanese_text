/**
 * CodeMirror 6 拡張構成 — 仕様書 §11 (Editor仕様) / §9.1 (Diagnostic表示)
 *
 * v1では必要なmoduleのみ導入し「全部入り」のEditor設定は使用しない (§11)。
 * 必須: History / Search / Selection / Line Number / Markdown syntax /
 *       Diagnostic decorations / Lint gutter / Keyboard shortcuts
 * 診断はWorker由来のため linter() による自動実行は行わず、
 * setDiagnostics() により imperative に反映する。
 */

import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  type ViewUpdate
} from '@codemirror/view'
import { Compartment, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { lintGutter, lintKeymap, type Diagnostic as CMDiagnostic, type Action } from '@codemirror/lint'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { Diagnostic } from '../core/types'

export const lineNumbersCompartment = new Compartment()

/** アプリのDiagnostic → CodeMirror Diagnostic 変換 (Quick Fix action付き) */
export function toCodeMirrorDiagnostics(diagnostics: Diagnostic[]): CMDiagnostic[] {
  return diagnostics.map((d) => {
    const actions: Action[] = []
    if (d.replacement !== undefined) {
      actions.push({
        name: d.fixKind === 'safe' ? '修正 (Safe Fix)' : '修正 (Suggestion)',
        apply: (view: EditorView) => {
          // §42: Quick FixはEditor Historyへ統合
          view.dispatch({
            changes: { from: d.start, to: d.end, insert: d.replacement ?? '' },
            selection: { anchor: d.start + (d.replacement ?? '').length },
            userEvent: 'input.quickfix'
          })
        }
      })
    }
    const severityLabel = d.severity === 'error' ? 'Error' : d.severity === 'warning' ? 'Warning' : 'Info'
    return {
      from: d.start,
      to: d.end,
      severity: d.severity,
      source: d.ruleId,
      message: `${severityLabel} [${d.ruleId}]\n${d.message}`,
      actions
    }
  })
}

export function createEditorExtensions(options: {
  onDocumentChanged: (update: ViewUpdate) => void
  onFormatShortcut: () => void
  showLineNumbers: boolean
}): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    lineNumbersCompartment.of(options.showLineNumbers ? lineNumbers() : []),
    markdown({ base: markdownLanguage, codeLanguages: [] }),
    search({ top: true }),
    lintGutter(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...lintKeymap,
      indentWithTab,
      {
        key: 'Shift-Alt-f',
        preventDefault: true,
        run: () => {
          options.onFormatShortcut()
          return true
        }
      }
    ]),
    EditorView.updateListener.of(options.onDocumentChanged)
  ]
}
