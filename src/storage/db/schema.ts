export const DB_NAME = 'japanese-writing-toolkit'
export const DB_VERSION = 2

export const LEGACY_SETTINGS_STORE = 'settings'
export const LEGACY_DOCUMENTS_STORE = 'documents'

export const STORE_META = 'meta'
export const STORE_WORKSPACES = 'workspaces'
export const STORE_PREFERENCES = 'preferences'
export const STORE_RULE_PROFILES = 'ruleProfiles'
export const STORE_WORKSPACE_DOCUMENTS = 'workspaceDocuments'
export const STORE_DOCUMENT_SNAPSHOTS = 'documentSnapshots'
export const STORE_SUPPRESSIONS = 'suppressions'

export const META_ACTIVE_WORKSPACE_ID = 'active-workspace-id'
export const META_ACTIVE_DOCUMENT_PREFIX = 'active-document-id:'

export function activeDocumentMetaKey(workspaceId: string): string {
  if (workspaceId.length === 0) throw new Error('workspaceId must not be empty')
  return `${META_ACTIVE_DOCUMENT_PREFIX}${workspaceId}`
}

export const INDEX_WORKSPACE_ID = 'workspaceId'
export const INDEX_UPDATED_AT = 'updatedAt'
export const INDEX_DOCUMENT_ID = 'documentId'
export const INDEX_DOCUMENT_CREATED_AT = 'documentIdCreatedAt'
export const INDEX_SCOPE_AND_SCOPE_ID = 'scopeAndScopeId'
export const INDEX_RULE_ID = 'ruleId'

export const V2_STORE_NAMES = [
  STORE_META,
  STORE_WORKSPACES,
  STORE_PREFERENCES,
  STORE_RULE_PROFILES,
  STORE_WORKSPACE_DOCUMENTS,
  STORE_DOCUMENT_SNAPSHOTS,
  STORE_SUPPRESSIONS
] as const
