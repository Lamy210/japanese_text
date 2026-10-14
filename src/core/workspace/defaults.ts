import { createDefaultConfig } from '../config/validate'
import type { GlobalPreferences, RuleProfile, Workspace } from './types'

export const WORKSPACE_MODEL_SCHEMA_VERSION = 1
export const DEFAULT_WORKSPACE_ID = 'local-default-workspace'
export const DEFAULT_PROFILE_ID = 'local-default-profile'

export function createDefaultWorkspaceState(now: number): {
  workspace: Workspace
  preferences: GlobalPreferences
  profile: RuleProfile
} {
  const config = createDefaultConfig()
  const profile: RuleProfile = {
    id: DEFAULT_PROFILE_ID,
    name: 'General Japanese',
    sourcePresetId: 'general',
    rules: structuredClone(config.rules),
    ngWords: structuredClone(config.ngWords),
    terminology: structuredClone(config.terminology),
    citation: structuredClone(config.citation),
    formatter: structuredClone(config.formatter),
    customRules: [],
    createdAt: now,
    updatedAt: now
  }

  return {
    workspace: {
      id: DEFAULT_WORKSPACE_ID,
      name: 'Default Workspace',
      activeRuleProfileId: profile.id,
      storageMode: 'private-session',
      snapshotPolicy: { enabled: false, maxSnapshots: 20 },
      createdAt: now,
      updatedAt: now
    },
    preferences: {
      schemaVersion: WORKSPACE_MODEL_SCHEMA_VERSION,
      theme: config.theme,
      editor: structuredClone(config.editor),
      defaultStorageMode: 'private-session'
    },
    profile
  }
}
