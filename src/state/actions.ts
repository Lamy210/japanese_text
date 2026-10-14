/**
 * アプリケーションアクション — Format Document / Quick Fix / Import / Export / Theme
 *
 * Format Document の処理順 (§18):
 * 1. Safe Fix候補収集 → 2. offset競合検査 → 3. Fix順序決定 → 4. 後方offsetから適用
 * → 5. 再Lint (shadow) → 6. 新規Error確認 → 7. Editorへ反映 (1 transaction = Undo 1回)
 */

import type { Diagnostic, DocumentType } from '../core/types'
import type { AppConfig, PresetId, ThemeMode } from '../core/config/schema'
import { formatDocument as formatDocumentCore } from '../core/formatter/formatter'
import { migrateConfig } from '../core/config/validate'
import { applyFixesTransaction, applyReplacement, jumpToPosition } from '../editor/editor-adapter'
import { lintController } from './lint-controller'
import { appState } from './app-state'
import {
  saveConfig as persistConfig,
  saveRecentDocument,
  saveWorkspaceDocument,
  deleteRecentDocument,
  isStorageAvailable,
  type StoredDocument
} from '../storage/storage'

// ----------------------------------------------------------------
// Quick Fix / Jump (§42: Quick FixもEditor Historyへ統合)
// ----------------------------------------------------------------

export function quickFix(diagnostic: Diagnostic): void {
  if (diagnostic.replacement === undefined) return
  applyReplacement(diagnostic.start, diagnostic.end, diagnostic.replacement, 'input.quickfix')
  appState.pushToast('success', '修正を適用しました。')
}

export function jumpToDiagnostic(diagnostic: Diagnostic): void {
  appState.setSelectedDiagnosticId(diagnostic.id)
  jumpToPosition(diagnostic.start, diagnostic.end)
}

// ----------------------------------------------------------------
// Format Document (§18 / §42)
// ----------------------------------------------------------------

export async function formatDocumentAction(): Promise<void> {
  const text = appState.documentText()
  if (text.length === 0) return
  if (!appState.config.formatter.enabled) {
    appState.pushToast('info', 'Formatterは設定で無効になっています。')
    return
  }

  // 1. 現在の診断を確定させる (保留中のスケジュールを即時実行して完了を待つ)
  await lintController.lintAllNow()
  const diagnostics = appState.diagnostics()

  // 2-4. Safe Fix収集・競合検査・後方適用の計画
  const plan = formatDocumentCore(text, diagnostics)
  if (plan.appliedCount === 0) {
    appState.pushToast('info', '適用可能なSafe Fixはありません。')
    return
  }

  // 5-6. 再Lintして新規Errorが増えていないか確認 (§18.6)
  const errorsBefore = diagnostics.filter((d) => d.severity === 'error').length
  try {
    const shadow = await lintController.lintShadowText(plan.text)
    const shadowDiags: Diagnostic[] = []
    for (const result of shadow.values()) shadowDiags.push(...result.diagnostics)
    const errorsAfter = shadowDiags.filter((d) => d.severity === 'error').length
    if (errorsAfter > errorsBefore) {
      appState.pushToast(
        'warning',
        `Formatを中止しました (新規Errorが ${errorsAfter - errorsBefore} 件発生する可能性があります)。`
      )
      return
    }
  } catch {
    // 検証に失敗した場合でもSafe Fixのみのため適用を続行する
  }

  // 7. Editorへ反映 (1 transaction → Undo 1回でFormat前に戻る — §42)
  // CM6のtransaction changesは現在のdoc位置で指定する (複数changeを1つのtransactionへ)
  applyFixesTransaction(
    plan.appliedFixes.map((d) => ({ start: d.start, end: d.end, replacement: d.replacement ?? '' })),
    'input.format'
  )
  appState.pushToast(
    'success',
    `Format完了: ${plan.appliedCount} 件のSafe Fixを適用${plan.skippedCount > 0 ? ` (競合により ${plan.skippedCount} 件スキップ)` : ''}。Undo 1回で元に戻せます。`
  )
}

// ----------------------------------------------------------------
// Document Import / Export (§30)
// ----------------------------------------------------------------

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.mdown', '.mkd']

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export async function openDocumentFile(file: File): Promise<void> {
  const lower = file.name.toLowerCase()
  const isText =
    file.type.startsWith('text/') ||
    TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))
  if (!isText) {
    appState.pushToast('error', `対応していないファイル形式です: ${file.name} (.txt / .md / .markdown を指定してください)`)
    return
  }
  try {
    const raw = await file.text()
    const docType: DocumentType = lower.endsWith('.txt') ? 'text' : 'markdown'
    appState.setDocument(normalizeLineEndings(raw), file.name, docType)
    lintController.relintAll()
    appState.pushToast('success', `${file.name} を開きました。`)
  } catch (error) {
    appState.pushToast('error', `ファイルの読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`)
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

// ----------------------------------------------------------------
// Config Import / Export (§30 / §32)
// ----------------------------------------------------------------

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
    const migrated = migrateConfig(parsed)
    const currentPrivacy = structuredClone(appState.config.privacy)
    const importCandidate =
      typeof migrated === 'object' && migrated !== null && !Array.isArray(migrated)
        ? { ...(migrated as Record<string, unknown>), privacy: currentPrivacy }
        : migrated
    const result = appState.loadConfigFrom(importCandidate)
    if (!result.ok) {
      // §30: 不正configによってApp全体を起動不能にしてはならない → 旧設定を維持
      appState.pushToast('error', `設定のImportに失敗しました: ${result.error}`)
      return
    }
    persistAndRelint()
    appState.pushToast('success', '設定をImportしました。')
  } catch (error) {
    appState.pushToast('error', `設定ファイルの読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ----------------------------------------------------------------
// Preset / Rule 変更 (§31)
// ----------------------------------------------------------------

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

// ----------------------------------------------------------------
// Theme (§39)
// ----------------------------------------------------------------

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

// ----------------------------------------------------------------
// Persistence (§27 / §28)
// ----------------------------------------------------------------

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

export function cancelPendingDocumentPersistence(): void {
  if (documentSaveTimer !== null) {
    clearTimeout(documentSaveTimer)
    documentSaveTimer = null
  }
}

/**
 * Schedule a document write with an explicit destination captured now.
 * The callback never re-resolves the active workspace, preventing switch races.
 */
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

/** Legacy active-workspace path retained until the workspace controller owns editor persistence. */
export function persistDocumentDebounced(): void {
  if (!isStorageAvailable()) return
  if (appState.config.privacy.privacyMode || !appState.config.privacy.autoSave) return
  cancelPendingDocumentPersistence()
  documentSaveTimer = setTimeout(() => {
    documentSaveTimer = null
    saveRecentDocument({
      name: appState.documentName(),
      content: appState.documentText(),
      docType: appState.docType(),
      updatedAt: Date.now()
    }).catch(() => undefined)
  }, 800)
}

export function persistAndRelint(): void {
  persistConfigDebounced()
  lintController.relintAll()
}

/** Privacy Mode有効化時: 保存済み本文を即座に削除 (§28) */
export function onPrivacyModeChanged(enabled: boolean): void {
  if (enabled) {
    cancelPendingDocumentPersistence()
    void deleteRecentDocument()
    appState.pushToast('info', 'プライバシーモードが有効です。文書本文はブラウザに保存されません。')
  }
}
