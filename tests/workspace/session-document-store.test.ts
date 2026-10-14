import { describe, expect, it, vi } from 'vitest'
import type { DocumentType } from '../../src/core/types'

interface SessionDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

interface SessionDocumentStore {
  get(workspaceId: string): SessionDocument | undefined
  set(workspaceId: string, document: SessionDocument): void
  delete(workspaceId: string): void
  clear(): void
}

interface SessionDocumentModule {
  createSessionDocumentStore(): SessionDocumentStore
}

async function loadModule(): Promise<SessionDocumentModule | undefined> {
  return vi
    .importActual<SessionDocumentModule>('../../src/workspace/session-document-store')
    .catch(() => undefined)
}

describe('SessionDocumentStore', () => {
  it('isolates documents by workspace and clones values on both boundaries', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const store = module.createSessionDocumentStore()
    const a: SessionDocument = {
      name: 'a.md',
      content: 'A',
      docType: 'markdown',
      updatedAt: 100
    }
    store.set('workspace-a', a)
    store.set('workspace-b', {
      name: 'b.txt',
      content: 'B',
      docType: 'text',
      updatedAt: 200
    })

    a.content = 'mutated-after-set'
    expect(store.get('workspace-a')?.content).toBe('A')
    expect(store.get('workspace-b')?.content).toBe('B')

    const loaded = store.get('workspace-a')!
    loaded.content = 'mutated-after-get'
    expect(store.get('workspace-a')?.content).toBe('A')
  })

  it('deletes one workspace without touching another and clear removes all', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const store = module.createSessionDocumentStore()
    store.set('workspace-a', { name: 'a.md', content: 'A', docType: 'markdown', updatedAt: 1 })
    store.set('workspace-b', { name: 'b.md', content: 'B', docType: 'markdown', updatedAt: 2 })

    store.delete('workspace-a')
    expect(store.get('workspace-a')).toBeUndefined()
    expect(store.get('workspace-b')?.content).toBe('B')

    store.clear()
    expect(store.get('workspace-b')).toBeUndefined()
  })
})
