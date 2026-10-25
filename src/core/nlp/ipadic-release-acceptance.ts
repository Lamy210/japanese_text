/**
 * AP-11b offline acceptance gate for a maintainer-supplied Lindera release.
 *
 * No network requests, no dictionary redistribution, no tokenizer activation.
 * A passing result is a byte/ZIP/CRC/metadata test, NOT a license approval.
 */
import { extractIpadicZipContents, type IpadicExtractFailure } from './ipadic-zip-extractor'
import type { IpadicFile } from './ipadic-zip-inspector'

export interface IpadicReleaseCandidate {
  readonly releaseTag: string
  readonly assetName: string
  readonly byteLength: number
  readonly sha256: string
}

/** Pinned to upstream GitHub Release v6.2.0; license review remains pending. */
export const LINDERA_IPADIC_V620_CANDIDATE: Readonly<IpadicReleaseCandidate> =
  Object.freeze({
    releaseTag: 'v6.2.0',
    assetName: 'lindera-ipadic-6.2.0.zip',
    byteLength: 10_519_550,
    sha256: '5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72'
  })

export interface IpadicReleaseFileSummary {
  readonly name: IpadicFile
  readonly byteLength: number
}

export type IpadicReleaseAcceptance =
  | {
      readonly status: 'passed'
      readonly releaseTag: string
      readonly sha256: string
      readonly files: readonly IpadicReleaseFileSummary[]
      readonly totalUncompressedBytes: number
      /** Intentionally never implies distribution or tokenizer permission. */
      readonly licenseReview: 'pending'
    }
  | {
      readonly status: 'rejected'
      readonly reason: 'invalid-pin' | 'size-mismatch' | 'sha256-mismatch' |
        'digest-unavailable' | 'aborted' | 'invalid-archive'
      readonly detail?: IpadicExtractFailure
    }

const SHA256 = /^[0-9a-f]{64}$/u
const RELEASE_TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const ASSET_NAME = /^lindera-ipadic-(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.zip$/u
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

function validPin(pin: IpadicReleaseCandidate): boolean {
  return !!pin && typeof pin === 'object' &&
    typeof pin.releaseTag === 'string' && RELEASE_TAG.test(pin.releaseTag) &&
    typeof pin.assetName === 'string' && ASSET_NAME.test(pin.assetName) &&
    pin.assetName === 'lindera-ipadic-' + pin.releaseTag.slice(1) + '.zip' &&
    Number.isSafeInteger(pin.byteLength) &&
    pin.byteLength > 0 && pin.byteLength <= MAX_ARCHIVE_BYTES &&
    typeof pin.sha256 === 'string' && SHA256.test(pin.sha256)
}

/**
 * Checks an already-local, explicitly supplied ZIP.
 *
 * Snapshot first: an asynchronously mutated caller-owned Uint8Array must not
 * be able to change bytes between SHA-256 verification and ZIP extraction.
 * Neither the archive nor any extracted dictionary bytes are returned.
 */
export async function inspectOfflineIpadicRelease(
  raw: Uint8Array,
  pin: IpadicReleaseCandidate = LINDERA_IPADIC_V620_CANDIDATE,
  signal?: AbortSignal
): Promise<IpadicReleaseAcceptance> {
  if (!validPin(pin)) return { status: 'rejected', reason: 'invalid-pin' }
  if (!(raw instanceof Uint8Array) || raw.byteLength !== pin.byteLength) {
    return { status: 'rejected', reason: 'size-mismatch' }
  }
  if (signal?.aborted) return { status: 'rejected', reason: 'aborted' }

  const snapshot = new Uint8Array(raw)
  let actualHash: Uint8Array
  try {
    actualHash = new Uint8Array(await crypto.subtle.digest('SHA-256', snapshot))
  } catch {
    return { status: 'rejected', reason: signal?.aborted ? 'aborted' : 'digest-unavailable' }
  }
  if (signal?.aborted) return { status: 'rejected', reason: 'aborted' }
  const hex = Array.from(actualHash, x => x.toString(16).padStart(2, '0')).join('')
  if (hex !== pin.sha256) return { status: 'rejected', reason: 'sha256-mismatch' }

  const result = await extractIpadicZipContents(snapshot, signal)
  if (result.status === 'invalid') {
    return result.reason === 'aborted'
      ? { status: 'rejected', reason: 'aborted' }
      : { status: 'rejected', reason: 'invalid-archive', detail: result.reason }
  }
  const files = Array.from(result.files, ([name, contents]) =>
    Object.freeze({ name, byteLength: contents.byteLength }))
  const totalUncompressedBytes = files.reduce((sum, entry) => sum + entry.byteLength, 0)
  return {
    status: 'passed',
    releaseTag: pin.releaseTag,
    sha256: hex,
    files: Object.freeze(files),
    totalUncompressedBytes,
    licenseReview: 'pending'
  }
}
