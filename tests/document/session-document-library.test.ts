import { describe, expect, it } from 'vitest'
import {
  createSessionDocumentLibraryStore,
  type SessionDocumentLibrarySnapshot
} from '../../src/document/session-document-library'
import type { EditableDocument } from '../../src/document/types'

function document(
  id: string,
  workspaceId = 'workspace-a',
  content = id
): EditableDocument {
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

describe('SessionDocumentLibraryStore', () => {
  it('stores multiple documents independently per workspace', () => {
    const store = createSessionDocumentLibraryStore()
    store.save(document('a1', 'workspace-a'))
    store.save(document('a2', 'workspace-a'))
    store.save(document('b1', 'workspace-b'))

    expect(store.list('workspace-a').map((value) => value.id)).toEqual(['a1', 'a2'])
    expect(store.list('workspace-b').map((value) => value.id)).toEqual(['b1'])
  })

  it('defensively clones documents on save and read', () => {
    const store = createSessionDocumentLibraryStore()
    const original = document('a1', 'workspace-a', 'original')
    store.save(original)
    original.content = 'mutated after save'

    const first = store.get('workspace-a', 'a1')
    expect(first?.content).toBe('original')
    if (first !== undefined) first.content = 'mutated after read'

    expect(store.get('workspace-a', 'a1')?.content).toBe('original')
  })

  it('tracks active document selection per workspace', () => {
    const store = createSessionDocumentLibraryStore()
    store.save(document('a1', 'workspace-a'))
    store.save(document('a2', 'workspace-a'))
    store.save(document('b1', 'workspace-b'))

    store.setActiveDocumentId('workspace-a', 'a2')
    store.setActiveDocumentId('workspace-b', 'b1')

    expect(store.getActiveDocumentId('workspace-a')).toBe('a2')
    expect(store.getActiveDocumentId('workspace-b')).toBe('b1')
  })

  it('deleting a document removes only that document and clears a matching active selection', () => {
    const store = createSessionDocumentLibraryStore()
    store.save(document('a1'))
    store.save(document('a2'))
    store.setActiveDocumentId('workspace-a', 'a1')

    store.delete('workspace-a', 'a1')

    expect(store.get('workspace-a', 'a1')).toBeUndefined()
    expect(store.get('workspace-a', 'a2')?.id).toBe('a2')
    expect(store.getActiveDocumentId('workspace-a')).toBeUndefined()
  })

  it('replaces one workspace atomically when the snapshot is valid', () => {
    const store = createSessionDocumentLibraryStore()
    store.save(document('old'))
    store.setActiveDocumentId('workspace-a', 'old')

    const snapshot: SessionDocumentLibrarySnapshot = {
      documents: [document('new-1'), document('new-2')],
      activeDocumentId: 'new-2'
    }
    store.replaceWorkspace('workspace-a', snapshot)

    expect(store.list('workspace-a').map((value) => value.id)).toEqual(['new-1', 'new-2'])
    expect(store.getActiveDocumentId('workspace-a')).toBe('new-2')
  })

  it('rejects an invalid replacement without mutating existing workspace state', () => {
    const store = createSessionDocumentLibraryStore()
    store.save(document('old'))
    store.setActiveDocumentId('workspace-a', 'old')

    expect(() =>
      store.replaceWorkspace('workspace-a', {
        documents: [document('new-1')],
        activeDocumentId: 'missing'
      })
    ).toThrow()

    expect(store.list('workspace-a').map((value) => value.id)).toEqual(['old'])
    expect(store.getActiveDocumentId('workspace-a')).toBe('old')
  })

  it('rejects replacement documents that belong to another workspace', () => {
    const store = createSessionDocumentLibraryStore()

    expect(() =>
      store.replaceWorkspace('workspace-a', {
        documents: [document('b1', 'workspace-b')],
        activeDocumentId: 'b1'
      })
    ).toThrow()

    expect(store.list('workspace-a')).toEqual([])
  })

  it('deletes all state for one workspace without touching another', () => {
    const store = createSessionDocumentLibraryStore()
    store.save(document('a1', 'workspace-a'))
    store.save(document('b1', 'workspace-b'))
    store.setActiveDocumentId('workspace-a', 'a1')
    store.setActiveDocumentId('workspace-b', 'b1')

    store.deleteWorkspace('workspace-a')

    expect(store.list('workspace-a')).toEqual([])
    expect(store.getActiveDocumentId('workspace-a')).toBeUndefined()
    expect(store.list('workspace-b').map((value) => value.id)).toEqual(['b1'])
    expect(store.getActiveDocumentId('workspace-b')).toBe('b1')
  })

  it('clear removes every workspace', () => {
    const store = createSessionDocumentLibraryStore()
    store.save(document('a1', 'workspace-a'))
    store.save(document('b1', 'workspace-b'))

    store.clear()

    expect(store.list('workspace-a')).toEqual([])
    expect(store.list('workspace-b')).toEqual([])
  })
})
