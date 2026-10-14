import { validateAppConfig } from '../config/validate'
import type { PresetId, ThemeMode } from '../config/schema'
import type { DocumentType } from '../types'
import type { GlobalPreferences, RuleProfile, StoredWorkspaceDocument, StorageMode, Workspace } from './types'

export class WorkspaceRecordValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceRecordValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new WorkspaceRecordValidationError(`${label} must be an object`)
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WorkspaceRecordValidationError(`${label} must be a non-empty string`)
  }
  return value
}

function requireTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new WorkspaceRecordValidationError(`${label} must be a non-negative finite number`)
  }
  return value
}

const STORAGE_MODES = new Set<StorageMode>(['private-session', 'local-library', 'file-backed'])
const PERSISTED_DEFAULT_MODES = new Set<GlobalPreferences['defaultStorageMode']>(['private-session', 'local-library'])
const THEMES = new Set<ThemeMode>(['light', 'dark', 'system'])
const PRESETS = new Set<PresetId>(['general', 'technical', 'strict', 'minimal', 'custom'])
const DOCUMENT_TYPES = new Set<DocumentType>(['markdown', 'text'])

export function validateWorkspaceRecord(raw: unknown): Workspace {
  const value = requireRecord(raw, 'workspace')
  const storageMode = requireString(value.storageMode, 'workspace.storageMode') as StorageMode
  if (!STORAGE_MODES.has(storageMode)) {
    throw new WorkspaceRecordValidationError('workspace.storageMode is invalid')
  }

  const snapshot = requireRecord(value.snapshotPolicy, 'workspace.snapshotPolicy')
  if (typeof snapshot.enabled !== 'boolean') {
    throw new WorkspaceRecordValidationError('workspace.snapshotPolicy.enabled must be boolean')
  }
  if (
    typeof snapshot.maxSnapshots !== 'number' ||
    !Number.isInteger(snapshot.maxSnapshots) ||
    snapshot.maxSnapshots < 1 ||
    snapshot.maxSnapshots > 1000
  ) {
    throw new WorkspaceRecordValidationError('workspace.snapshotPolicy.maxSnapshots must be an integer between 1 and 1000')
  }

  return {
    id: requireString(value.id, 'workspace.id'),
    name: requireString(value.name, 'workspace.name'),
    activeRuleProfileId: requireString(value.activeRuleProfileId, 'workspace.activeRuleProfileId'),
    storageMode,
    snapshotPolicy: {
      enabled: snapshot.enabled,
      maxSnapshots: snapshot.maxSnapshots
    },
    createdAt: requireTimestamp(value.createdAt, 'workspace.createdAt'),
    updatedAt: requireTimestamp(value.updatedAt, 'workspace.updatedAt')
  }
}

export function validatePreferencesRecord(raw: unknown): GlobalPreferences {
  const value = requireRecord(raw, 'preferences')
  if (value.schemaVersion !== 1) {
    throw new WorkspaceRecordValidationError('preferences.schemaVersion must be 1')
  }

  const theme = requireString(value.theme, 'preferences.theme') as ThemeMode
  if (!THEMES.has(theme)) throw new WorkspaceRecordValidationError('preferences.theme is invalid')

  const editor = requireRecord(value.editor, 'preferences.editor')
  if (
    typeof editor.fontSize !== 'number' ||
    !Number.isFinite(editor.fontSize) ||
    editor.fontSize < 10 ||
    editor.fontSize > 32
  ) {
    throw new WorkspaceRecordValidationError('preferences.editor.fontSize must be between 10 and 32')
  }
  if (typeof editor.showLineNumbers !== 'boolean') {
    throw new WorkspaceRecordValidationError('preferences.editor.showLineNumbers must be boolean')
  }

  const defaultStorageMode = requireString(
    value.defaultStorageMode,
    'preferences.defaultStorageMode'
  ) as GlobalPreferences['defaultStorageMode']
  if (!PERSISTED_DEFAULT_MODES.has(defaultStorageMode)) {
    throw new WorkspaceRecordValidationError('preferences.defaultStorageMode is invalid')
  }

  return {
    schemaVersion: 1,
    theme,
    editor: {
      fontSize: editor.fontSize,
      showLineNumbers: editor.showLineNumbers
    },
    defaultStorageMode
  }
}

export function validateRuleProfileRecord(raw: unknown): RuleProfile {
  const value = requireRecord(raw, 'ruleProfile')
  const customRules = value.customRules
  if (!Array.isArray(customRules) || customRules.length !== 0) {
    throw new WorkspaceRecordValidationError('ruleProfile.customRules must be an empty array in Phase 2A')
  }
  if (!isRecord(value.rules)) throw new WorkspaceRecordValidationError('ruleProfile.rules must be an object')
  if (!Array.isArray(value.ngWords)) throw new WorkspaceRecordValidationError('ruleProfile.ngWords must be an array')
  if (!Array.isArray(value.terminology)) {
    throw new WorkspaceRecordValidationError('ruleProfile.terminology must be an array')
  }
  if (!isRecord(value.citation)) throw new WorkspaceRecordValidationError('ruleProfile.citation must be an object')
  if (!isRecord(value.formatter)) throw new WorkspaceRecordValidationError('ruleProfile.formatter must be an object')

  let sourcePresetId: PresetId | undefined
  if (value.sourcePresetId !== undefined) {
    const preset = requireString(value.sourcePresetId, 'ruleProfile.sourcePresetId') as PresetId
    if (!PRESETS.has(preset)) throw new WorkspaceRecordValidationError('ruleProfile.sourcePresetId is invalid')
    sourcePresetId = preset
  }

  let validated
  try {
    validated = validateAppConfig({
      schemaVersion: 1,
      preset: sourcePresetId ?? 'custom',
      rules: value.rules,
      ngWords: value.ngWords,
      terminology: value.terminology,
      citation: value.citation,
      formatter: value.formatter
    })
  } catch (error) {
    throw new WorkspaceRecordValidationError(
      `ruleProfile config is invalid: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  return {
    id: requireString(value.id, 'ruleProfile.id'),
    name: requireString(value.name, 'ruleProfile.name'),
    ...(sourcePresetId === undefined ? {} : { sourcePresetId }),
    rules: structuredClone(validated.rules),
    ngWords: structuredClone(validated.ngWords),
    terminology: structuredClone(validated.terminology),
    citation: structuredClone(validated.citation),
    formatter: structuredClone(validated.formatter),
    customRules: [],
    createdAt: requireTimestamp(value.createdAt, 'ruleProfile.createdAt'),
    updatedAt: requireTimestamp(value.updatedAt, 'ruleProfile.updatedAt')
  }
}

export function validateDocumentRecord(raw: unknown): StoredWorkspaceDocument {
  const value = requireRecord(raw, 'document')
  const docType = requireString(value.docType, 'document.docType') as DocumentType
  if (!DOCUMENT_TYPES.has(docType)) throw new WorkspaceRecordValidationError('document.docType is invalid')

  const sourceKind = requireString(value.sourceKind, 'document.sourceKind')
  if (sourceKind !== 'local' && sourceKind !== 'file') {
    throw new WorkspaceRecordValidationError('document.sourceKind is invalid')
  }
  if (value.content !== undefined && typeof value.content !== 'string') {
    throw new WorkspaceRecordValidationError('document.content must be a string when present')
  }

  return {
    id: requireString(value.id, 'document.id'),
    workspaceId: requireString(value.workspaceId, 'document.workspaceId'),
    name: requireString(value.name, 'document.name'),
    docType,
    ...(value.content === undefined ? {} : { content: value.content }),
    sourceKind,
    createdAt: requireTimestamp(value.createdAt, 'document.createdAt'),
    updatedAt: requireTimestamp(value.updatedAt, 'document.updatedAt')
  }
}
