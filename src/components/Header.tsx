/**
 * Header — 仕様書 §9.1 Desktop Header
 *
 * 配置: App Name / Workspace / Documents / Open / Export / Lint / Format / Preset / Settings / Theme
 */

import { Show } from 'solid-js'
import { appState } from '../state/app-state'
import { lintController } from '../state/lint-controller'
import {
  openDocumentFile,
  exportDocumentFile,
  formatDocumentAction,
  applyPresetAction,
  cycleTheme
} from '../state/actions'
import { BUILTIN_PRESETS, PRESET_LABELS } from '../core/config/presets'
import type { PresetId } from '../core/config/schema'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { nextAuxiliaryPanels } from './document-sidebar-model'

const SEVERITY_ICON: Record<string, string> = { error: '✕', warning: '!', info: 'i' }

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth
}

export function Header() {
  let fileInput: HTMLInputElement | undefined

  const onOpenClick = (): void => {
    fileInput?.click()
  }

  const onFileSelected = (event: Event): void => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file !== undefined) void openDocumentFile(file)
    input.value = ''
  }

  const toggleAuxiliaryPanel = (target: 'documents' | 'diagnostics'): void => {
    const next = nextAuxiliaryPanels({
      width: viewportWidth(),
      target,
      documentsOpen: appState.documentSidebarOpen(),
      diagnosticsOpen: appState.panelOpen()
    })
    appState.setDocumentSidebarOpen(next.documentsOpen)
    appState.setPanelOpen(next.diagnosticsOpen)
  }

  const counts = () => appState.diagnosticCounts()

  return (
    <header class="app-header" role="banner">
      <div class="header-left">
        <span class="app-logo" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 7V4h16v3M9 20h6M12 4v16" stroke-linecap="round" />
          </svg>
        </span>
        <h1 class="app-title">Japanese Writing Toolkit</h1>
        <span class="app-subtitle">日本語文章 Linter / Formatter</span>
      </div>

      <div class="header-actions">
        <WorkspaceSwitcher />
        <button
          id="documents-toggle"
          type="button"
          class="btn"
          onClick={() => toggleAuxiliaryPanel('documents')}
          title="ドキュメント一覧の表示切替"
          aria-controls="document-sidebar"
          aria-expanded={appState.documentSidebarOpen()}
        >
          Documents
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.md,.markdown,.mdown,.mkd,text/plain,text/markdown"
          style={{ display: 'none' }}
          onChange={onFileSelected}
          aria-hidden="true"
          tabindex={-1}
        />
        <button type="button" class="btn" onClick={onOpenClick} title="ファイルを開く (.txt / .md)">
          Open
        </button>
        <button type="button" class="btn" onClick={() => exportDocumentFile()} title="文書をダウンロード">
          Export
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => void lintController.lintAllNow()}
          title="全ルールを即時実行"
        >
          Lint
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => void formatDocumentAction()}
          title="Safe Fixを一括適用 (Shift+Alt+F / Undo 1回で戻る)"
        >
          Format
        </button>

        <label class="preset-select-wrap" for="preset-select">
          <span class="visually-hidden">プリセット選択</span>
          <select
            id="preset-select"
            class="preset-select"
            value={appState.config.preset}
            onChange={(e) => applyPresetAction(e.currentTarget.value as PresetId)}
            title="ルールプリセット"
          >
            <option value="custom" disabled={appState.config.preset !== 'custom'}>
              {PRESET_LABELS.custom}
              <Show when={appState.config.preset === 'custom'}>{' (現在の設定)'}</Show>
            </option>
            {BUILTIN_PRESETS.map((p) => (
              <option value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          class="btn"
          onClick={() => cycleTheme()}
          title="テーマ切替 (Light / Dark / System)"
          aria-label="テーマ切替"
        >
          <Show when={appState.config.theme === 'dark'} fallback={<span aria-hidden="true">☀</span>}>
            <span aria-hidden="true">☾</span>
          </Show>
          <span class="theme-label">{appState.config.theme === 'system' ? 'Auto' : ''}</span>
        </button>

        <button
          type="button"
          class="btn"
          onClick={() => appState.setSettingsOpen(true)}
          title="設定 (ルール / NGワード / 用語統一 / 引用 / 全般)"
        >
          Settings
        </button>

        <button
          type="button"
          class="btn btn-panel-toggle"
          onClick={() => toggleAuxiliaryPanel('diagnostics')}
          title="診断パネルの表示切替"
          aria-expanded={appState.panelOpen()}
        >
          診断
          <span class={`count-pill ${counts().error > 0 ? 'pill-error' : ''}`} data-count={counts().error + counts().warning + counts().info}>
            <span aria-hidden="true">{SEVERITY_ICON.error}</span>
            {counts().error}
          </span>
          <span class={`count-pill ${counts().warning > 0 ? 'pill-warning' : ''}`}>
            <span aria-hidden="true">{SEVERITY_ICON.warning}</span>
            {counts().warning}
          </span>
        </button>
      </div>
    </header>
  )
}
