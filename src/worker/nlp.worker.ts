/// <reference lib="webworker" />
/**
 * Dedicated NLP Worker entrypoint (AP-10).
 *
 * Deliberately fail-closed until an explicitly opted-in, SHA-verified local
 * provider/dictionary adapter has been implemented (AP-11/12).
 * A successful Worker startup is NOT a successful linguistic analysis.
 */
import type { NlpAnalyzeRequest, NlpWorkerResponse } from '../core/nlp/worker-protocol'

const context = self as unknown as DedicatedWorkerGlobalScope

context.addEventListener('message', (event: MessageEvent<NlpAnalyzeRequest>) => {
  const request = event.data
  if (request?.type !== 'analyze' || !request.identity || !request.identity.snapshot) return
  const code: Extract<NlpWorkerResponse, {type: 'error'}>['code'] =
    typeof request.text === 'string' &&
    request.text.length === request.identity.snapshot.sourceUtf16Length
      ? 'provider-unavailable' : 'invalid-request'
  context.postMessage({ type: 'error', identity: request.identity, code } satisfies NlpWorkerResponse)
})
