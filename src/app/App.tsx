/**
 * App — 3領域レイアウト (§9.1 Desktop) + レスポンシブ (§10)
 *
 * Desktop (≥1024px) : Editor + Diagnostics 並列表示
 * Tablet (768-1023px): Diagnostics を Drawer 化
 * Mobile (<768px)   : Editor優先 / Diagnostics は Bottom Sheet / Settings は全画面Dialog
 */

import { onMount, createEffect, Show } from 'solid-js'
import { Header } from '../components/Header'
import { EditorPane } from '../components/EditorPane'
import { DiagnosticsPanel } from '../components/DiagnosticsPanel'
import { StatusBar } from '../components/StatusBar'
import { SettingsDialog } from '../components/SettingsDialog'
import { Toasts } from '../components/Toasts'
import { appState } from '../state/app-state'
import { lintController } from '../state/lint-controller'
import { applyTheme, persistConfigDebounced } from '../state/actions'
import { loadConfig, loadRecentDocument, isStorageAvailable } from '../storage/storage'
import { migrateConfig } from '../core/config/validate'

export function App() {
  onMount(() => {
    void bootstrap()
  })

  // 設定変更を永続化 (§27)
  createEffect(() => {
    void appState.config
    if (appState.configLoaded()) {
      persistConfigDebounced()
    }
  })

  // テーマ反映 (§39)
  createEffect(() => {
    applyTheme(appState.config.theme)
  })

  // フォントサイズ反映
  createEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', `${appState.config.editor.fontSize}px`)
  })

  return (
    <div class="app-shell">
      <Header />
      <main class="app-main">
        <EditorPane />
        <Show when={appState.panelOpen()}>
          <DiagnosticsPanel />
        </Show>
      </main>
      <StatusBar />
      <SettingsDialog />
      <Toasts />
    </div>
  )
}

/** 起動処理: 設定復元 → 文書復元 → 初回Lint (§27/28) */
async function bootstrap(): Promise<void> {
  // feature detection (§45)
  appState.setStorageAvailable(isStorageAvailable())

  // 設定の復元 (不正データでは起動不能にしない — §30)
  if (isStorageAvailable()) {
    try {
      const stored = await loadConfig()
      if (stored !== undefined) {
        const result = appState.loadConfigFrom(migrateConfig(stored))
        if (!result.ok) {
          appState.pushToast('warning', '保存されていた設定が不正なため、デフォルト設定を使用します。')
        }
      }
    } catch {
      // 設定読み込み失敗時はデフォルトで継続
    }
  }
  appState.setConfigLoaded(true)

  // 最近の文書の復元 (Auto Save ON かつ Privacy Mode OFF の場合のみ — §28)
  if (isStorageAvailable() && !appState.config.privacy.privacyMode && appState.config.privacy.autoSave) {
    try {
      const doc = await loadRecentDocument()
      if (doc !== undefined && typeof doc.content === 'string' && doc.content.trim() !== '') {
        appState.setDocument(doc.content, doc.name, doc.docType)
        appState.pushToast('info', `前回の文書「${doc.name}」を復元しました。`)
      }
    } catch {
      // 文書復元失敗時はウェルカム文書で継続
    }
  }

  // 初回解析
  lintController.relintAll()
}
