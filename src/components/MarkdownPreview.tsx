import { createMemo, Match, Switch } from 'solid-js'
import { renderMarkdownPreview } from '../core/markdown/preview'

export function MarkdownPreview(props: { readonly text: string }) {
  const result = createMemo(() => renderMarkdownPreview(props.text))
  const html = () => {
    const current = result()
    return current.status === 'ready' ? current.html : ''
  }

  return (
    <section class="markdown-preview" aria-label="Markdownプレビュー" tabindex={0}>
      <div class="markdown-preview-note">読み取り専用・リンクと外部画像は無効</div>
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
        <Match when={result().status === 'ready'}>
          {/* Only fixed tags and escaped source from renderMarkdownPreview may enter this sink. */}
          <article class="markdown-preview-body" innerHTML={html()} />
        </Match>
      </Switch>
    </section>
  )
}
