/// <reference lib="webworker" />
/**
 * Analysis Worker — 仕様書 §8 (解析処理をWeb Workerへ配置) / §24 (Revision) / §26 (障害)
 *
 * メインUIスレッドとは別スレッドで解析処理を実行し、UIブロックを避ける。
 * textlint (Deep Engine) はdynamic importで遅延ロードする (§33)。
 * 個別ルールの例外はruleErrorsとして報告し、全体Lintは停止しない (§41)。
 */

import type { LintRequest, WorkerResponse } from './protocol'
import { prepareOwnRuleExecution, runOwnRules, type PreparedOwnRuleExecution } from '../core/engine/engine'
import { RevisionGate } from './revision-gate'

const ctx = self as unknown as DedicatedWorkerGlobalScope

// Node依存パッケージ (assert polyfill等) のための process シム。
// textlintの動的importより前に実行する必要がある (§45: ブラウザ環境での継続動作)。
if (typeof (globalThis as { process?: unknown }).process === 'undefined') {
  ;(globalThis as unknown as { process: unknown }).process = {
    env: {},
    browser: true,
    version: '',
    platform: 'browser',
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      queueMicrotask(() => fn(...args))
    }
  }
}

// Fast Engineは初期ロード、Deep (textlint) は初回実行時にロード
let textlintModule: typeof import('../core/engine/textlint-adapter') | null = null
async function loadTextlint(): Promise<typeof import('../core/engine/textlint-adapter') | null> {
  if (textlintModule === null) {
    try {
      textlintModule = await import('../core/engine/textlint-adapter')
    } catch (error) {
      console.error('[worker] textlint module load failed:', error)
      textlintLoadError = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      return null
    }
  }
  return textlintModule
}

let textlintLoadError: string | null = null
const revisionGate = new RevisionGate()

async function runLint(req: LintRequest): Promise<void> {
  const { revision, text, config, docType, tiers } = req
  // Scope prepared structures to this individual message. Requests for newer
  // revisions or shadow lint can interleave while textlint awaits imports.
  let prepared: PreparedOwnRuleExecution | null = null
  let pendingPreparationMs = 0

  for (const tier of tiers) {
    // A newer UI revision makes older work obsolete. Send one terminal
    // response per tier so UI progress and manual waiters never get stuck.
    if (revisionGate.isObsolete(revision)) {
      post({ type: 'skipped', revision, tier, reason: 'superseded' })
      continue
    }
    try {
      if (prepared === null) {
        const started = performance.now()
        prepared = prepareOwnRuleExecution(text, config)
        pendingPreparationMs = performance.now() - started
      }
      const setupChargeMs = pendingPreparationMs
      pendingPreparationMs = 0
      if (tier === 'deep') {
        // Deep = 独自Deepルール + textlint
        const own = runOwnRules(text, config, 'deep', docType, prepared)
        let textlintDiagnostics: typeof own.diagnostics = []
        const ruleErrors = [...own.ruleErrors]
        const adapter = await loadTextlint()
        if (revisionGate.isObsolete(revision)) {
          post({ type: 'skipped', revision, tier, reason: 'superseded' })
          continue
        }
        if (adapter !== null) {
          try {
            const result = await adapter.runTextlint(text, config, docType)
            textlintDiagnostics = result.diagnostics
            ruleErrors.push(...result.ruleErrors)
          } catch (error) {
            ruleErrors.push({
              ruleId: 'textlint',
              message: `textlint実行に失敗しました: ${error instanceof Error ? error.message : String(error)}`
            })
          }
        } else {
          ruleErrors.push({
            ruleId: 'textlint',
            message: `textlintモジュールのロードに失敗しました。Deep解析の一部が無効になっています。${textlintLoadError ?? ''}`
          })
        }
        if (revisionGate.isObsolete(revision)) {
          post({ type: 'skipped', revision, tier, reason: 'superseded' })
          continue
        }
        const merged = [...own.diagnostics, ...textlintDiagnostics].sort(
          (a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId)
        )
        post({
          type: 'result',
          revision,
          tier,
          diagnostics: merged,
          ruleErrors,
          durationMs: own.durationMs + setupChargeMs
        })
      } else {
        // fast / idle
        const result = runOwnRules(text, config, tier, docType, prepared)
        post({
          type: 'result',
          revision,
          tier,
          diagnostics: result.diagnostics,
          ruleErrors: result.ruleErrors,
          durationMs: result.durationMs + setupChargeMs
        })
      }
    } catch (error) {
      // Worker全体は継続、エラーをUIへ通知 (§26)
      post({
        type: 'error',
        revision,
        tier,
        message: `${tier}解析でエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
}

function post(message: WorkerResponse): void {
  ctx.postMessage(message)
}

ctx.addEventListener('message', (event: MessageEvent<LintRequest>) => {
  const data = event.data
  if (data === undefined || data === null || data.type !== 'lint') return
  // Track arrival before scheduling async work; negative formatter shadow
  // requests must never obsolete positive UI requests or be cancelled.
  revisionGate.receive(data.revision)
  void runLint(data)
})

// 準備完了を通知 (Intl.Segmenterのfeature detection結果も伝える — §45)
post({
  type: 'ready',
  segmenterAvailable: typeof Intl !== 'undefined' && 'Segmenter' in Intl
})
