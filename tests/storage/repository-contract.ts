import { describe, expect, it } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { StoredWorkspaceDocument } from '../../src/core/workspace/types'
import type { StorageRepositories } from '../../src/storage/repositories/ports'

export function defineRepositoryContract(
  label: string,
  createRepositories: () => Promise<StorageRepositories> | StorageRepositories
): void {
  describe(`${label} repository contract`, () => {
    it('round-trips workspaces with defensive cloning', async () => {
      const repositories = await createRepositories()
      const { workspace } = createDefaultWorkspaceState(1000)
      const savedName = workspace.name

      await repositories.workspaces.save(workspace)
      workspace.name = 'mutated after save'

      const first = await repositories.workspaces.get(workspace.id)
      expect(first?.name).toBe(savedName)
      if (first !== undefined) first.name = 'mutated after read'

      expect((await repositories.workspaces.get(workspace.id))?.name).toBe(savedName)
    })

    it('overwrites the same workspace ID instead of duplicating it', async () => {
      const repositories = await createRepositories()
      const { workspace } = createDefaultWorkspaceState(1000)

      await repositories.workspaces.save(workspace)
      await repositories.workspaces.save({ ...workspace, name: 'Renamed', updatedAt: 2000 })

      expect(await repositories.workspaces.list()).toHaveLength(1)
      expect((await repositories.workspaces.get(workspace.id))?.name).toBe('Renamed')
    })

    it('deletes only the requested workspace', async () => {
      const repositories = await createRepositories()
      const first = createDefaultWorkspaceState(1000).workspace
      const second = { ...first, id: 'workspace-2', name: 'Second Workspace' }

      await repositories.workspaces.save(first)
      await repositories.workspaces.save(second)
      await repositories.workspaces.delete(first.id)

      expect(await repositories.workspaces.get(first.id)).toBeUndefined()
      expect((await repositories.workspaces.get(second.id))?.name).toBe('Second Workspace')
    })

    it('round-trips profiles with defensive cloning', async () => {
      const repositories = await createRepositories()
      const { profile } = createDefaultWorkspaceState(1000)

      await repositories.profiles.save(profile)
      profile.name = 'mutated after save'

      const first = await repositories.profiles.get(profile.id)
      expect(first?.name).toBe('General Japanese')
      if (first !== undefined) first.name = 'mutated after read'

      expect((await repositories.profiles.get(profile.id))?.name).toBe('General Japanese')
    })

    it('isolates documents by workspace and supports overwrite/delete', async () => {
      const repositories = await createRepositories()
      const documentA: StoredWorkspaceDocument = {
        id: 'doc-a',
        workspaceId: 'workspace-a',
        name: 'A.md',
        docType: 'markdown',
        content: 'A',
        sourceKind: 'local',
        createdAt: 1000,
        updatedAt: 1000
      }
      const documentB: StoredWorkspaceDocument = {
        ...documentA,
        id: 'doc-b',
        workspaceId: 'workspace-b',
        name: 'B.md',
        content: 'B'
      }

      await repositories.documents.save(documentA)
      await repositories.documents.save(documentB)
      await repositories.documents.save({ ...documentA, content: 'A2', updatedAt: 2000 })

      const workspaceA = await repositories.documents.listByWorkspace('workspace-a')
      expect(workspaceA).toHaveLength(1)
      expect(workspaceA[0]?.content).toBe('A2')

      workspaceA[0]!.content = 'mutated after read'
      expect((await repositories.documents.get('doc-a'))?.content).toBe('A2')

      await repositories.documents.delete('doc-a')
      expect(await repositories.documents.get('doc-a')).toBeUndefined()
      expect((await repositories.documents.get('doc-b'))?.content).toBe('B')
    })
  })
}
