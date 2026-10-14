/**
 * StatusBar — 解析状態・タイミング・Workspace保存状態の表示
 */

import { Show } from 'solid-js'
import { appState } from '../state/app-state'

export function StatusBar() {
  const text = () => appState.documentText()
  const charCount = () => text().length
  const lineCount = () => (text() === '' ? 1 : text().split('\n').length)
  const timings = () => appState.lastTimings()
  const activeWorkspace = () => appState.workspaceSummaries().find((workspace) => workspace.id === appState.activeWorkspaceId())

  const statusText = () => {
    switch (appState.analysisStatus()) {
      case 'linting': return '解析中…'
      case 'error': return '解析エラー'
      case 'off': return '解析無効'
      default: return '待機中'
    }
  }

  const workerDotClass = () => {
    switch (appState.workerStatus()) {
      case 'ok': return 'worker-ok'
      case 'error': return 'worker-error'
      default: return 'worker-starting'
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
      <Show when={timings().fast !== undefined}><span class="status-item">fast {Math.round(timings().fast ?? 0)}ms</span></Show>
      <Show when={timings().deep !== undefined}><span class="status-item">deep {Math.round(timings().deep ?? 0)}ms</span></Show>
      <Show when={timings().idle !== undefined}><span class="status-item">idle {Math.round(timings().idle ?? 0)}ms</span></Show>
      <span class="status-spacer" />
      <Show when={!appState.segmenterAvailable()}>
        <span class="status-item status-warn" title="Intl.Segmenterが利用できないため、文単位の判定は段落判定にフォールバックしています (§45)">
          Intl.Segmenter 不在 (fallback)
        </span>
      </Show>
      <Show when={!appState.storageAvailable()}>
        <span class="status-item status-warn" title="Durable IndexedDBが利用できないため、Local Libraryは利用できません。Private Session本文はこのタブ内のメモリだけに保持されます。">
          Memory only
        </span>
      </Show>
      <Show when={activeWorkspace()?.storageMode === 'private-session'}>
        <span class="status-item status-privacy" title="本文はこのタブ内のメモリだけに保持されます">
          🔒 Private Session
        </span>
      </Show>
      <Show when={activeWorkspace()?.storageMode === 'local-library'}>
        <span class="status-item" title="本文をこのブラウザのIndexedDBへ保存します">
          Local Library
        </span>
      </Show>
      <span class={`status-item ${workerDotClass()}`} title={`解析Worker: ${appState.workerStatus()}`}>
        <span class="worker-dot" aria-hidden="true" />
        Worker
      </span>
    </footer>
  )
}
