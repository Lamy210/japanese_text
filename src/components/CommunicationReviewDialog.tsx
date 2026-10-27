import { For, Show, createEffect, createSignal, untrack } from 'solid-js'
import type { ExplicitCommunicationAct } from '../core/communication/explicit-acts'
import {
  canNavigateToCommunicationAct,
  describeCommunicationAct,
  describeCommunicationSlot,
  isCommunicationReviewCurrent,
  reviewCurrentCommunication,
  type CommunicationReviewInput,
  type CommunicationReviewResult
} from '../core/communication/review'
import { jumpToPosition } from '../editor/editor-adapter'
import { appState } from '../state/app-state'
import './CommunicationReviewDialog.css'

interface CommunicationReviewDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

const SKIPPED_REASONS = {
  'missing-document': '文書の読み込み後に解析してください。',
  'invalid-input': '解析できない文書形式です。',
  'size-limit': '20万文字を超える文書は、この初期版では解析できません。',
  'result-limit': '検出件数が上限を超えたため、部分的な結果は表示しません。'
} as const

/** Explicit read-only communication analysis; completely separate from Lint. */
export function CommunicationReviewDialog(props: CommunicationReviewDialogProps) {
  const [result, setResult] = createSignal<CommunicationReviewResult | null>(null)
  let dialogRef: HTMLDivElement | undefined
  let closeButton: HTMLButtonElement | undefined

  const currentDocument = (): CommunicationReviewInput => ({
    workspaceId: appState.activeWorkspaceId() ?? null,
    documentId: appState.activeDocumentId() ?? null,
    revision: appState.revision(),
    text: appState.documentText(),
    documentType: appState.docType()
  })

  const analyze = (): void => { setResult(reviewCurrentCommunication(currentDocument())) }
  const snapshot = () => {
    const r = result()
    return r?.status === 'ready' ? r.snapshot : null
  }
  const slotsForAct = (act: ExplicitCommunicationAct) =>
    snapshot()?.slots.filter(slot =>
      slot.actStartUtf16 === act.startUtf16 &&
      slot.actEndUtf16 === act.endUtf16
    ) ?? []

  const isStale = () => {
    const s = snapshot()
    return s !== null && !isCommunicationReviewCurrent(s, currentDocument())
  }

  // Re-open -> fresh explicit snapshot; editing while open only marks it stale.
  createEffect(() => {
    if (!props.open) return
    untrack(analyze)
    queueMicrotask(() => closeButton?.focus())
  })

  const close = (): void => {
    props.onClose()
    queueMicrotask(() => document.getElementById('communication-review-toggle')?.focus())
  }

  const navigate = (act: ExplicitCommunicationAct): void => {
    const source = snapshot()
    if (!canNavigateToCommunicationAct(source, currentDocument(), act)) {
      appState.pushToast('warning', '解析後に本文または文書が変更されました。再解析してください。')
      return
    }
    props.onClose()
    // Select only after the modal has been removed from the focus order.
    queueMicrotask(() => jumpToPosition(act.startUtf16, act.endUtf16))
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab' || dialogRef === undefined) return
    const enabled = Array.from(dialogRef.querySelectorAll<HTMLElement>(
      'button:not([disabled])'
    ))
    const first = enabled[0]
    const last = enabled[enabled.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <Show when={props.open}>
      <div class="dialog-backdrop" onClick={e => e.target === e.currentTarget && close()}>
        <div
          ref={dialogRef}
          class="dialog communication-review-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="communication-review-title"
          onKeyDown={onKeyDown}
        >
          <div class="dialog-header">
            <h2 id="communication-review-title" class="dialog-title">質問・依頼の分析</h2>
            <button type="button" ref={closeButton} class="btn btn-icon"
              aria-label="質問分析を閉じる" onClick={close}>✕</button>
          </div>
          <div class="dialog-body communication-review-body">
            <p class="settings-note">
              原文をブラウザ内で解析します。明示的な質問・依頼だけを保守的に検出する初期版です。
              未検出は「問題なし」を意味せず、内容の正誤・期限・実際の回答完了までは判断しません。
              本文の変更・自動修正・外部送信・保存は行いません。
            </p>
            <div class="button-row">
              <button type="button" class="btn btn-primary" onClick={analyze}>現在の本文を再解析</button>
              <span class="communication-review-meta">
                {snapshot() !== null
                  ? `検出 ${snapshot()!.acts.length}件 / 文書revision ${snapshot()!.revision}`
                  : '未解析'}
              </span>
            </div>
            <Show when={isStale()}>
              <p class="communication-review-stale" role="status">
                解析後に本文または選択文書が変更されました。古い結果からの原文移動は無効です。再解析してください。
              </p>
            </Show>
            <Show when={result()?.status === 'skipped'}>
              <p class="communication-review-muted" role="status">
                {(() => {
                  const r = result()
                  return r?.status === 'skipped' ? SKIPPED_REASONS[r.reason] : ''
                })()}
              </p>
            </Show>
            <Show when={snapshot() !== null && snapshot()!.acts.length === 0}>
              <p class="communication-review-muted">明示表現は見つかりませんでした。ルールが対応していない表現は解析できません。</p>
            </Show>
            <ol class="communication-review-list">
              <For each={snapshot()?.acts ?? []}>
                {act => {
                  const details = describeCommunicationAct(act)
                  return (
                    <li class="communication-review-item">
                      <div class="communication-review-heading">
                        <strong>{details.intent}</strong>
                        <span class="communication-review-meta">{details.surfaceForm}</span>
                      </div>
                      <blockquote class="communication-review-evidence">{act.evidence}</blockquote>
                      <dl class="communication-review-fields">
                        <div><dt>期待される回答</dt><dd>{details.expectedAnswer}</dd></div>
                        <div><dt>完了判定</dt><dd>{details.completion}</dd></div>
                      </dl>
                      <Show when={slotsForAct(act).length > 0}>
                        <div class="communication-review-slot-list">
                          <strong>明示的な項目の候補</strong>
                          <For each={slotsForAct(act)}>
                            {slot => {
                              const detail = describeCommunicationSlot(slot)
                              return (
                                <div class="communication-review-slot">
                                  <span class="communication-review-slot-label">{detail.label}</span>
                                  <span class="communication-review-slot-evidence">{slot.evidence}</span>
                                  <small>{detail.caution}</small>
                                </div>
                              )
                            }}
                          </For>
                        </div>
                      </Show>
                      <div class="communication-review-actions">
                        <button type="button" class="btn btn-small"
                          onClick={() => navigate(act)}
                          disabled={isStale()}>
                          原文へ移動
                        </button>
                        <span class="communication-review-meta">
                          UTF-16 {act.startUtf16}–{act.endUtf16} / 明示ルール
                        </span>
                      </div>
                    </li>
                  )
                }}
              </For>
            </ol>
          </div>
        </div>
      </div>
    </Show>
  )
}
