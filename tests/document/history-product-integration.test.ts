import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../src/core/workspace/types'

const applyFixesTransaction = vi.fn()
const snapshotCapture = vi.fn()
const snapshotAutosave = vi.fn()
const documentSave = vi.fn()

const workspace: Workspace = {
  id: 'w1',
  name: 'W1',
  activeRuleProfileId: 'p1',
  storageMode: 'local-library',
  snapshotPolicy: { enabled: true, maxSnapshots: 20 },
  createdAt: 1,
  updatedAt: 1
}

vi.mock('../../src/editor/editor-adapter', () => ({
  applyFixesTransaction,
  applyReplacement: vi.fn(),
  jumpToPosition: vi.fn()
}))

vi.mock('../../src/core/formatter/formatter', () => ({
  formatDocument: vi.fn(() => ({
    text: 'formatted',
    appliedCount: 1,
    skippedCount: 0,
    appliedFixes: [{ start: 0, end: 1, replacement: 'F' }]
  }))
}))

vi.mock('../../src/state/lint-controller', () => ({
  lintController: {
    lintAllNow: vi.fn(async () => undefined),
    lintShadowText: vi.fn(async () => new Map()),
    relintAll: vi.fn(),
    scheduleLint: vi.fn()
  }
}))

vi.mock('../../src/storage/storage', () => ({
  getStorageContext: vi.fn(async () => ({
    repositories: {
      workspaces: { get: vi.fn(async () => workspace) },
      documents: {
        get: vi.fn(async () => ({
          id: 'd1', workspaceId: 'w1', name: 'd1.md', content: 'before', docType: 'markdown',
          sourceKind: 'local', createdAt: 1, updatedAt: 1
        })),
        save: documentSave
      }
    },
    atomic: { saveLocalDocumentIfActive: documentSave }
  })),
  saveConfig: vi.fn(async () => undefined),
  saveWorkspaceDocument: vi.fn(async () => undefined),
  isStorageAvailable: vi.fn(() => true)
}))

vi.mock('../../src/state/application-runtime', () => ({
  applicationRuntime: {
    getWorkspaceService: vi.fn(async () => ({ getActive: vi.fn(async () => ({ workspace })) })),
    getSnapshotService: vi.fn(async () => ({ capture: snapshotCapture, captureAutosave: snapshotAutosave }))
  }
}))

vi.mock('../../src/state/workspace-runtime', () => ({
  documentController: {
    currentEditableDocument: vi.fn(() => ({
      id: 'd1', workspaceId: 'w1', name: 'd1.md', content: 'before', docType: 'markdown',
      sourceKind: 'local', createdAt: 1, updatedAt: 2
    }))
  }
}))

describe('history product integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    snapshotCapture.mockResolvedValue({ snapshot: { id: 's1' }, skippedDuplicate: false })
    snapshotAutosave.mockResolvedValue({ snapshot: { id: 'a1' }, skippedDuplicate: false })
    documentSave.mockResolvedValue(undefined)
    const { appState } = await import('../../src/state/app-state')
    appState.setActiveWorkspaceId('w1')
    appState.setActiveDocumentId('d1')
    appState.setDocumentSummaries([{
      id: 'd1', workspaceId: 'w1', name: 'd1.md', docType: 'markdown', sourceKind: 'local',
      createdAt: 1, updatedAt: 1, active: true
    }])
    appState.setDocument('before', 'd1.md', 'markdown')
    appState.updateConfig((draft) => { draft.formatter.enabled = true })
  })

  test('Format captures before-format before mutating the editor', async () => {
    const { formatDocumentAction } = await import('../../src/state/actions')
    snapshotCapture.mockImplementationOnce(async () => {
      expect(applyFixesTransaction).not.toHaveBeenCalled()
      return { snapshot: { id: 's1' }, skippedDuplicate: false }
    })

    await formatDocumentAction()

    expect(snapshotCapture).toHaveBeenCalledWith(
      workspace,
      expect.objectContaining({ id: 'd1', content: 'before' }),
      'before-format'
    )
    expect(applyFixesTransaction).toHaveBeenCalledTimes(1)
  })

  test('failed before-format capture aborts Format and leaves editor mutation unapplied', async () => {
    const { formatDocumentAction } = await import('../../src/state/actions')
    snapshotCapture.mockRejectedValueOnce(new Error('snapshot failed'))

    await formatDocumentAction()

    expect(applyFixesTransaction).not.toHaveBeenCalled()
  })

  test('policy OFF skips before-format capture and preserves Format behavior', async () => {
    const { formatDocumentAction } = await import('../../src/state/actions')
    workspace.snapshotPolicy.enabled = false

    await formatDocumentAction()

    expect(snapshotCapture).not.toHaveBeenCalled()
    expect(applyFixesTransaction).toHaveBeenCalledTimes(1)
    workspace.snapshotPolicy.enabled = true
  })

  test('successful Local document save triggers best-effort autosave snapshot after save', async () => {
    const { persistCapturedDocument } = await import('../../src/state/actions')
    const order: string[] = []
    documentSave.mockImplementationOnce(async () => { order.push('save') })
    snapshotAutosave.mockImplementationOnce(async () => { order.push('snapshot'); return { skippedDuplicate: true } })

    await persistCapturedDocument({
      workspaceId: 'w1', documentId: 'd1', name: 'd1.md', content: 'edited', docType: 'markdown',
      sourceKind: 'local', createdAt: 1, updatedAt: 3
    })

    expect(order).toEqual(['save', 'snapshot'])
    expect(snapshotAutosave).toHaveBeenCalledWith(
      workspace,
      expect.objectContaining({ id: 'd1', content: 'edited' })
    )
  })

  test('autosave snapshot failure does not roll back or reject a successful document save', async () => {
    const { persistCapturedDocument } = await import('../../src/state/actions')
    snapshotAutosave.mockRejectedValueOnce(new Error('history unavailable'))

    await expect(persistCapturedDocument({
      workspaceId: 'w1', documentId: 'd1', name: 'd1.md', content: 'edited', docType: 'markdown',
      sourceKind: 'local', createdAt: 1, updatedAt: 3
    })).resolves.toBeUndefined()

    expect(documentSave).toHaveBeenCalledTimes(1)
  })
  test('Format aborts if the editor changes while the before-format checkpoint is pending', async () => {
    const { appState } = await import('../../src/state/app-state')
    const { formatDocumentAction } = await import('../../src/state/actions')
    snapshotCapture.mockImplementationOnce(async () => {
      appState.onDocumentEdited('concurrent user edit')
      return { snapshot: { id: 's1' }, skippedDuplicate: false }
    })

    await formatDocumentAction()

    expect(applyFixesTransaction).not.toHaveBeenCalled()
    expect(appState.documentText()).toBe('concurrent user edit')
  })

})
