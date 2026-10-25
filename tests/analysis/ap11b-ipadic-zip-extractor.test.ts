import { describe, expect, test } from 'vitest'
import { extractIpadicZipContents } from '../../src/core/nlp/ipadic-zip-extractor'

const names = [
  'metadata.json', 'dict.trie', 'dict.valsidx', 'dict.vals', 'dict.wordsidx',
  'dict.words', 'matrix.mtx', 'char_def.bin', 'unk.bin'
] as const

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const put16 = (bytes: Uint8Array, index: number, value: number) =>
  new DataView(bytes.buffer).setUint16(index, value, true)
const put32 = (bytes: Uint8Array, index: number, value: number) =>
  new DataView(bytes.buffer).setUint32(index, value, true)

function join(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, x) => sum + x.length, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

async function rawDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  const result = new Blob([new Uint8Array(bytes)])
    .stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(result).arrayBuffer())
}

async function zip(
  dictionary: Partial<Record<typeof names[number], Uint8Array>> = {},
  method: 'stored' | 'deflate' = 'stored'
) {
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  const layout = new Map<string, {localOffset: number; centralOffset: number; dataOffset: number}>()
  let position = 0
  for (const name of names) {
    const nameBytes = new TextEncoder().encode(name)
    const source = dictionary[name] ??
      (name === 'metadata.json' ? new TextEncoder().encode('{"format_version":2}') : new Uint8Array([1, 2, 3, 4]))
    const compressed = method === 'deflate' ? await rawDeflate(source) : source
    const header = new Uint8Array(30 + nameBytes.length + compressed.length)
    put32(header, 0, 0x04034b50)
    put16(header, 4, 20)
    put16(header, 8, method === 'stored' ? 0 : 8)
    put32(header, 14, crc32(source))
    put32(header, 18, compressed.length)
    put32(header, 22, source.length)
    put16(header, 26, nameBytes.length)
    header.set(nameBytes, 30)
    header.set(compressed, 30 + nameBytes.length)
    const here = position
    local.push(header)
    position += header.length
    const cd = new Uint8Array(46 + nameBytes.length)
    put32(cd, 0, 0x02014b50)
    put16(cd, 4, 20)
    put16(cd, 6, 20)
    put16(cd, 10, method === 'stored' ? 0 : 8)
    put32(cd, 16, crc32(source))
    put32(cd, 20, compressed.length)
    put32(cd, 24, source.length)
    put16(cd, 28, nameBytes.length)
    put32(cd, 42, here)
    cd.set(nameBytes, 46)
    central.push(cd)
    layout.set(name, {localOffset:here, centralOffset:0, dataOffset:here + 30 + nameBytes.length})
  }
  const centralOffset = position
  for (const [i, cd] of central.entries()) {
    layout.get(names[i]!)!.centralOffset = position
    position += cd.length
  }
  const end = new Uint8Array(22)
  put32(end, 0, 0x06054b50)
  put16(end, 8, names.length)
  put16(end, 10, names.length)
  put32(end, 12, position - centralOffset)
  put32(end, 16, centralOffset)
  return {bytes: join([...local, ...central, end]), layout}
}

describe('AP-11b-2 bounded dictionary extraction', () => {
  test('extracts nine stored entries only after checking their actual CRC', async () => {
    const archive = await zip()
    const result = await extractIpadicZipContents(archive.bytes)
    expect(result.status).toBe('extracted')
    if (result.status !== 'extracted') return
    expect([...result.files.keys()]).toEqual(names)
    expect(new TextDecoder().decode(result.files.get('metadata.json'))).toContain('"format_version":2')
  })

  test('extracts deflate-raw entries and checks output byte count + CRC', async () => {
    const data = new Uint8Array(4096).fill(42)
    const archive = await zip({ 'dict.trie': data }, 'deflate')
    const result = await extractIpadicZipContents(archive.bytes)
    expect(result.status).toBe('extracted')
    if (result.status === 'extracted') expect(result.files.get('dict.trie')).toEqual(data)
  })

  test('rejects CRC mismatch in a stored entry without publishing partial files', async () => {
    const archive = await zip()
    archive.bytes[archive.layout.get('dict.trie')!.dataOffset] ^= 1
    expect(await extractIpadicZipContents(archive.bytes)).toEqual({
      status: 'invalid', reason: 'crc-mismatch'
    })
  })

  test('rejects correct-compression bytes with a forged CRC in central and local headers', async () => {
    const archive = await zip({}, 'deflate')
    const entry = archive.layout.get('dict.trie')!
    put32(archive.bytes, entry.localOffset + 14, 0x12345678)
    put32(archive.bytes, entry.centralOffset + 16, 0x12345678)
    expect(await extractIpadicZipContents(archive.bytes)).toEqual({
      status: 'invalid', reason: 'crc-mismatch'
    })
  })

  test('declared expansion size cannot hide a different actual size', async () => {
    const archive = await zip({}, 'deflate')
    const entry = archive.layout.get('dict.trie')!
    put32(archive.bytes, entry.centralOffset + 24, 6)
    put32(archive.bytes, entry.localOffset + 22, 6)
    expect(await extractIpadicZipContents(archive.bytes)).toEqual({
      status: 'invalid', reason: 'size-mismatch'
    })
  })

  test('rejects malformed compressed payload instead of treating it as clean tokens', async () => {
    const archive = await zip({}, 'deflate')
    archive.bytes[archive.layout.get('dict.trie')!.dataOffset] = 255
    const result = await extractIpadicZipContents(archive.bytes)
    expect(result.status).toBe('invalid')
  })

  test('rejects a legacy v5 dictionary metadata even when ZIP/CRC are valid', async () => {
    const archive = await zip({
      'metadata.json': new TextEncoder().encode('{"format_version":1}')
    })
    expect(await extractIpadicZipContents(archive.bytes)).toEqual({
      status: 'invalid', reason: 'invalid-metadata'
    })
  })

  test('rejects malformed UTF-8 and unknown metadata shape', async () => {
    const invalidUtf8 = await zip({'metadata.json':new Uint8Array([0xff,0xff])})
    expect(await extractIpadicZipContents(invalidUtf8.bytes)).toMatchObject({
      status: 'invalid', reason: 'invalid-metadata'
    })
    const missing = await zip({'metadata.json':new TextEncoder().encode('{}')})
    expect(await extractIpadicZipContents(missing.bytes)).toMatchObject({
      status: 'invalid', reason: 'invalid-metadata'
    })
  })

  test('aborted operations never return partially extracted content', async () => {
    const controller = new AbortController()
    controller.abort()
    const archive = await zip()
    expect(await extractIpadicZipContents(archive.bytes, controller.signal)).toEqual({
      status:'invalid', reason:'aborted'
    })
  })

  test('rejects a non-ZIP file before starting decompression', async () => {
    expect(await extractIpadicZipContents(new Uint8Array([1,2,3]))).toEqual({
      status: 'invalid', reason: 'invalid-zip'
    })
  })
})
