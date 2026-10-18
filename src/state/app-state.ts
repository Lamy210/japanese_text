/**
 * アプリケーション状態 — 仕様書 §40 State Management
 *
 * Redux等のglobal state libraryは導入せず、SolidJS primitives (signal / store) を利用する。
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
import type { DocumentSnapshot } from '../core/workspace/types'
import type { DocumentSummary } from '../document/types'
import type { SnapshotSummary } from '../history/types'
import type { WorkspaceSummary } from '../workspace/workspace-service'
import type { StorageCapability } from '../workspace/storage-capability'
import { WELCOME_DOCUMENT } from './welcome-document'

export interface TierResult {
  revision: number
  diagnostics: Diagnostic[]
  ruleErrors: RuleError[]
  durationMs: number
}

export type AnalysisStatus = 'idle' | 'linting' | 'error' | 'off'
export type WorkerStatus = 'starting' | 'ok' | 'error'

const [documentText, setDocumentText] = createSignal<string>(WELCOME_DOCUMENT)
const [documentName, setDocumentName] = createSignal<string>('welcome.md')
const [docType, setDocType] = createSignal<DocumentType>('markdown')
const [revision, setRevision] = createSignal<number>(0)
const [documentSummaries, setDocumentSummaries] = createSignal<DocumentSummary[]>([])
const [activeDocumentId, setActiveDocumentId] = createSignal<string | undefined>(undefined)
const [documentLibraryReady, setDocumentLibraryReady] = createSignal(false)
const [documentMutationPending, setDocumentMutationPending] = createSignal(false)
const [documentSidebarOpen, setDocumentSidebarOpen] = createSignal(true)
const [documentFilter, setDocumentFilter] = createSignal('')

const [historyOpen, setHistoryOpen] = createSignal(false)
const [historyLoading, setHistoryLoading] = createSignal(false)
const [historyMutationPending, setHistoryMutationPending] = createSignal(false)
const [historyEntries, setHistoryEntries] = createSignal<SnapshotSummary[]>([])
const [selectedHistorySnapshot, setSelectedHistorySnapshot] = createSignal<DocumentSnapshot | undefined>(undefined)

const [tierResults, setTierResults] = createStore<Record<RuleTier, TierResult | undefined>>({
  fast: undefined,
  deep: undefined,
  idle: undefined
})
const [selectedDiagnosticId, setSelectedDiagnosticId] = createSignal<string | null>(null)
const [severityFilter, setSeverityFilter] = createSignal<'all' | 'error' | 'warning' | 'info'>('all')

const derived = createRoot(() => {
  const diagnostics = createMemo<Diagnostic[]>(() => {
    const rev = revision()
    const merged: Diagnostic[] = []
    for (const tier of ['fast', 'deep', 'idle'] as const) {
      const result = tierResults[tier]
      if (result !== undefined && result.revision === rev) merged.push(...result.diagnostics)
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

const [config, setConfigState] = createStore<AppConfig>(createDefaultConfig())
const [configLoaded, setConfigLoaded] = createSignal(false)

function setConfig(next: AppConfig): void {
  setConfigState({ ...next })
}

const [workspaceSummaries, setWorkspaceSummaries] = createSignal<WorkspaceSummary[]>([])
const [activeWorkspaceId, setActiveWorkspaceId] = createSignal<string | undefined>(undefined)
const [workspaceReady, setWorkspaceReady] = createSignal(false)
const [workspaceManagerOpen, setWorkspaceManagerOpen] = createSignal(false)
const [workspaceMutationPending, setWorkspaceMutationPending] = createSignal(false)
const [storageCapability, setStorageCapability] = createSignal<StorageCapability | undefined>(undefined)

const [analysisStatus, setAnalysisStatus] = createSignal<AnalysisStatus>('idle')
const [workerStatus, setWorkerStatus] = createSignal<WorkerStatus>('starting')
const [workerErrorMessage, setWorkerErrorMessage] = createSignal<string | null>(null)
const [segmenterAvailable, setSegmenterAvailable] = createSignal<boolean>(true)
const [storageAvailable, setStorageAvailable] = createSignal<boolean>(true)

const [settingsOpen, setSettingsOpen] = createSignal(false)
const [panelOpen, setPanelOpen] = createSignal(true)
const [settingsTab, setSettingsTab] = createSignal<'rules' | 'ngwords' | 'terminology' | 'citation' | 'general'>(
  'rules'
)

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

export const appState = {
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
  onDocumentEdited: (text: string): void => {
    setDocumentText(text)
    setRevision((r) => r + 1)
  },
  documentSummaries,
  setDocumentSummaries: (values: DocumentSummary[]): void => {
    setDocumentSummaries(structuredClone(values))
  },
  activeDocumentId,
  setActiveDocumentId,
  documentLibraryReady,
  setDocumentLibraryReady,
  documentMutationPending,
  setDocumentMutationPending,
  documentSidebarOpen,
  setDocumentSidebarOpen,
  documentFilter,
  setDocumentFilter,

  historyOpen,
  setHistoryOpen,
  historyLoading,
  setHistoryLoading,
  historyMutationPending,
  setHistoryMutationPending,
  historyEntries,
  setHistoryEntries: (values: SnapshotSummary[]): void => {
    setHistoryEntries(structuredClone(values))
  },
  selectedHistorySnapshot,
  setSelectedHistorySnapshot: (value: DocumentSnapshot | undefined): void => {
    setSelectedHistorySnapshot(value === undefined ? undefined : structuredClone(value))
  },
  resetHistoryForDocumentContext: (): void => {
    setHistoryEntries([])
    setSelectedHistorySnapshot(undefined)
    setHistoryLoading(false)
  },

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
  applyWorkerResult: (tier: RuleTier, result: TierResult): void => {
    setTierResults(tier, result)
  },
  resetDiagnosticsForDocumentContext: (): void => {
    setSelectedDiagnosticId(null)
    setTierResults({ fast: undefined, deep: undefined, idle: undefined })
  },

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
    const current = unwrap(config)
    const next = structuredClone(current)
    mutator(next)
    const privacyChangeRequested =
      next.privacy.autoSave !== current.privacy.autoSave || next.privacy.privacyMode !== current.privacy.privacyMode
    // Workspace.storageMode is canonical in Phase 2B. Generic settings mutations cannot
    // change the compatibility privacy view; direct attempts are redirected to Workspace Manage.
    next.privacy = structuredClone(current.privacy)
    const validated = validateAppConfig(next)
    setConfig(validated)
    if (privacyChangeRequested) setWorkspaceManagerOpen(true)
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

  workspaceSummaries,
  setWorkspaceSummaries: (values: WorkspaceSummary[]): void => {
    setWorkspaceSummaries(structuredClone(values))
  },
  activeWorkspaceId,
  setActiveWorkspaceId,
  workspaceReady,
  setWorkspaceReady,
  workspaceManagerOpen,
  setWorkspaceManagerOpen,
  workspaceMutationPending,
  setWorkspaceMutationPending,
  storageCapability,
  setStorageCapability,

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

  settingsOpen,
  setSettingsOpen,
  panelOpen,
  setPanelOpen,
  settingsTab,
  setSettingsTab,

  toasts,
  pushToast
}

function unwrap(store: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(store)) as AppConfig
}

export type AppState = typeof appState
