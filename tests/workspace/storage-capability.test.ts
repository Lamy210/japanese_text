import { describe, expect, it, vi } from 'vitest'

interface StorageCapability {
  durableBackend: boolean
  storageManagerAvailable: boolean
  usage?: number
  quota?: number
  persisted?: boolean
  persistenceRequestSupported: boolean
  error?: string
}

interface StorageManagerLike {
  estimate?: () => Promise<{ usage?: number; quota?: number }>
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
}

interface StorageCapabilityService {
  inspect(): Promise<StorageCapability>
  requestPersistence(): Promise<StorageCapability>
}

interface StorageCapabilityModule {
  createStorageCapabilityService(
    storage: StorageManagerLike | undefined,
    durableBackend: boolean
  ): StorageCapabilityService
}

async function loadModule(): Promise<StorageCapabilityModule | undefined> {
  return vi.importActual<StorageCapabilityModule>('../../src/workspace/storage-capability').catch(() => undefined)
}

describe('StorageCapabilityService', () => {
  it('reports origin-level estimate and persistence status without requesting persistence during inspect', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const persist = vi.fn(async () => true)
    const service = module.createStorageCapabilityService({
      estimate: async () => ({ usage: 1200, quota: 6400 }),
      persisted: async () => true,
      persist
    }, true)

    await expect(service.inspect()).resolves.toEqual({
      durableBackend: true,
      storageManagerAvailable: true,
      usage: 1200,
      quota: 6400,
      persisted: true,
      persistenceRequestSupported: true
    })
    expect(persist).not.toHaveBeenCalled()
  })

  it('supports estimate-only browsers and missing StorageManager methods', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const service = module.createStorageCapabilityService({
      estimate: async () => ({ usage: 0 })
    }, true)

    await expect(service.inspect()).resolves.toEqual({
      durableBackend: true,
      storageManagerAvailable: true,
      usage: 0,
      persistenceRequestSupported: false
    })
  })

  it('reports an unavailable StorageManager without throwing', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    await expect(module.createStorageCapabilityService(undefined, false).inspect()).resolves.toEqual({
      durableBackend: false,
      storageManagerAvailable: false,
      persistenceRequestSupported: false
    })
  })

  it('converts estimate and persisted failures into a non-fatal capability error', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const service = module.createStorageCapabilityService({
      estimate: async () => { throw new Error('estimate failed') },
      persisted: async () => { throw new Error('persisted failed') },
      persist: async () => true
    }, true)
    const capability = await service.inspect()

    expect(capability.durableBackend).toBe(true)
    expect(capability.storageManagerAvailable).toBe(true)
    expect(capability.persistenceRequestSupported).toBe(true)
    expect(capability.usage).toBeUndefined()
    expect(capability.quota).toBeUndefined()
    expect(capability.persisted).toBeUndefined()
    expect(capability.error).toContain('estimate failed')
    expect(capability.error).toContain('persisted failed')
  })

  it('returns the denied persistence result without treating denial as an exception', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const service = module.createStorageCapabilityService({
      estimate: async () => ({ quota: 1000 }),
      persisted: async () => false,
      persist: async () => false
    }, true)

    await expect(service.requestPersistence()).resolves.toMatchObject({
      durableBackend: true,
      storageManagerAvailable: true,
      quota: 1000,
      persisted: false,
      persistenceRequestSupported: true
    })
  })

  it('converts persistence request rejection into a non-fatal capability error', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const service = module.createStorageCapabilityService({
      persist: async () => { throw new Error('request rejected') }
    }, true)
    const capability = await service.requestPersistence()

    expect(capability.persisted).toBeUndefined()
    expect(capability.error).toContain('request rejected')
  })
})
