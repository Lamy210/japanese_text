/**
 * AP-11b-2: bounded ZIP extraction, CRC-32 and Lindera v6 metadata validation.
 *
 * This is not a tokenizer or permission to redistribute an IPADIC dictionary.
 * Only pass verified archives from readVerifiedNlpArchive in production.
 */
import {
  inspectIpadicZip, type IpadicFile, type IpadicZipEntry
} from './ipadic-zip-inspector'
import {
  readVerifiedNlpArchive, type NlpArchiveSpec, type NlpArchiveOptions
} from './archive-installer'

const MAX_FILE_BYTES = 128 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_METADATA_BYTES = 64 * 1024
const CRC_POLYNOMIAL = 0xedb88320

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let value = i
  for (let j = 0; j < 8; j++) {
    value = (value >>> 1) ^ ((value & 1) === 1 ? CRC_POLYNOMIAL : 0)
  }
  crcTable[i] = value >>> 0
}

function updateCrc32(crc: number, chunk: Uint8Array): number {
  let value = crc >>> 0
  for (const byte of chunk) {
    value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]!
  }
  return value >>> 0
}

export type IpadicExtractFailure =
  | 'invalid-zip' | 'inflation-unavailable' | 'invalid-compression'
  | 'size-mismatch' | 'crc-mismatch' | 'invalid-metadata' | 'aborted'

export type IpadicExtractResult =
  | { readonly status: 'extracted'; readonly files: ReadonlyMap<IpadicFile, Uint8Array> }
  | { readonly status: 'invalid'; readonly reason: IpadicExtractFailure }

export type IpadicVerifiedExtractResult =
  | ({ readonly status: 'extracted'; readonly sha256: string } &
     Extract<IpadicExtractResult, {status: 'extracted'}>)
  | { readonly status: 'unavailable'; readonly reason: string }

class ExtractError extends Error {
  constructor(readonly reason: IpadicExtractFailure) {
    super(reason)
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExtractError('aborted')
}

function crc32(bytes: Uint8Array): number {
  return (updateCrc32(0xffffffff, bytes) ^ 0xffffffff) >>> 0
}

/**
 * Streams raw DEFLATE, enforcing the physical emitted byte count BEFORE
 * accumulating a chunk. A decompression bomb cannot bypass declared ZIP sizes.
 * Without browser-native raw DEFLATE support, fail closed.
 */
async function inflateRaw(
  compressed: Uint8Array,
  entry: IpadicZipEntry,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ExtractError('inflation-unavailable')
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = new Blob([new Uint8Array(compressed)])
      .stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  } catch {
    throw new ExtractError('inflation-unavailable')
  }
  const interrupt = (): void => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', interrupt, { once: true })
  let written = 0
  let crc = 0xffffffff
  const pieces: Uint8Array[] = []
  try {
    while (true) {
      checkAbort(signal)
      const { done, value } = await reader.read()
      checkAbort(signal)
      if (done) break
      if (value.byteLength > entry.uncompressedSize - written ||
          value.byteLength > MAX_FILE_BYTES - written) {
        throw new ExtractError('size-mismatch')
      }
      written += value.byteLength
      crc = updateCrc32(crc, value)
      pieces.push(value)
    }
    if (written !== entry.uncompressedSize) throw new ExtractError('size-mismatch')
    if (((crc ^ 0xffffffff) >>> 0) !== entry.crc32) {
      throw new ExtractError('crc-mismatch')
    }
    const all = new Uint8Array(written)
    let at = 0
    for (const part of pieces) {
      all.set(part, at)
      at += part.byteLength
    }
    return all
  } catch (error) {
    interrupt()
    if (error instanceof ExtractError) throw error
    throw new ExtractError(signal?.aborted ? 'aborted' : 'invalid-compression')
  } finally {
    signal?.removeEventListener('abort', interrupt)
    try { reader.releaseLock() } catch { /* already detached */ }
  }
}

function checkMetadata(metadata: Uint8Array): void {
  if (metadata.byteLength < 2 || metadata.byteLength > MAX_METADATA_BYTES) {
    throw new ExtractError('invalid-metadata')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata))
  } catch {
    throw new ExtractError('invalid-metadata')
  }
  // Lindera v6 dictionaries use format_version 2. Legacy v5 must not load.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).format_version !== 2) {
    throw new ExtractError('invalid-metadata')
  }
}

/**
 * Trusted caller must separately validate archive SHA-256. If ANY entry fails,
 * do not return a partially extracted dictionary. Never persist ZIP entries.
 */
export async function extractIpadicZipContents(
  archive: Uint8Array,
  signal?: AbortSignal
): Promise<IpadicExtractResult> {
  try {
    checkAbort(signal)
    const inspected = inspectIpadicZip(archive)
    if (inspected.status !== 'valid') throw new ExtractError('invalid-zip')
    const files = new Map<IpadicFile, Uint8Array>()
    let emitted = 0
    for (const entry of inspected.index.entries) {
      checkAbort(signal)
      if (entry.uncompressedSize > MAX_FILE_BYTES ||
          entry.uncompressedSize > MAX_TOTAL_BYTES - emitted) {
        throw new ExtractError('size-mismatch')
      }
      const data = archive.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)
      let uncompressed: Uint8Array
      if (entry.method === 'stored') {
        if (entry.uncompressedSize !== data.byteLength) throw new ExtractError('size-mismatch')
        if (crc32(data) !== entry.crc32) throw new ExtractError('crc-mismatch')
        uncompressed = new Uint8Array(data)
      } else {
        uncompressed = await inflateRaw(data, entry, signal)
      }
      emitted += uncompressed.byteLength
      files.set(entry.name, uncompressed)
    }
    checkAbort(signal)
    checkMetadata(files.get('metadata.json')!)
    return { status: 'extracted', files }
  } catch (error) {
    const reason = error instanceof ExtractError
      ? error.reason
      : signal?.aborted ? 'aborted' : 'invalid-compression'
    return { status: 'invalid', reason }
  }
}

/**
 * Complete integrity boundary: re-verify OPFS SHA + archive index +
 * streamed size/CRC + metadata format before exposing file buffers.
 */
export async function extractVerifiedIpadicArchive(
  spec: NlpArchiveSpec,
  options: NlpArchiveOptions = {}
): Promise<IpadicVerifiedExtractResult> {
  const loaded = await readVerifiedNlpArchive(spec, options)
  if (loaded.status !== 'ready') {
    return { status: 'unavailable', reason: loaded.reason }
  }
  const result = await extractIpadicZipContents(loaded.bytes, options.signal)
  if (result.status !== 'extracted') {
    return { status: 'unavailable', reason: result.reason }
  }
  return { status: 'extracted', sha256: loaded.sha256, files: result.files }
}
