import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { createDocumentService } from '../../src/document/document-service'
import { createSessionDocumentLibraryStore } from '../../src/document/session-document-library'

describe.each(['memory', 'indexeddb'] as const)('%s local save privacy boundaries', (backend) => {
  test('a stale Local document save cannot resurrect private content after atomic scrub', async () => {
    const db = backend === 'indexeddb' ? await openDatabase(new IDBFactory()) : undefined
    const memory = backend === 'memory' ? createMemoryStorageContext() : undefined
    const repositories = db ? createIndexedDbRepositories(db) : memory!.repositories
    const atomic = db ? createIndexedDbAtomicOperations(db) : memory!.atomicOperations
    const seeded = createDefaultWorkspaceState(1)
    const workspace = { ...seeded.workspace, storageMode: 'local-library' as const }
    await repositories.workspaces.save(workspace)
    const doc = {
      id: 'doc-1', workspaceId: workspace.id, name: 'private.md',
      docType: 'markdown' as const, content: 'secret', sourceKind: 'local' as const,
      createdAt: 1, updatedAt: 1
    }
    await repositories.documents.save(doc)
    const documents = createDocumentService({
      repositories, atomic, sessionLibrary: createSessionDocumentLibraryStore()
    })
    await atomic.makeWorkspacePrivate(workspace.id)
    expect(await repositories.documents.get(doc.id)).toBeUndefined()
    await documents.save(workspace, { ...doc, content: 'secret resurrected' })
    expect(await repositories.documents.get(doc.id)).toBeUndefined()
    db?.close()
  })
})
