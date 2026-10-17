import type {
  CitationPolicy,
  EditorPreferences,
  FormatterPolicy,
  NgWordEntry,
  PresetId,
  TermEntry,
  ThemeMode
} from '../config/schema'
import type { DocumentType, RuleSetting } from '../types'

export type StorageMode = 'private-session' | 'local-library' | 'file-backed'

export interface SnapshotPolicy {
  enabled: boolean
  maxSnapshots: number
}

export interface Workspace {
  id: string
  name: string
  activeRuleProfileId: string
  storageMode: StorageMode
  snapshotPolicy: SnapshotPolicy
  createdAt: number
  updatedAt: number
}

export interface GlobalPreferences {
  schemaVersion: number
  theme: ThemeMode
  editor: EditorPreferences
  defaultStorageMode: Exclude<StorageMode, 'file-backed'>
}

export interface RuleProfile {
  id: string
  name: string
  sourcePresetId?: PresetId
  rules: Record<string, RuleSetting>
  ngWords: NgWordEntry[]
  terminology: TermEntry[]
  citation: CitationPolicy
  formatter: FormatterPolicy
  customRules: unknown[]
  createdAt: number
  updatedAt: number
}

export interface StoredWorkspaceDocument {
  id: string
  workspaceId: string
  name: string
  docType: DocumentType
  content?: string
  sourceKind: 'local' | 'file'
  createdAt: number
  updatedAt: number
}

export type SnapshotReason = 'autosave' | 'manual' | 'before-format' | 'before-import' | 'before-restore'

export interface DocumentSnapshot {
  id: string
  documentId: string
  revision: number
  content: string
  reason: SnapshotReason
  createdAt: number
}

export type SuppressionScope = 'document' | 'workspace' | 'profile'
export type SuppressionKind = 'rule' | 'message' | 'term'

export interface Suppression {
  id: string
  scope: SuppressionScope
  scopeId: string
  kind: SuppressionKind
  ruleId?: string
  match?: string
  reason?: string
  createdAt: number
}
