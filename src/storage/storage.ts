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
import { composeAppConfig, splitAppConfig, type ProjectedStorageState } from './compat/app-config-projection'
import { getStorageContext } from './runtime'

export { getStorageContext, resetStorageRuntimeForTests } from './runtime'

const LOCAL_RECENT_DOCUMENT_ID = 'local-recent-document'

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
    atomic: context.atomic
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

/** Save existing AppConfig semantics into the split v2 persistence model atomically. */
export async function saveConfig(config: AppConfig): Promise<void> {
  const context = await getStorageContext()
  const current = await getActiveState(context)
  const next = splitAppConfig(config, current, Date.now())
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

/**
 * Save the current document only when the active workspace explicitly opted into
 * local-library persistence. Private/file-backed modes never write body text here.
 */
export async function saveRecentDocument(doc: StoredDocument): Promise<void> {
  const context = await getStorageContext()
  const { workspace } = await getActiveState(context)
  if (workspace.storageMode !== 'local-library') return

  const existing = newestDocument(await context.repositories.documents.listByWorkspace(workspace.id))
  await context.repositories.documents.save({
    id: existing?.id ?? LOCAL_RECENT_DOCUMENT_ID,
    workspaceId: workspace.id,
    name: doc.name,
    content: doc.content,
    docType: doc.docType,
    sourceKind: 'local',
    createdAt: existing?.createdAt ?? doc.updatedAt,
    updatedAt: doc.updatedAt
  })
}

export async function loadRecentDocument(): Promise<StoredDocument | undefined> {
  try {
    const context = await getStorageContext()
    const { workspace } = await getActiveState(context)
    if (workspace.storageMode !== 'local-library') return undefined

    const document = newestDocument(await context.repositories.documents.listByWorkspace(workspace.id))
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
