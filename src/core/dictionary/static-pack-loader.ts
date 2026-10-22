/**
 * Phase 6B-3: optional, same-origin static dictionary reader.
 *
 * Merely importing this module performs no network requests. The existing
 * Fast typo rule continues to use the reviewed in-memory dictionary; callers
 * must explicitly request a load and decide whether to use its result.
 */
import { CURATED_TYPO_MANIFEST } from './curated-typos'
import {
  MAX_TYPO_PACK_BYTES,
  validateDictionaryAssetIndex,
  verifyCuratedTypoPackBytes,
  type CuratedTypoPackV1
} from './pack-codec'

const MAX_INDEX_BYTES = 16 * 1024
const BASE_PATH = /^\/(?:[A-Za-z0-9_-]+\/)*$/u

export type StaticDictionaryLoadResult =
  | { readonly status: 'ready'; readonly pack: CuratedTypoPackV1 }
  | { readonly status: 'unavailable'; readonly reason: 'aborted' | 'invalid-base' | 'fetch' | 'invalid-asset' }

export interface StaticDictionaryLoadOptions {
  readonly signal?: AbortSignal
  /** Trusted build base path; defaults to the Vite deployment base. */
  readonly basePath?: string
  /** Dependency injection for tests; never take this value from untrusted data. */
  readonly fetcher?: typeof fetch
}

function errorReason(error: unknown, signal?: AbortSignal): 'aborted' | 'fetch' | 'invalid-asset' {
  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return 'aborted'
  if (error instanceof Error && /^(?:Invalid dictionary|Dictionary asset)/u.test(error.message)) return 'invalid-asset'
  return 'fetch'
}

/** Read at most maxBytes before allocating and concatenating a verified body. */
async function readBounded(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!response.ok || response.status !== 200 || response.redirected) {
    throw new Error('Invalid dictionary response')
  }
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader !== null && (!/^\d+$/u.test(lengthHeader) || Number(lengthHeader) > maxBytes)) {
    throw new Error('Invalid dictionary content length')
  }
  if (!response.body) throw new Error('Invalid dictionary response body')
  const reader = response.body.getReader()
  // Fetch signals normally cancel the body, but a stalled/custom stream may
  // leave reader.read() pending. Cancel its reader explicitly on abort.
  const cancelPendingRead = (): void => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', cancelPendingRead, { once: true })
  const pieces: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      // Cancellation may resolve the pending read with done: true.
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('Invalid dictionary asset size')
      pieces.push(value)
    }
  } catch (error) {
    // Do not wait for a broken stream's asynchronous cancel algorithm.
    cancelPendingRead()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancelPendingRead)
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let cursor = 0
  for (const part of pieces) {
    result.set(part, cursor)
    cursor += part.byteLength
  }
  return result
}

export async function loadBundledCuratedTypoPack(
  options: StaticDictionaryLoadOptions = {}
): Promise<StaticDictionaryLoadResult> {
  if (options.signal?.aborted) return { status: 'unavailable', reason: 'aborted' }
  const basePath = options.basePath ?? import.meta.env.BASE_URL
  const origin = globalThis.location?.origin
  if (!origin || !origin.startsWith('https://') && !origin.startsWith('http://') ||
      !BASE_PATH.test(basePath)) {
    return { status: 'unavailable', reason: 'invalid-base' }
  }
  const directory = `dictionaries/${CURATED_TYPO_MANIFEST.packId}/${CURATED_TYPO_MANIFEST.version}/`
  const base = new URL(basePath, origin)
  const indexUrl = new URL(directory + 'index.json', base)
  const packUrl = new URL(directory + 'pack.json', base)
  if (indexUrl.origin !== origin || packUrl.origin !== origin ||
      !indexUrl.pathname.startsWith(base.pathname) || !packUrl.pathname.startsWith(base.pathname)) {
    return { status: 'unavailable', reason: 'invalid-base' }
  }
  const fetcher = options.fetcher ?? fetch
  try {
    const settings: RequestInit = {
      credentials: 'omit',
      redirect: 'error',
      cache: 'force-cache',
      signal: options.signal
    }
    const indexResponse = await fetcher(indexUrl.href, settings)
    if (indexResponse.url && indexResponse.url !== indexUrl.href) throw new Error('Invalid dictionary response URL')
    const indexBytes = await readBounded(indexResponse, MAX_INDEX_BYTES, options.signal)
    let decodedIndex: unknown
    try {
      decodedIndex = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(indexBytes)) as unknown
    } catch {
      throw new Error('Invalid dictionary index JSON')
    }
    const index = validateDictionaryAssetIndex(decodedIndex)
    if (index.packId !== CURATED_TYPO_MANIFEST.packId ||
        index.version !== CURATED_TYPO_MANIFEST.version) {
      throw new Error('Invalid dictionary index identity')
    }
    const packResponse = await fetcher(packUrl.href, settings)
    if (packResponse.url && packResponse.url !== packUrl.href) throw new Error('Invalid dictionary response URL')
    const packBytes = await readBounded(packResponse, MAX_TYPO_PACK_BYTES, options.signal)
    const pack = await verifyCuratedTypoPackBytes(packBytes, index)
    // A user may cancel while SHA-256 verification is in progress.
    if (options.signal?.aborted) return { status: 'unavailable', reason: 'aborted' }
    return { status: 'ready', pack }
  } catch (error) {
    return { status: 'unavailable', reason: errorReason(error, options.signal) }
  }
}
