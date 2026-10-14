/**
 * textlint Adapter (Deep Engine) — 仕様書 §23 Deep Engine / §33 (lazy load)
 *
 * @textlint/kernel をWeb Worker上で実行し、結果を本アプリのDiagnostic形式へ正規化する (§61 PoC-3/4)。
 * severityは当アプリの設定 (info/warning/error) をkernelのoptions.severityへ渡す。
 * textlintのfixは Suggestion としてのみ扱う (§17: 自動整形は独自Safe Formatterのみ)。
 *
 * このモジュールは dynamic import 専用 (初期bundleに含めない — §33)。
 */

import { TextlintKernel, type TextlintKernelRule, type TextlintRuleModule } from '@textlint/kernel'
import type { Diagnostic, DocumentType, Severity } from '../types'
import type { AppConfig } from '../config/schema'
import { TEXTLINT_RULE_META } from '../rules/registry'
import { sortDiagnostics } from './engine'
import { LineIndex } from '../text/positions'

/** kernel severity (数値) → 当アプリseverity */
function mapSeverity(level: number): Severity {
  // TextlintRuleSeverityLevelKeys: none=0, warning=1, error=2, info=3
  if (level === 2) return 'error'
  if (level === 1) return 'warning'
  return 'info'
}

/**
 * CJS相互運用の解決: textlintルールは module.exports = { default: reporter } 形式。
 * Vite/esbuildのinteropでは import().default が { default: fn } になる場合と
 * 直接 fn になる場合があるため、両方に対応する (§61 PoC-3)。
 */
function resolveRuleModule(mod: unknown): TextlintRuleModule | null {
  const asObj = mod as { default?: unknown } | null
  const d0 = asObj?.default
  if (typeof d0 === 'function') return d0 as TextlintRuleModule
  if (typeof mod === 'function') return mod as TextlintRuleModule
  if (d0 !== null && typeof d0 === 'object') {
    const d1 = (d0 as { default?: unknown }).default
    if (typeof d1 === 'function') return d1 as TextlintRuleModule
    if (d1 !== null && typeof d1 === 'object' && typeof (d1 as { linter?: unknown }).linter === 'function') {
      return d1 as TextlintRuleModule
    }
  }
  if (mod !== null && typeof mod === 'object' && typeof (mod as { linter?: unknown }).linter === 'function') {
    return mod as TextlintRuleModule
  }
  return null
}

/** プラグインも同様にネストされたdefaultを解決する */
function resolvePluginModule(mod: unknown): unknown {
  const asObj = mod as { default?: unknown } | null
  const d0 = asObj?.default
  if (typeof d0 === 'function') return d0
  if (d0 !== null && typeof d0 === 'object' && 'default' in (d0 as object)) {
    const d1 = (d0 as { default?: unknown }).default
    if (d1 !== undefined) return d1
  }
  return d0 ?? mod
}

const RULE_LOADERS: Record<string, () => Promise<unknown>> = {
  'style/sentence-length': () => import('textlint-rule-sentence-length'),
  'typography/nfd': () => import('textlint-rule-no-nfd'),
  'typography/hankaku-kana': () => import('textlint-rule-no-hankaku-kana')
}

const PLUGIN_LOADERS: Record<'markdown' | 'text', () => Promise<unknown>> = {
  markdown: () => import('@textlint/textlint-plugin-markdown'),
  text: () => import('@textlint/textlint-plugin-text')
}

export interface TextlintRunResult {
  diagnostics: Diagnostic[]
  ruleErrors: Array<{ ruleId: string; message: string }>
  durationMs: number
}

export async function runTextlint(
  text: string,
  config: AppConfig,
  docType: DocumentType
): Promise<TextlintRunResult> {
  const started = performance.now()
  const diagnostics: Diagnostic[] = []
  const ruleErrors: Array<{ ruleId: string; message: string }> = []

  // 有効なtextlintルールを収集
  const enabledRules: string[] = []
  for (const ruleId of Object.keys(RULE_LOADERS)) {
    const setting = config.rules[ruleId]
    if (setting !== undefined && setting.enabled) {
      enabledRules.push(ruleId)
    }
  }
  if (enabledRules.length === 0) {
    return { diagnostics: [], ruleErrors: [], durationMs: performance.now() - started }
  }

  // ルールのロード (個別にtry/catch — §41)
  const kernelRules: TextlintKernelRule[] = []
  for (const ruleId of enabledRules) {
    try {
      const mod = await RULE_LOADERS[ruleId]()
      const rule = resolveRuleModule(mod)
      if (rule === null) {
        ruleErrors.push({ ruleId, message: 'ルールモジュールの形式が不正です (linter関数が見つかりません)。' })
        continue
      }
      const setting = config.rules[ruleId]
      const meta = TEXTLINT_RULE_META[ruleId]
      const options: Record<string, unknown> = {
        ...(setting?.options ?? {}),
        severity: setting?.severity ?? meta?.defaultSeverity ?? 'warning'
      }
      kernelRules.push({ ruleId, rule, options })
    } catch (error) {
      ruleErrors.push({
        ruleId,
        message: `textlintルールのロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
  if (kernelRules.length === 0) {
    return { diagnostics, ruleErrors, durationMs: performance.now() - started }
  }

  // プラグインロード (markdown / text)
  const pluginLoader = docType === 'text' ? PLUGIN_LOADERS.text : PLUGIN_LOADERS.markdown
  let plugin: unknown
  try {
    const mod = await pluginLoader()
    plugin = resolvePluginModule(mod)
  } catch (error) {
    return {
      diagnostics: [],
      ruleErrors: [
        {
          ruleId: 'textlint',
          message: `textlintプラグインのロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`
        }
      ],
      durationMs: performance.now() - started
    }
  }

  const kernel = new TextlintKernel()
  try {
    const result = await kernel.lintText(text, {
      ext: docType === 'text' ? '.txt' : '.md',
      plugins: [
        {
          pluginId: docType === 'text' ? 'text' : 'markdown',
          plugin: plugin as never
        }
      ],
      rules: kernelRules
    })

    const lineIndex = new LineIndex(text)
    for (const message of result.messages) {
      if (message.severity === 0) continue // none
      const ruleId = message.ruleId
      const range = message.range ?? [message.index ?? 0, (message.index ?? 0) + 1]
      const start = Math.max(0, Math.min(range[0], text.length))
      const end = Math.max(start, Math.min(range[1], text.length))
      const pos = lineIndex.posFromOffset(start)
      const meta = TEXTLINT_RULE_META[ruleId]
      diagnostics.push({
        id: `${ruleId}@${start}-${end}`,
        ruleId,
        severity: mapSeverity(message.severity),
        message: message.message,
        start,
        end,
        line: pos.line,
        column: pos.column,
        // textlintのfixは人間判断を要求するため Suggestion 扱い (§17)
        fixKind: message.fix ? 'suggestion' : 'none',
        replacement: message.fix?.text,
        documentation: meta?.description,
        source: 'textlint'
      })
    }
  } catch (error) {
    ruleErrors.push({
      ruleId: 'textlint',
      message: `textlint実行エラー: ${error instanceof Error ? error.message : String(error)}`
    })
  }

  return {
    diagnostics: sortDiagnostics(diagnostics),
    ruleErrors,
    durationMs: performance.now() - started
  }
}
