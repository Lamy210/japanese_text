import type { DocumentType } from '../../core/types'
import type {
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

export interface StorageRepositories {
  workspaces: WorkspaceRepository
  preferences: PreferencesRepository
  profiles: RuleProfileRepository
  documents: DocumentRepository
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
  deleteWorkspaceCascade(workspaceId: string): Promise<void>
}
