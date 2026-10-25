/**
 * AP-11b (stage 1): inspect the structure of a SHA-pinned Lindera IPADIC ZIP
 * without extracting it or initializing WASM. A valid ZIP index is NOT a
 * validated linguistic dictionary or authorization to redistribute it.
 *
 * Caller MUST first verify SHA-256 through readVerifiedNlpArchive().
 */
import {
  readVerifiedNlpArchive,
  type NlpArchiveSpec,
  type NlpArchiveOptions
} from './archive-installer'

const MAX_ZIP_BYTES = 64 * 1024 * 1024
const MAX_ENTRY_BYTES = 128 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 512
const REQUIRED = [
  'metadata.json', 'dict.trie', 'dict.valsidx', 'dict.vals',
  'dict.wordsidx', 'dict.words', 'matrix.mtx', 'char_def.bin', 'unk.bin'
] as const
export type IpadicFile = typeof REQUIRED[number]
const requiredSet: ReadonlySet<string> = new Set<string>(REQUIRED)
const ALLOWED_FLAGS = 0x080e // UTF-8, descriptor, deflate-option bits
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

export interface IpadicZipEntry {
  readonly name: IpadicFile
  readonly zipPath: string
  readonly method: 'stored' | 'deflate'
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly crc32: number
  readonly dataOffset: number
}

export interface IpadicZipIndex {
  readonly entries: readonly IpadicZipEntry[]
  readonly totalUncompressedBytes: number
}

export type IpadicZipInspection =
  | { readonly status: 'valid'; readonly index: IpadicZipIndex }
  | { readonly status: 'invalid'; readonly reason: string }

function invalid(reason: string): IpadicZipInspection {
  return { status: 'invalid', reason }
}

function range(size: number, offset: number, length: number): boolean {
  return Number.isSafeInteger(offset) && Number.isSafeInteger(length) &&
    offset >= 0 && length >= 0 && offset <= size && length <= size - offset
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function asciiPath(bytes: Uint8Array, offset: number, length: number): string | null {
  if (!range(bytes.byteLength, offset, length) || length < 1 || length > 128) return null
  const raw = bytes.subarray(offset, offset + length)
  if (raw.some(byte => byte < 0x20 || byte > 0x7e || byte === 0x5c)) return null
  return new TextDecoder('ascii').decode(raw)
}

/** Reject malformed extra fields and ZIP64, even when 32-bit fields look valid. */
function validExtras(view: DataView, offset: number, length: number): boolean {
  if (!range(view.byteLength, offset, length)) return false
  let cursor = offset
  const end = offset + length
  while (cursor < end) {
    if (end - cursor < 4) return false
    const id = view.getUint16(cursor, true)
    const bytes = view.getUint16(cursor + 2, true)
    if (id === 1 || bytes > end - cursor - 4) return false
    cursor += 4 + bytes
  }
  return cursor === end
}

/** Small, fail-closed central-directory inspector. No decompression is done. */
export function inspectIpadicZip(bytes: Uint8Array): IpadicZipInspection {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ZIP_BYTES || bytes.byteLength < 22) {
    return invalid('size')
  }
  const view = viewOf(bytes)
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)

  // EOCD comments are bounded to 64 KiB. Reject appended data or multipart ZIPs.
  let eocd = -1
  for (let pos = bytes.byteLength - 22; pos >= Math.max(0, bytes.byteLength - 22 - 0xffff); pos--) {
    if (u32(pos) === EOCD_SIGNATURE && pos + 22 + u16(pos + 20) === bytes.byteLength) {
      eocd = pos
      break
    }
  }
  if (eocd < 0) return invalid('end-record')
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 ||
      u16(eocd + 8) !== u16(eocd + 10)) return invalid('multi-disk')
  const count = u16(eocd + 10)
  const centralSize = u32(eocd + 12)
  const centralOffset = u32(eocd + 16)
  if (count < REQUIRED.length || count > REQUIRED.length + 1 ||
      count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff ||
      !range(bytes.byteLength, centralOffset, centralSize) ||
      centralOffset + centralSize !== eocd) return invalid('central-directory')

  const found = new Map<string, IpadicZipEntry>()
  let cursor = centralOffset
  let totalBytes = 0
  let prefix: string | undefined
  const localRanges: Array<{start: number; end: number}> = []
  let directoryEntries = 0
  let directoryPath: string | undefined
  for (let i = 0; i < count; i++) {
    if (!range(eocd, cursor, 46) || u32(cursor) !== CENTRAL_SIGNATURE) {
      return invalid('central-entry')
    }
    const madeBy = u16(cursor + 4)
    const flags = u16(cursor + 8)
    const method = u16(cursor + 10)
    const crc = u32(cursor + 16)
    const compressed = u32(cursor + 20)
    const uncompressed = u32(cursor + 24)
    const nameLength = u16(cursor + 28)
    const extraLength = u16(cursor + 30)
    const commentLength = u16(cursor + 32)
    const startDisk = u16(cursor + 34)
    const external = u32(cursor + 38)
    const localOffset = u32(cursor + 42)
    const totalHeader = 46 + nameLength + extraLength + commentLength
    if (!range(eocd, cursor, totalHeader) ||
        (flags & ~ALLOWED_FLAGS) !== 0 || startDisk !== 0 ||
        (method !== 0 && method !== 8) ||
        compressed === 0xffffffff || uncompressed === 0xffffffff ||
        localOffset === 0xffffffff || commentLength !== 0 ||
        uncompressed > MAX_ENTRY_BYTES || (compressed === 0 && uncompressed !== 0) ||
        (compressed > 0 && uncompressed > compressed * MAX_COMPRESSION_RATIO) ||
        (method === 0 && compressed !== uncompressed)) {
      return invalid('unsupported-entry')
    }
    // Unix symlinks, devices, or arbitrary file types are never dictionary assets.
    const unixMode = madeBy >> 8 === 3 ? external >>> 16 : 0
    const fileType = unixMode & 0xf000
    if (fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000) {
      return invalid('unsafe-file-type')
    }
    if (!validExtras(view, cursor + 46 + nameLength, extraLength)) return invalid('extra-field')
    const zipPath = asciiPath(bytes, cursor + 46, nameLength)
    if (zipPath === null || zipPath.startsWith('/') || zipPath.includes('//') ||
        zipPath.split('/').some(s => s === '..' || s === '.') ||
        zipPath.includes(':')) return invalid('unsafe-path')

    // Check the matching local file header and its exact byte range.
    if (!range(centralOffset, localOffset, 30) || u32(localOffset) !== LOCAL_SIGNATURE) {
      return invalid('local-header')
    }
    const localFlags = u16(localOffset + 6)
    const localMethod = u16(localOffset + 8)
    const localNameLength = u16(localOffset + 26)
    const localExtraLength = u16(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength ||
        !range(centralOffset, localOffset, 30 + localNameLength + localExtraLength) ||
        !range(centralOffset, dataOffset, compressed)) return invalid('local-entry')
    if (!validExtras(view, localOffset + 30 + localNameLength, localExtraLength)) return invalid('extra-field')
    if (asciiPath(bytes, localOffset + 30, localNameLength) !== zipPath) return invalid('local-name')
    if ((flags & 0x0008) === 0 &&
        (u32(localOffset + 14) !== crc ||
         u32(localOffset + 18) !== compressed ||
         u32(localOffset + 22) !== uncompressed)) return invalid('local-size')

    localRanges.push({start: localOffset, end: dataOffset + compressed})
    const directory = zipPath.endsWith('/')
    if (directory) {
      directoryEntries++
      if (directoryEntries !== 1 || compressed !== 0 || uncompressed !== 0 ||
          !/^[a-z0-9][a-z0-9._-]*\/$/u.test(zipPath) || fileType === 0x8000) return invalid('unsafe-directory')
      directoryPath = zipPath
    } else {
      if (fileType === 0x4000) return invalid('unsafe-file-type')
      const parts = zipPath.split('/')
      if (parts.length > 2 || parts.some(s => s.length === 0)) return invalid('unsafe-path')
      const root = parts.length === 2 ? parts[0]! : ''
      if (root && !/^[a-z0-9][a-z0-9._-]*$/u.test(root)) return invalid('unsafe-path')
      if (prefix === undefined) prefix = root
      if (prefix !== root) return invalid('mixed-roots')
      const name = parts[parts.length - 1]!
      if (!requiredSet.has(name) || found.has(name)) return invalid('unexpected-or-duplicate-file')
      totalBytes += uncompressed
      if (totalBytes > MAX_TOTAL_BYTES || uncompressed === 0) return invalid('unpacked-size')

      found.set(name, {
        name: name as IpadicFile, zipPath,
        method: method === 0 ? 'stored' : 'deflate',
        compressedSize: compressed, uncompressedSize: uncompressed,
        crc32: crc, dataOffset
      })
    }
    cursor += totalHeader
  }
  if (cursor !== eocd || found.size !== REQUIRED.length ||
      REQUIRED.some(name => !found.has(name))) return invalid('missing-dictionary-file')
  if (directoryPath !== undefined && directoryPath !== prefix + '/') {
    return invalid('unsafe-directory')
  }
  localRanges.sort((a,b) => a.start - b.start)
  for (let i = 1; i < localRanges.length; i++) {
    if (localRanges[i]!.start < localRanges[i - 1]!.end) return invalid('overlapping-file-data')
  }
  return {
    status: 'valid',
    index: Object.freeze({
      entries: Object.freeze(REQUIRED.map(name => Object.freeze(found.get(name)!))),
      totalUncompressedBytes: totalBytes
    })
  }
}

export async function inspectVerifiedIpadicArchive(
  spec: NlpArchiveSpec,
  options: NlpArchiveOptions = {}
): Promise<
  | { readonly status: 'inspected'; readonly sha256: string; readonly index: IpadicZipIndex }
  | { readonly status: 'unavailable'; readonly reason: string }
> {
  const archive = await readVerifiedNlpArchive(spec, options)
  if (archive.status !== 'ready') return archive
  const inspected = inspectIpadicZip(archive.bytes)
  if (inspected.status !== 'valid') {
    return { status: 'unavailable', reason: 'invalid-zip:' + inspected.reason }
  }
  return { status: 'inspected', sha256: archive.sha256, index: inspected.index }
}
