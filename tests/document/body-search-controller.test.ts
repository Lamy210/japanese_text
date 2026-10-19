import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../src/core/workspace/types'
import type { DocumentService } from '../../src/document/document-service'
import type { WorkspaceService } from '../../src/workspace/workspace-service'
import type { DocumentSearchHit } from '../../src/document/types'
import { createDocumentController } from '../../src/state/document-controller'
import { appState } from '../../src/state/app-state'

const ws: Workspace = {
  id: 'w1', name: 'Workspace', activeRuleProfileId: 'p1',
  storageMode: 'private-session', snapshotPolicy: { enabled: false, maxSnapshots: 20 },
  createdAt: 1, updatedAt: 1
}
const hit: DocumentSearchHit = {
  workspaceId: 'w1', documentId: 'd1', name: 'd1.md',
  start: 0, end: 6, preview: 'needle'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}

function harness(search: DocumentService['search']) {
  const documentService = { search } as unknown as DocumentService
  const workspaceService = {
    getActive: async () => ({ workspace: ws })
  } as unknown as WorkspaceService
  return createDocumentController({
    getDocumentService: async () => documentService,
    getWorkspaceService: async () => workspaceService,
    now: () => 10
  })
}

describe('DocumentController body search', () => {
  beforeEach(() => {
    appState.setActiveWorkspaceId('w1')
    appState.setActiveDocumentId('d1')
    appState.setDocumentSummaries([{
      id: 'd1', workspaceId: 'w1', name: 'd1.md', active: true,
      docType: 'markdown', sourceKind: 'local', createdAt: 1, updatedAt: 1
    }])
    appState.setDocument('needle unsaved', 'd1.md', 'markdown')
  })

  test('search sends the unsaved editor projection without mutating it', async () => {
    const search = vi.fn<DocumentService['search']>(async () => [hit])
    const controller = harness(search)
    expect(await controller.searchWorkspaceDocuments('needle')).toEqual([hit])
    expect(search).toHaveBeenCalledWith(ws, expect.objectContaining({
      workspaceId: 'w1', id: 'd1', content: 'needle unsaved'
    }), 'needle')
    expect(appState.documentText()).toBe('needle unsaved')
  })

  test('rejects stale results after a Workspace navigation', async () => {
    const pending = deferred<DocumentSearchHit[]>()
    let began!: () => void
    const started = new Promise<void>((resolve) => { began = resolve })
    const controller = harness(async () => { began(); return pending.promise })
    const request = controller.searchWorkspaceDocuments('needle')
    await started
    appState.setActiveWorkspaceId('w2')
    pending.resolve([hit])
    await expect(request).rejects.toThrow(/stale/i)
  })

  test('rejects stale results after an editor edit while searching', async () => {
    const pending = deferred<DocumentSearchHit[]>()
    let began!: () => void
    const started = new Promise<void>((resolve) => { began = resolve })
    const controller = harness(async () => { began(); return pending.promise })
    const request = controller.searchWorkspaceDocuments('needle')
    await started
    appState.onDocumentEdited('changed during search')
    pending.resolve([hit])
    await expect(request).rejects.toThrow(/stale/i)
  })
})
