/**
 * Durable Local Library diagnostic ignores, using the existing IndexedDB v2
 * suppressions store. Never call this store for Private Session documents.
 * Every operation verifies the workspace mode and document ownership in the
 * SAME IndexedDB transaction as its read/write.
 */
import type { IgnoredDiagnostic } from '../state/ignored-diagnostics'
import { MAX_IGNORED_PER_DOCUMENT } from '../state/ignored-diagnostics'
import { validateDocumentRecord, validateWorkspaceRecord } from '../core/workspace/validate'
import { requestToPromise, transactionDone } from './db/idb-utils'
import {
  INDEX_SCOPE_AND_SCOPE_ID,
  STORE_SUPPRESSIONS,
  STORE_WORKSPACES,
  STORE_WORKSPACE_DOCUMENTS
} from './db/schema'

const PREFIX = 'japanese-text:document-ignore:'
const SOURCES = new Set(['core', 'user', 'textlint'])

function assertEntry(value: IgnoredDiagnostic): void {
  if (!value || typeof value.ruleId !== 'string' || !value.ruleId.trim() ||
      !SOURCES.has(value.source) || typeof value.excerpt !== 'string' ||
      value.excerpt.length === 0 || value.excerpt.length > 240 ||
      !value.excerpt.trim() || value.excerpt.includes('\uFFFF') ||
      value.key !== JSON.stringify([value.source, value.ruleId, value.excerpt])) {
    throw new Error('Invalid persisted diagnostic ignore')
  }
}

function prefixFor(workspaceId: string, documentId: string): string {
  if (!workspaceId || !documentId) throw new Error('Workspace and document IDs are required')
  return PREFIX + JSON.stringify([workspaceId, documentId]) + ':'
}

function idFor(workspaceId: string, documentId: string, key: string): string {
  return prefixFor(workspaceId, documentId) + key
}

interface StoredRecord {
  id: string
  scope: 'document'
  scopeId: string
  kind: 'message'
  ruleId: string
  match: string
  createdAt: number
}

function readRecord(raw: unknown, prefix: string, documentId: string): IgnoredDiagnostic | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Partial<StoredRecord>
  if (typeof row.id !== 'string' || !row.id.startsWith(prefix) ||
      row.scope !== 'document' || row.scopeId !== documentId ||
      row.kind !== 'message' || typeof row.ruleId !== 'string' ||
      typeof row.match !== 'string') return null
  try {
    const parsed = JSON.parse(row.match) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [source, excerpt] = parsed
    const item: IgnoredDiagnostic = {
      source, excerpt, ruleId: row.ruleId,
      key: JSON.stringify([source, row.ruleId, excerpt])
    }
    assertEntry(item)
    return row.id === idFor(JSON.parse(prefix.slice(PREFIX.length, -1))[0], documentId, item.key)
      ? item : null
  } catch {
    return null
  }
}

async function getContext(
  tx: IDBTransaction, workspaceId: string, documentId: string
): Promise<{ local: boolean }> {
  const [w, d] = await Promise.all([
    requestToPromise(tx.objectStore(STORE_WORKSPACES).get(workspaceId)),
    requestToPromise(tx.objectStore(STORE_WORKSPACE_DOCUMENTS).get(documentId))
  ])
  const workspace = w === undefined ? undefined : validateWorkspaceRecord(w)
  if (workspace?.storageMode !== 'local-library') return { local: false }
  if (d === undefined || validateDocumentRecord(d).workspaceId !== workspaceId) {
    throw new Error('Document does not belong to this Local Library workspace')
  }
  return { local: true }
}

export async function readDocumentIgnores(
  db: IDBDatabase, workspaceId: string, documentId: string
): Promise<IgnoredDiagnostic[]> {
  const prefix = prefixFor(workspaceId, documentId)
  const tx = db.transaction([STORE_WORKSPACES, STORE_WORKSPACE_DOCUMENTS, STORE_SUPPRESSIONS], 'readonly')
  const done = transactionDone(tx)
  try {
    const context = await getContext(tx, workspaceId, documentId)
    if (!context.local) {
      await done
      return []
    }
    const raw = await requestToPromise(
      tx.objectStore(STORE_SUPPRESSIONS).index(INDEX_SCOPE_AND_SCOPE_ID).getAll(['document', documentId])
    ) as StoredRecord[]
    await done
    return raw.filter(row => typeof row.id === 'string' && row.id.startsWith(prefix))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(row => readRecord(row, prefix, documentId))
      .filter((row): row is IgnoredDiagnostic => row !== null)
      .slice(0, MAX_IGNORED_PER_DOCUMENT)
  } catch (error) {
    void done.catch(() => undefined)
    throw error
  }
}

/** Replace only records owned by this feature, preserving other suppressions. */
export async function replaceDocumentIgnores(
  db: IDBDatabase, workspaceId: string, documentId: string,
  entries: readonly IgnoredDiagnostic[]
): Promise<void> {
  const prefix = prefixFor(workspaceId, documentId)
  if (entries.length > MAX_IGNORED_PER_DOCUMENT) throw new Error('Too many ignored diagnostics')
  const seen = new Set<string>()
  for (const entry of entries) {
    assertEntry(entry)
    if (seen.has(entry.key)) throw new Error('Duplicate ignored diagnostic')
    seen.add(entry.key)
  }
  const tx = db.transaction([STORE_WORKSPACES, STORE_WORKSPACE_DOCUMENTS, STORE_SUPPRESSIONS], 'readwrite')
  const done = transactionDone(tx)
  try {
    const context = await getContext(tx, workspaceId, documentId)
    if (!context.local) throw new Error('Cannot persist ignores outside Local Library')
    const store = tx.objectStore(STORE_SUPPRESSIONS)
    const rows = await requestToPromise(store.index(INDEX_SCOPE_AND_SCOPE_ID).getAll(['document', documentId])) as StoredRecord[]
    for (const row of rows) if (typeof row.id === 'string' && row.id.startsWith(prefix)) store.delete(row.id)
    entries.forEach((item, index) => {
      const record: StoredRecord = {
        id: idFor(workspaceId, documentId, item.key),
        scope: 'document', scopeId: documentId, kind: 'message',
        ruleId: item.ruleId, match: JSON.stringify([item.source, item.excerpt]),
        createdAt: Date.now() + index
      }
      store.put(record)
    })
    await done
  } catch (error) {
    try { tx.abort() } catch { /* Transaction may already be closed */ }
    void done.catch(() => undefined)
    throw error
  }
}
