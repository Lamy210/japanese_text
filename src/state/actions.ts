/**
 * アプリケーションアクション — Format Document / Quick Fix / Import / Export / Theme
 */

import type { Diagnostic, DocumentType } from '../core/types'
import type { AppConfig, PresetId, ThemeMode } from '../core/config/schema'
import { generateId } from '../core/config/schema'
import { createAllowedTypoTerm } from '../core/rules/fast/common-typo'
import { createIgnoredDiagnostic, MAX_IGNORED_PER_DOCUMENT } from './ignored-diagnostics'
import { replaceDocumentIgnores } from '../storage/document-ignore-store'
import type { Workspace } from '../core/workspace/types'
import type { EditableDocument } from '../document/types'
import { formatDocument as formatDocumentCore } from '../core/formatter/formatter'
import { checkCompleteFormatterLint } from '../core/formatter/lint-safety'
import { prepareConfigImport } from '../core/config/transfer'
import { applyFixesTransaction, applyReplacement, jumpToPosition } from '../editor/editor-adapter'
import { lintController } from './lint-controller'
import { appState } from './app-state'
import {
  getStorageContext,
  saveConfig as persistConfig,
  saveWorkspaceDocument,
  isStorageAvailable,
  type StoredDocument
} from '../storage/storage'

export function quickFix(diagnostic: Diagnostic): void {
  if (diagnostic.replacement === undefined) return
  applyReplacement(diagnostic.start, diagnostic.end, diagnostic.replacement, 'input.quickfix')
  appState.pushToast('success', '修正を適用しました。')
}

/** Accept a highlighted curated typo as intentional terminology, not as a text edit. */
export function allowDiagnosticSpelling(diagnostic: Diagnostic): boolean {
  const entry = createAllowedTypoTerm(
    diagnostic,
    appState.documentText(),
    appState.config.terminology,
    generateId('typo-allowed')
  )
  if (entry === null) {
    appState.pushToast('warning', '古い診断結果か、既に用語集へ登録された表記です。再解析結果を確認してください。')
    return false
  }
  appState.addTerm(entry)
  // A previous asynchronous Worker result is invalid after the vocabulary change.
  appState.invalidateAnalysisForConfigChange()
  persistAndRelint()
  appState.pushToast('success', `「${entry.preferred}」を許可しました。設定の用語集から解除できます。`)
  return true
}

/**
 * Session-only for Private Session. In Local Library, commit to IndexedDB
 * BEFORE reflecting the change in UI; failed writes never silently appear
 * saved. Serializing ignore/restore prevents lost concurrent updates.
 */
let ignoreWritePending = false

async function durableIgnoreContext(): Promise<
  { workspaceId: string; documentId: string; db: IDBDatabase } | null
> {
  const workspaceId = appState.activeWorkspaceId()
  const documentId = appState.activeDocumentId()
  if (!workspaceId || !documentId) return null
  const { applicationRuntime } = await import('./application-runtime')
  const current = await (await applicationRuntime.getWorkspaceService()).getActive()
  if (current.workspace.id !== workspaceId || appState.activeDocumentId() !== documentId ||
      appState.activeWorkspaceId() !== workspaceId) return null
  if (current.workspace.storageMode !== 'local-library') return null
  const storage = await applicationRuntime.getStorageContext()
  if (!storage.durable || !storage.db) throw new Error('Local Library storage is unavailable')
  return { workspaceId, documentId, db: storage.db }
}

function isCurrentDiagnostic(d: Diagnostic): boolean {
  return appState.diagnostics().some(item =>
    item.id === d.id && item.ruleId === d.ruleId && item.source === d.source &&
    item.start === d.start && item.end === d.end
  )
}

/** Ignore an exact rule+text match in the current document, with durable Local Library storage. */
export async function ignoreDiagnosticForDocument(diagnostic: Diagnostic): Promise<boolean> {
  if (ignoreWritePending) return false
  const workspaceId = appState.activeWorkspaceId()
  const documentId = appState.activeDocumentId()
  const revision = appState.revision()
  const entry = createIgnoredDiagnostic(diagnostic, appState.documentText())
  if (!workspaceId || !documentId || !entry || !isCurrentDiagnostic(diagnostic)) return false
  const existing = appState.ignoredForActiveDocument()
  if (existing.length >= MAX_IGNORED_PER_DOCUMENT || existing.some(item => item.key === entry.key)) return false
  ignoreWritePending = true
  try {
    const ctx = await durableIgnoreContext()
    if (ctx !== null) {
      if (workspaceId !== ctx.workspaceId || documentId !== ctx.documentId ||
          revision !== appState.revision() || !isCurrentDiagnostic(diagnostic)) return false
      await replaceDocumentIgnores(ctx.db, workspaceId, documentId, [...existing, entry])
    } else if (appState.activeWorkspaceId() !== workspaceId ||
               appState.activeDocumentId() !== documentId || revision !== appState.revision()) return false
    const accepted = appState.activeWorkspaceId() === workspaceId &&
      appState.activeDocumentId() === documentId &&
      appState.ignoreDiagnosticForCurrentDocument(diagnostic)
    if (accepted) appState.pushToast('success',
      ctx === null ? 'この文書で無視しました（このタブ内のみ）。' : 'この文書の無視設定をLocal Libraryへ保存しました。')
    return accepted
  } catch (error) {
    appState.pushToast('error', `無視設定を保存できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    return false
  } finally {
    ignoreWritePending = false
  }
}

/** Restore an ignored diagnostic, and remove durable data before updating the UI. */
export async function restoreDocumentDiagnostic(key: string): Promise<boolean> {
  if (ignoreWritePending) return false
  const workspaceId = appState.activeWorkspaceId()
  const documentId = appState.activeDocumentId()
  if (!workspaceId || !documentId) return false
  const existing = appState.ignoredForActiveDocument()
  if (!existing.some(item => item.key === key)) return false
  ignoreWritePending = true
  try {
    const ctx = await durableIgnoreContext()
    if (ctx !== null) {
      if (workspaceId !== ctx.workspaceId || documentId !== ctx.documentId) return false
      await replaceDocumentIgnores(ctx.db, workspaceId, documentId, existing.filter(item => item.key !== key))
    } else if (appState.activeWorkspaceId() !== workspaceId ||
               appState.activeDocumentId() !== documentId) return false
    const restored = appState.activeWorkspaceId() === workspaceId &&
      appState.activeDocumentId() === documentId &&
      appState.restoreIgnoredForCurrentDocument(key)
    if (restored) appState.pushToast('success', 'この文書の警告を再表示しました。')
    return restored
  } catch (error) {
    appState.pushToast('error', `無視解除を保存できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    return false
  } finally {
    ignoreWritePending = false
  }
}

export function jumpToDiagnostic(diagnostic: Diagnostic): void {
  appState.setSelectedDiagnosticId(diagnostic.id)
  jumpToPosition(diagnostic.start, diagnostic.end)
}

async function activeWorkspaceForHistory(): Promise<Workspace | undefined> {
  const workspaceId = appState.activeWorkspaceId()
  if (workspaceId === undefined) return undefined
  const { applicationRuntime } = await import('./application-runtime')
  const active = await (await applicationRuntime.getWorkspaceService()).getActive()
  return active.workspace.id === workspaceId ? active.workspace : undefined
}

async function captureBeforeFormatCheckpoint(text: string): Promise<boolean> {
  const workspace = await activeWorkspaceForHistory()
  if (workspace === undefined || !workspace.snapshotPolicy.enabled) return true

  try {
    const { documentController } = await import('./workspace-runtime')
    const current = documentController.currentEditableDocument()
    if (
      current.workspaceId !== workspace.id ||
      current.id !== appState.activeDocumentId() ||
      current.content !== text ||
      appState.documentText() !== text
    ) {
      appState.pushToast('warning', '編集中に文書が変更されたためFormatを中止しました。')
      return false
    }
    const { applicationRuntime } = await import('./application-runtime')
    await (await applicationRuntime.getSnapshotService()).capture(workspace, current, 'before-format')
    return true
  } catch (error) {
    appState.pushToast(
      'error',
      `Format前の履歴保存に失敗したためFormatを中止しました: ${error instanceof Error ? error.message : String(error)}`
    )
    return false
  }
}

export async function formatDocumentAction(): Promise<void> {
  const originalWorkspaceId = appState.activeWorkspaceId()
  const originalDocumentId = appState.activeDocumentId()
  const text = appState.documentText()
  if (text.length === 0) return
  if (!appState.config.formatter.enabled) {
    appState.pushToast('info', 'Formatterは設定で無効になっています。')
    return
  }

  const baselineRevision = appState.revision()
  const baselineResults = await lintController.lintAllNow()
  if (appState.revision() !== baselineRevision || appState.documentText() !== text) {
    appState.pushToast('warning', '編集中に文書が変更されたためFormatを中止しました。')
    return
  }
  const baseline = checkCompleteFormatterLint(baselineResults, baselineRevision)
  if (!baseline.ok) {
    appState.pushToast('warning', '全Tierの解析が正常終了しなかったためFormatを中止しました。')
    return
  }
  const diagnostics = appState.diagnostics()
  const plan = formatDocumentCore(text, diagnostics)
  if (plan.appliedCount === 0) {
    appState.pushToast('info', '適用可能なSafe Fixはありません。')
    return
  }

  // Compare complete raw lint runs (not the UI-filtered ignore state).
  // Skipped, timed-out or failed Shadow tiers cannot prove safety.
  try {
    const shadowResults = await lintController.lintShadowText(plan.text)
    const shadow = checkCompleteFormatterLint(shadowResults, 'shadow')
    if (!shadow.ok) {
      appState.pushToast('warning', 'Format後の全Tierを検証できなかったため変更を適用しませんでした。')
      return
    }
    if (shadow.errorCount > baseline.errorCount) {
      appState.pushToast(
        'warning',
        `Formatを中止しました (新規Errorが ${shadow.errorCount - baseline.errorCount} 件発生する可能性があります)。`
      )
      return
    }
  } catch {
    appState.pushToast('warning', 'Format後の安全性確認に失敗したため変更を適用しませんでした。')
    return
  }

  if (!(await captureBeforeFormatCheckpoint(text))) return
  if (
    appState.activeWorkspaceId() !== originalWorkspaceId ||
    appState.activeDocumentId() !== originalDocumentId ||
    appState.documentText() !== text
  ) {
    appState.pushToast('warning', '編集中に文書が変更されたためFormatを中止しました。')
    return
  }

  applyFixesTransaction(
    plan.appliedFixes.map((d) => ({ start: d.start, end: d.end, replacement: d.replacement ?? '' })),
    'input.format'
  )
  appState.pushToast(
    'success',
    `Format完了: ${plan.appliedCount} 件のSafe Fixを適用${plan.skippedCount > 0 ? ` (競合により ${plan.skippedCount} 件スキップ)` : ''}。Undo 1回で元に戻せます。`
  )
}

/**
 * Header/Open compatibility action. The actual import semantics live in
 * DocumentController so Open participates in document flush, active selection,
 * Private Session isolation, and Local Library persistence rules.
 *
 * Dynamic import avoids a static actions <-> workspace-runtime cycle because
 * workspace-runtime injects cancelPendingDocumentPersistence from this module.
 */
export async function openDocumentFile(file: File): Promise<void> {
  try {
    const { documentController } = await import('./workspace-runtime')
    await documentController.importFile(file)
  } catch (error) {
    appState.pushToast(
      'error',
      `ファイルの読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function exportDocumentFile(): void {
  const name = appState.documentName()
  const text = appState.documentText()
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.md`
    a.click()
    URL.revokeObjectURL(url)
    appState.pushToast('success', `${a.download} をダウンロードしました。`)
  } catch (error) {
    appState.pushToast('error', `書き出しに失敗しました: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function exportConfigFile(): void {
  try {
    const config = JSON.parse(JSON.stringify(appState.config)) as AppConfig
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'japanese-writing-toolkit.config.json'
    a.click()
    URL.revokeObjectURL(url)
    appState.pushToast('success', '設定ファイルを書き出しました。')
  } catch (error) {
    appState.pushToast('error', `設定の書き出しに失敗しました: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function importConfigFile(file: File): Promise<void> {
  try {
    const raw = await file.text()
    const parsed: unknown = JSON.parse(raw)
    const current = JSON.parse(JSON.stringify(appState.config)) as AppConfig
    const validated = prepareConfigImport(parsed, current)
    const result = appState.loadConfigFrom(validated)
    if (!result.ok) {
      appState.pushToast('error', `設定のImportに失敗しました: ${result.error}`)
      return
    }
    persistAndRelint()
    appState.pushToast('success', '設定をImportしました。')
  } catch (error) {
    appState.pushToast('error', `設定ファイルの読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function applyPresetAction(presetId: PresetId): void {
  if (presetId === 'custom') {
    appState.pushToast('info', 'Custom は現在の設定を表します。ルールを変更すると自動的に Custom になります。')
    return
  }
  appState.applyPreset(presetId)
  persistAndRelint()
  appState.pushToast('success', `プリセット「${presetId}」を適用しました。`)
}

export function updateRuleSetting(ruleId: string, patch: { enabled?: boolean; severity?: string; options?: Record<string, number | boolean | string> }): void {
  appState.updateConfig((draft) => {
    const current = draft.rules[ruleId] ?? { enabled: true, severity: 'warning' as const }
    draft.rules[ruleId] = {
      ...current,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.severity !== undefined ? { severity: patch.severity as typeof current.severity } : {}),
      ...(patch.options !== undefined ? { options: { ...(current.options ?? {}), ...patch.options } } : {})
    }
    draft.preset = 'custom'
  })
  persistAndRelint()
}

export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.dataset.theme = prefersDark ? 'dark' : 'light'
  } else {
    root.dataset.theme = theme
  }
}

export function cycleTheme(): void {
  const order: ThemeMode[] = ['light', 'dark', 'system']
  const current = appState.config.theme
  const next = order[(order.indexOf(current) + 1) % order.length]
  appState.setTheme(next)
  applyTheme(next)
  appState.pushToast('info', `テーマ: ${next}`)
}

let configSaveTimer: ReturnType<typeof setTimeout> | null = null
export function persistConfigDebounced(): void {
  if (!isStorageAvailable()) return
  if (configSaveTimer !== null) clearTimeout(configSaveTimer)
  configSaveTimer = setTimeout(() => {
    configSaveTimer = null
    const config = JSON.parse(JSON.stringify(appState.config)) as AppConfig
    persistConfig(config).catch(() => {
      appState.pushToast('warning', '設定の保存に失敗しました (IndexedDB)。')
    })
  }, 400)
}

let documentSaveTimer: ReturnType<typeof setTimeout> | null = null

export interface DocumentPersistenceSnapshot {
  workspaceId: string
  documentId: string
  name: string
  content: string
  docType: DocumentType
  sourceKind: 'local' | 'file'
  createdAt: number
  updatedAt: number
}

export function cancelPendingDocumentPersistence(): void {
  if (documentSaveTimer !== null) {
    clearTimeout(documentSaveTimer)
    documentSaveTimer = null
  }
}

function editableFromPersistence(snapshot: DocumentPersistenceSnapshot): EditableDocument {
  return {
    id: snapshot.documentId,
    workspaceId: snapshot.workspaceId,
    name: snapshot.name,
    content: snapshot.content,
    docType: snapshot.docType,
    sourceKind: snapshot.sourceKind,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt
  }
}

export async function persistCapturedDocument(snapshot: DocumentPersistenceSnapshot): Promise<void> {
  const context = await getStorageContext()
  const workspace = await context.repositories.workspaces.get(snapshot.workspaceId)
  if (workspace === undefined || workspace.storageMode === 'file-backed') return

  const document = editableFromPersistence(snapshot)
  if (workspace.storageMode === 'local-library') {
    if (context.durable === false) return
    const existing = await context.repositories.documents.get(snapshot.documentId)
    if (existing === undefined || existing.workspaceId !== snapshot.workspaceId) return
    const saved = await context.atomic.saveLocalDocumentIfActive(document)
    if (!saved) return
  } else {
    const { applicationRuntime } = await import('./application-runtime')
    const sessionDocument = applicationRuntime.getSessionDocumentLibrary().get(snapshot.workspaceId, snapshot.documentId)
    if (sessionDocument === undefined) return
  }

  try {
    const { applicationRuntime } = await import('./application-runtime')
    await (await applicationRuntime.getSnapshotService()).captureAutosave(workspace, document)
  } catch (error) {
    appState.pushToast(
      'warning',
      `本文は保存しましたが履歴のAutosaveに失敗しました: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Debounced product autosave. Destination and body are captured at schedule time;
 * the callback never re-resolves current Workspace/Document selection or editor state.
 */
export function persistDocumentDebounced(snapshot: DocumentPersistenceSnapshot): void {
  cancelPendingDocumentPersistence()
  const captured = structuredClone(snapshot)
  documentSaveTimer = setTimeout(() => {
    documentSaveTimer = null
    persistCapturedDocument(captured).catch(() => undefined)
  }, 800)
}

/** Phase 2B compatibility path. Active product code must use persistDocumentDebounced(). */
export function persistWorkspaceDocumentDebounced(workspaceId: string, document: StoredDocument): void {
  if (!isStorageAvailable()) return
  cancelPendingDocumentPersistence()
  const capturedWorkspaceId = workspaceId
  const capturedDocument = structuredClone(document)
  documentSaveTimer = setTimeout(() => {
    documentSaveTimer = null
    saveWorkspaceDocument(capturedWorkspaceId, capturedDocument).catch(() => undefined)
  }, 800)
}

export function persistAndRelint(): void {
  persistConfigDebounced()
  lintController.relintAll()
}

/**
 * Legacy Settings compatibility hook. Phase 2B storage policy is canonical on
 * Workspace.storageMode, so direct privacy toggles only redirect to Workspace Manage.
 */
export function onPrivacyModeChanged(_enabled: boolean): void {
  appState.setWorkspaceManagerOpen(true)
  appState.pushToast('info', '本文の保存方式は「ワークスペース管理」から変更してください。')
}
