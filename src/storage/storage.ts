/**
 * Legacy-compatible storage façade.
 *
 * Existing UI/state code continues to consume AppConfig + one recent document while
 * persistence is backed by the Phase 2A Workspace/RuleProfile IndexedDB v2 model.
 */

import type { AppConfig } from '../core/config/schema'
import type { DocumentType } from '../core/types'
import { createWorkspaceService } from '../workspace/workspace-service'
import type { StorageContext } from './bootstrap'
import {
  composeAppConfig,
  splitAppConfigPreservingStorageMode,
  type ProjectedStorageState
} from './compat/app-config-projection'
import { getStorageContext } from './runtime'

export { getStorageContext, resetStorageRuntimeForTests } from './runtime'

export interface StoredDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

export function isStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

async function getActiveState(context: StorageContext): Promise<ProjectedStorageState> {
  const active = await createWorkspaceService({
    repositories: context.repositories,
    atomic: context.atomic,
    durableBackend: context.durable
  }).getActive()
  return {
    workspace: active.workspace,
    preferences: active.preferences,
    profile: active.profile
  }
}

function newestDocument<T extends { updatedAt: number }>(values: T[]): T | undefined {
  return values.reduce<T | undefined>(
    (current, candidate) => current === undefined || candidate.updatedAt > current.updatedAt ? candidate : current,
    undefined
  )
}

/** Save config/profile preferences without changing the canonical Workspace storage mode. */
export async function saveConfig(config: AppConfig): Promise<void> {
  const context = await getStorageContext()
  const current = await getActiveState(context)
  const next = splitAppConfigPreservingStorageMode(config, current, Date.now())
  await context.atomic.saveProjectedState(next)
}

/** Load a validated v2 state and project it back to the existing AppConfig shape. */
export async function loadConfig(): Promise<AppConfig | undefined> {
  try {
    const context = await getStorageContext()
    return composeAppConfig(await getActiveState(context))
  } catch {
    return undefined
  }
}

/** Persist a body only to the explicitly named local-library workspace. */
export async function saveWorkspaceDocument(workspaceId: string, doc: StoredDocument): Promise<void> {
  const context = await getStorageContext()
  const workspace = await context.repositories.workspaces.get(workspaceId)
  if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
  if (workspace.storageMode !== 'local-library') return

  const existing = newestDocument(await context.repositories.documents.listByWorkspace(workspaceId))
  await context.repositories.documents.save({
    id: existing?.id ?? `local-recent-document:${workspaceId}`,
    workspaceId,
    name: doc.name,
    content: doc.content,
    docType: doc.docType,
    sourceKind: 'local',
    createdAt: existing?.createdAt ?? doc.updatedAt,
    updatedAt: doc.updatedAt
  })
}

/** Load a body only from the explicitly named local-library workspace. */
export async function loadWorkspaceDocument(workspaceId: string): Promise<StoredDocument | undefined> {
  try {
    const context = await getStorageContext()
    const workspace = await context.repositories.workspaces.get(workspaceId)
    if (workspace === undefined || workspace.storageMode !== 'local-library') return undefined

    const document = newestDocument(await context.repositories.documents.listByWorkspace(workspaceId))
    if (document === undefined || typeof document.content !== 'string') return undefined
    return {
      name: document.name,
      content: document.content,
      docType: document.docType,
      updatedAt: document.updatedAt
    }
  } catch {
    return undefined
  }
}

/** Compatibility wrapper for the currently active workspace. */
export async function saveRecentDocument(doc: StoredDocument): Promise<void> {
  const context = await getStorageContext()
  const { workspace } = await getActiveState(context)
  await saveWorkspaceDocument(workspace.id, doc)
}

/** Compatibility wrapper for the currently active workspace. */
export async function loadRecentDocument(): Promise<StoredDocument | undefined> {
  try {
    const context = await getStorageContext()
    const { workspace } = await getActiveState(context)
    return loadWorkspaceDocument(workspace.id)
  } catch {
    return undefined
  }
}

/**
 * Explicit privacy deletion: scrub both v2 and retained v1 body records atomically
 * when durable IndexedDB is in use. Memory fallback removes its session documents.
 */
export async function deleteRecentDocument(): Promise<void> {
  try {
    const context = await getStorageContext()
    const { workspace } = await getActiveState(context)
    await context.atomic.deletePersistedDocuments(workspace.id)
  } catch {
    // Preserve the historical best-effort API used by the UI privacy toggle.
  }
}
