import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DocumentSnapshot, Workspace } from '../../src/core/workspace/types'
import type { EditableDocument } from '../../src/document/types'
import type { SnapshotService } from '../../src/history/snapshot-service'
import type { SnapshotSummary } from '../../src/history/types'
import type { WorkspaceService } from '../../src/workspace/workspace-service'

function workspace(id = 'w1'): Workspace {
  return {
    id,
    name: id,
    activeRuleProfileId: 'p1',
    storageMode: 'private-session',
    snapshotPolicy: { enabled: true, maxSnapshots: 20 },
    createdAt: 1,
    updatedAt: 1
  }
}

function document(workspaceId = 'w1', id = 'd1', content = 'current'): EditableDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    docType: 'markdown',
    content,
    sourceKind: 'local',
    createdAt: 1,
    updatedAt: 1
  }
}

function snapshot(id = 's1', content = 'old'): DocumentSnapshot {
  return { id, documentId: 'd1', revision: 1, content, reason: 'manual', createdAt: 10 }
}

function summary(id = 's1'): SnapshotSummary {
  return { id, documentId: 'd1', revision: 1, reason: 'manual', createdAt: 10, preview: 'old' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function harness() {
  vi.resetModules()
  const [{ appState }, { createHistoryController }] = await Promise.all([
    import('../../src/state/app-state'),
    import('../../src/state/history-controller')
  ])
  const ws = workspace()
  let current = document()
  appState.setActiveWorkspaceId(ws.id)
  appState.setActiveDocumentId(current.id)
  appState.setDocument(current.content, current.name, current.docType)
  appState.setDocumentSummaries([{ ...current, active: true }])

  const list = vi.fn(async () => [summary()])
  const get = vi.fn(async () => snapshot())
  const capture = vi.fn(async () => ({ snapshot: snapshot('manual'), skippedDuplicate: false }))
  const restore = vi.fn(async () => ({
    document: { ...current, content: 'old', updatedAt: 50 },
    rollbackSnapshot: snapshot('rollback', current.content),
    noOp: false
  }))
  const snapshotService = { list, get, capture, restore, captureAutosave: vi.fn() } as unknown as SnapshotService
  const workspaceService = {
    getActive: vi.fn(async () => ({ workspace: ws }))
  } as unknown as WorkspaceService
  const relint = vi.fn()
  const toast = vi.fn()
  const cancelPendingDocumentPersistence = vi.fn()
  const controller = createHistoryController({
    getSnapshotService: async () => snapshotService,
    getWorkspaceService: async () => workspaceService,
    getCurrentDocument: () => ({
      ...current,
      content: appState.documentText(),
      name: appState.documentName(),
      docType: appState.docType()
    }),
    relint,
    toast,
    cancelPendingDocumentPersistence
  })

  return {
    appState,
    controller,
    ws,
    get current() { return current },
    setCurrent(value: EditableDocument) { current = value },
    snapshotService,
    list,
    get,
    capture,
    restore,
    relint,
    toast,
    cancelPendingDocumentPersistence
  }
}

describe('HistoryController', () => {
  beforeEach(() => vi.restoreAllMocks())

  test('open and refresh bind history to the active workspace/document and preview does not mutate editor body', async () => {
    const h = await harness()
    await h.controller.open()

    expect(h.appState.historyOpen()).toBe(true)
    expect(h.appState.historyLoading()).toBe(false)
    expect(h.appState.historyEntries()).toEqual([summary()])
    expect(h.list).toHaveBeenCalledWith(h.ws, 'd1')

    const before = h.appState.documentText()
    await h.controller.previewSnapshot('s1')
    expect(h.appState.selectedHistorySnapshot()?.id).toBe('s1')
    expect(h.appState.documentText()).toBe(before)
  })

  test('manual snapshot captures current editor content and refreshes the list', async () => {
    const h = await harness()
    await h.controller.open()
    h.list.mockClear()
    h.appState.onDocumentEdited('edited in editor')

    await h.controller.saveManualSnapshot()

    expect(h.capture).toHaveBeenCalledWith(
      h.ws,
      expect.objectContaining({ id: 'd1', content: 'edited in editor' }),
      'manual'
    )
    expect(h.list).toHaveBeenCalledTimes(1)
    expect(h.appState.historyMutationPending()).toBe(false)
  })

  test('stale refresh result is ignored after document identity changes', async () => {
    const h = await harness()
    const pending = deferred<SnapshotSummary[]>()
    h.list.mockImplementationOnce(() => pending.promise)

    const refreshing = h.controller.refresh()
    h.appState.setActiveDocumentId('d2')
    pending.resolve([summary('stale')])
    await refreshing

    expect(h.appState.historyEntries()).toEqual([])
  })

  test('stale restore result never overwrites a newly active document', async () => {
    const h = await harness()
    const pending = deferred<Awaited<ReturnType<SnapshotService['restore']>>>()
    h.restore.mockImplementationOnce(() => pending.promise)
    const restoring = h.controller.restoreSnapshot('s1')

    h.appState.setActiveDocumentId('d2')
    h.appState.setDocument('new active body', 'd2.md', 'markdown')
    pending.resolve({
      document: { ...document('w1', 'd1'), content: 'restored old body', updatedAt: 50 },
      rollbackSnapshot: snapshot('rollback', 'current'),
      noOp: false
    })

    await expect(restoring).rejects.toThrow(/stale/i)
    expect(h.appState.documentText()).toBe('new active body')
    expect(h.relint).not.toHaveBeenCalled()
  })

  test('successful restore cancels pending autosave, applies editor state, resets diagnostics, relints, and refreshes history', async () => {
    const h = await harness()
    h.appState.setSelectedDiagnosticId('stale-diagnostic')
    h.list.mockClear()

    await h.controller.restoreSnapshot('s1')

    expect(h.cancelPendingDocumentPersistence).toHaveBeenCalledTimes(1)
    expect(h.appState.documentText()).toBe('old')
    expect(h.appState.selectedDiagnosticId()).toBeNull()
    expect(h.relint).toHaveBeenCalledTimes(1)
    expect(h.list).toHaveBeenCalledTimes(1)
    expect(h.appState.historyMutationPending()).toBe(false)
  })

  test('a second restore is rejected while the first restore is pending', async () => {
    const h = await harness()
    const pending = deferred<Awaited<ReturnType<SnapshotService['restore']>>>()
    h.restore.mockImplementationOnce(() => pending.promise)

    const first = h.controller.restoreSnapshot('s1')
    await expect(h.controller.restoreSnapshot('s1')).rejects.toThrow(/pending/i)

    pending.resolve({
      document: { ...h.current, content: 'old', updatedAt: 50 },
      rollbackSnapshot: snapshot('rollback'),
      noOp: false
    })
    await first
  })
})
