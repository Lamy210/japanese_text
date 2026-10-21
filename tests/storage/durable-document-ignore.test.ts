import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import {
  readDocumentIgnores,
  replaceDocumentIgnores
} from '../../src/storage/document-ignore-store'
import type { IgnoredDiagnostic } from '../../src/state/ignored-diagnostics'

const sample: IgnoredDiagnostic = {
  key: JSON.stringify(['core', 'wording/common-typo', 'デバック']),
  source: 'core',
  ruleId: 'wording/common-typo',
  excerpt: 'デバック'
}
const other: IgnoredDiagnostic = {
  key: JSON.stringify(['core', 'style/paragraph-density', '長い段落']),
  source: 'core',
  ruleId: 'style/paragraph-density',
  excerpt: '長い段落'
}

async function setup() {
  const db = await openDatabase(new IDBFactory())
  const repo = createIndexedDbRepositories(db)
  const atomic = createIndexedDbAtomicOperations(db)
  const base = createDefaultWorkspaceState(1000)
  await repo.workspaces.save({ ...base.workspace, storageMode: 'local-library' })
  await repo.documents.save({
    id: 'doc-a', workspaceId: base.workspace.id,
    name: 'a.md', docType: 'markdown', content: 'デバック',
    sourceKind: 'local', createdAt: 1000, updatedAt: 1000
  })
  await repo.documents.save({
    id: 'doc-b', workspaceId: base.workspace.id,
    name: 'b.md', docType: 'markdown', content: '本文',
    sourceKind: 'local', createdAt: 1000, updatedAt: 1000
  })
  return { db, repo, atomic, workspaceId: base.workspace.id }
}

describe('durable document ignore: existing IndexedDB v2 suppressions store', () => {
  test('survives fresh reads, replaces and restores without schema upgrades', async () => {
    const { db, workspaceId } = await setup()
    try {
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([])
      await replaceDocumentIgnores(db, workspaceId, 'doc-a', [sample, other])
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([sample, other])
      expect(await readDocumentIgnores(db, workspaceId, 'doc-b')).toEqual([])
      await replaceDocumentIgnores(db, workspaceId, 'doc-a', [other])
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([other])
      await replaceDocumentIgnores(db, workspaceId, 'doc-a', [])
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([])
    } finally { db.close() }
  })

  test('rejects cross-workspace reuse of a document ID', async () => {
    const { db, workspaceId } = await setup()
    try {
      const otherWorkspace = createDefaultWorkspaceState(2000).workspace
      const repo = createIndexedDbRepositories(db)
      await repo.workspaces.save({ ...otherWorkspace, id: 'second', storageMode: 'local-library' })
      await expect(replaceDocumentIgnores(db, 'second', 'doc-a', [sample])).rejects.toThrow()
      await expect(readDocumentIgnores(db, 'second', 'doc-a')).rejects.toThrow()
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([])
    } finally { db.close() }
  })

  test('refuses private-mode and nonexistent documents without persisting anything', async () => {
    const { db, repo, workspaceId } = await setup()
    try {
      await expect(replaceDocumentIgnores(db, workspaceId, 'missing', [sample])).rejects.toThrow()
      const w = (await repo.workspaces.get(workspaceId))!
      await repo.workspaces.save({ ...w, storageMode: 'private-session' })
      await expect(replaceDocumentIgnores(db, workspaceId, 'doc-a', [sample])).rejects.toThrow()
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([])
    } finally { db.close() }
  })

  test('rejects invalid or duplicate records instead of corrupting previous durable state', async () => {
    const { db, workspaceId } = await setup()
    try {
      await replaceDocumentIgnores(db, workspaceId, 'doc-a', [sample])
      await expect(replaceDocumentIgnores(db, workspaceId, 'doc-a', [sample, sample])).rejects.toThrow()
      await expect(replaceDocumentIgnores(db, workspaceId, 'doc-a', [{
        ...sample, key: 'fake'
      }])).rejects.toThrow()
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([sample])
    } finally { db.close() }
  })

  test('removes ignores atomically when document is deleted and a successor selected', async () => {
    const { db, atomic, workspaceId } = await setup()
    try {
      await replaceDocumentIgnores(db, workspaceId, 'doc-a', [sample])
      await replaceDocumentIgnores(db, workspaceId, 'doc-b', [other])
      await atomic.deleteDocumentAndSelectNext(workspaceId, 'doc-a', 'doc-b')
      await expect(readDocumentIgnores(db, workspaceId, 'doc-a')).rejects.toThrow()
      expect(await readDocumentIgnores(db, workspaceId, 'doc-b')).toEqual([other])
    } finally { db.close() }
  })

  test('scrubs ignores when Local Library converts to Private Session', async () => {
    const { db, atomic, repo, workspaceId } = await setup()
    try {
      await replaceDocumentIgnores(db, workspaceId, 'doc-a', [sample])
      await atomic.makeWorkspacePrivate(workspaceId)
      expect((await repo.workspaces.get(workspaceId))?.storageMode).toBe('private-session')
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([])
      const w = (await repo.workspaces.get(workspaceId))!
      await repo.workspaces.save({ ...w, storageMode: 'local-library' })
      // A Local Library re-enable must not resurrect private-session ignores.
      await repo.documents.save({ id: 'doc-a', workspaceId, name: 'new.md', docType: 'markdown', content: '',
        sourceKind: 'local', createdAt: 3000, updatedAt: 3000 })
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([])
    } finally { db.close() }
  })
  test('clears ignored entries atomically when replacing the last document', async () => {
    const { db, atomic, repo, workspaceId } = await setup()
    try {
      await replaceDocumentIgnores(db, workspaceId, 'doc-a', [sample])
      await atomic.deleteDocumentAndSelectNext(workspaceId, 'doc-b', 'doc-a')
      await atomic.replaceLastDocument(workspaceId, 'doc-a', {
        id: 'doc-new', workspaceId, name: 'fresh.md', docType: 'markdown',
        content: '', sourceKind: 'local', createdAt: 4000, updatedAt: 4000
      })
      await repo.documents.save({
        id: 'doc-a', workspaceId, name: 'reused.md', docType: 'markdown',
        content: '', sourceKind: 'local', createdAt: 4001, updatedAt: 4001
      })
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([])
    } finally { db.close() }
  })

  test('purges suppressions alongside all persisted documents in bulk deletion', async () => {
    const { db, atomic, repo, workspaceId } = await setup()
    try {
      await replaceDocumentIgnores(db, workspaceId, 'doc-a', [sample])
      await replaceDocumentIgnores(db, workspaceId, 'doc-b', [other])
      await atomic.deletePersistedDocuments(workspaceId)
      await repo.documents.save({
        id: 'doc-a', workspaceId, name: 'recreated.md',
        docType: 'markdown', content: '', sourceKind: 'local',
        createdAt: 5000, updatedAt: 5000
      })
      expect(await readDocumentIgnores(db, workspaceId, 'doc-a')).toEqual([])
    } finally { db.close() }
  })

})
