/**
 * Legacy-compatible storage façade.
 *
 * Existing UI/state code continues to consume AppConfig + one recent document while
 * persistence is backed by the Phase 2A Workspace/RuleProfile IndexedDB v2 model.
 */

import type { AppConfig } from '../core/config/schema'
import type { DocumentType } from '../core/types'
import type { RuleProfile, Workspace } from '../core/workspace/types'
import { createStorageContext, type StorageContext } from './bootstrap'
import { composeAppConfig, splitAppConfig, type ProjectedStorageState } from './compat/app-config-projection'
import { transactionDone } from './db/idb-utils'
import { LEGACY_DOCUMENTS_STORE } from './db/schema'

const LOCAL_RECENT_DOCUMENT_ID = 'local-recent-document'
const LEGACY_RECENT_DOCUMENT_KEY = 'recent'

export interface StoredDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

let contextPromise: Promise<StorageContext> | null = null

export function isStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function getContext(): Promise<StorageContext> {
  if (contextPromise === null) contextPromise = createStorageContext()
  return contextPromise
}

async function getActiveState(context: StorageContext): Promise<ProjectedStorageState> {
  const workspaces = await context.repositories.workspaces.list()
  const workspace = workspaces[0]
  if (workspace === undefined) throw new Error('Active workspace is missing')

  const preferences = await context.repositories.preferences.get()
  if (preferences === undefined) throw new Error('Global preferences are missing')

  const profile = await context.repositories.profiles.get(workspace.activeRuleProfileId)
  if (profile === undefined) throw new Error('Active rule profile is missing')

  return { workspace, preferences, profile }
}

function newestDocument<T extends { updatedAt: number }>(values: T[]): T | undefined {
  return values.reduce<T | undefined>(
    (current, candidate) => current === undefined || candidate.updatedAt > current.updatedAt ? candidate : current,
    undefined
  )
}

/** Save existing AppConfig semantics into the split v2 persistence model atomically. */
export async function saveConfig(config: AppConfig): Promise<void> {
  const context = await getContext()
  const current = await getActiveState(context)
  const next = splitAppConfig(config, current, Date.now())

  await context.atomic.saveProjectedState(next)
}

/** Load a validated v2 state and project it back to the existing AppConfig shape. */
export async function loadConfig(): Promise<AppConfig | undefined> {
  try {
    const context = await getContext()
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
  const context = await getContext()
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
    const context = await getContext()
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

async function deleteLegacyRecentDocument(context: StorageContext): Promise<void> {
  const db = context.db
  if (db === undefined || !db.objectStoreNames.contains(LEGACY_DOCUMENTS_STORE)) return

  const tx = db.transaction(LEGACY_DOCUMENTS_STORE, 'readwrite')
  const done = transactionDone(tx)
  tx.objectStore(LEGACY_DOCUMENTS_STORE).delete(LEGACY_RECENT_DOCUMENT_KEY)
  await done
}

/**
 * Explicit privacy deletion: remove body text from v2 persistence and from the
 * retained v1 legacy recent record so a later recovery path cannot resurrect it.
 */
export async function deleteRecentDocument(): Promise<void> {
  try {
    const context = await getContext()
    const { workspace } = await getActiveState(context)
    const documents = await context.repositories.documents.listByWorkspace(workspace.id)

    await Promise.all(documents.map((document) => context.repositories.documents.delete(document.id)))
    await deleteLegacyRecentDocument(context)
  } catch {
    // Preserve the historical best-effort API used by the UI privacy toggle.
  }
}

/** @internal Useful for module-isolated tests; product code must not depend on it. */
export function __resetStorageContextForTests(): void {
  contextPromise = null
}

/** @internal Runtime state accessor kept private from normal UI code. */
export async function __getStorageContextForTests(): Promise<StorageContext> {
  return getContext()
}

/** @internal Type anchors ensure compatibility state stays explicit during Phase 2A. */
export type { Workspace, RuleProfile }
