/**
 * Import-only boundary. An old AppConfig v1 export did not contain Pack flags,
 * so importing it must not overwrite a Profile's current v2 selections.
 * Canonical Workspace storage mode remains authoritative over privacy flags.
 */
import type { AppConfig } from './schema'
import { migrateConfig, validateAppConfig } from './validate'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function prepareConfigImport(raw: unknown, current: AppConfig): AppConfig {
  const fromV1 = isObject(raw) && (raw.schemaVersion === 1 || raw.schemaVersion === undefined)
  const migrated = migrateConfig(raw)
  if (!isObject(migrated)) return validateAppConfig(migrated)

  return validateAppConfig({
    ...migrated,
    // Legacy JSON had no Analysis settings. Keep the active Profile's current
    // selection instead of replacing it with migration defaults.
    ...(fromV1 ? { analysis: current.analysis } : {}),
    // Never allow JSON import to change the Workspace's storage policy.
    privacy: current.privacy
  })
}
