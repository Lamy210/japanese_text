import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { createStorageContext } from '../../src/storage/bootstrap'
import { createApplicationRuntime } from '../../src/state/application-runtime'
import { createDocumentController } from '../../src/state/document-controller'
import { createWorkspaceController } from '../../src/state/workspace-controller'
import { appState } from '../../src/state/app-state'

describe('History mutation guards', () => {
  test('document and workspace navigation reject while a history restore is pending', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 100 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 500 })
    const workspaceController = createWorkspaceController({ runtime, now: () => 500 })
    const documentController = createDocumentController({
      getDocumentService: runtime.getDocumentService,
      getWorkspaceService: runtime.getWorkspaceService,
      now: () => 500
    })
    await workspaceController.bootstrap()
    const firstWorkspaceId = appState.activeWorkspaceId()
    const firstDocumentId = appState.activeDocumentId()
    if (!firstWorkspaceId || !firstDocumentId) throw new Error('Expected first workspace/document')
    await documentController.createDocument()
    const secondDocumentId = appState.activeDocumentId()
    expect(secondDocumentId).not.toBe(firstDocumentId)

    appState.setHistoryMutationPending(true)
    try {
      await expect(documentController.switchDocument(firstDocumentId)).rejects.toThrow(/history/i)
      expect(appState.activeDocumentId()).toBe(secondDocumentId)
    } finally {
      appState.setHistoryMutationPending(false)
    }

    await workspaceController.createWorkspace('Second')
    const secondWorkspaceId = appState.activeWorkspaceId()
    expect(secondWorkspaceId).not.toBe(firstWorkspaceId)
    appState.setHistoryMutationPending(true)
    try {
      await expect(workspaceController.switchWorkspace(firstWorkspaceId)).rejects.toThrow(/history/i)
      expect(appState.activeWorkspaceId()).toBe(secondWorkspaceId)
    } finally {
      appState.setHistoryMutationPending(false)
    }
  })
})
