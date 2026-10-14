import { createStorageContext, type StorageContext } from './bootstrap'

let contextPromise: Promise<StorageContext> | null = null

/**
 * Return the single storage context used by the application runtime.
 *
 * This is especially important for the non-durable fallback: creating two memory
 * contexts would split workspace/config state inside one tab.
 */
export function getStorageContext(): Promise<StorageContext> {
  if (contextPromise === null) contextPromise = createStorageContext()
  return contextPromise
}

/** Test-only lifecycle hook. Production code should keep one context per page lifetime. */
export function resetStorageRuntimeForTests(): void {
  const previous = contextPromise
  contextPromise = null
  if (previous !== null) {
    void previous
      .then((context) => context.db?.close())
      .catch(() => undefined)
  }
}
