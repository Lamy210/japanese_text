/**
 * DiagnosticsPanel — 仕様書 §9.1 Diagnostics Panel
 *
 * 表示: Error/Warning/Info件数 / rule ID / message / line・column / Fix有無
 * - 診断クリックで該当箇所へジャンプ
 * - Quick Fixボタンで修正適用
 * - severityは色だけでなく icon (✕ ! i) とラベルで区別 (§43)
 * - ルール実行エラー (§41) も表示
 */

import { For, Show, createMemo } from 'solid-js'
import type { Diagnostic } from '../core/types'
import { appState } from '../state/app-state'
import { jumpToDiagnostic, quickFix } from '../state/actions'

const SEVERITY_META: Record<string, { icon: string; label: string }> = {
  error: { icon: '✕', label: 'Error' },
  warning: { icon: '!', label: 'Warning' },
  info: { icon: 'i', label: 'Info' }
}

const FIX_LABEL: Record<string, string> = {
  safe: 'Safe Fix',
  suggestion: 'Suggestion',
  none: ''
}

export function DiagnosticsPanel() {
  const counts = () => appState.diagnosticCounts()
  const filter = () => appState.severityFilter()
  const diagnostics = () => appState.filteredDiagnostics()
  const ruleErrors = () => appState.activeRuleErrors()

  const filterTabs = createMemo(() => [
    { key: 'all' as const, label: 'すべて', count: counts().error + counts().warning + counts().info },
    { key: 'error' as const, label: 'Error', count: counts().error },
    { key: 'warning' as const, label: 'Warning', count: counts().warning },
    { key: 'info' as const, label: 'Info', count: counts().info }
  ])

  return (
    <aside class="diagnostics-panel" aria-label="診断パネル">
      <div class="panel-header">
        <h2 class="panel-title">診断</h2>
        <div class="filter-tabs" role="tablist" aria-label="深刻度で絞り込み">
          <For each={filterTabs()}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter() === tab.key}
                class={`filter-tab ${filter() === tab.key ? 'active' : ''}`}
                onClick={() => appState.setSeverityFilter(tab.key)}
              >
                {tab.label} ({tab.count})
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={ruleErrors().length > 0}>
        <div class="rule-errors" role="alert">
          <p class="rule-errors-title">一部のルールでエラーが発生しました (§41: 他ルールは継続):</p>
          <For each={ruleErrors()}>
            {(err) => (
              <p class="rule-error-item">
                <code>{err.ruleId}</code>: {err.message}
              </p>
            )}
          </For>
        </div>
      </Show>

      <div class="diagnostic-list" role="list" aria-label="診断リスト">
        <Show
          when={diagnostics().length > 0}
          fallback={
            <p class="panel-empty" role="status">
              診断はありません。
            </p>
          }
        >
          <For each={diagnostics()}>
            {(d: Diagnostic) => (
              <div
                role="listitem"
                class={`diagnostic-item severity-${d.severity} ${appState.selectedDiagnosticId() === d.id ? 'selected' : ''}`}
                onClick={() => jumpToDiagnostic(d)}
              >
                <span class={`severity-badge severity-${d.severity}`} title={SEVERITY_META[d.severity].label}>
                  <span aria-hidden="true">{SEVERITY_META[d.severity].icon}</span>
                  <span class="severity-label">{SEVERITY_META[d.severity].label}</span>
                </span>
                <div class="diagnostic-body">
                  <p class="diagnostic-message">{d.message}</p>
                  <p class="diagnostic-meta">
                    <code class="rule-id">{d.ruleId}</code>
                    <span class="position">
                      行 {d.line} : 列 {d.column}
                    </span>
                    <Show when={d.source !== 'core'}>
                      <span class="source-badge">{d.source === 'textlint' ? 'textlint' : 'user'}</span>
                    </Show>
                    <Show when={d.fixKind !== 'none' && d.replacement !== undefined}>
                      <span class={`fix-badge fix-${d.fixKind}`}>{FIX_LABEL[d.fixKind]}</span>
                    </Show>
                  </p>
                  <Show when={d.replacement !== undefined && d.fixKind !== 'none'}>
                    <div class="diagnostic-fix-preview">
                      <span class="fix-arrow" aria-label="修正候補">
                        →
                      </span>
                      <code class="fix-replacement">{d.replacement === '' ? '(削除)' : d.replacement}</code>
                      <button
                        type="button"
                        class="btn btn-small btn-fix"
                        onClick={(e) => {
                          e.stopPropagation()
                          quickFix(d)
                        }}
                        title="この修正を適用"
                      >
                        修正
                      </button>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </aside>
  )
}
