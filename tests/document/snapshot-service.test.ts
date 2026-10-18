import { describe, expect, test, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { Workspace } from '../../src/core/workspace/types'
import type { EditableDocument } from '../../src/document/types'
import { createSessionSnapshotStore } from '../../src/document/session-snapshot-store'
import { createSessionDocumentLibraryStore } from '../../src/document/session-document-library'
import { createSnapshotService } from '../../src/history/snapshot-service'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'

function workspace(
  mode: 'private-session' | 'local-library',
  enabled = true,
  maxSnapshots = 20
): Workspace {
  const base = createDefaultWorkspaceState(1).workspace
  return {
    ...base,
    id: `workspace-${mode}`,
    storageMode: mode,
    snapshotPolicy: { enabled, maxSnapshots }
  }
}

function document(workspaceId: string, content = 'current'): EditableDocument {
  return {
    id: 'd1',
    workspaceId,
    name: 'd1.md',
    docType: 'markdown',
    content,
    sourceKind: 'local',
    createdAt: 1,
    updatedAt: 1
  }
}

function serviceHarness(start = 1_000) {
  const durable = createMemoryStorageContext(() => start)
  const sessionSnapshots = createSessionSnapshotStore()
  const sessionDocuments = createSessionDocumentLibraryStore()
  let clock = start
  let id = 0
  const service = createSnapshotService({
    repositories: durable.repositories,
    atomic: durable.atomicOperations,
    sessionSnapshots,
    sessionDocuments,
    now: () => clock,
    generateId: () => `snapshot-${++id}`
  })
  return {
    durable,
    sessionSnapshots,
    service,
    setClock(value: number) {
      clock = value
    }
  }
}

describe('SnapshotService', () => {
  test('policy OFF blocks manual, before-format, and autosave capture but keeps existing list/get/restore usable', async () => {
    const harness = serviceHarness()
    const ws = workspace('local-library', false)
    const doc = document(ws.id, 'current')
    await harness.durable.repositories.workspaces.save(ws)
    await harness.durable.repositories.documents.save(doc)
    await harness.durable.atomicOperations.captureSnapshot({
      id: 'target', documentId: doc.id, content: 'old', reason: 'manual', createdAt: 10, maxSnapshots: 20
    })

    await harness.service.capture(ws, doc, 'manual')
    await harness.service.capture(ws, doc, 'before-format')
    await harness.service.captureAutosave(ws, doc)
    expect(await harness.durable.repositories.snapshots.listByDocument(doc.id)).toHaveLength(1)

    const summaries = await harness.service.list(ws, doc.id)
    expect(summaries.map((summary) => summary.id)).toEqual(['target'])
    expect((await harness.service.get(ws, doc.id, 'target'))?.content).toBe('old')

    const restored = await harness.service.restore(ws, doc, 'target')
    expect(restored.document.content).toBe('old')
    expect(restored.noOp).toBe(false)
    expect((await harness.durable.repositories.snapshots.listByDocument(doc.id)).some(
      (snapshot) => snapshot.reason === 'before-restore' && snapshot.content === 'current'
    )).toBe(true)
  })

  test('autosave captures immediately, throttles for five minutes, and manual capture does not reset its clock', async () => {
    const harness = serviceHarness(1_000)
    const ws = workspace('private-session', true)
    const doc = document(ws.id, 'one')

    const first = await harness.service.captureAutosave(ws, doc)
    expect('snapshot' in first && first.snapshot?.reason).toBe('autosave')

    harness.setClock(1_000 + 60_000)
    const throttled = await harness.service.captureAutosave(ws, { ...doc, content: 'two' })
    expect(throttled).toEqual({ skippedThrottle: true })

    harness.setClock(1_000 + 120_000)
    await harness.service.capture(ws, { ...doc, content: 'manual-body' }, 'manual')

    harness.setClock(1_000 + 299_999)
    expect(await harness.service.captureAutosave(ws, { ...doc, content: 'three' })).toEqual({ skippedThrottle: true })

    harness.setClock(1_000 + 300_000)
    const second = await harness.service.captureAutosave(ws, { ...doc, content: 'three' })
    expect('snapshot' in second && second.snapshot?.reason).toBe('autosave')
    expect(harness.sessionSnapshots.list(doc.id).map((snapshot) => snapshot.reason)).toEqual([
      'autosave',
      'manual',
      'autosave'
    ])
  })

  test('summary preview collapses Unicode whitespace, trims, limits to 160 code points, and labels empty content', async () => {
    const harness = serviceHarness()
    const ws = workspace('private-session', true)
    const doc = document(ws.id)
    await harness.service.capture(ws, { ...doc, content: `  hello\n\tworld  ${'😀'.repeat(200)}` }, 'manual')
    const longPreview = (await harness.service.list(ws, doc.id))[0]!.preview
    expect([...longPreview]).toHaveLength(160)
    expect(longPreview.startsWith('hello world 😀')).toBe(true)

    await harness.service.capture(ws, { ...doc, content: ' \n\t　 ' }, 'manual')
    expect((await harness.service.list(ws, doc.id))[0]!.preview).toBe('(empty)')
  })

  test('restoring the current body is a no-op without creating a checkpoint or updating the body', async () => {
    const harness = serviceHarness(5_000)
    const ws = workspace('private-session', true)
    const doc = document(ws.id, 'same')
    await harness.service.capture(ws, doc, 'manual')
    const before = harness.sessionSnapshots.list(doc.id)

    harness.setClock(10_000)
    const result = await harness.service.restore(ws, doc, before[0]!.id)

    expect(result.noOp).toBe(true)
    expect(result.document.updatedAt).toBe(doc.updatedAt)
    expect(harness.sessionSnapshots.list(doc.id)).toEqual(before)
  })

  test('Private Session never calls durable snapshot reads or atomic capture/restore', async () => {
    const harness = serviceHarness()
    const ws = workspace('private-session', true)
    const doc = document(ws.id, 'private')
    const listSpy = vi.spyOn(harness.durable.repositories.snapshots, 'listByDocument')
    const getSpy = vi.spyOn(harness.durable.repositories.snapshots, 'get')
    const captureSpy = vi.spyOn(harness.durable.atomicOperations, 'captureSnapshot')
    const restoreSpy = vi.spyOn(harness.durable.atomicOperations, 'restoreDocumentFromSnapshot')

    await harness.service.capture(ws, doc, 'manual')
    const snapshotId = harness.sessionSnapshots.list(doc.id)[0]!.id
    await harness.service.list(ws, doc.id)
    await harness.service.get(ws, doc.id, snapshotId)
    await harness.service.restore(ws, { ...doc, content: 'changed' }, snapshotId)

    expect(listSpy).not.toHaveBeenCalled()
    expect(getSpy).not.toHaveBeenCalled()
    expect(captureSpy).not.toHaveBeenCalled()
    expect(restoreSpy).not.toHaveBeenCalled()
  })
})
