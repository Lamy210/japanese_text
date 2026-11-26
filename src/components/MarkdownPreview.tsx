import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import { MAX_OUTLINE_HEADINGS, renderMarkdownPreview } from '../core/markdown/preview'

export function MarkdownPreview(props: { readonly text: string }) {
  const [outlineOpen, setOutlineOpen] = createSignal(false)
  let article: HTMLElement | undefined
  const result = createMemo(() => renderMarkdownPreview(props.text))
  const ready = () => {
    const current = result()
    return current.status === 'ready' ? current : undefined
  }

  const jumpToHeading = (index: number): void => {
    // The DOM order is the renderer's heading order; no source-controlled selector or anchor.
    const heading = article?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').item(index)
    if (!heading) return
    heading.tabIndex = -1
    heading.focus({ preventScroll: true })
    heading.scrollIntoView({ block: 'start' })
  }

  return (
    <section class="markdown-preview" aria-label="Markdownプレビュー" tabindex={0}>
      <div class="markdown-preview-tools">
        <span class="markdown-preview-note">読み取り専用・リンクと外部画像は無効</span>
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
          <article ref={article} class="markdown-preview-body" innerHTML={ready()?.html ?? ''} />
        </Match>
      </Switch>
    </section>
  )
}
