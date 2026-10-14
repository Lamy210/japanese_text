/**
 * Toasts — 操作フィードバック (role=status / aria-live)
 */

import { For } from 'solid-js'
import { appState } from '../state/app-state'

export function Toasts() {
  return (
    <div class="toast-container" role="status" aria-live="polite">
      <For each={appState.toasts()}>
        {(toast) => <div class={`toast toast-${toast.kind}`}>{toast.message}</div>}
      </For>
    </div>
  )
}
