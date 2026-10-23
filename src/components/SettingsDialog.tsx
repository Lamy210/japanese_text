/**
 * SettingsDialog — 仕様書 §3.1 Settings / §31 Preset / §30 Import/Export / §28 Privacy
 *
 * タブ: ルール / NGワード / 用語統一 / 引用 / 全般
 * - ルールON/OFF、severity変更、ルール個別オプション
 * - モバイルでは全画面Dialog (§10)
 */

import { For, Show, createMemo, createSignal, onMount, onCleanup } from 'solid-js'
import { appState } from '../state/app-state'
import {
  updateRuleSetting,
  setDictionaryPackEnabled,
  exportConfigFile,
  importConfigFile,
  onPrivacyModeChanged,
  persistAndRelint,
  applyTheme
} from '../state/actions'
import { generateId, type NgWordEntry } from '../core/config/schema'
import type { Severity, RuleCategory } from '../core/types'
import { listRuleManifests, RULE_CATEGORY_LABELS } from '../core/rules/registry'
import { isLegacyDictionaryOwnedRule } from '../core/analysis/packs'

const SEVERITIES: Severity[] = ['error', 'warning', 'info']
const SEVERITY_LABELS: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' }

export function SettingsDialog() {
  const [ngWord, setNgWord] = createSignal('')
  const [ngSeverity, setNgSeverity] = createSignal<Severity>('error')
  const [ngReplacement, setNgReplacement] = createSignal('')
  const [ngIsRegex, setNgIsRegex] = createSignal(false)
  const [termPreferred, setTermPreferred] = createSignal('')
  const [termRejected, setTermRejected] = createSignal('')

  let dialogRef: HTMLDivElement | undefined
  let fileInput: HTMLInputElement | undefined

  const ruleEntries = createMemo(() => {
    const config = appState.config
    return listRuleManifests().map((manifest) => ({
      id: manifest.id,
      category: manifest.category,
      description: manifest.description,
      optionDefs: manifest.optionDefs,
      setting: config.rules[manifest.id]
    }))
  })

  const groupedRules = createMemo(() => {
    const groups = new Map<RuleCategory, typeof ruleEntries extends () => infer T ? T : never>()
    for (const entry of ruleEntries()) {
      const list = groups.get(entry.category) ?? []
      list.push(entry)
      groups.set(entry.category, list)
    }
    return [...groups.entries()]
  })

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && appState.settingsOpen()) {
      appState.setSettingsOpen(false)
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown)
    onCleanup(() => window.removeEventListener('keydown', onKeydown))
  })

  const addNgWord = (): void => {
    const w = ngWord().trim()
    if (w === '') return
    const entry: NgWordEntry = {
      id: generateId('ngw'),
      word: w,
      severity: ngSeverity(),
      replacement: ngReplacement().trim() === '' ? undefined : ngReplacement().trim(),
      isRegex: ngIsRegex()
    }
    appState.addNgWord(entry)
    setNgWord('')
    setNgReplacement('')
    persistAndRelint()
    appState.pushToast('success', `NGワード「${w}」を追加しました。`)
  }

  const addTerm = (): void => {
    const preferred = termPreferred().trim()
    const rejected = termRejected()
      .split(/[,、\n]/)
      .map((s) => s.trim())
      .filter((s) => s !== '')
    if (preferred === '') return
    appState.addTerm({ id: generateId('term'), preferred, rejected, caseSensitive: /[A-Za-z]/.test(preferred) })
    setTermPreferred('')
    setTermRejected('')
    persistAndRelint()
    appState.pushToast('success', `用語「${preferred}」を追加しました。`)
  }

  return (
    <Show when={appState.settingsOpen()}>
      <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && appState.setSettingsOpen(false)}>
        <div
          ref={dialogRef}
          class="dialog settings-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <div class="dialog-header">
            <h2 id="settings-title" class="dialog-title">
              設定
            </h2>
            <button
              type="button"
              class="btn btn-icon"
              onClick={() => appState.setSettingsOpen(false)}
              aria-label="設定を閉じる"
            >
              ✕
            </button>
          </div>

          <div class="settings-tabs" role="tablist" aria-label="設定カテゴリ">
            <For each={['rules', 'ngwords', 'terminology', 'citation', 'general'] as const}>
              {(tab) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={appState.settingsTab() === tab}
                  class={`settings-tab ${appState.settingsTab() === tab ? 'active' : ''}`}
                  onClick={() => appState.setSettingsTab(tab)}
                >
                  {{ rules: 'ルール', ngwords: 'NGワード', terminology: '用語統一', citation: '引用', general: '全般' }[tab]}
                </button>
              )}
            </For>
          </div>

          <div class="dialog-body">
            {/* ------------------- ルール ------------------- */}
            <Show when={appState.settingsTab() === 'rules'}>
              <div class="settings-section">
                <p class="settings-note">
                  ルールのON/OFFとseverity (Error = ルール違反 / Warning = 確認推奨 / Info = 改善候補) を変更できます。変更は即座に反映されます (§13)。
                </p>
                <fieldset class="field-group" aria-describedby="dictionary-pack-note">
                  <legend>辞書解析 (Dictionary Pack)</legend>
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      aria-label="辞書解析を有効にする"
                      checked={appState.config.analysis.packs.dictionary}
                      onChange={(e) => setDictionaryPackEnabled(e.currentTarget.checked)}
                    />
                    誤字検出・用語統一・NGワード検出を有効にする
                  </label>
                  <p id="dictionary-pack-note" class="settings-note">
                    OFFの間は上記3種類の診断を停止します。個別ルールのON/OFFと用語集は保持され、
                    再びONにすると元の設定で解析します。この選択は現在のRuleProfileに保存されます。
                  </p>
                </fieldset>
                <For each={groupedRules()}>
                  {([category, entries]) => (
                    <section class="rule-group">
                      <h3 class="rule-group-title">{RULE_CATEGORY_LABELS[category] ?? category}</h3>
                      <For each={entries}>
                        {(entry) => (
                          <div class={`rule-item ${entry.setting?.enabled === false || (!appState.config.analysis.packs.dictionary && isLegacyDictionaryOwnedRule(entry.id)) ? 'rule-disabled' : ''}`}>
                            <div class="rule-item-main">
                              <label class="rule-name">
                                <input
                                  type="checkbox"
                                  checked={entry.setting?.enabled !== false}
                                  disabled={!appState.config.analysis.packs.dictionary && isLegacyDictionaryOwnedRule(entry.id)}
                                  aria-describedby={!appState.config.analysis.packs.dictionary && isLegacyDictionaryOwnedRule(entry.id) ? 'dictionary-pack-note' : undefined}
                                  onChange={(e) =>
                                    updateRuleSetting(entry.id, { enabled: e.currentTarget.checked })
                                  }
                                />
                                <code>{entry.id}</code>
                              </label>
                              <Show when={entry.setting?.enabled !== false}>
                                <label class="rule-severity">
                                  <span class="visually-hidden">{entry.id} のseverity</span>
                                  <select
                                    value={entry.setting?.severity ?? 'warning'}
                                    disabled={!appState.config.analysis.packs.dictionary && isLegacyDictionaryOwnedRule(entry.id)}
                                    onChange={(e) => updateRuleSetting(entry.id, { severity: e.currentTarget.value })}
                                  >
                                    <For each={SEVERITIES}>
                                      {(sev) => (
                                        <option value={sev}>{SEVERITY_LABELS[sev]}</option>
                                      )}
                                    </For>
                                  </select>
                                </label>
                              </Show>
                            </div>
                            <p class="rule-description">{entry.description}</p>
                            <Show when={entry.optionDefs !== undefined && entry.optionDefs.length > 0 && entry.setting?.enabled !== false}>
                              <div class="rule-options">
                                <For each={entry.optionDefs}>
                                  {(opt) => (
                                    <Show when={opt.type === 'number'} fallback={
                                      <label class="rule-option">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(entry.setting?.options?.[opt.key] ?? opt.defaultValue)}
                                          disabled={!appState.config.analysis.packs.dictionary && isLegacyDictionaryOwnedRule(entry.id)}
                                          onChange={(e) =>
                                            updateRuleSetting(entry.id, {
                                              options: { [opt.key]: e.currentTarget.checked }
                                            })
                                          }
                                        />
                                        {opt.label}
                                      </label>
                                    }>
                                      <label class="rule-option">
                                        {opt.label}
                                        <input
                                          type="number"
                                          class="option-number"
                                          disabled={!appState.config.analysis.packs.dictionary && isLegacyDictionaryOwnedRule(entry.id)}
                                          value={Number(entry.setting?.options?.[opt.key] ?? opt.defaultValue)}
                                          min={opt.min}
                                          max={opt.max}
                                          onChange={(e) =>
                                            updateRuleSetting(entry.id, {
                                              options: { [opt.key]: Number(e.currentTarget.value) }
                                            })
                                          }
                                        />
                                      </label>
                                    </Show>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </section>
                  )}
                </For>
              </div>
            </Show>

            {/* ------------------- NGワード ------------------- */}
            <Show when={appState.settingsTab() === 'ngwords'}>
              <div class="settings-section">
                <p class="settings-note">
                  禁止表現 (NGワード) を登録します (§15)。Advanced mode では正規表現が使えます (危険なパターン制限は将来検討)。
                </p>
                <div class="entry-form">
                  <input
                    type="text"
                    placeholder="NGワード (例: 完了しています)"
                    value={ngWord()}
                    onInput={(e) => setNgWord(e.currentTarget.value)}
                  />
                  <select value={ngSeverity()} onChange={(e) => setNgSeverity(e.currentTarget.value as Severity)}>
                    <For each={SEVERITIES}>
                      {(sev) => (
                        <option value={sev}>{SEVERITY_LABELS[sev]}</option>
                      )}
                    </For>
                  </select>
                  <input
                    type="text"
                    placeholder="置き換え語 (任意)"
                    value={ngReplacement()}
                    onInput={(e) => setNgReplacement(e.currentTarget.value)}
                  />
                  <label class="checkbox-label">
                    <input type="checkbox" checked={ngIsRegex()} onChange={(e) => setNgIsRegex(e.currentTarget.checked)} />
                    正規表現
                  </label>
                  <button type="button" class="btn" onClick={addNgWord} disabled={ngWord().trim() === ''}>
                    追加
                  </button>
                </div>
                <Show
                  when={appState.config.ngWords.length > 0}
                  fallback={<p class="panel-empty">NGワードは登録されていません。</p>}
                >
                  <ul class="entry-list">
                    <For each={appState.config.ngWords}>
                      {(entry) => (
                        <li class="entry-item">
                          <code class={`ng-word ${entry.isRegex ? 'is-regex' : ''}`}>{entry.word}</code>
                          <span class={`severity-badge severity-${entry.severity}`}>{entry.severity}</span>
                          <Show when={entry.replacement}>
                            <span class="fix-arrow">→</span>
                            <code>{entry.replacement}</code>
                          </Show>
                          <button
                            type="button"
                            class="btn btn-icon"
                            aria-label={`NGワード ${entry.word} を削除`}
                            onClick={() => {
                              appState.removeNgWord(entry.id)
                              persistAndRelint()
                            }}
                          >
                            ✕
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            </Show>

            {/* ------------------- 用語統一 ------------------- */}
            <Show when={appState.settingsTab() === 'terminology'}>
              <div class="settings-section">
                <p class="settings-note">
                  同一概念の表記を統一します (§16)。却下表記は任意です。推奨表記だけを登録すると、内蔵誤字辞書の例外として使用できます。却下表記がある場合は推奨表記へのSafe Fixを提示します。
                </p>
                <div class="entry-form">
                  <input
                    type="text"
                    placeholder="推奨表記 (例: GitHub)"
                    value={termPreferred()}
                    onInput={(e) => setTermPreferred(e.currentTarget.value)}
                  />
                  <input
                    type="text"
                    placeholder="却下表記（任意・カンマ区切り）"
                    value={termRejected()}
                    onInput={(e) => setTermRejected(e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="btn"
                    onClick={addTerm}
                    disabled={termPreferred().trim() === ''}
                  >
                    追加
                  </button>
                </div>
                <ul class="entry-list">
                  <For each={appState.config.terminology}>
                    {(entry) => (
                      <li class="entry-item">
                        <code>{entry.preferred}</code>
                        <Show
                          when={entry.rejected.length > 0}
                          fallback={<span class="position">誤字辞書の例外（正式表記）</span>}
                        >
                          <span class="fix-arrow">←</span>
                          <code>{entry.rejected.join(', ')}</code>
                        </Show>
                        <button
                          type="button"
                          class="btn btn-icon"
                          aria-label={`用語 ${entry.preferred} を削除`}
                          onClick={() => {
                            appState.removeTerm(entry.id)
                            persistAndRelint()
                          }}
                        >
                          ✕
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            {/* ------------------- 引用 ------------------- */}
            <Show when={appState.settingsTab() === 'citation'}>
              <div class="settings-section">
                <p class="settings-note">
                  Evidence / Citation Linter は heuristic detector です (§19)。引用の存在判定範囲を変更できます (§20)。デフォルト: Paragraph。
                </p>
                <fieldset class="field-group">
                  <legend>判定範囲 (Citation Scope)</legend>
                  <div class="radio-row">
                    <For each={['sentence', 'paragraph', 'section'] as const}>
                      {(scope) => (
                        <label class="radio-label">
                          <input
                            type="radio"
                            name="citation-scope"
                            checked={appState.config.citation.scope === scope}
                            onChange={() => {
                              appState.updateConfig((d) => {
                                d.citation.scope = scope
                                d.preset = 'custom'
                              })
                              persistAndRelint()
                            }}
                          />
                          {{ sentence: '同一文', paragraph: '同一段落 (デフォルト)', section: '同一セクション' }[scope]}
                        </label>
                      )}
                    </For>
                  </div>
                </fieldset>
                <div class="checkbox-column">
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      checked={appState.config.citation.detectNumbers}
                      onChange={(e) => {
                        appState.updateConfig((d) => {
                          d.citation.detectNumbers = e.currentTarget.checked
                          d.preset = 'custom'
                        })
                        persistAndRelint()
                      }}
                    />
                    数値・統計を含む主張を検出 (evidence/citation-number)
                  </label>
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      checked={appState.config.citation.detectComparison}
                      onChange={(e) => {
                        appState.updateConfig((d) => {
                          d.citation.detectComparison = e.currentTarget.checked
                          d.preset = 'custom'
                        })
                        persistAndRelint()
                      }}
                    />
                    比較・性能表現を検出 (evidence/citation-comparison)
                  </label>
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      checked={appState.config.citation.detectExternalFact}
                      onChange={(e) => {
                        appState.updateConfig((d) => {
                          d.citation.detectExternalFact = e.currentTarget.checked
                          d.preset = 'custom'
                        })
                        persistAndRelint()
                      }}
                    />
                    外部事実への言及を検出 (evidence/citation-external-fact)
                  </label>
                </div>
              </div>
            </Show>

            {/* ------------------- 全般 ------------------- */}
            <Show when={appState.settingsTab() === 'general'}>
              <div class="settings-section general-section">
                <fieldset class="field-group">
                  <legend>テーマ (§39)</legend>
                  <div class="radio-row">
                    <For each={['light', 'dark', 'system'] as const}>
                      {(theme) => (
                        <label class="radio-label">
                          <input
                            type="radio"
                            name="theme"
                            checked={appState.config.theme === theme}
                            onChange={() => {
                              appState.setTheme(theme)
                              applyTheme(theme)
                            }}
                          />
                          {{ light: 'Light', dark: 'Dark', system: 'System' }[theme]}
                        </label>
                      )}
                    </For>
                  </div>
                </fieldset>

                <fieldset class="field-group">
                  <legend>エディタ</legend>
                  <div class="checkbox-column">
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        checked={appState.config.editor.showLineNumbers}
                        onChange={(e) => {
                          appState.updateConfig((d) => {
                            d.editor.showLineNumbers = e.currentTarget.checked
                          })
                        }}
                      />
                      行番号を表示
                    </label>
                    <label class="rule-option">
                      フォントサイズ
                      <input
                        type="number"
                        class="option-number"
                        min={10}
                        max={32}
                        value={appState.config.editor.fontSize}
                        onChange={(e) => {
                          appState.updateConfig((d) => {
                            d.editor.fontSize = Number(e.currentTarget.value)
                          })
                        }}
                      />
                    </label>
                  </div>
                </fieldset>

                <fieldset class="field-group">
                  <legend>保存とプライバシー (§28)</legend>
                  <div class="checkbox-column">
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        checked={appState.config.privacy.autoSave}
                        onChange={(e) => {
                          appState.updateConfig((d) => {
                            d.privacy.autoSave = e.currentTarget.checked
                          })
                        }}
                      />
                      自動保存 (IndexedDBへ文書を保存)
                    </label>
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        checked={appState.config.privacy.privacyMode}
                        onChange={(e) => {
                          const enabled = e.currentTarget.checked
                          appState.updateConfig((d) => {
                            d.privacy.privacyMode = enabled
                          })
                          onPrivacyModeChanged(enabled)
                        }}
                      />
                      プライバシーモード (文書本文を保存しない / 設定のみ保存)
                    </label>
                  </div>
                  <p class="settings-note">
                    いずれの場合も、文章本文が外部へ送信されることはありません (§36 Privacy)。
                  </p>
                </fieldset>

                <fieldset class="field-group">
                  <legend>設定ファイル (§30 / §32)</legend>
                  <p class="settings-note">
                    ルール設定・severity・terminology・NGワード・引用ポリシーをJSONファイルとして入出力できます。Import前にvalidationとmigrationが行われます。
                  </p>
                  <div class="button-row">
                    <button type="button" class="btn" onClick={() => exportConfigFile()}>
                      設定をExport
                    </button>
                    <button type="button" class="btn" onClick={() => fileInput?.click()}>
                      設定をImport
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="application/json,.json"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const input = e.currentTarget
                        const file = input.files?.[0]
                        if (file !== undefined) void importConfigFile(file)
                        input.value = ''
                      }}
                      aria-hidden="true"
                      tabindex={-1}
                    />
                  </div>
                </fieldset>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
