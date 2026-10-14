/**
 * Formatter — 仕様書 §17 (Safe Fix Only) / §18 (Format Document) / §50 (Idempotency)
 *
 * 原則: 意味が変化する可能性のある自動変更は禁止する。
 * Safe Fix (意味変化の可能性が極めて低い) のみを自動適用対象とする。
 *
 * Format Document の処理順序 (§18):
 * 1. Safe Fix候補収集 → 2. offset競合検査 → 3. Fix順序決定 → 4. 後方offsetから適用
 * (5. 再Lint / 6. 新規Error確認 / 7. Editor反映 はState層で行う)
 *
 * 性質 (§50): format(format(x)) === format(x) (Idempotency)
 */

import type { Diagnostic } from '../types'

export interface FormatPlan {
  /** 適用する修正 (start降順) */
  fixes: Diagnostic[]
  /** 競合によりスキップされた修正 */
  skippedConflicts: Diagnostic[]
}

export interface FormatResult {
  text: string
  appliedCount: number
  skippedCount: number
  /** 適用された修正 (Editor transaction生成用) */
  appliedFixes: Diagnostic[]
}

/** Safe Fix候補の収集 (§18.1) */
export function collectSafeFixes(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(
    (d) => d.fixKind === 'safe' && typeof d.replacement === 'string' && d.end > d.start
  )
}

/**
 * offset競合検査 (§18.2) と Fix順序決定 (§18.3)
 * 開始位置の昇順に走査し、重複する範囲を持つ修正は後方をスキップする。
 */
export function planFixes(fixes: Diagnostic[]): FormatPlan {
  const sorted = [...fixes].sort((a, b) => a.start - b.start || a.end - b.end)
  const applied: Diagnostic[] = []
  const skipped: Diagnostic[] = []
  let lastEnd = -1
  for (const fix of sorted) {
    if (fix.start >= lastEnd) {
      applied.push(fix)
      lastEnd = fix.end
    } else {
      skipped.push(fix)
    }
  }
  // 後方offsetから適用するため降順にしておく (§18.4)
  applied.reverse()
  return { fixes: applied, skippedConflicts: skipped }
}

/** 修正群をテキストへ適用 (後方から適用するため前方offsetは不変) */
export function applyFixes(text: string, fixes: Diagnostic[]): string {
  let result = text
  for (const fix of fixes) {
    result = result.slice(0, fix.start) + (fix.replacement ?? '') + result.slice(fix.end)
  }
  return result
}

/** Format Document のコア処理: 1〜4をまとめて実行 */
export function formatDocument(text: string, diagnostics: Diagnostic[]): FormatResult {
  const candidates = collectSafeFixes(diagnostics)
  const plan = planFixes(candidates)
  const formatted = applyFixes(text, plan.fixes)
  return {
    text: formatted,
    appliedCount: plan.fixes.length,
    skippedCount: plan.skippedConflicts.length,
    appliedFixes: plan.fixes
  }
}
