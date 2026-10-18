import { describe, expect, it } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { StoredWorkspaceDocument, Workspace } from '../../src/core/workspace/types'
import {
  createDocumentService,
  type DocumentServiceDependencies
} from '../../src/document/document-service'
import { createSessionDocumentLibraryStore } from '../../src/document/session-document-library'
import type { EditableDocument } from '../../src/document/types'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { StorageRepositories } from '../../src/storage/repositories/ports'
import { WELCOME_DOCUMENT } from '../../src/state/welcome-document'

function workspace(id: string, mode: 'private-session' | 'local-library'): Workspace {
  return {
    ...createDefaultWorkspaceState(1000).workspace,
    id,
    name: id,
    storageMode: mode
  }
}

function stored(
  id: string,
  workspaceId: string,
  updatedAt = 1000,
  createdAt = 1000,
  content?: string
): StoredWorkspaceDocument {
  const resolvedContent = arguments.length >= 5 ? content : id
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    docType: 'markdown',
    ...(resolvedContent === undefined ? {} : { content: resolvedContent }),
    sourceKind: 'local',
    createdAt,
    updatedAt
  }
}

function editable(id: string, workspaceId: string, content = id): EditableDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    docType: 'markdown',
    content,
    sourceKind: 'local',
    createdAt: 1000,
    updatedAt: 1000
  }
}

async function harness(
  target: Workspace,
  overrides: Partial<DocumentServiceDependencies> = {}
): Promise<{
  repositories: StorageRepositories
  service: ReturnType<typeof createDocumentService>
  sessionLibrary: ReturnType<typeof createSessionDocumentLibraryStore>
}> {
  const memory = createMemoryStorageContext(() => 5000)
  await memory.repositories.workspaces.save(target)
  const sessionLibrary = createSessionDocumentLibraryStore()
  let id = 0
  const service = createDocumentService({
    repositories: memory.repositories,
    atomic: memory.atomicOperations,
    sessionLibrary,
    now: () => 5000,
    generateId: () => `generated-${++id}`,
    ...overrides
  })
  return { repositories: memory.repositories, service, sessionLibrary }
}

describe('DocumentService active document resolution', () => {
  it('loads an explicit Local Library active document instead of the newest document', async () => {
    const target = workspace('workspace-a', 'local-library')
    const { repositories, service } = await harness(target)
    await repositories.documents.save(stored('older-selected', target.id, 1000))
    await repositories.documents.save(stored('newer', target.id, 3000))
    await repositories.documentSelection.setActiveDocumentId(target.id, 'older-selected')

    const result = await service.resolveActive(target)

    expect(result.document).toMatchObject({ id: 'older-selected', content: 'older-selected' })
    expect(result.summaries.find((value) => value.id === 'older-selected')?.active).toBe(true)
  })

  it('repairs missing Local selection using legacy newest order exactly once', async () => {
    const target = workspace('workspace-a', 'local-library')
    const { repositories, service } = await harness(target)
    await repositories.documents.save(stored('old', target.id, 1000, 1000))
    await repositories.documents.save(stored('legacy-newest', target.id, 3000, 2000))

    expect((await service.resolveActive(target)).document).toMatchObject({ id: 'legacy-newest' })
    expect(await repositories.documentSelection.getActiveDocumentId(target.id)).toBe('legacy-newest')

    await repositories.documents.save(stored('old', target.id, 9000, 1000))
    expect((await service.resolveActive(target)).document).toMatchObject({ id: 'legacy-newest' })
  })

  it('repairs an invalid Local selection', async () => {
    const target = workspace('workspace-a', 'local-library')
    const { repositories, service } = await harness(target)
    await repositories.documents.save(stored('doc-a', target.id, 1000))
    await repositories.documents.save(stored('doc-b', target.id, 2000))
    await repositories.documentSelection.setActiveDocumentId(target.id, 'missing')

    const result = await service.resolveActive(target)

    expect(result.document).toMatchObject({ id: 'doc-b' })
    expect(await repositories.documentSelection.getActiveDocumentId(target.id)).toBe('doc-b')
  })

  it('creates and activates a persisted welcome document when a Local Library is empty', async () => {
    const target = workspace('workspace-a', 'local-library')
    const { repositories, service } = await harness(target)

    const result = await service.resolveActive(target)

    expect(result.document).toMatchObject({
      id: 'generated-1',
      name: 'welcome.md',
      content: WELCOME_DOCUMENT
    })
    expect((await repositories.documents.listByWorkspace(target.id))).toHaveLength(1)
    expect(await repositories.documentSelection.getActiveDocumentId(target.id)).toBe('generated-1')
  })

  it('uses a transient Local selection if repair persistence fails', async () => {
    const target = workspace('workspace-a', 'local-library')
    const memory = createMemoryStorageContext(() => 5000)
    await memory.repositories.workspaces.save(target)
    await memory.repositories.documents.save(stored('doc-a', target.id, 1000))
    await memory.repositories.documents.save(stored('doc-b', target.id, 2000))
    let setAttempts = 0
    const repositories: StorageRepositories = {
      ...memory.repositories,
      documentSelection: {
        ...memory.repositories.documentSelection,
        async setActiveDocumentId() {
          setAttempts += 1
          throw new Error('forced selection write failure')
        }
      }
    }
    const service = createDocumentService({
      repositories,
      atomic: memory.atomicOperations,
      sessionLibrary: createSessionDocumentLibraryStore(),
      now: () => 5000,
      generateId: () => 'generated'
    })

    const first = await service.resolveActive(target)
    const second = await service.resolveActive(target)

    expect(first.document).toMatchObject({ id: 'doc-b' })
    expect(first.warning).toContain('selection')
    expect(second.document).toMatchObject({ id: 'doc-b' })
    expect(setAttempts).toBe(1)
  })

  it('creates a welcome document only in memory for an empty Private Session', async () => {
    const target = workspace('workspace-a', 'private-session')
    const { repositories, service, sessionLibrary } = await harness(target)

    const result = await service.resolveActive(target)

    expect(result.document).toMatchObject({ name: 'welcome.md', content: WELCOME_DOCUMENT })
    expect(sessionLibrary.list(target.id)).toHaveLength(1)
    expect(await repositories.documents.listByWorkspace(target.id)).toEqual([])
    expect(await repositories.documentSelection.getActiveDocumentId(target.id)).toBeUndefined()
  })

  it('recovers a Local body with missing content as empty text with a warning', async () => {
    const target = workspace('workspace-a', 'local-library')
    const { repositories, service } = await harness(target)
    await repositories.documents.save(stored('doc-a', target.id, 1000, 1000, undefined))
    await repositories.documentSelection.setActiveDocumentId(target.id, 'doc-a')

    const result = await service.resolveActive(target)

    expect(result.document).toMatchObject({ id: 'doc-a', content: '' })
    expect(result.warning).toContain('content')
  })
})

describe('DocumentService CRUD and switching', () => {
  it('allows duplicate names because immutable IDs define identity', async () => {
    const target = workspace('workspace-a', 'private-session')
    const { service } = await harness(target)

    const first = await service.create(target, { name: 'same.md' })
    const second = await service.create(target, { name: 'same.md' })

    expect(first.document).toMatchObject({ id: 'generated-1', name: 'same.md' })
    expect(second.document).toMatchObject({ id: 'generated-2', name: 'same.md' })
    expect(second.summaries.filter((value) => value.name === 'same.md')).toHaveLength(2)
  })

  it('normalizes valid rename input and rejects empty, path-like, control, and overlong names', async () => {
    const target = workspace('workspace-a', 'private-session')
    const { service } = await harness(target)
    const created = await service.create(target)
    const id = 'id' in created.document ? created.document.id : ''

    expect((await service.rename(target, id, '  renamed.md  ')).document).toMatchObject({ name: 'renamed.md' })
    await expect(service.rename(target, id, '   ')).rejects.toThrow()
    await expect(service.rename(target, id, 'folder/name.md')).rejects.toThrow()
    await expect(service.rename(target, id, 'folder\\name.md')).rejects.toThrow()
    await expect(service.rename(target, id, 'bad\u0000name')).rejects.toThrow()
    await expect(service.rename(target, id, 'あ'.repeat(121))).rejects.toThrow()
  })

  it('switches Private documents A to B to A without losing the current editor body', async () => {
    const target = workspace('workspace-a', 'private-session')
    const { service } = await harness(target)
    const a = await service.create(target, { name: 'a.md', content: 'A original' })
    const aDocument = a.document as EditableDocument
    const b = await service.create(target, { name: 'b.md', content: 'B original' })
    const bDocument = b.document as EditableDocument

    const switchedToA = await service.switchTo(target, aDocument.id, { ...bDocument, content: 'B edited' })
    const switchedBackToB = await service.switchTo(target, bDocument.id, {
      ...(switchedToA.document as EditableDocument),
      content: 'A edited'
    })

    expect(switchedToA.document).toMatchObject({ id: aDocument.id, content: 'A original' })
    expect(switchedBackToB.document).toMatchObject({ id: bDocument.id, content: 'B edited' })
    const backToA = await service.switchTo(target, aDocument.id, switchedBackToB.document as EditableDocument)
    expect(backToA.document).toMatchObject({ id: aDocument.id, content: 'A edited' })
  })

  it('does not change Local selection when saving the current document fails before a switch', async () => {
    const target = workspace('workspace-a', 'local-library')
    const memory = createMemoryStorageContext(() => 5000)
    await memory.repositories.workspaces.save(target)
    await memory.repositories.documents.save(stored('doc-a', target.id))
    await memory.repositories.documents.save(stored('doc-b', target.id))
    await memory.repositories.documentSelection.setActiveDocumentId(target.id, 'doc-a')
    const repositories: StorageRepositories = {
      ...memory.repositories,
      documents: {
        ...memory.repositories.documents,
        async save(value) {
          if (value.id === 'doc-a') throw new Error('forced save failure')
          return memory.repositories.documents.save(value)
        }
      }
    }
    const service = createDocumentService({
      repositories,
      atomic: {
        ...memory.atomicOperations,
        async saveLocalDocumentIfActive(value) {
          if (value.id === 'doc-a') throw new Error('forced save failure')
          return memory.atomicOperations.saveLocalDocumentIfActive(value)
        }
      },
      sessionLibrary: createSessionDocumentLibraryStore(),
      now: () => 5000,
      generateId: () => 'generated'
    })

    await expect(service.switchTo(target, 'doc-b', editable('doc-a', target.id, 'edited'))).rejects.toThrow(
      'forced save failure'
    )
    expect(await repositories.documentSelection.getActiveDocumentId(target.id)).toBe('doc-a')
  })

  it('rejects a switch target owned by another workspace', async () => {
    const target = workspace('workspace-a', 'local-library')
    const { repositories, service } = await harness(target)
    await repositories.documents.save(stored('doc-a', target.id))
    await repositories.documents.save(stored('doc-b', 'workspace-b'))
    await repositories.documentSelection.setActiveDocumentId(target.id, 'doc-a')

    await expect(service.switchTo(target, 'doc-b', editable('doc-a', target.id))).rejects.toThrow()
    expect(await repositories.documentSelection.getActiveDocumentId(target.id)).toBe('doc-a')
  })

  it('deletes the active document and selects the next stable document, then the previous one', async () => {
    const target = workspace('workspace-a', 'private-session')
    const { service } = await harness(target)
    const first = (await service.create(target, { name: 'first.md' })).document as EditableDocument
    const second = (await service.create(target, { name: 'second.md' })).document as EditableDocument
    const third = (await service.create(target, { name: 'third.md' })).document as EditableDocument
    await service.switchTo(target, second.id, third)

    const afterSecond = await service.delete(target, second.id)
    expect(afterSecond.document).toMatchObject({ id: third.id })

    const afterThird = await service.delete(target, third.id)
    expect(afterThird.document).toMatchObject({ id: first.id })
  })

  it('deleting the last document creates an empty untitled replacement', async () => {
    const target = workspace('workspace-a', 'local-library')
    const { service } = await harness(target)
    const only = await service.create(target, { name: 'only.md', content: 'body' })
    const onlyId = (only.document as EditableDocument).id

    const result = await service.delete(target, onlyId)

    expect(result.deletedDocumentId).toBe(onlyId)
    expect(result.document).toMatchObject({ name: 'untitled.md', content: '' })
    expect(result.summaries).toHaveLength(1)
  })

  it('deleting a non-active document preserves the current active selection', async () => {
    const target = workspace('workspace-a', 'local-library')
    const { repositories, service } = await harness(target)
    const active = await service.create(target, { name: 'active.md' })
    const activeDocument = active.document as EditableDocument
    const other = await service.create(target, { name: 'other.md' })
    const otherDocument = other.document as EditableDocument
    await service.switchTo(target, activeDocument.id, otherDocument)

    const result = await service.delete(target, otherDocument.id)

    expect(result.document).toMatchObject({ id: activeDocument.id })
    expect(await repositories.documentSelection.getActiveDocumentId(target.id)).toBe(activeDocument.id)
  })
})
