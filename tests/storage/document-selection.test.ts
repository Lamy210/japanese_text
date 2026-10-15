import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/storage/db/open-database'
import { activeDocumentMetaKey, DB_VERSION } from '../../src/storage/db/schema'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { StorageRepositories } from '../../src/storage/repositories/ports'

function defineDocumentSelectionContract(
  label: string,
  createRepositories: () => Promise<StorageRepositories> | StorageRepositories
): void {
  describe(`${label} active document selection`, () => {
    it('starts empty and round-trips an active document per workspace', async () => {
      const repositories = await createRepositories()

      expect(await repositories.documentSelection.getActiveDocumentId('workspace-a')).toBeUndefined()

      await repositories.documentSelection.setActiveDocumentId('workspace-a', 'doc-a')
      await repositories.documentSelection.setActiveDocumentId('workspace-b', 'doc-b')

      expect(await repositories.documentSelection.getActiveDocumentId('workspace-a')).toBe('doc-a')
      expect(await repositories.documentSelection.getActiveDocumentId('workspace-b')).toBe('doc-b')
    })

    it('deletes only the requested workspace selection', async () => {
      const repositories = await createRepositories()
      await repositories.documentSelection.setActiveDocumentId('workspace-a', 'doc-a')
      await repositories.documentSelection.setActiveDocumentId('workspace-b', 'doc-b')

      await repositories.documentSelection.deleteActiveDocumentId('workspace-a')

      expect(await repositories.documentSelection.getActiveDocumentId('workspace-a')).toBeUndefined()
      expect(await repositories.documentSelection.getActiveDocumentId('workspace-b')).toBe('doc-b')
    })

    it('rejects empty workspace or document IDs when setting selection', async () => {
      const repositories = await createRepositories()

      await expect(repositories.documentSelection.setActiveDocumentId('', 'doc-a')).rejects.toThrow()
      await expect(repositories.documentSelection.setActiveDocumentId('workspace-a', '')).rejects.toThrow()
    })
  })
}

defineDocumentSelectionContract('memory', () => createMemoryStorageContext().repositories)

defineDocumentSelectionContract('indexeddb', async () => {
  const db = await openDatabase(new IDBFactory())
  return createIndexedDbRepositories(db)
})

describe('active document selection schema', () => {
  it('uses a workspace-scoped meta key without changing DB version', () => {
    expect(activeDocumentMetaKey('workspace-a')).toBe('active-document-id:workspace-a')
    expect(DB_VERSION).toBe(2)
  })
})
