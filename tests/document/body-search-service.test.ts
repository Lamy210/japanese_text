import { describe, expect, test, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { Workspace } from '../../src/core/workspace/types'
import { createDocumentService } from '../../src/document/document-service'
import { createSessionDocumentLibraryStore } from '../../src/document/session-document-library'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { EditableDocument } from '../../src/document/types'

function doc(id: string, workspaceId: string, content: string): EditableDocument {
  return { id, workspaceId, name: id + '.md', content, docType: 'markdown', sourceKind: 'local', createdAt: 1, updatedAt: 1 }
}
function ws(id: string, mode: 'local-library' | 'private-session'): Workspace {
  return { ...createDefaultWorkspaceState(1).workspace, id, storageMode: mode }
}
function setup() {
  const memory = createMemoryStorageContext()
  const session = createSessionDocumentLibraryStore()
  const service = createDocumentService({ repositories: memory.repositories, atomic: memory.atomicOperations, sessionLibrary: session })
  return { ...memory, session, service }
}

describe('DocumentService workspace body search', () => {
  test('Private Session reads only its in-memory Workspace and never touches the durable repository', async () => {
    const h = setup(), w = ws('private', 'private-session')
    h.session.save(doc('one', 'private', '秘密の日本語'))
    h.session.save(doc('other', 'other-workspace', '秘密の日本語'))
    const listSpy = vi.spyOn(h.repositories.documents, 'listByWorkspace')
    const saveSpy = vi.spyOn(h.repositories.documents, 'save')
    const results = await h.service.search(w, '日本語')
    expect(results.map(result => result.documentId)).toEqual(['one'])
    expect(listSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
  })

  test('Local Library scans current Workspace only and overlays unsaved editor text without persistence', async () => {
    const h = setup(), w = ws('local', 'local-library')
    await h.repositories.documents.save(doc('a', 'local', 'saved body'))
    await h.repositories.documents.save(doc('b', 'foreign', 'secret needle'))
    const saveSpy = vi.spyOn(h.repositories.documents, 'save')
    const results = await h.service.search(w, 'needle', doc('a', 'local', 'unsaved needle'))
    expect(results.map(result => result.documentId)).toEqual(['a'])
    expect(saveSpy).not.toHaveBeenCalled()
    expect((await h.repositories.documents.get('a'))?.content).toBe('saved body')
  })

  test('ignores active-document overrides from other workspaces or unknown IDs', async () => {
    const h = setup(), w = ws('local', 'local-library')
    await h.repositories.documents.save(doc('a', 'local', 'kept'))
    expect(await h.service.search(w, 'injected', doc('a', 'foreign', 'injected'))).toEqual([])
    expect(await h.service.search(w, 'injected', doc('missing', 'local', 'injected'))).toEqual([])
  })

  test('empty query does not access either persistence layer', async () => {
    const h = setup(), w = ws('local', 'local-library')
    const listSpy=vi.spyOn(h.repositories.documents, 'listByWorkspace')
    expect(await h.service.search(w, '  ')).toEqual([])
    expect(listSpy).not.toHaveBeenCalled()
  })
})
