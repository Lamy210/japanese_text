import { describe, expect, it } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { StoredWorkspaceDocument } from '../../src/core/workspace/types'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'

function document(id: string, workspaceId: string, content: string): StoredWorkspaceDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    content,
    docType: 'markdown',
    sourceKind: 'local',
    createdAt: 1,
    updatedAt: 1
  }
}

async function localHarness() {
  const memory = createMemoryStorageContext(() => 1000)
  const state = createDefaultWorkspaceState(100)
  state.workspace.storageMode = 'local-library'
  await memory.repositories.workspaces.save(state.workspace)
  return { memory, workspaceId: state.workspace.id }
}

describe('Memory atomic document collision parity', () => {
  it('rejects createDocumentAndActivate when the ID already exists in the same Workspace', async () => {
    const { memory, workspaceId } = await localHarness()
    await memory.repositories.documents.save(document('same-id', workspaceId, 'original'))

    await expect(
      memory.atomicOperations.createDocumentAndActivate(document('same-id', workspaceId, 'replacement'))
    ).rejects.toThrow('already exists')

    await expect(memory.repositories.documents.get('same-id')).resolves.toMatchObject({ content: 'original' })
    await expect(memory.repositories.documentSelection.getActiveDocumentId(workspaceId)).resolves.toBeUndefined()
  })

  it('rejects replaceLastDocument when the replacement ID belongs to another document in the same Workspace', async () => {
    const { memory, workspaceId } = await localHarness()
    await memory.repositories.documents.save(document('old', workspaceId, 'old body'))
    await memory.repositories.documents.save(document('collision', workspaceId, 'keep body'))
    await memory.repositories.documentSelection.setActiveDocumentId(workspaceId, 'old')

    await expect(
      memory.atomicOperations.replaceLastDocument(
        workspaceId,
        'old',
        document('collision', workspaceId, 'must not overwrite')
      )
    ).rejects.toThrow('already exists')

    await expect(memory.repositories.documents.get('old')).resolves.toMatchObject({ content: 'old body' })
    await expect(memory.repositories.documents.get('collision')).resolves.toMatchObject({ content: 'keep body' })
    await expect(memory.repositories.documentSelection.getActiveDocumentId(workspaceId)).resolves.toBe('old')
  })
})