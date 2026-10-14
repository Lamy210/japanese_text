/**
 * アプリケーション状態 — 仕様書 §40 State Management
 *
 * Redux等のglobal state libraryは導入せず、SolidJS primitives (signal / store) を利用する。
 * 主要state: currentDocument / currentRevision / diagnostics / selectedDiagnostic /
 *           ruleConfig / preset / editorPreferences / analysisState
 */

import { createMemo, createSignal, createRoot } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { Diagnostic, DocumentType, RuleError, RuleTier } from '../core/types'
import {
  type AppConfig,
  type NgWordEntry,
  type PresetId,
  type TermEntry,
  type ThemeMode
} from '../core/config/schema'
import { createDefaultConfig, validateAppConfig } from '../core/config/validate'
import { getPreset } from '../core/config/presets'
import { WELCOME_DOCUMENT } from './welcome-document'

export interface TierResult {
  revision: number
  diagnostics: Diagnostic[]
  ruleErrors: RuleError[]
  durationMs: number
}

export type AnalysisStatus = 'idle' | 'linting' | 'error' | 'off'
export type WorkerStatus = 'starting' | 'ok' | 'error'

// ----------------------------------------------------------------
// Document state
// ----------------------------------------------------------------
const [documentText, setDocumentText] = createSignal<string>(WELCOME_DOCUMENT)
const [documentName, setDocumentName] = createSignal<string>('welcome.md')
const [docType, setDocType] = createSignal<DocumentType>('markdown')
const [revision, setRevision] = createSignal<number>(0)

// ----------------------------------------------------------------
// Diagnostics state
// ----------------------------------------------------------------
const [tierResults, setTierResults] = createStore<Record<RuleTier, TierResult | undefined>>({
  fast: undefined,
  deep: undefined,
  idle: undefined
})
const [selectedDiagnosticId, setSelectedDiagnosticId] = createSignal<string | null>(null)
const [severityFilter, setSeverityFilter] = createSignal<'all' | 'error' | 'warning' | 'info'>('all')

/** 表示する診断 = 現在revisionと一致するtier結果のマージ (§24: 最新revisionのみ表示)
 * モジュールスコープのmemoはアプリ寿命と同じため createRoot で包む (破棄警告の解消) */
const derived = createRoot(() => {
const diagnostics = createMemo<Diagnostic[]>(() => {
  const rev = revision()
  const merged: Diagnostic[] = []
  for (const tier of ['fast', 'deep', 'idle'] as const) {
    const result = tierResults[tier]
    if (result !== undefined && result.revision === rev) {
      merged.push(...result.diagnostics)
    }
  }
  return merged.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId))
})

const filteredDiagnostics = createMemo<Diagnostic[]>(() => {
  const filter = severityFilter()
  if (filter === 'all') return diagnostics()
  return diagnostics().filter((d) => d.severity === filter)
})

const diagnosticCounts = createMemo(() => {
  const counts = { error: 0, warning: 0, info: 0, fixable: 0 }
  for (const d of diagnostics()) {
    counts[d.severity]++
    if (d.fixKind !== 'none' && d.replacement !== undefined) counts.fixable++
  }
  return counts
})

const activeRuleErrors = createMemo<RuleError[]>(() => {
  const rev = revision()
  const errors: RuleError[] = []
  const seen = new Set<string>()
  for (const tier of ['fast', 'deep', 'idle'] as const) {
    const result = tierResults[tier]
    if (result !== undefined && result.revision === rev) {
      for (const err of result.ruleErrors) {
        const key = `${err.ruleId}:${err.message}`
        if (!seen.has(key)) {
          seen.add(key)
          errors.push(err)
        }
      }
    }
  }
  return errors
})

const lastTimings = createMemo(() => {
  const rev = revision()
  return {
    fast: tierResults.fast?.revision === rev ? tierResults.fast.durationMs : undefined,
    deep: tierResults.deep?.revision === rev ? tierResults.deep.durationMs : undefined,
    idle: tierResults.idle?.revision === rev ? tierResults.idle.durationMs : undefined
  }
})

return { diagnostics, filteredDiagnostics, diagnosticCounts, activeRuleErrors, lastTimings }
})
const { diagnostics, filteredDiagnostics, diagnosticCounts, activeRuleErrors, lastTimings } = derived

// ----------------------------------------------------------------
// Config state (IndexedDBから復元、なければデフォルト)
// ----------------------------------------------------------------
const [config, setConfigState] = createStore<AppConfig>(createDefaultConfig())
const [configLoaded, setConfigLoaded] = createSignal(false)

function setConfig(next: AppConfig): void {
  setConfigState({ ...next })
}

// ----------------------------------------------------------------
// Analysis / Worker state
// ----------------------------------------------------------------
const [analysisStatus, setAnalysisStatus] = createSignal<AnalysisStatus>('idle')
const [workerStatus, setWorkerStatus] = createSignal<WorkerStatus>('starting')
const [workerErrorMessage, setWorkerErrorMessage] = createSignal<string | null>(null)
const [segmenterAvailable, setSegmenterAvailable] = createSignal<boolean>(true)
const [storageAvailable, setStorageAvailable] = createSignal<boolean>(true)

// ----------------------------------------------------------------
// UI state
// ----------------------------------------------------------------
const [settingsOpen, setSettingsOpen] = createSignal(false)
const [panelOpen, setPanelOpen] = createSignal(true) // tablet drawer / mobile bottom sheet
const [settingsTab, setSettingsTab] = createSignal<'rules' | 'ngwords' | 'terminology' | 'citation' | 'general'>(
  'rules'
)

// ----------------------------------------------------------------
// Toasts
// ----------------------------------------------------------------
export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error' | 'warning'
  message: string
}
const [toasts, setToasts] = createSignal<Toast[]>([])
let toastId = 0

function pushToast(kind: Toast['kind'], message: string): void {
  const id = ++toastId
  setToasts((prev) => [...prev, { id, kind, message }])
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, 4200)
}

// ----------------------------------------------------------------
// Export (読み取り専用シグナル + 制御関数)
// ----------------------------------------------------------------
export const appState = {
  // document
  documentText,
  documentName,
  docType,
  revision,
  setDocument: (text: string, name?: string, type?: DocumentType): void => {
    setDocumentText(text)
    if (name !== undefined) setDocumentName(name)
    if (type !== undefined) setDocType(type)
    setRevision((r) => r + 1)
  },
  /** エディタ入力による本文更新 (revisionを進める) */
  onDocumentEdited: (text: string): void => {
    setDocumentText(text)
    setRevision((r) => r + 1)
  },
  // diagnostics
  diagnostics,
  filteredDiagnostics,
  diagnosticCounts,
  severityFilter,
  setSeverityFilter,
  selectedDiagnosticId,
  setSelectedDiagnosticId,
  activeRuleErrors,
  lastTimings,
  tierResults,
  /** Worker結果の反映 (revision一致時のみ — §24) */
  applyWorkerResult: (tier: RuleTier, result: TierResult): void => {
    setTierResults(tier, result)
  },
  // config
  config,
  configLoaded,
  setConfigLoaded,
  loadConfigFrom(raw: unknown): { ok: boolean; error?: string } {
    try {
      const validated = validateAppConfig(raw)
      setConfig(validated)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  updateConfig: (mutator: (draft: AppConfig) => void): void => {
    // 疎な更新のため、コピー→変更→検証→反映 (常にvalidな状態を保つ)
    const next = structuredClone(unwrap(config))
    mutator(next)
    const validated = validateAppConfig(next)
    setConfig(validated)
  },
  applyPreset: (presetId: PresetId): void => {
    const preset = getPreset(presetId)
    if (preset === undefined) return
    appState.updateConfig((draft) => {
      draft.rules = structuredClone(preset.rules)
      draft.citation = { ...preset.citation }
      draft.preset = presetId
    })
  },
  // ng words / terminology helpers
  addNgWord: (entry: NgWordEntry): void => {
    appState.updateConfig((d) => {
      d.ngWords.push(entry)
    })
  },
  removeNgWord: (id: string): void => {
    appState.updateConfig((d) => {
      d.ngWords = d.ngWords.filter((e) => e.id !== id)
    })
  },
  addTerm: (entry: TermEntry): void => {
    appState.updateConfig((d) => {
      d.terminology.push(entry)
    })
  },
  removeTerm: (id: string): void => {
    appState.updateConfig((d) => {
      d.terminology = d.terminology.filter((e) => e.id !== id)
    })
  },
  setTheme: (theme: ThemeMode): void => {
    appState.updateConfig((d) => {
      d.theme = theme
    })
  },
  // analysis
  analysisStatus,
  setAnalysisStatus,
  workerStatus,
  setWorkerStatus,
  workerErrorMessage,
  setWorkerErrorMessage,
  segmenterAvailable,
  setSegmenterAvailable,
  storageAvailable,
  setStorageAvailable,
  // ui
  settingsOpen,
  setSettingsOpen,
  panelOpen,
  setPanelOpen,
  settingsTab,
  setSettingsTab,
  // toasts
  toasts,
  pushToast
}

/** storeの実体を取り出す (structuredClone用) */
function unwrap(store: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(store)) as AppConfig
}

export type AppState = typeof appState
