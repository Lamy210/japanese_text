import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test, vi } from 'vitest'
import { createApplicationRuntime } from '../../src/state/application-runtime'
import { createStorageContext } from '../../src/storage/bootstrap'
import type { EditableDocument } from '../../src/document/types'

const doc = (id: string, workspaceId: string, content: string): EditableDocument => ({
  id, workspaceId, content, name: id + '.md', docType: 'markdown',
  sourceKind: 'local', createdAt: 1, updatedAt: 1
})

describe('on-demand search privacy across storage modes', () => {
  test('IndexedDB Local search never consults Private Session bodies or other Workspace records', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 100 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 100 })
    const workspaces = await runtime.getWorkspaceService()
    const active = (await workspaces.getActive()).workspace
    await context.atomic.enableLocalLibrary(active.id, [doc('local-1', active.id, 'needle local')], 'local-1')
    const local = (await workspaces.getActive()).workspace
    const privateWorkspace = (await workspaces.create({ name: 'Private' })).workspace
    runtime.getSessionDocumentLibrary().save(doc('secret', privateWorkspace.id, 'needle secret'))
    const search = await runtime.getDocumentService()
    const durableSave = vi.spyOn(context.repositories.documents, 'save')
    const privateResult = await search.search(privateWorkspace, 'needle')
    const localResult = await search.search(local, 'needle')
    expect(privateResult.map(result => result.documentId)).toEqual(['secret'])
    expect(localResult.map(result => result.documentId)).toEqual(['local-1'])
    expect(durableSave).not.toHaveBeenCalled()
    expect((await context.repositories.documents.get('local-1'))?.content).toBe('needle local')
    expect(await context.repositories.documents.get('secret')).toBeUndefined()
  })

  test('query strings with regex syntax cannot match unrelated private content', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 100 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 100 })
    const workspace = (await (await runtime.getWorkspaceService()).getActive()).workspace
    runtime.getSessionDocumentLibrary().save(doc('a', workspace.id, 'a.* is literal'))
    runtime.getSessionDocumentLibrary().save(doc('b', workspace.id, 'a123 is distinct'))
    const search = await runtime.getDocumentService()
    expect((await search.search(workspace, 'a.*')).map(result => result.documentId)).toEqual(['a'])
  })
})
