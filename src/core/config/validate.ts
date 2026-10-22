/**
 * Config Validation / Migration — 仕様書 §30 (Import前validation) / §32 (Config Versioning)
 *
 * - 不正configによってApp全体を起動不能にしてはならない
 * - 古いconfigはMigration Layerを通して読み込む
 * - 判定はホワイトリスト・型強制・クランプにより寛容に (未知のキーは無視)
 */

import type { RuleSetting, Severity } from '../types'
import {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CITATION,
  DEFAULT_EDITOR,
  DEFAULT_PRIVACY,
  DEFAULT_TERMINOLOGY,
  type AppConfig,
  type CitationScope,
  type NgWordEntry,
  type PresetId,
  type TermEntry,
  type ThemeMode
} from './schema'
import { getPreset } from './presets'
import { defaultProfileAnalysisSettings, validateProfileAnalysisSettings } from '../analysis/profile-settings'
import { buildRuleRegistry, TEXTLINT_RULE_META } from '../rules/registry'

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigValidationError'
  }
}

const SEVERITIES: ReadonlySet<string> = new Set(['info', 'warning', 'error'])
const PRESET_IDS: ReadonlySet<string> = new Set(['general', 'technical', 'strict', 'minimal', 'custom'])
const THEMES: ReadonlySet<string> = new Set(['light', 'dark', 'system'])
const SCOPES: ReadonlySet<string> = new Set(['sentence', 'paragraph', 'section'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asSeverity(value: unknown, fallback: Severity): Severity {
  return typeof value === 'string' && SEVERITIES.has(value) ? (value as Severity) : fallback
}

/** 全ルールIDの正規集合 (独自 + textlint) */
function allKnownRuleIds(config: AppConfig): string[] {
  return [...buildRuleRegistry(config).keys(), ...Object.keys(TEXTLINT_RULE_META)]
}

/** デフォルト設定 (General Japaneseベース) を構築 */
export function createDefaultConfig(): AppConfig {
  const base = getPreset('general')
  if (base === undefined) {
    throw new Error('General Japanese preset is missing')
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    analysis: defaultProfileAnalysisSettings(),
    preset: 'general',
    rules: structuredClone(base.rules),
    ngWords: [],
    terminology: structuredClone(DEFAULT_TERMINOLOGY),
    citation: { ...DEFAULT_CITATION },
    formatter: { enabled: true },
    editor: { ...DEFAULT_EDITOR },
    privacy: { ...DEFAULT_PRIVACY },
    theme: 'system'
  }
}

/**
 * 未知の入力を検証してAppConfigへ変換する。
 * 不正な場合はConfigValidationErrorを投げる (§30: Import前にvalidation)。
 * 欠損値はデフォルトで補完される (部分的なconfigも許可)。
 */
export function validateAppConfig(input: unknown): AppConfig {
  if (!isRecord(input)) {
    throw new ConfigValidationError('設定はJSONオブジェクトである必要があります。')
  }

  const config = createDefaultConfig()

  // --- schemaVersion ---
  if (input.schemaVersion !== undefined) {
    if (typeof input.schemaVersion !== 'number' || !Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
      throw new ConfigValidationError('schemaVersionは正の整数である必要があります。')
    }
    if (input.schemaVersion > CONFIG_SCHEMA_VERSION) {
      throw new ConfigValidationError(
        `この設定はschema v${input.schemaVersion}です。現在のアプリはv${CONFIG_SCHEMA_VERSION}まで対応しています。`
      )
    }
    // Accepted v1 imports are normalized to v2 below; never write a v1 config back.
  }

  // --- analysis settings (v2, optional on older imports) ---
  if (input.analysis !== undefined) {
    try {
      config.analysis = validateProfileAnalysisSettings(input.analysis)
    } catch (error) {
      throw new ConfigValidationError(`analysis設定が不正です: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // --- preset ---
  if (input.preset !== undefined) {
    if (typeof input.preset !== 'string' || !PRESET_IDS.has(input.preset)) {
      throw new ConfigValidationError(`presetは ${[...PRESET_IDS].join('/')} のいずれかである必要があります。`)
    }
    config.preset = input.preset as PresetId
  }

  // --- rules ---
  if (input.rules !== undefined) {
    if (!isRecord(input.rules)) {
      throw new ConfigValidationError('rulesはオブジェクトである必要があります。')
    }
    const known = new Set(allKnownRuleIds(config))
    for (const [ruleId, raw] of Object.entries(input.rules)) {
      if (!known.has(ruleId)) continue // 未知ルールは無視 (将来互換)
      if (typeof raw === 'boolean') {
        config.rules[ruleId] = { enabled: raw, severity: config.rules[ruleId]?.severity ?? 'warning' }
        continue
      }
      if (!isRecord(raw)) continue
      const enabled = raw.enabled === undefined ? true : Boolean(raw.enabled)
      const severity = asSeverity(raw.severity, config.rules[ruleId]?.severity ?? 'warning')
      let options: RuleSetting['options'] | undefined
      if (raw.options !== undefined && isRecord(raw.options)) {
        options = {}
        for (const [k, v] of Object.entries(raw.options)) {
          if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
            options[k] = v
          }
        }
      }
      config.rules[ruleId] = { enabled, severity, options }
    }
  }

  // --- ngWords ---
  if (input.ngWords !== undefined) {
    if (!Array.isArray(input.ngWords)) {
      throw new ConfigValidationError('ngWordsは配列である必要があります。')
    }
    config.ngWords = input.ngWords.slice(0, 500).map((raw, i): NgWordEntry => {
      if (!isRecord(raw) || typeof raw.word !== 'string' || raw.word.length === 0) {
        throw new ConfigValidationError(`ngWords[${i}]: word (空でない文字列) が必須です。`)
      }
      if (raw.word.length > 200) {
        throw new ConfigValidationError(`ngWords[${i}]: wordが長すぎます (200文字以内)。`)
      }
      if (raw.isRegex === true) {
        try {
          new RegExp(raw.word)
        } catch {
          throw new ConfigValidationError(`ngWords[${i}]: 不正な正規表現です: ${raw.word}`)
        }
      }
      return {
        id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `ngw-${i}`,
        word: raw.word,
        severity: asSeverity(raw.severity, 'error'),
        message: typeof raw.message === 'string' ? raw.message.slice(0, 300) : undefined,
        replacement: typeof raw.replacement === 'string' ? raw.replacement.slice(0, 200) : undefined,
        caseSensitive: raw.caseSensitive === undefined ? undefined : Boolean(raw.caseSensitive),
        wholeWord: raw.wholeWord === undefined ? undefined : Boolean(raw.wholeWord),
        isRegex: raw.isRegex === undefined ? undefined : Boolean(raw.isRegex)
      }
    })
  }

  // --- terminology ---
  if (input.terminology !== undefined) {
    if (!Array.isArray(input.terminology)) {
      throw new ConfigValidationError('terminologyは配列である必要があります。')
    }
    config.terminology = input.terminology.slice(0, 500).map((raw, i): TermEntry => {
      if (!isRecord(raw) || typeof raw.preferred !== 'string' || raw.preferred.length === 0) {
        throw new ConfigValidationError(`terminology[${i}]: preferred (空でない文字列) が必須です。`)
      }
      const rejected = Array.isArray(raw.rejected)
        ? raw.rejected.filter((r): r is string => typeof r === 'string' && r.length > 0)
        : []
      return {
        id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `term-${i}`,
        preferred: raw.preferred.slice(0, 100),
        rejected,
        caseSensitive: raw.caseSensitive === undefined ? undefined : Boolean(raw.caseSensitive)
      }
    })
  }

  // --- citation ---
  if (input.citation !== undefined) {
    if (!isRecord(input.citation)) {
      throw new ConfigValidationError('citationはオブジェクトである必要があります。')
    }
    const c = input.citation
    if (c.scope !== undefined) {
      if (typeof c.scope !== 'string' || !SCOPES.has(c.scope)) {
        throw new ConfigValidationError('citation.scopeは sentence/paragraph/section のいずれかです。')
      }
      config.citation.scope = c.scope as CitationScope
    }
    if (c.detectNumbers !== undefined) config.citation.detectNumbers = Boolean(c.detectNumbers)
    if (c.detectComparison !== undefined) config.citation.detectComparison = Boolean(c.detectComparison)
    if (c.detectExternalFact !== undefined) config.citation.detectExternalFact = Boolean(c.detectExternalFact)
  }

  // --- formatter ---
  if (input.formatter !== undefined) {
    if (!isRecord(input.formatter)) throw new ConfigValidationError('formatterはオブジェクトである必要があります。')
    if (input.formatter.enabled !== undefined) {
      config.formatter.enabled = Boolean(input.formatter.enabled)
    }
  }

  // --- editor ---
  if (input.editor !== undefined) {
    if (!isRecord(input.editor)) throw new ConfigValidationError('editorはオブジェクトである必要があります。')
    if (input.editor.fontSize !== undefined) {
      const fs = Number(input.editor.fontSize)
      if (!Number.isFinite(fs)) throw new ConfigValidationError('editor.fontSizeは数値である必要があります。')
      config.editor.fontSize = Math.min(32, Math.max(10, Math.round(fs)))
    }
    if (input.editor.showLineNumbers !== undefined) {
      config.editor.showLineNumbers = Boolean(input.editor.showLineNumbers)
    }
  }

  // --- privacy ---
  if (input.privacy !== undefined) {
    if (!isRecord(input.privacy)) throw new ConfigValidationError('privacyはオブジェクトである必要があります。')
    if (input.privacy.autoSave !== undefined) config.privacy.autoSave = Boolean(input.privacy.autoSave)
    if (input.privacy.privacyMode !== undefined) config.privacy.privacyMode = Boolean(input.privacy.privacyMode)
  }

  // --- theme ---
  if (input.theme !== undefined) {
    if (typeof input.theme !== 'string' || !THEMES.has(input.theme)) {
      throw new ConfigValidationError('themeは light/dark/system のいずれかです。')
    }
    config.theme = input.theme as ThemeMode
  }

  return config
}

/**
 * Migration — 仕様書 §32
 * 古いconfigはMigration Layerを通して読み込む。
 * v1以降のスキーマ変更が発生した場合、ここに v1→v2 等の変換を追加する。
 */
export function migrateConfig(raw: unknown): unknown {
  if (isRecord(raw) && raw.schemaVersion === 1) {
    // Legacy AppConfig never had the Profile-local analysis subtree. An explicit
    // v2 copy prevents an imported v1 JSON from being re-exported as v1.
    return { ...raw, schemaVersion: 2, analysis: defaultProfileAnalysisSettings() }
  }
  return raw
}
