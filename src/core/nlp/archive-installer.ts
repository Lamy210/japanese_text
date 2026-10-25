/**
 * AP-11a: opt-in, same-origin, SHA-pinned NLP dictionary archive installer.
 *
 * ArchiveSpec must be compiled/reviewed first-party metadata, never a
 * manifest returned by the remote server. No ZIP unpacking or WASM execution.
 * OPFS stores no user document content or private user dictionaries.
 */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_ASSET_ID = /^[a-z][a-z0-9-]{0,63}$/u
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const SHA = /^[0-9a-f]{64}$/u
const BASE_PATH = /^\/(?:[a-zA-Z0-9_-]+\/)*$/u
const LICENSE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/u
const ARCHIVE_ROOT = 'japanese-text-nlp-dictionaries'

export interface NlpArchiveSpec {
  readonly schemaVersion: 1
  readonly providerId: 'lindera-ipadic'
  readonly assetId: string
  readonly version: string
  readonly byteLength: number
  readonly sha256: string
  /** A maintainer-reviewed license ID. This value alone is not a license audit. */
  readonly licenseId: string
  readonly licenseReview: 'approved'
}

export interface NlpArchiveOptions {
  readonly basePath?: string
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly getRoot?: () => Promise<FileSystemDirectoryHandle>
  /** Injection point for tests; production requires Web Locks (cross-tab exclusivity). */
  readonly withExclusiveLock?: <T>(key: string, work: () => Promise<T>) => Promise<T>
}

export type NlpArchiveInstallResult =
  | { readonly status: 'installed' | 'already-installed'; readonly sha256: string }
  | { readonly status: 'unavailable'; readonly reason: 'invalid-spec' | 'aborted' | 'fetch' | 'digest' | 'storage' }

export type NlpArchiveReadResult =
  | { readonly status: 'ready'; readonly bytes: Uint8Array; readonly sha256: string }
  | { readonly status: 'unavailable'; readonly reason: 'invalid-spec' | 'aborted' | 'storage' | 'not-installed' | 'digest' }

class ArchiveError extends Error {
  constructor(readonly reason: 'invalid-spec' | 'aborted' | 'fetch' | 'digest' | 'storage' | 'not-installed') {
    super(reason)
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ArchiveError('aborted')
}

function validateSpec(raw: NlpArchiveSpec): NlpArchiveSpec {
  if (raw === null || typeof raw !== 'object' || raw.schemaVersion !== 1 ||
      raw.providerId !== 'lindera-ipadic' || typeof raw.assetId !== 'string' ||
      !MAX_ASSET_ID.test(raw.assetId) || typeof raw.version !== 'string' ||
      !VERSION.test(raw.version) ||
      !Number.isSafeInteger(raw.byteLength) || raw.byteLength < 1 ||
      raw.byteLength > MAX_ARCHIVE_BYTES || typeof raw.sha256 !== 'string' ||
      !SHA.test(raw.sha256) || typeof raw.licenseId !== 'string' ||
      !LICENSE.test(raw.licenseId) || raw.licenseReview !== 'approved' ||
      Object.keys(raw).some(key => ![
        'schemaVersion', 'providerId', 'assetId', 'version', 'byteLength',
        'sha256', 'licenseId', 'licenseReview'
      ].includes(key))) {
    throw new ArchiveError('invalid-spec')
  }
  return { ...raw }
}

function archiveUrl(spec: NlpArchiveSpec, basePath: string): URL {
  const origin = typeof location !== 'undefined' ? location.origin : ''
  if (!/^https?:\/\/[^/]+$/u.test(origin) || !BASE_PATH.test(basePath)) {
    throw new ArchiveError('invalid-spec')
  }
  const root = new URL(basePath, origin)
  const path = 'nlp-dictionaries/' + spec.providerId + '/' + spec.version + '/' + spec.assetId + '.zip'
  const url = new URL(path, root)
  if (url.origin !== origin || !url.pathname.startsWith(root.pathname)) {
    throw new ArchiveError('invalid-spec')
  }
  return url
}

async function digest(bytes: Uint8Array): Promise<string> {
  // The digest input must never be backed by SharedArrayBuffer.
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', owned))
  return Array.from(hash, x => x.toString(16).padStart(2, '0')).join('')
}

async function verify(bytes: Uint8Array, spec: NlpArchiveSpec): Promise<void> {
  if (bytes.byteLength !== spec.byteLength || await digest(bytes) !== spec.sha256) {
    throw new ArchiveError('digest')
  }
}

async function boundedBytes(response: Response, spec: NlpArchiveSpec, signal?: AbortSignal): Promise<Uint8Array> {
  if (!response.ok || response.status !== 200 || response.redirected || !response.body) {
    throw new ArchiveError('fetch')
  }
  const declared = response.headers.get('content-length')
  if (declared !== null &&
      (!/^\d+$/u.test(declared) || Number(declared) !== spec.byteLength)) {
    throw new ArchiveError('digest')
  }
  const reader = response.body.getReader()
  const stop = (): void => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', stop, { once: true })
  let total = 0
  const parts: Uint8Array[] = []
  try {
    while (true) {
      checkAbort(signal)
      const { done, value } = await reader.read()
      checkAbort(signal)
      if (done) break
      total += value.byteLength
      if (total > spec.byteLength) throw new ArchiveError('digest')
      parts.push(value)
    }
    if (total !== spec.byteLength) throw new ArchiveError('digest')
    const all = new Uint8Array(total)
    let cursor = 0
    for (const part of parts) {
      all.set(part, cursor)
      cursor += part.byteLength
    }
    return all
  } catch (error) {
    stop()
    throw error
  } finally {
    signal?.removeEventListener('abort', stop)
    reader.releaseLock()
  }
}

async function loadArchive(spec: NlpArchiveSpec, options: NlpArchiveOptions): Promise<Uint8Array> {
  checkAbort(options.signal)
  const url = archiveUrl(spec, options.basePath ?? import.meta.env.BASE_URL)
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(url.href, {
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal: options.signal
    })
  } catch {
    checkAbort(options.signal)
    throw new ArchiveError('fetch')
  }
  if (response.url && response.url !== url.href) throw new ArchiveError('fetch')
  const bytes = await boundedBytes(response, spec, options.signal)
  await verify(bytes, spec)
  checkAbort(options.signal)
  return bytes
}

async function withLock<T>(spec: NlpArchiveSpec, options: NlpArchiveOptions, work: () => Promise<T>): Promise<T> {
  const name = 'japanese-text-ap11:' + spec.providerId + ':' + spec.assetId + ':' + spec.version
  if (options.withExclusiveLock) return options.withExclusiveLock(name, work)
  if (typeof navigator === 'undefined' || !navigator.locks) throw new ArchiveError('storage')
  return navigator.locks.request(name, { mode: 'exclusive', signal: options.signal }, work)
}

async function directory(options: NlpArchiveOptions, spec: NlpArchiveSpec): Promise<FileSystemDirectoryHandle> {
  const root = await (options.getRoot ??
    (() => {
      if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
        throw new ArchiveError('storage')
      }
      return navigator.storage.getDirectory()
    }))()
  let dir = root
  for (const part of [ARCHIVE_ROOT, spec.providerId, spec.assetId, spec.version]) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  return dir
}

async function removeQuietly(dir: FileSystemDirectoryHandle, file: string): Promise<void> {
  try { await dir.removeEntry(file) } catch { /* may not exist */ }
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true })
  const stream = await handle.createWritable({ keepExistingData: false })
  try {
    await stream.write(new Blob([new Uint8Array(bytes)]))
    await stream.close()
  } catch (error) {
    try { await stream.abort() } catch { /* already closed */ }
    throw error
  }
}

async function readFile(dir: FileSystemDirectoryHandle, name: string, maxBytes: number): Promise<Uint8Array | null> {
  try {
    const handle = await dir.getFileHandle(name)
    const file = await handle.getFile()
    if (file.size > maxBytes) return null
    return new Uint8Array(await file.arrayBuffer())
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

async function committedBytes(dir: FileSystemDirectoryHandle, spec: NlpArchiveSpec): Promise<Uint8Array | null> {
  // A marker is published LAST; incomplete .partial or .zip files are not ready.
  const marker = await readFile(dir, spec.sha256 + '.ready', 100)
  if (marker === null || new TextDecoder().decode(marker) !== spec.sha256) return null
  const bytes = await readFile(dir, spec.sha256 + '.zip', spec.byteLength)
  if (bytes === null) return null
  await verify(bytes, spec)
  return bytes
}

function classify(error: unknown): Extract<NlpArchiveInstallResult, {status: 'unavailable'}>['reason'] {
  if (error instanceof ArchiveError) {
    return error.reason === 'not-installed' ? 'storage' : error.reason
  }
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
  // Fail closed on quota, OPFS, WebCrypto, lock and other unsupported environments.
  return 'storage'
}

/**
 * Explicit opt-in installer. Never auto-download, and never publish a ready
 * marker for a partial or mismatched payload. The old SHA/version remains
 * intact when a new archive fails to download or install.
 */
export async function installVerifiedNlpArchive(
  raw: NlpArchiveSpec,
  options: NlpArchiveOptions = {}
): Promise<NlpArchiveInstallResult> {
  try {
    const spec = validateSpec(raw)
    return await withLock(spec, options, async () => {
      checkAbort(options.signal)
      const dir = await directory(options, spec)
      try {
        if (await committedBytes(dir, spec) !== null) {
          return { status: 'already-installed', sha256: spec.sha256 } as const
        }
      } catch { /* damaged existing archive is not trusted */ }
      const bytes = await loadArchive(spec, options)
      const partial = spec.sha256 + '.partial'
      try {
        await writeFile(dir, partial, bytes)
        const staged = await readFile(dir, partial, spec.byteLength)
        if (staged === null) throw new ArchiveError('digest')
        await verify(staged, spec)
        checkAbort(options.signal)
        await writeFile(dir, spec.sha256 + '.zip', staged)
        const installed = await readFile(dir, spec.sha256 + '.zip', spec.byteLength)
        if (installed === null) throw new ArchiveError('digest')
        await verify(installed, spec)
        checkAbort(options.signal)
        // Last commit operation; never write a marker before persisted bytes verify.
        await writeFile(dir, spec.sha256 + '.ready', new TextEncoder().encode(spec.sha256))
        return { status: 'installed', sha256: spec.sha256 } as const
      } catch (error) {
        // Failed new version is not visible; old versions are kept untouched.
        await removeQuietly(dir, spec.sha256 + '.ready')
        throw error
      } finally {
        await removeQuietly(dir, partial)
      }
    })
  } catch (error) {
    return { status: 'unavailable', reason: classify(error) }
  }
}

/** Verify the full SHA again when loading from OPFS, not just the ready marker. */
export async function readVerifiedNlpArchive(
  raw: NlpArchiveSpec,
  options: NlpArchiveOptions = {}
): Promise<NlpArchiveReadResult> {
  try {
    const spec = validateSpec(raw)
    return await withLock(spec, options, async () => {
      checkAbort(options.signal)
      const dir = await directory(options, spec)
      const marker = await readFile(dir, spec.sha256 + '.ready', 100)
      if (marker === null || new TextDecoder().decode(marker) !== spec.sha256) {
        return { status: 'unavailable', reason: 'not-installed' } as const
      }
      const bytes = await readFile(dir, spec.sha256 + '.zip', spec.byteLength)
      if (bytes === null) return { status: 'unavailable', reason: 'digest' } as const
      await verify(bytes, spec)
      checkAbort(options.signal)
      return { status: 'ready', bytes, sha256: spec.sha256 } as const
    })
  } catch (error) {
    const reason = classify(error)
    return { status: 'unavailable', reason: reason === 'fetch' ? 'storage' : reason }
  }
}
