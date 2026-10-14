export interface StorageCapability {
  durableBackend: boolean
  storageManagerAvailable: boolean
  usage?: number
  quota?: number
  persisted?: boolean
  persistenceRequestSupported: boolean
  error?: string
}

export interface StorageManagerLike {
  estimate?: () => Promise<{ usage?: number; quota?: number }>
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
}

export interface StorageCapabilityService {
  inspect(): Promise<StorageCapability>
  requestPersistence(): Promise<StorageCapability>
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function withErrors(capability: StorageCapability, errors: string[]): StorageCapability {
  if (errors.length === 0) return capability
  return { ...capability, error: errors.join('; ') }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createStorageCapabilityService(
  storage: StorageManagerLike | undefined,
  durableBackend: boolean
): StorageCapabilityService {
  async function inspect(): Promise<StorageCapability> {
    const capability: StorageCapability = {
      durableBackend,
      storageManagerAvailable: storage !== undefined,
      persistenceRequestSupported: typeof storage?.persist === 'function'
    }
    if (storage === undefined) return capability

    const errors: string[] = []

    if (typeof storage.estimate === 'function') {
      try {
        const estimate = await storage.estimate()
        const usage = finiteNonNegative(estimate.usage)
        const quota = finiteNonNegative(estimate.quota)
        if (usage !== undefined) capability.usage = usage
        if (quota !== undefined) capability.quota = quota
      } catch (error) {
        errors.push(`estimate: ${errorMessage(error)}`)
      }
    }

    if (typeof storage.persisted === 'function') {
      try {
        capability.persisted = await storage.persisted()
      } catch (error) {
        errors.push(`persisted: ${errorMessage(error)}`)
      }
    }

    return withErrors(capability, errors)
  }

  return {
    inspect,

    async requestPersistence(): Promise<StorageCapability> {
      const capability = await inspect()
      if (typeof storage?.persist !== 'function') return capability

      try {
        const persisted = await storage.persist()
        return { ...capability, persisted }
      } catch (error) {
        const requestError = `persist: ${errorMessage(error)}`
        return {
          ...capability,
          error: capability.error === undefined ? requestError : `${capability.error}; ${requestError}`
        }
      }
    }
  }
}
