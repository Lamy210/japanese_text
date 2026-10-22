/**
 * AP-03a: strictly validated, opt-in Profile analysis settings.
 *
 * This is a Profile-local metadata contract only. AppConfig remains v1 and
 * the existing engine does NOT gate diagnostics using these flags yet.
 * Historical RuleProfiles without "analysis" remain readable unchanged.
 */
import { ANALYSIS_PACK_IDS, type AnalysisPackId } from './contracts'
import { defaultAnalysisPackSelection } from './packs'

export interface ProfileAnalysisSettingsV2 {
  readonly packs: Readonly<Record<AnalysisPackId, boolean>>
  readonly morphology: {
    readonly enabled: boolean
    readonly providerId: 'lindera-ipadic' | 'kuromojin-ipadic'
    readonly dictionaryAssetId: string | null
    readonly automaticMaxUtf16: number
    readonly manualMaxUtf16: number
    readonly analyzeQuotedBlocks: false
    readonly showEvidence: boolean
  }
  readonly dictionaries: {
    readonly enabledBuiltInIds: readonly string[]
    readonly enabledSharedAssetIds: readonly string[]
    /** Non-sensitive identifiers only: never serialize private dictionary data. */
    readonly localUserDictionaryRefs: readonly string[]
  }
}

const ID = /^[a-z0-9][a-z0-9._-]*$/u
const MAX_IDS = 64
const MAX_ID_LENGTH = 128

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error(`${label} contains unsupported fields`)
  }
}

function ids(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_IDS ||
    value.some(item => typeof item !== 'string' || !item.length || item.length > MAX_ID_LENGTH || !ID.test(item)) ||
    new Set(value).size !== value.length) {
    throw new Error(`${label} must contain unique, valid dictionary identifiers`)
  }
  return [...value] as string[]
}

export function defaultProfileAnalysisSettings(): ProfileAnalysisSettingsV2 {
  return {
    packs: { ...defaultAnalysisPackSelection() },
    morphology: {
      enabled: false,
      providerId: 'lindera-ipadic',
      dictionaryAssetId: null,
      automaticMaxUtf16: 10_000,
      manualMaxUtf16: 50_000,
      analyzeQuotedBlocks: false,
      showEvidence: false
    },
    dictionaries: {
      enabledBuiltInIds: ['curated-common-typo-ja'],
      enabledSharedAssetIds: [],
      localUserDictionaryRefs: []
    }
  }
}

/**
 * Normalize without mutating the caller. No file paths, URLs, corpus contents,
 * executable expressions or unknown fields may enter a persisted Profile.
 */
export function validateProfileAnalysisSettings(input: unknown): ProfileAnalysisSettingsV2 {
  const root = record(input, 'analysis')
  exactKeys(root, ['packs', 'morphology', 'dictionaries'], 'analysis')

  const packValues = record(root.packs, 'analysis.packs')
  exactKeys(packValues, ANALYSIS_PACK_IDS, 'analysis.packs')
  const packs = {} as Record<AnalysisPackId, boolean>
  for (const id of ANALYSIS_PACK_IDS) {
    if (typeof packValues[id] !== 'boolean') throw new Error(`analysis.packs.${id} must be boolean`)
    packs[id] = packValues[id] as boolean
  }
  // Required core can never be disabled, regardless of imported settings.
  packs.core = true

  const morph = record(root.morphology, 'analysis.morphology')
  exactKeys(morph, [
    'enabled', 'providerId', 'dictionaryAssetId', 'automaticMaxUtf16',
    'manualMaxUtf16', 'analyzeQuotedBlocks', 'showEvidence'
  ], 'analysis.morphology')
  const provider = morph.providerId
  if (typeof morph.enabled !== 'boolean' ||
    (provider !== 'lindera-ipadic' && provider !== 'kuromojin-ipadic') ||
    (morph.dictionaryAssetId !== null &&
      (typeof morph.dictionaryAssetId !== 'string' ||
       morph.dictionaryAssetId.length > MAX_ID_LENGTH || !ID.test(morph.dictionaryAssetId))) ||
    !Number.isSafeInteger(morph.automaticMaxUtf16) ||
    (morph.automaticMaxUtf16 as number) < 100 || (morph.automaticMaxUtf16 as number) > 100_000 ||
    !Number.isSafeInteger(morph.manualMaxUtf16) ||
    (morph.manualMaxUtf16 as number) < (morph.automaticMaxUtf16 as number) ||
    (morph.manualMaxUtf16 as number) > 200_000 ||
    morph.analyzeQuotedBlocks !== false ||
    typeof morph.showEvidence !== 'boolean') {
    throw new Error('Invalid analysis.morphology options')
  }

  const dict = record(root.dictionaries, 'analysis.dictionaries')
  exactKeys(dict, ['enabledBuiltInIds', 'enabledSharedAssetIds', 'localUserDictionaryRefs'], 'analysis.dictionaries')
  return {
    packs,
    morphology: {
      enabled: morph.enabled,
      providerId: provider,
      dictionaryAssetId: morph.dictionaryAssetId as string | null,
      automaticMaxUtf16: morph.automaticMaxUtf16 as number,
      manualMaxUtf16: morph.manualMaxUtf16 as number,
      analyzeQuotedBlocks: false,
      showEvidence: morph.showEvidence
    },
    dictionaries: {
      enabledBuiltInIds: ids(dict.enabledBuiltInIds, 'analysis.dictionaries.enabledBuiltInIds'),
      enabledSharedAssetIds: ids(dict.enabledSharedAssetIds, 'analysis.dictionaries.enabledSharedAssetIds'),
      localUserDictionaryRefs: ids(dict.localUserDictionaryRefs, 'analysis.dictionaries.localUserDictionaryRefs')
    }
  }
}

/** Legacy records do not need an eager write/migration to read effective defaults. */
export function resolveProfileAnalysisSettings(
  value: ProfileAnalysisSettingsV2 | undefined
): ProfileAnalysisSettingsV2 {
  return value === undefined ? defaultProfileAnalysisSettings() : validateProfileAnalysisSettings(value)
}
