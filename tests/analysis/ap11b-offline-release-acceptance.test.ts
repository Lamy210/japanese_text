import { describe, expect, test } from 'vitest'
import {
  inspectOfflineIpadicRelease, LINDERA_IPADIC_V620_CANDIDATE,
  type IpadicReleaseCandidate
} from '../../src/core/nlp/ipadic-release-acceptance'

const names = [
  'metadata.json', 'dict.trie', 'dict.valsidx', 'dict.vals', 'dict.wordsidx',
  'dict.words', 'matrix.mtx', 'char_def.bin', 'unk.bin'
] as const

function put16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer).setUint16(offset, value, true)
}
function put32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer).setUint32(offset, value, true)
}
function join(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of chunks) { result.set(part, offset); offset += part.length }
  return result
}
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let i = 0; i < 8; i++) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
    }
  }
  return (value ^ 0xffffffff) >>> 0
}

function syntheticZip(metadata = '{"format_version":2}') {
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  let firstData = 0
  for (const [index, name] of names.entries()) {
    const nameBytes = new TextEncoder().encode(name)
    const value = index === 0
      ? new TextEncoder().encode(metadata)
      : new Uint8Array([index, 14, 23])
    const crc = crc32(value)
    const local = new Uint8Array(30 + nameBytes.length + value.length)
    put32(local, 0, 0x04034b50)
    put16(local, 4, 20)
    put32(local, 14, crc)
    put32(local, 18, value.length)
    put32(local, 22, value.length)
    put16(local, 26, nameBytes.length)
    local.set(nameBytes, 30)
    local.set(value, 30 + nameBytes.length)
    if (index === 0) firstData = offset + 30 + nameBytes.length
    locals.push(local)

    const directory = new Uint8Array(46 + nameBytes.length)
    put32(directory, 0, 0x02014b50)
    put16(directory, 4, 20)
    put16(directory, 6, 20)
    put32(directory, 16, crc)
    put32(directory, 20, value.length)
    put32(directory, 24, value.length)
    put16(directory, 28, nameBytes.length)
    put32(directory, 42, offset)
    directory.set(nameBytes, 46)
    central.push(directory)
    offset += local.length
  }
  const centralOffset = offset
  const centralLength = central.reduce((n, p) => n + p.length, 0)
  const end = new Uint8Array(22)
  put32(end, 0, 0x06054b50)
  put16(end, 8, names.length)
  put16(end, 10, names.length)
  put32(end, 12, centralLength)
  put32(end, 16, centralOffset)
  return { bytes: join([...locals, ...central, end]), firstData }
}

async function pinned(
  bytes: Uint8Array,
  override: Partial<IpadicReleaseCandidate> = {}
): Promise<IpadicReleaseCandidate> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
  return {
    releaseTag: 'v1.2.3',
    assetName: 'lindera-ipadic-1.2.3.zip',
    byteLength: bytes.length,
    sha256: Array.from(hash, x => x.toString(16).padStart(2, '0')).join(''),
    ...override
  }
}

describe('AP-11b offline release acceptance', () => {
  test('pins upstream v6.2.0 bytes but does not pretend redistribution was approved', () => {
    expect(LINDERA_IPADIC_V620_CANDIDATE).toEqual({
      releaseTag: 'v6.2.0',
      assetName: 'lindera-ipadic-6.2.0.zip',
      byteLength: 10_519_550,
      sha256: '5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72'
    })
    expect(Object.isFrozen(LINDERA_IPADIC_V620_CANDIDATE)).toBe(true)
  })

  test('accepts a fully valid offline fixture and reports only sizes, never dictionary bytes', async () => {
    const fixture = syntheticZip()
    const report = await inspectOfflineIpadicRelease(fixture.bytes, await pinned(fixture.bytes))
    expect(report.status).toBe('passed')
    if (report.status !== 'passed') return
    expect(report.licenseReview).toBe('pending')
    expect(report.files.map(x => x.name)).toEqual(names)
    expect(report.files).toHaveLength(9)
    expect(report.totalUncompressedBytes).toBeGreaterThan(0)
    expect(Object.keys(report)).not.toContain('dictionary')
    expect(Object.keys(report)).not.toContain('bytes')
  })

  test('fails size and SHA-256 checks before attempting ZIP inspection', async () => {
    const fixture = syntheticZip()
    const pin = await pinned(fixture.bytes)
    expect(await inspectOfflineIpadicRelease(fixture.bytes.subarray(0, 3), pin))
      .toEqual({ status: 'rejected', reason: 'size-mismatch' })
    const altered = new Uint8Array(fixture.bytes)
    altered[fixture.firstData] ^= 1
    expect(await inspectOfflineIpadicRelease(altered, pin))
      .toEqual({ status: 'rejected', reason: 'sha256-mismatch' })
  })

  test('even SHA-matching corrupt content cannot bypass per-file CRC verification', async () => {
    const fixture = syntheticZip()
    fixture.bytes[fixture.firstData] ^= 1
    expect(await inspectOfflineIpadicRelease(fixture.bytes, await pinned(fixture.bytes)))
      .toEqual({ status: 'rejected', reason: 'invalid-archive', detail: 'crc-mismatch' })
  })

  test('a correctly hashed legacy-format ZIP fails the Lindera v6 metadata gate', async () => {
    const fixture = syntheticZip('{"format_version":1}')
    expect(await inspectOfflineIpadicRelease(fixture.bytes, await pinned(fixture.bytes)))
      .toEqual({ status: 'rejected', reason: 'invalid-archive', detail: 'invalid-metadata' })
  })

  test('a SHA-matching non-ZIP is never an accepted dictionary', async () => {
    const junk = new Uint8Array([1, 2, 3, 4])
    expect(await inspectOfflineIpadicRelease(junk, await pinned(junk)))
      .toEqual({ status: 'rejected', reason: 'invalid-archive', detail: 'invalid-zip' })
  })

  test('invalid version, asset name and digests are rejected before digesting', async () => {
    const fixture = syntheticZip()
    const pin = await pinned(fixture.bytes)
    for (const invalid of [
      { releaseTag: 'v1.2' },
      { assetName: '../lindera-ipadic.zip' },
      { assetName: 'lindera-ipadic-2.0.0.zip' },
      { sha256: 'A'.repeat(64) },
      { byteLength: Number.POSITIVE_INFINITY },
      { byteLength: 100 * 1024 * 1024 }
    ]) {
      expect(await inspectOfflineIpadicRelease(fixture.bytes, { ...pin, ...invalid }))
        .toEqual({ status: 'rejected', reason: 'invalid-pin' })
    }
  })

  test('an aborted audit exposes no partial result', async () => {
    const fixture = syntheticZip()
    const pin = await pinned(fixture.bytes)
    const controller = new AbortController()
    controller.abort()
    expect(await inspectOfflineIpadicRelease(fixture.bytes, pin, controller.signal))
      .toEqual({ status: 'rejected', reason: 'aborted' })
  })

  test('does not trust mutations to the source buffer after starting an async digest', async () => {
    const fixture = syntheticZip()
    const pin = await pinned(fixture.bytes)
    const outcome = inspectOfflineIpadicRelease(fixture.bytes, pin)
    fixture.bytes[fixture.firstData] ^= 1
    expect((await outcome).status).toBe('passed')
  })

  test('a fixture is not confused with the real upstream pin', async () => {
    const fixture = syntheticZip()
    expect(await inspectOfflineIpadicRelease(fixture.bytes))
      .toEqual({ status: 'rejected', reason: 'size-mismatch' })
  })
})
