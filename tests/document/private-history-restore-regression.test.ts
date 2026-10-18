import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { createApplicationRuntime } from '../../src/state/application-runtime'
import { createStorageContext } from '../../src/storage/bootstrap'

describe('Private Session history restore persistence', () => {
  test('restored body remains canonical in the session document library', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 100 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 500 })
    const workspace = (await (await runtime.getWorkspaceService()).getActive()).workspace
    expect(workspace.storageMode).toBe('private-session')
    const documents = await runtime.getDocumentService()
    const initial = (await documents.resolveActive(workspace)).document
    if (!('id' in initial)) throw new Error('Expected editable document')

    await documents.save(workspace, { ...initial, content: 'original body' })
    const service = await runtime.getSnapshotService()
    const checkpoint = await service.capture(
      { ...workspace, snapshotPolicy: { enabled: true, maxSnapshots: 20 } },
      { ...initial, content: 'original body' },
      'manual'
    )
    const snapshotId = checkpoint.snapshot?.id
    if (snapshotId === undefined) throw new Error('Expected manual snapshot')
    await documents.save(workspace, { ...initial, content: 'new body' })
    const result = await service.restore(workspace, { ...initial, content: 'new body' }, snapshotId)
    expect(result.noOp).toBe(false)
    expect(result.document.content).toBe('original body')

    const canonical = runtime.getSessionDocumentLibrary().get(workspace.id, initial.id)
    expect(canonical?.content).toBe('original body')
    expect((await documents.resolveActive(workspace)).document.content).toBe('original body')
  })
})
