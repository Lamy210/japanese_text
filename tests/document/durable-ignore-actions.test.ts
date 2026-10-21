import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Diagnostic } from '../../src/core/types'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { readDocumentIgnores } from '../../src/storage/document-ignore-store'

const runtime = vi.hoisted(() => ({
  workspaceId: 'workspace-a',
  storageMode: 'local-library' as 'local-library' | 'private-session',
  db: null as IDBDatabase | null
}))

vi.mock('../../src/state/application-runtime', () => ({
  applicationRuntime: {
    getWorkspaceService: async () => ({
      getActive: async () => ({ workspace: { id: runtime.workspaceId, storageMode: runtime.storageMode } })
    }),
    getStorageContext: async () => ({ durable: runtime.db !== null, db: runtime.db })
  }
}))

import { appState } from '../../src/state/app-state'
import {
  ignoreDiagnosticForDocument,
  restoreDocumentDiagnostic
} from '../../src/state/actions'

const source = 'デバックを確認します。'
const diagnostic: Diagnostic = {
  id: 'wording/common-typo:0-4', ruleId: 'wording/common-typo',
  source: 'core', start: 0, end: 4, line: 1, column: 1,
  severity: 'warning', message: '誤表記候補',
  fixKind: 'suggestion', replacement: 'デバッグ'
}

async function setup(mode: 'local-library' | 'private-session' = 'local-library') {
  const db = await openDatabase(new IDBFactory())
  const repo = createIndexedDbRepositories(db)
  const state = createDefaultWorkspaceState(1000)
  await repo.workspaces.save({
    ...state.workspace, id: 'workspace-a', storageMode: mode
  })
  await repo.documents.save({
    id: 'doc-a', workspaceId: 'workspace-a', name: 'a.md',
    docType: 'markdown', sourceKind: 'local', content: source,
    createdAt: 1000, updatedAt: 1000
  })
  runtime.workspaceId = 'workspace-a'
  runtime.storageMode = mode
  runtime.db = db
  appState.clearIgnoredWorkspace('workspace-a')
  appState.setActiveWorkspaceId('workspace-a')
  appState.setActiveDocumentId('doc-a')
  appState.setDocument(source)
  appState.applyWorkerResult('fast', {
    revision: appState.revision(), diagnostics: [diagnostic], ruleErrors: [], durationMs: 1
  })
  return db
}

afterEach(() => {
  runtime.db?.close()
  runtime.db = null
  appState.clearIgnoredWorkspace('workspace-a')
  appState.setActiveWorkspaceId(undefined)
  appState.setActiveDocumentId(undefined)
  appState.resetDiagnosticsForDocumentContext()
})

describe('diagnostic action: durable Local Library vs Private Session', () => {
  test('commits Local Library ignores and restores to the existing v2 IndexedDB store', async () => {
    const db = await setup()
    expect(await ignoreDiagnosticForDocument(diagnostic)).toBe(true)
    expect(appState.diagnostics()).toEqual([])
    expect(await readDocumentIgnores(db, 'workspace-a', 'doc-a')).toEqual([
      expect.objectContaining({ ruleId: 'wording/common-typo', excerpt: 'デバック' })
    ])
    const stored = (await readDocumentIgnores(db, 'workspace-a', 'doc-a'))[0]!
    expect(await restoreDocumentDiagnostic(stored.key)).toBe(true)
    expect(appState.diagnostics()).toEqual([diagnostic])
    expect(await readDocumentIgnores(db, 'workspace-a', 'doc-a')).toEqual([])
  })

  test('Private Session only changes in-memory ignores and does not persist them', async () => {
    const db = await setup('private-session')
    expect(await ignoreDiagnosticForDocument(diagnostic)).toBe(true)
    expect(appState.diagnostics()).toEqual([])
    expect(await readDocumentIgnores(db, 'workspace-a', 'doc-a')).toEqual([])
  })

  test('failed Local Library storage leaves the warning visible and does not pretend success', async () => {
    await setup()
    runtime.db = null
    expect(await ignoreDiagnosticForDocument(diagnostic)).toBe(false)
    expect(appState.diagnostics()).toEqual([diagnostic])
    expect(appState.ignoredForActiveDocument()).toEqual([])
  })

  test('rejects a stale diagnostic without attempting a durable write', async () => {
    const db = await setup()
    const previous = diagnostic
    appState.setDocument('デバッグに変更しました。')
    expect(await ignoreDiagnosticForDocument(previous)).toBe(false)
    expect(await readDocumentIgnores(db, 'workspace-a', 'doc-a')).toEqual([])
  })
})
