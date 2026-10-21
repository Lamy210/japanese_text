import { afterEach, describe, expect, test } from 'vitest'
import {
  createIgnoredDiagnostic,
  isIgnoredDiagnostic,
  documentIgnoreScope
} from '../../src/state/ignored-diagnostics'
import type { Diagnostic } from '../../src/core/types'
import { appState } from '../../src/state/app-state'
import { createDefaultConfig } from '../../src/core/config/validate'
import { formatDocument } from '../../src/core/formatter/formatter'

function diagnostic(text: string, ruleId = 'wording/common-typo', occurrence = 0): Diagnostic {
  const token = 'デバック'
  const start = text.indexOf(token, occurrence)
  if (start === -1) throw new Error('missing typo test term')
  return {
    id: `${ruleId}@${start}-${start + token.length}`,
    ruleId,
    source: 'core',
    start,
    end: start + token.length,
    message: '書き換え候補',
    severity: 'warning',
    line: 1,
    column: start + 1,
    fixKind: 'safe',
    replacement: 'デバッグ'
  }
}

function setDocumentWithDiagnostics(workspace: string, id: string, text: string, results: Diagnostic[]): void {
  appState.setActiveWorkspaceId(workspace)
  appState.setActiveDocumentId(id)
  appState.setDocument(text)
  appState.applyWorkerResult('fast', {
    revision: appState.revision(),
    diagnostics: results,
    ruleErrors: [],
    durationMs: 2
  })
}

afterEach(() => {
  appState.clearIgnoredWorkspace('workspace-a')
  appState.clearIgnoredWorkspace('workspace-b')
  appState.setActiveDocumentId(undefined)
  appState.setActiveWorkspaceId(undefined)
  appState.resetDiagnosticsForDocumentContext()
  appState.loadConfigFrom(createDefaultConfig())
})

describe('document-local session diagnostic suppression', () => {
  test('constructs deterministic keys and validates scope', () => {
    expect(documentIgnoreScope('workspace-a', 'doc-a')).toBe(JSON.stringify(['workspace-a', 'doc-a']))
    expect(documentIgnoreScope('workspace-a', undefined)).toBeNull()
    expect(documentIgnoreScope(undefined, 'doc-a')).toBeNull()
    expect(documentIgnoreScope('workspace-a', '')).toBeNull()
    const text = '📚デバックです。'
    const entry = createIgnoredDiagnostic(diagnostic(text), text)
    expect(entry?.excerpt).toBe('デバック')
    expect(entry?.ruleId).toBe('wording/common-typo')
    expect(entry?.source).toBe('core')
    expect(entry?.key).toBe(JSON.stringify(['core', 'wording/common-typo', 'デバック']))
  })

  test('refuses a stale or malicious offset, empty span, and missing content', () => {
    const text = 'デバックです。'
    const d = diagnostic(text)
    expect(createIgnoredDiagnostic({ ...d, start: -1 }, text)).toBeNull()
    expect(createIgnoredDiagnostic({ ...d, end: 999 }, text)).toBeNull()
    expect(createIgnoredDiagnostic({ ...d, end: d.start }, text)).toBeNull()
    expect(createIgnoredDiagnostic({ ...d, ruleId: '' }, text)).toBeNull()
    expect(createIgnoredDiagnostic({ ...d, start: Number.NaN }, text)).toBeNull()
    expect(createIgnoredDiagnostic(d, text + ' '.repeat(300))).toBeTruthy()
  })

  test('keeps rule and source isolation for the same matched text', () => {
    const text = 'デバックを確認します。'
    const d = diagnostic(text)
    const ignored = createIgnoredDiagnostic(d, text)!
    expect(isIgnoredDiagnostic(d, text, [ignored])).toBe(true)
    expect(isIgnoredDiagnostic(diagnostic(text, 'wording/terminology'), text, [ignored])).toBe(false)
    expect(isIgnoredDiagnostic({ ...d, source: 'user' }, text, [ignored])).toBe(false)
    expect(isIgnoredDiagnostic(d, 'デバッグを確認します。', [ignored])).toBe(false)
  })

  test('suppresses all identical occurrences in one document but not other rule outputs', () => {
    const text = 'デバックとデバックについて。'
    const first = diagnostic(text)
    const second = diagnostic(text, 'wording/common-typo', first.end)
    const separate = { ...diagnostic(text, 'wording/terminology'), fixKind: 'none' as const, replacement: undefined }
    setDocumentWithDiagnostics('workspace-a', 'doc-a', text, [first, second, separate])
    expect(appState.diagnosticCounts().warning).toBe(3)
    expect(appState.ignoreDiagnosticForCurrentDocument(first)).toBe(true)
    expect(appState.diagnostics()).toEqual([separate])
    expect(appState.filteredDiagnostics()).toEqual([separate])
    expect(appState.diagnosticCounts().warning).toBe(1)
    expect(appState.ignoredForActiveDocument()).toHaveLength(1)
    expect(appState.ignoreDiagnosticForCurrentDocument(first)).toBe(false)
    expect(formatDocument(text, appState.diagnostics()).text).toBe('デバックとデバックについて。')
  })

  test('ignores the same rule and text after offsets shift on edit', () => {
    const oldText = 'デバックです。'
    const d = diagnostic(oldText)
    setDocumentWithDiagnostics('workspace-a', 'doc-a', oldText, [d])
    expect(appState.ignoreDiagnosticForCurrentDocument(d)).toBe(true)
    const newText = '📚報告します。' + oldText
    appState.setDocument(newText)
    appState.applyWorkerResult('fast', {
      revision: appState.revision(), diagnostics: [diagnostic(newText)], ruleErrors: [], durationMs: 1
    })
    expect(appState.diagnostics()).toEqual([])
    expect(appState.ignoredForActiveDocument()).toHaveLength(1)
  })

  test('isolates by workspace AND document identity, and allows restoring later', () => {
    const text = 'デバックです。'
    const d = diagnostic(text)
    setDocumentWithDiagnostics('workspace-a', 'doc-a', text, [d])
    expect(appState.ignoreDiagnosticForCurrentDocument(d)).toBe(true)
    const key = appState.ignoredForActiveDocument()[0]!.key
    setDocumentWithDiagnostics('workspace-a', 'doc-b', text, [d])
    expect(appState.diagnostics()).toHaveLength(1)
    expect(appState.ignoredForActiveDocument()).toHaveLength(0)
    setDocumentWithDiagnostics('workspace-b', 'doc-a', text, [d])
    expect(appState.diagnostics()).toHaveLength(1)
    setDocumentWithDiagnostics('workspace-a', 'doc-a', text, [d])
    expect(appState.diagnostics()).toEqual([])
    expect(appState.restoreIgnoredForCurrentDocument(key)).toBe(true)
    expect(appState.diagnostics()).toEqual([d])
    expect(appState.restoreIgnoredForCurrentDocument(key)).toBe(false)
  })

  test('requires current diagnostics and a real active document', () => {
    const text = 'デバックです。'
    const d = diagnostic(text)
    setDocumentWithDiagnostics('workspace-a', 'doc-a', text, [d])
    expect(appState.ignoreDiagnosticForCurrentDocument({ ...d, id: 'spoofed' })).toBe(false)
    expect(appState.ignoreDiagnosticForCurrentDocument({ ...d, start: 1 })).toBe(false)
    appState.setDocument('本文が変更されました。')
    expect(appState.ignoreDiagnosticForCurrentDocument(d)).toBe(false)
    appState.setActiveDocumentId(undefined)
    expect(appState.ignoreDiagnosticForCurrentDocument(d)).toBe(false)
  })

  test('deletion erases scoped session ignores and prevents same-ID reuse', () => {
    const text = 'デバックです。'
    const d = diagnostic(text)
    setDocumentWithDiagnostics('workspace-a', 'doc-a', text, [d])
    expect(appState.ignoreDiagnosticForCurrentDocument(d)).toBe(true)
    appState.clearIgnoredDocument('workspace-a', 'doc-a')
    expect(appState.ignoredForActiveDocument()).toEqual([])
    expect(appState.diagnostics()).toEqual([d])
    expect(appState.ignoreDiagnosticForCurrentDocument(d)).toBe(true)
    appState.clearIgnoredWorkspace('workspace-a')
    expect(appState.ignoredForActiveDocument()).toEqual([])
  })

  test('never stores any ignored diagnostic in persisted configuration', () => {
    const text = 'デバックです。'
    setDocumentWithDiagnostics('workspace-a', 'doc-a', text, [diagnostic(text)])
    const before = JSON.stringify(appState.config)
    expect(appState.ignoreDiagnosticForCurrentDocument(diagnostic(text))).toBe(true)
    expect(JSON.stringify(appState.config)).toBe(before)
  })
})
