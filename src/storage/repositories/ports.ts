import type { DocumentType } from '../../core/types'
import type {
  DocumentSnapshot,
  GlobalPreferences,
  RuleProfile,
  StoredWorkspaceDocument,
  Workspace
} from '../../core/workspace/types'

export interface WorkspaceRepository {
  list(): Promise<Workspace[]>
  get(id: string): Promise<Workspace | undefined>
  save(value: Workspace): Promise<void>
  delete(id: string): Promise<void>
}

export interface WorkspaceSelectionRepository {
  getActiveWorkspaceId(): Promise<string | undefined>
  setActiveWorkspaceId(workspaceId: string): Promise<void>
}

export interface DocumentSelectionRepository {
  getActiveDocumentId(workspaceId: string): Promise<string | undefined>
  setActiveDocumentId(workspaceId: string, documentId: string): Promise<void>
  deleteActiveDocumentId(workspaceId: string): Promise<void>
}

export interface PreferencesRepository {
  get(): Promise<GlobalPreferences | undefined>
  save(value: GlobalPreferences): Promise<void>
}

export interface RuleProfileRepository {
  list(): Promise<RuleProfile[]>
  get(id: string): Promise<RuleProfile | undefined>
  save(value: RuleProfile): Promise<void>
  delete(id: string): Promise<void>
}

export interface DocumentRepository {
  listByWorkspace(workspaceId: string): Promise<StoredWorkspaceDocument[]>
  get(id: string): Promise<StoredWorkspaceDocument | undefined>
  save(value: StoredWorkspaceDocument): Promise<void>
  delete(id: string): Promise<void>
}

export interface SnapshotRepository {
  listByDocument(documentId: string): Promise<DocumentSnapshot[]>
  get(id: string): Promise<DocumentSnapshot | undefined>
}

export interface StorageRepositories {
  workspaces: WorkspaceRepository
  selection: WorkspaceSelectionRepository
  documentSelection: DocumentSelectionRepository
  preferences: PreferencesRepository
  profiles: RuleProfileRepository
  documents: DocumentRepository
  snapshots: SnapshotRepository
}

export interface RecoveredDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

export interface MigrationResult {
  state: 'not-needed' | 'migrated' | 'recovered-with-warning' | 'failed'
  warning?: string
  recoveredDocument?: RecoveredDocument
}

export interface AtomicProjectedStorageState {
  preferences: GlobalPreferences
  workspace: Workspace
  profile: RuleProfile
}

export interface AtomicOperationsPort {
  migrateV1ToV2(): Promise<MigrationResult>
  saveProjectedState(value: AtomicProjectedStorageState): Promise<void>
  createWorkspaceAndActivate(workspace: Workspace, profile: RuleProfile): Promise<void>
  createDocumentAndActivate(document: StoredWorkspaceDocument): Promise<void>
  deleteDocumentAndSelectNext(workspaceId: string, documentId: string, nextDocumentId: string): Promise<void>
  replaceLastDocument(
    workspaceId: string,
    oldDocumentId: string,
    replacement: StoredWorkspaceDocument
  ): Promise<void>
  deletePersistedDocuments(workspaceId: string): Promise<void>
  deleteWorkspaceCascade(workspaceId: string): Promise<void>
  deleteWorkspaceAndSelectNext(workspaceId: string, nextWorkspaceId: string): Promise<void>
  enableLocalLibrary(
    workspaceId: string,
    documents: StoredWorkspaceDocument[],
    activeDocumentId: string
  ): Promise<void>
  makeWorkspacePrivate(workspaceId: string): Promise<void>
}
