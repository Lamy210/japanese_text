import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { generateId } from '../core/config/schema'
import { BrainstormMemorySession, BRAINSTORM_PHASE_LABELS } from '../core/thinking/memory-session'
import { appState } from '../state/app-state'
import './BrainstormDialog.css'

export interface BrainstormDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

/**
 * Solo brainstorming MVP, memory only. It is not bound to the editor document
 * and never calls storage or any AI service. Workspace changes discard notes.
 */
export function BrainstormDialog(props: BrainstormDialogProps) {
  const controller = new BrainstormMemorySession()
  const [theme, setTheme] = createSignal('')
  const [thought, setThought] = createSignal('')
  const [revision, setRevision] = createSignal(0)
  let dialogRef: HTMLDivElement | undefined
  let closeButton: HTMLButtonElement | undefined
  let importInput: HTMLInputElement | undefined

  const refresh = (): void => { setRevision(v => v + 1) }
  const snapshot = createMemo(() => {
    revision()
    return controller.snapshot()
  })
  const question = createMemo(() => {
    revision()
    return controller.question()
  })

  const answeredQuestion = (nodeId: string): string | null => {
    const graph = snapshot()
    if (graph === null) return null
    const link = graph.edges.find(edge =>
      edge.relation === 'answers' && edge.fromNodeId === nodeId
    )
    return graph.nodes.find(node => node.id === link?.toNodeId)?.text ?? null
  }

  createEffect(() => {
    const workspaceId = appState.activeWorkspaceId() ?? null
    if (controller.bindWorkspace(workspaceId)) {
      setTheme('')
      setThought('')
      refresh()
    }
  })

  createEffect(() => {
    if (props.open) queueMicrotask(() => closeButton?.focus())
  })

  const close = (): void => {
    props.onClose()
    queueMicrotask(() => document.getElementById('brainstorm-toggle')?.focus())
  }

  const keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab' || dialogRef === undefined) return
    const controls = Array.from(
      dialogRef.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
      )
    )
    if (controls.length === 0) return
    const first = controls[0]!
    const last = controls[controls.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const start = (): void => {
    if (!controller.start(theme(), generateId('brainstorm'))) {
      appState.pushToast('warning', 'ワークスペースとテーマを確認してください（最大512文字）。')
      return
    }
    setThought('')
    refresh()
  }

  const addThought = (): void => {
    if (!controller.addThought(generateId('thought'), thought(), new Date().toISOString())) {
      appState.pushToast('warning', '内容を入力してください（最大4096文字）。')
      return
    }
    // Record which prompt the answer addressed before changing focus.
    // The new node may become the next strategy focus.
    setThought('')
    refresh()
  }

  const move = (direction: 'forward' | 'backward'): void => {
    if (controller.movePhase(direction)) {
      refresh()
    }
  }

  const skip = (): void => {
    if (controller.skipQuestion()) refresh()
  }

  const remove = (id: string): void => {
    if (!window.confirm('この考えを削除しますか？')) return
    if (controller.removeThought(id)) refresh()
  }

  const clear = (): void => {
    if (!window.confirm('現在の一人ブレストを破棄しますか？取り消せません。')) return
    controller.clear()
    setTheme('')
    setThought('')
    refresh()
  }

  const importFile = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file === undefined) return
    const beforeWorkspaceId = appState.activeWorkspaceId()
    if (beforeWorkspaceId === undefined) return
    // Reject before reading to avoid parsing arbitrarily large untrusted files.
    if (file.size > 16 * 1024 * 1024) {
      appState.pushToast('warning', '読み込み可能なJSONファイルは最大16MiBです。')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text()) as unknown
    } catch {
      appState.pushToast('warning', 'JSONファイルを読み取れませんでした。')
      return
    }
    // A workspace switch while reading must never import into the new scope.
    if (appState.activeWorkspaceId() !== beforeWorkspaceId) {
      appState.pushToast('warning', 'ワークスペースが変更されたため読み込みを中止しました。')
      return
    }
    if (controller.snapshot() !== null &&
        !window.confirm('現在の一人ブレストを読み込んだ内容で置き換えますか？')) return
    const result = controller.importSnapshot(parsed)
    if (result !== 'imported') {
      appState.pushToast('warning', result === 'wrong-workspace'
        ? 'このJSONは別のワークスペース用です。読み込みできません。'
        : '不正なデータ形式または未対応バージョンのJSONです。')
      return
    }
    setTheme('')
    setThought('')
    refresh()
    appState.pushToast('success', '一人ブレストのJSONを復元しました（このタブ内のみ）。')
  }

  const download = (): void => {
    const json = controller.exportSnapshot()
    const active = controller.snapshot()
    if (json === null || active === null) return
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `brainstorm-${active.session.id}.json`
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <Show when={props.open}>
      <div class="dialog-backdrop" onClick={e => e.target === e.currentTarget && close()}>
        <div
          ref={dialogRef}
          class="dialog brainstorm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="brainstorm-dialog-title"
          onKeyDown={keyDown}
        >
          <div class="dialog-header">
            <h2 id="brainstorm-dialog-title" class="dialog-title">一人ブレスト</h2>
            <button ref={closeButton} type="button" class="btn btn-icon" onClick={close} aria-label="一人ブレストを閉じる">
              ✕
            </button>
          </div>
          <div class="dialog-body brainstorm-body">
            <p class="settings-note">
              LLM不要・ブラウザ内のみで動作します。内容は自動保存されません。
              画面を閉じてもこのタブ内では保持しますが、再読み込み・タブを閉じる・ワークスペース切替で消えます。
              必要に応じてJSONを書き出し、同じワークスペースで再度読み込んでください。
            </p>
            <Show when={appState.activeWorkspaceId() !== undefined}
              fallback={<p role="status">ワークスペースの読み込み後に使用できます。</p>}>
              <div class="button-row">
                <input
                  ref={importInput}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={event => { void importFile(event) }}
                  aria-hidden="true"
                  tabindex={-1}
                />
                <button type="button" class="btn"
                  onClick={() => importInput?.click()}>
                  JSONから復元
                </button>
              </div>
              <Show when={snapshot() !== null} fallback={
                <form class="brainstorm-section" onSubmit={e => { e.preventDefault(); start() }}>
                  <label class="brainstorm-label" for="brainstorm-theme">考えたいテーマ</label>
                  <textarea
                    id="brainstorm-theme"
                    rows={3}
                    maxlength={512}
                    value={theme()}
                    onInput={e => setTheme(e.currentTarget.value)}
                    placeholder="例：問い合わせの回答漏れをなくしたい"
                  />
                  <button class="btn btn-primary" type="submit" disabled={!theme().trim()}>
                    ブレストを始める
                  </button>
                </form>
              }>
                <section class="brainstorm-section" aria-label="ブレストの進行">
                  <strong class="brainstorm-theme">{snapshot()?.session.theme}</strong>
                  <p class="brainstorm-phase">段階：{snapshot() && BRAINSTORM_PHASE_LABELS[snapshot()!.session.phase]}</p>
                  <div class="button-row">
                    <button class="btn" type="button"
                      disabled={snapshot()?.session.phase === 'discover'}
                      onClick={() => move('backward')}>前の段階</button>
                    <button class="btn btn-primary" type="button"
                      disabled={snapshot()?.session.phase === 'act'}
                      onClick={() => move('forward')}>次の段階</button>
                  </div>
                </section>
                <section class="brainstorm-section" aria-label="思考を深める質問">
                  <h3>考えてみる質問</h3>
                  <Show when={question()} fallback={
                    <p class="brainstorm-muted">この段階の質問は一通り確認しました。新しい考えを追加するか、別の段階へ進めます。</p>
                  }>
                    <p class="brainstorm-prompt">{question()?.question}</p>
                    <button type="button" class="btn btn-small" onClick={skip}>次の質問を見る</button>
                  </Show>
                  <label class="brainstorm-label" for="brainstorm-thought">考えたこと・回答を記録</label>
                  <textarea
                    id="brainstorm-thought"
                    rows={4}
                    maxlength={4096}
                    value={thought()}
                    onInput={e => setThought(e.currentTarget.value)}
                    placeholder="思いついた内容を入力。事実と仮説は区別して記録しましょう。"
                  />
                  <button type="button" class="btn btn-primary" onClick={addThought}
                    disabled={!thought().trim()}>記録する</button>
                </section>
                <section class="brainstorm-section" aria-label="記録した考え">
                  <h3>記録した質問・回答・考え（{snapshot()?.nodes.length ?? 0}件）</h3>
                  <Show when={(snapshot()?.nodes.length ?? 0) > 0}
                    fallback={<p class="brainstorm-muted">まだ記録がありません。</p>}>
                    <ul class="brainstorm-thought-list">
                      <For each={snapshot()?.nodes ?? []}>
                        {node => <li>
                          <span class="brainstorm-kind">{node.kind}</span>
                          <div class="brainstorm-thought-text">
                            <Show when={answeredQuestion(node.id)}>
                              {prompt => <p class="brainstorm-related-question">回答先：{prompt()}</p>}
                            </Show>
                            <p>{node.text}</p>
                          </div>
                          <button type="button" class="btn btn-small" onClick={() => remove(node.id)}
                            aria-label={`「${node.text.slice(0,40)}」を削除`}>削除</button>
                        </li>}
                      </For>
                    </ul>
                  </Show>
                </section>
                <div class="button-row brainstorm-footer-actions">
                  <button type="button" class="btn" onClick={download}>JSONを書き出す</button>
                  <button type="button" class="btn" onClick={clear}>最初からやり直す</button>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
