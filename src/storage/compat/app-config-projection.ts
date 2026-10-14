import { CONFIG_SCHEMA_VERSION, type AppConfig } from '../../core/config/schema'
import type { GlobalPreferences, RuleProfile, Workspace } from '../../core/workspace/types'

export interface ProjectedStorageState {
  preferences: GlobalPreferences
  workspace: Workspace
  profile: RuleProfile
}

function compatibilityPrivacy(workspace: Workspace): AppConfig['privacy'] {
  if (workspace.storageMode === 'local-library') {
    return { autoSave: true, privacyMode: false }
  }
  return { autoSave: false, privacyMode: true }
}

function storageModeFromConfig(config: AppConfig): 'private-session' | 'local-library' {
  if (config.privacy.privacyMode || !config.privacy.autoSave) return 'private-session'
  return 'local-library'
}

export function composeAppConfig(state: ProjectedStorageState): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    preset: state.profile.sourcePresetId ?? 'custom',
    rules: structuredClone(state.profile.rules),
    ngWords: structuredClone(state.profile.ngWords),
    terminology: structuredClone(state.profile.terminology),
    citation: structuredClone(state.profile.citation),
    formatter: structuredClone(state.profile.formatter),
    editor: structuredClone(state.preferences.editor),
    privacy: compatibilityPrivacy(state.workspace),
    theme: state.preferences.theme
  }
}

export function splitAppConfig(
  config: AppConfig,
  current: ProjectedStorageState,
  now: number
): ProjectedStorageState {
  const storageMode = storageModeFromConfig(config)

  return {
    preferences: {
      schemaVersion: current.preferences.schemaVersion,
      theme: config.theme,
      editor: structuredClone(config.editor),
      defaultStorageMode: storageMode
    },
    workspace: {
      ...structuredClone(current.workspace),
      storageMode,
      updatedAt: now
    },
    profile: {
      id: current.profile.id,
      name: current.profile.name,
      sourcePresetId: config.preset,
      rules: structuredClone(config.rules),
      ngWords: structuredClone(config.ngWords),
      terminology: structuredClone(config.terminology),
      citation: structuredClone(config.citation),
      formatter: structuredClone(config.formatter),
      customRules: structuredClone(current.profile.customRules),
      createdAt: current.profile.createdAt,
      updatedAt: now
    }
  }
}
