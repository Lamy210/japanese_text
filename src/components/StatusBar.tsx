/**
 * StatusBar — 解析状態・タイミング・プライバシー状態の表示
 * (§35 Performance SLOの可視化 / §28 Privacy Mode / §45 feature detection)
 */

import { Show } from 'solid-js'
import { appState } from '../state/app-state'

export function StatusBar() {
  const text = () => appState.documentText()
  const charCount = () => text().length
  const lineCount = () => (text() === '' ? 1 : text().split('\n').length)
  const timings = () => appState.lastTimings()

  const statusText = () => {
    switch (appState.analysisStatus()) {
      case 'linting':
        return '解析中…'
      case 'error':
        return '解析エラー'
      case 'off':
        return '解析無効'
      default:
        return '待機中'
    }
  }

  const workerDotClass = () => {
    switch (appState.workerStatus()) {
      case 'ok':
        return 'worker-ok'
      case 'error':
        return 'worker-error'
      default:
        return 'worker-starting'
    }
  }

  return (
    <footer class="status-bar" role="contentinfo">
      <span class="status-item">
        {charCount().toLocaleString('ja-JP')} 文字 / {lineCount().toLocaleString('ja-JP')} 行
      </span>
      <span class="status-item">rev {appState.revision()}</span>
      <span class="status-item" aria-live="polite">
        <span class={`status-dot ${appState.analysisStatus() === 'linting' ? 'dot-linting' : 'dot-idle'}`} aria-hidden="true" />
        {statusText()}
      </span>
      <Show when={timings().fast !== undefined}>
        <span class="status-item">fast {Math.round(timings().fast ?? 0)}ms</span>
      </Show>
      <Show when={timings().deep !== undefined}>
        <span class="status-item">deep {Math.round(timings().deep ?? 0)}ms</span>
      </Show>
      <Show when={timings().idle !== undefined}>
        <span class="status-item">idle {Math.round(timings().idle ?? 0)}ms</span>
      </Show>
      <span class="status-spacer" />
      <Show when={!appState.segmenterAvailable()}>
        <span class="status-item status-warn" title="Intl.Segmenterが利用できないため、文単位の判定は段落判定にフォールバックしています (§45)">
          Intl.Segmenter 不在 (fallback)
        </span>
      </Show>
      <Show when={!appState.storageAvailable()}>
        <span class="status-item status-warn" title="IndexedDBが利用できないため、設定と文書は保存されません (§45)">
          IndexedDB 不在 (メモリのみ)
        </span>
      </Show>
      <Show when={appState.config.privacy.privacyMode}>
        <span class="status-item status-privacy" title="文書本文をブラウザへ保存しません">
          🔒 プライバシーモード
        </span>
      </Show>
      <span class={`status-item ${workerDotClass()}`} title={`解析Worker: ${appState.workerStatus()}`}>
        <span class="worker-dot" aria-hidden="true" />
        Worker
      </span>
    </footer>
  )
}
