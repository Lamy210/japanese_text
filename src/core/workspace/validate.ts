import type { GlobalPreferences, RuleProfile, StoredWorkspaceDocument, Workspace } from './types'

export class WorkspaceRecordValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceRecordValidationError'
  }
}

export function validateWorkspaceRecord(raw: unknown): Workspace {
  if (typeof raw !== 'object' || raw === null) {
    throw new WorkspaceRecordValidationError('workspace must be an object')
  }
  return raw as Workspace
}

export function validatePreferencesRecord(raw: unknown): GlobalPreferences {
  if (typeof raw !== 'object' || raw === null) {
    throw new WorkspaceRecordValidationError('preferences must be an object')
  }
  return raw as GlobalPreferences
}

export function validateRuleProfileRecord(raw: unknown): RuleProfile {
  if (typeof raw !== 'object' || raw === null) {
    throw new WorkspaceRecordValidationError('rule profile must be an object')
  }
  return raw as RuleProfile
}

export function validateDocumentRecord(raw: unknown): StoredWorkspaceDocument {
  if (typeof raw !== 'object' || raw === null) {
    throw new WorkspaceRecordValidationError('document must be an object')
  }
  return raw as StoredWorkspaceDocument
}
