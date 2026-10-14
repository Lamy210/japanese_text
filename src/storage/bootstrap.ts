import { createDefaultWorkspaceState } from '../core/workspace/defaults'
import { createIndexedDbAtomicOperations } from './db/indexeddb-atomic-operations'
import { openDatabase } from './db/open-database'
import { createIndexedDbRepositories } from './repositories/indexeddb'
import { createMemoryStorageContext } from './repositories/memory'
import type { AtomicOperationsPort, MigrationResult, StorageRepositories } from './repositories/ports'

export interface StorageContext {
  durable: boolean
  repositories: StorageRepositories
  atomic: AtomicOperationsPort
  migration: MigrationResult
  db?: IDBDatabase
}

export interface CreateStorageContextOptions {
  factory?: IDBFactory
  now?: () => number
}

function resolveFactory(explicit?: IDBFactory): IDBFactory | undefined {
  if (explicit !== undefined) return explicit
  try {
    return typeof indexedDB === 'undefined' ? undefined : indexedDB
  } catch {
    return undefined
  }
}

async function createSeededMemoryContext(
  now: () => number,
  warning: string
): Promise<StorageContext> {
  const memory = createMemoryStorageContext()
  const state = createDefaultWorkspaceState(now())

  await memory.repositories.preferences.save(state.preferences)
  await memory.repositories.profiles.save(state.profile)
  await memory.repositories.workspaces.save(state.workspace)

  return {
    durable: false,
    repositories: memory.repositories,
    atomic: memory.atomicOperations,
    migration: { state: 'failed', warning }
  }
}

export async function createStorageContext(options: CreateStorageContextOptions = {}): Promise<StorageContext> {
  const now = options.now ?? Date.now
  const factory = resolveFactory(options.factory)
  if (factory === undefined) {
    return createSeededMemoryContext(now, 'IndexedDB is unavailable; using private in-memory storage.')
  }

  let db: IDBDatabase | undefined
  try {
    db = await openDatabase(factory)
    const repositories = createIndexedDbRepositories(db)
    const atomic = createIndexedDbAtomicOperations(db, now)
    const migration = await atomic.migrateV1ToV2()

    if (migration.state === 'failed') {
      db.close()
      return createSeededMemoryContext(
        now,
        migration.warning ?? 'IndexedDB migration failed; using private in-memory storage.'
      )
    }

    return {
      durable: true,
      repositories,
      atomic,
      migration,
      db
    }
  } catch (error) {
    db?.close()
    const message = error instanceof Error ? error.message : String(error)
    return createSeededMemoryContext(now, `IndexedDB initialization failed: ${message}`)
  }
}
