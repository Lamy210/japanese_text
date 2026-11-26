import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js'
import { MAX_OUTLINE_HEADINGS, renderMarkdownPreview } from '../core/markdown/preview'
import { normalizePreviewSource, previewBlockAtOffset, resolvePreviewSourceRange } from '../core/markdown/source-map'
import { getEditorView, jumpToPosition } from '../editor/editor-adapter'
import { appState } from '../state/app-state'

export function MarkdownPreview(props: { readonly text: string; readonly cursor: number; readonly editorVisible: boolean }) {
  const [outlineOpen, setOutlineOpen] = createSignal(false)
  const [followCursor, setFollowCursor] = createSignal(false)
  let article: HTMLElement | undefined
  let pane: HTMLElement | undefined
  // Bind the source and context to the same synchronous rendering snapshot.
  const snapshot = createMemo(() => ({
    text: props.text,
    workspaceId: appState.activeWorkspaceId(),
    documentId: appState.activeDocumentId(),
    revision: appState.revision(),
    result: renderMarkdownPreview(props.text)
  }))
  const result = () => snapshot().result
  const ready = () => {
    const current = result()
    return current.status === 'ready' ? current : undefined
  }

  const jumpToSource = (index: number): void => {
    const current = snapshot()
    const view = getEditorView()
    if (!view || current.result.status !== 'ready' ||
        current.workspaceId !== appState.activeWorkspaceId() ||
        current.documentId !== appState.activeDocumentId() ||
        current.revision !== appState.revision() ||
        current.text !== appState.documentText()) return
    const range = resolvePreviewSourceRange(current.text, view.state.doc.toString(), current.result.sourceBlocks, index)
    if (range) jumpToPosition(range.from, range.from)
  }

  // Defer reading the DOM until Solid has applied the current preview HTML.
  createEffect(() => {
    const current = snapshot()
    const cursor = props.cursor
    if (!followCursor() || !props.editorVisible || current.result.status !== 'ready') return
    const index = previewBlockAtOffset(current.result.sourceBlocks, cursor)
    if (index === undefined) return
    const frame = requestAnimationFrame(() => {
      if (snapshot() !== current || !followCursor() || !props.editorVisible) return
      const view = getEditorView()
      if (!view || normalizePreviewSource(current.text) !== view.state.doc.toString()) return
      const block = article?.querySelector<HTMLElement>('[data-md-block="' + index + '"]')
      if (!block || !pane) return
      const bounds = pane.getBoundingClientRect()
      const rect = block.getBoundingClientRect()
      if (rect.top < bounds.top || rect.bottom > bounds.bottom) {
        pane.scrollTop += rect.top - bounds.top - 12
      }
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })

  const jumpToHeading = (index: number): void => {
    // The DOM order is the renderer's heading order; no source-controlled selector or anchor.
    const heading = article?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').item(index)
    if (!heading) return
    heading.tabIndex = -1
    heading.focus({ preventScroll: true })
    heading.scrollIntoView({ block: 'start' })
  }

  return (
    <section ref={pane} class="markdown-preview" aria-label="Markdownプレビュー" tabindex={0}>
      <div class="markdown-preview-tools">
        <span class="markdown-preview-note">読み取り専用・リンクと外部画像は無効。ブロックをダブルクリックすると原文へ移動します。</span>
        <Show when={props.editorVisible}>
          <button type="button" class="btn btn-small" aria-pressed={followCursor()} onClick={() => setFollowCursor(value => !value)}>カーソル追従</button>
        </Show>
        <Show when={(ready()?.headingCount ?? 0) > 0}>
          <button type="button" class="btn btn-small" aria-expanded={outlineOpen()} onClick={() => setOutlineOpen(value => !value)}>アウトライン ({ready()?.headingCount})</button>
        </Show>
      </div>
      <Switch>
        <Match when={result().status === 'too-large'}>
          <p role="status">文書が長いためプレビューを停止しました（上限20万UTF-16コード単位）。編集は継続できます。</p>
        </Match>
        <Match when={result().status === 'failed'}>
          <p role="status">プレビューを描画できませんでした。編集は継続できます。</p>
        </Match>
        <Match when={props.text.trim().length === 0}>
          <p class="markdown-preview-note">Markdownを入力するとここに表示されます。</p>
        </Match>
        <Match when={ready()}>
          <Show when={outlineOpen() && (ready()?.headingCount ?? 0) > 0}>
            <nav class="markdown-outline" aria-label="Markdown見出し一覧">
              <ul>
                <For each={ready()?.headings ?? []}>{heading => (
                  <li class={`markdown-outline-level-${heading.level}`}>
                    <button type="button" onClick={() => jumpToHeading(heading.index)}>{heading.label}</button>
                  </li>
                )}</For>
              </ul>
              <Show when={(ready()?.headingCount ?? 0) > MAX_OUTLINE_HEADINGS}>
                <p class="markdown-preview-note">先頭{MAX_OUTLINE_HEADINGS}件の見出しを表示しています。</p>
              </Show>
            </nav>
          </Show>
          {/* Only fixed tags and escaped source from renderMarkdownPreview may enter this sink. */}
          <article ref={article} class="markdown-preview-body" innerHTML={ready()?.html ?? ''}
            onDblClick={event => {
              const target = event.target
              if (!(target instanceof Element)) return
              const block = target.closest<HTMLElement>('[data-md-block]')
              if (!block || !article?.contains(block)) return
              const index = block.dataset.mdBlock
              if (index !== undefined && /^\d+$/.test(index)) jumpToSource(Number(index))
            }} />
          <Show when={(ready()?.sourceBlocks.length ?? 0) > 0}>
            <label class="markdown-source-jump">
              原文へ移動
              <select aria-label="原文へ移動するブロック" value="" onChange={event => {
                const value = event.currentTarget.value
                if (value !== '') jumpToSource(Number(value))
                event.currentTarget.value = ''
              }}>
                <option value="">ブロックを選択</option>
                <For each={ready()?.sourceBlocks.slice(0, 300) ?? []}>{(block, index) => (
                  <option value={index()}>{index() + 1}. {normalizePreviewSource(props.text).slice(block.from, Math.min(block.to, block.from + 40)).replace(/\s+/g, ' ')}</option>
                )}</For>
              </select>
              <Show when={(ready()?.sourceBlocks.length ?? 0) > 300}><span>先頭300ブロック</span></Show>
            </label>
          </Show>
        </Match>
      </Switch>
    </section>
  )
}
