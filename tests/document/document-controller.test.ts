import { describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createDocumentService } from '../../src/document/document-service'
import { createSessionDocumentLibraryStore } from '../../src/document/session-document-library'
import type { Workspace } from '../../src/core/workspace/types'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

async function harness(mode: 'private-session' | 'local-library' = 'private-session') {
  vi.resetModules()
  const [{ appState }, { createDocumentController }] = await Promise.all([
    import('../../src/state/app-state'),
    import('../../src/state/document-controller')
  ])
  const memory = createMemoryStorageContext(() => 5000)
  const state = createDefaultWorkspaceState(1000)
  state.workspace.id = 'workspace-a'
  state.workspace.name = 'Workspace A'
  state.workspace.activeRuleProfileId = 'profile-a'
  state.workspace.storageMode = mode
  state.profile.id = 'profile-a'
  await memory.repositories.preferences.save(state.preferences)
  await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)
  const sessionLibrary = createSessionDocumentLibraryStore()
  let generated = 0
  const documentService = createDocumentService({
    repositories: memory.repositories,
    atomic: memory.atomicOperations,
    sessionLibrary,
    now: () => 5000,
    generateId: () => `generated-${++generated}`
  })
  const workspaceService = createWorkspaceService({
    repositories: memory.repositories,
    atomic: memory.atomicOperations,
    durableBackend: mode === 'local-library'
  })
  const relint = vi.fn()
  const toast = vi.fn()
  const cancelPendingDocumentPersistence = vi.fn()
  const controller = createDocumentController({
    getDocumentService: async () => documentService,
    getWorkspaceService: async () => workspaceService,
    relint,
    toast,
    cancelPendingDocumentPersistence,
    now: () => 5000
  })
  return {
    appState,
    controller,
    memory,
    state,
    sessionLibrary,
    documentService,
    workspaceService,
    relint,
    toast,
    cancelPendingDocumentPersistence
  }
}

async function seedLocalDocuments(
  memory: ReturnType<typeof createMemoryStorageContext>,
  workspace: Workspace
): Promise<void> {
  await memory.repositories.documents.save({
    id: 'doc-a',
    workspaceId: workspace.id,
    name: 'a.md',
    content: 'A body',
    docType: 'markdown',
    sourceKind: 'local',
    createdAt: 100,
    updatedAt: 100
  })
  await memory.repositories.documents.save({
    id: 'doc-b',
    workspaceId: workspace.id,
    name: 'b.md',
    content: 'B body',
    docType: 'markdown',
    sourceKind: 'local',
    createdAt: 200,
    updatedAt: 200
  })
  await memory.repositories.documentSelection.setActiveDocumentId(workspace.id, 'doc-a')
}

describe('DocumentController bootstrap', () => {
  it('applies the explicit active document, summaries, readiness, diagnostics reset, and relint', async () => {
    const { appState, controller, memory, state, relint } = await harness('local-library')
    await seedLocalDocuments(memory, state.workspace)
    appState.setSelectedDiagnosticId('stale')
    appState.applyWorkerResult('fast', {
      revision: appState.revision(),
      diagnostics: [],
      ruleErrors: [],
      durationMs: 1
    })

    await controller.bootstrapForWorkspace(state.workspace)

    expect(appState.documentLibraryReady()).toBe(true)
    expect(appState.activeDocumentId()).toBe('doc-a')
    expect(appState.documentName()).toBe('a.md')
    expect(appState.documentText()).toBe('A body')
    expect(appState.documentSummaries()).toEqual([
      expect.objectContaining({ id: 'doc-a', active: true }),
      expect.objectContaining({ id: 'doc-b', active: false })
    ])
    expect(appState.selectedDiagnosticId()).toBeNull()
    expect(appState.tierResults.fast).toBeUndefined()
    expect(relint).toHaveBeenCalledTimes(1)
  })

  it('creates a Private Session welcome document without durable document or selection writes', async () => {
    const { appState, controller, memory, state, sessionLibrary } = await harness('private-session')

    await controller.bootstrapForWorkspace(state.workspace)

    expect(appState.activeDocumentId()).toBeDefined()
    expect(appState.documentName()).toBe('welcome.md')
    expect(sessionLibrary.list(state.workspace.id)).toHaveLength(1)
    await expect(memory.repositories.documents.listByWorkspace(state.workspace.id)).resolves.toEqual([])
    await expect(memory.repositories.documentSelection.getActiveDocumentId(state.workspace.id)).resolves.toBeUndefined()
  })

  it('opens an ephemeral recovery document when Local document listing fails', async () => {
    vi.resetModules()
    const [{ appState }, { createDocumentController }] = await Promise.all([
      import('../../src/state/app-state'),
      import('../../src/state/document-controller')
    ])
    const memory = createMemoryStorageContext(() => 5000)
    const state = createDefaultWorkspaceState(1000)
    state.workspace.id = 'workspace-a'
    state.workspace.activeRuleProfileId = 'profile-a'
    state.workspace.storageMode = 'local-library'
    state.profile.id = 'profile-a'
    await memory.repositories.preferences.save(state.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)
    const repositories = {
      ...memory.repositories,
      documents: {
        ...memory.repositories.documents,
        async listByWorkspace(): Promise<never> {
          throw new Error('forced list failure')
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
    const workspaceService = createWorkspaceService({
      repositories,
      atomic: memory.atomicOperations,
      durableBackend: true
    })
    const toast = vi.fn()
    const controller = createDocumentController({
      getDocumentService: async () => service,
      getWorkspaceService: async () => workspaceService,
      relint: vi.fn(),
      toast,
      cancelPendingDocumentPersistence: vi.fn(),
      now: () => 5000
    })

    await expect(controller.bootstrapForWorkspace(state.workspace)).resolves.toBeUndefined()

    expect(appState.documentLibraryReady()).toBe(true)
    expect(appState.activeDocumentId()).toBeUndefined()
    expect(appState.documentName()).toBe('recovery.md')
    expect(appState.documentText()).toBe('')
    expect(appState.documentSummaries()).toEqual([])
    expect(toast).toHaveBeenCalledWith('warning', expect.stringContaining('forced list failure'))
    expect(() => controller.currentEditableDocument()).toThrow('active document')
  })
})

describe('DocumentController mutations', () => {
  it('creates a new document after flushing the current body and applies it as active', async () => {
    const { appState, controller, state, cancelPendingDocumentPersistence } = await harness('private-session')
    await controller.bootstrapForWorkspace(state.workspace)
    appState.setDocument('edited welcome', 'welcome.md', 'markdown')

    await controller.createDocument()

    expect(cancelPendingDocumentPersistence).toHaveBeenCalled()
    expect(appState.documentMutationPending()).toBe(false)
    expect(appState.documentName()).toBe('untitled.md')
    expect(appState.documentSummaries()).toHaveLength(2)
    expect(appState.documentSummaries().filter((value) => value.active)).toHaveLength(1)
  })

  it('does not optimistically change editor state when rename validation fails', async () => {
    const { appState, controller, state } = await harness('private-session')
    await controller.bootstrapForWorkspace(state.workspace)
    const beforeId = appState.activeDocumentId()
    const beforeName = appState.documentName()

    await expect(controller.renameActiveDocument('   ')).rejects.toThrow()

    expect(appState.activeDocumentId()).toBe(beforeId)
    expect(appState.documentName()).toBe(beforeName)
    expect(appState.documentMutationPending()).toBe(false)
  })

  it('switches documents only after flushing the current editor and resets diagnostics before relint', async () => {
    const { appState, controller, state, relint } = await harness('private-session')
    await controller.bootstrapForWorkspace(state.workspace)
    const firstId = appState.activeDocumentId()!
    await controller.createDocument()
    const secondId = appState.activeDocumentId()!
    appState.setDocument('second edited', 'untitled.md', 'markdown')
    appState.setSelectedDiagnosticId('stale')
    relint.mockClear()

    await controller.switchDocument(firstId)

    expect(appState.activeDocumentId()).toBe(firstId)
    expect(appState.selectedDiagnosticId()).toBeNull()
    expect(relint).toHaveBeenCalledTimes(1)

    await controller.switchDocument(secondId)
    expect(appState.documentText()).toBe('second edited')
  })

  it('keeps session ignores through document switching and clears them on deletion', async () => {
    const { appState, controller, state } = await harness('private-session')
    await controller.bootstrapForWorkspace(state.workspace)
    appState.setActiveWorkspaceId(state.workspace.id)
    const original = appState.activeDocumentId()!
    const content = 'デバックを確認します。'
    appState.setDocument(content)
    const diagnostic = {
      id: 'wording/common-typo@0-4',
      ruleId: 'wording/common-typo',
      severity: 'warning' as const,
      message: '確認',
      start: 0,
      end: 4,
      line: 1,
      column: 1,
      fixKind: 'suggestion' as const,
      replacement: 'デバッグ',
      source: 'core' as const
    }
    appState.applyWorkerResult('fast', {
      revision: appState.revision(), diagnostics: [diagnostic], ruleErrors: [], durationMs: 1
    })
    expect(appState.ignoreDiagnosticForCurrentDocument(diagnostic)).toBe(true)

    await controller.createDocument()
    expect(appState.ignoredForActiveDocument()).toHaveLength(0)
    await controller.switchDocument(original)
    expect(appState.ignoredForActiveDocument()).toHaveLength(1)

    await controller.deleteActiveDocument()
    expect(appState.ignoredForActiveDocument()).toHaveLength(0)
    appState.setActiveDocumentId(original)
    expect(appState.ignoredForActiveDocument()).toHaveLength(0)
    appState.setActiveDocumentId(undefined)
  })

  it('deletes the active document and applies the successor', async () => {
    const { appState, controller, state } = await harness('private-session')
    await controller.bootstrapForWorkspace(state.workspace)
    const firstId = appState.activeDocumentId()!
    await controller.createDocument()
    const secondId = appState.activeDocumentId()!

    await controller.deleteActiveDocument()

    expect(appState.activeDocumentId()).toBe(firstId)
    expect(appState.activeDocumentId()).not.toBe(secondId)
    expect(appState.documentSummaries()).toHaveLength(1)
  })
})
