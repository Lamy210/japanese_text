import { describe, expect, test } from 'vitest'
import { inspectIpadicZip } from '../../src/core/nlp/ipadic-zip-inspector'

const names = [
  'metadata.json', 'dict.trie', 'dict.valsidx', 'dict.vals',
  'dict.wordsidx', 'dict.words', 'matrix.mtx', 'char_def.bin', 'unk.bin'
] as const

function combine(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const result = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    result.set(part, cursor)
    cursor += part.byteLength
  }
  return result
}

function write16(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer).setUint16(offset, value, true)
}
function write32(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer).setUint32(offset, value, true)
}

interface GeneratedEntry { readonly name: string; readonly central: number; readonly local: number }

function zip(paths: readonly string[] = names, opts: {
  directory?: string
  descriptor?: 'signed' | 'unsigned'
  data?: Uint8Array
  crc32?: number
} = {}) {
  const pathsToWrite = opts.directory ? [opts.directory, ...paths] : [...paths]
  let current = 0
  const locals: Uint8Array[] = []
  const centralFiles: Array<{name: string; local: number; data: Uint8Array; descriptor: boolean; crc32: number}> = []
  for (const name of pathsToWrite) {
    const fileName = new TextEncoder().encode(name)
    const data = name.endsWith('/') ? new Uint8Array() : (opts.data ?? new Uint8Array([1, 2, 3]))
    const crc32 = name.endsWith('/') ? 0 : (opts.crc32 ?? 0)
    const descriptor = Boolean(opts.descriptor && !name.endsWith('/'))
    const trailerSize = descriptor ? (opts.descriptor === 'signed' ? 16 : 12) : 0
    const local = new Uint8Array(30 + fileName.length + data.length + trailerSize)
    write32(local, 0, 0x04034b50)
    write16(local, 4, 20)
    write16(local, 6, descriptor ? 0x0008 : 0)
    write32(local, 14, descriptor ? 0 : crc32)
    write16(local, 26, fileName.length)
    write32(local, 18, descriptor ? 0 : data.length)
    write32(local, 22, descriptor ? 0 : data.length)
    local.set(fileName, 30)
    local.set(data, 30 + fileName.length)
    if (descriptor) {
      let at = 30 + fileName.length + data.length
      if (opts.descriptor === 'signed') {
        write32(local, at, 0x08074b50)
        at += 4
      }
      write32(local, at, crc32)
      write32(local, at + 4, data.length)
      write32(local, at + 8, data.length)
    }
    centralFiles.push({name, local: current, data, descriptor, crc32})
    current += local.length
    locals.push(local)
  }
  const centralStart = current
  const central: Uint8Array[] = []
  const entries: GeneratedEntry[] = []
  for (const file of centralFiles) {
    const fileName = new TextEncoder().encode(file.name)
    const header = new Uint8Array(46 + fileName.length)
    write32(header, 0, 0x02014b50)
    write16(header, 4, (3 << 8) | 20)
    write16(header, 6, 20)
    write16(header, 8, file.descriptor ? 0x0008 : 0)
    write32(header, 16, file.crc32)
    write16(header, 28, fileName.length)
    write32(header, 20, file.data.length)
    write32(header, 24, file.data.length)
    write32(header, 38, (file.name.endsWith('/') ? 0x4000 : 0x8000) * 65536)
    write32(header, 42, file.local)
    header.set(fileName, 46)
    entries.push({name: file.name, central: current, local: file.local})
    current += header.length
    central.push(header)
  }
  const eocd = new Uint8Array(22)
  write32(eocd, 0, 0x06054b50)
  write16(eocd, 8, centralFiles.length)
  write16(eocd, 10, centralFiles.length)
  write32(eocd, 12, current - centralStart)
  write32(eocd, 16, centralStart)
  return {bytes: combine([...locals, ...central, eocd]), entries, centralStart, eocd: current}
}

describe('AP-11b Lindera IPADIC ZIP structural gate', () => {
  test('accepts exactly nine required entries and preserves deterministic index order', () => {
    const valid = zip()
    const result = inspectIpadicZip(valid.bytes)
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') return
    expect(result.index.entries.map(x => x.name)).toEqual(names)
    expect(result.index.entries.every(x => x.method === 'stored')).toBe(true)
    expect(result.index.totalUncompressedBytes).toBe(27)
    expect(result.index.entries[0]?.dataOffset).toBe(valid.entries[0]!.local + 30 + names[0].length)
  })

  test.each(['signed', 'unsigned'] as const)(
    'accepts a correctly sized %s ZIP data descriptor',
    (descriptor) => {
      const archive = zip(names, { descriptor })
      const result = inspectIpadicZip(archive.bytes)
      expect(result.status).toBe('valid')
    }
  )

  test.each(['unsigned', 'signed'] as const)(
    'accepts %s descriptor when real payload CRC-32 equals optional signature',
    (descriptor) => {
      // CRC-32(ac 0a 7a d5) = 0x08074b50. In the unsigned form this
      // is the CRC field, NOT a 4-byte signature prefix.
      const archive = zip(names, {
        descriptor,
        data: new Uint8Array([0xac, 0x0a, 0x7a, 0xd5]),
        crc32: 0x08074b50
      })
      const result = inspectIpadicZip(archive.bytes)
      expect(result.status).toBe('valid')
      if (result.status === 'valid') {
        expect(result.index.entries.every(entry =>
          entry.crc32 === 0x08074b50 && entry.compressedSize === 4
        )).toBe(true)
      }
    }
  )

  test('rejects a corrupted unsigned descriptor with signature-shaped CRC', () => {
    const archive = zip(names, {
      descriptor: 'unsigned',
      data: new Uint8Array([0xac, 0x0a, 0x7a, 0xd5]),
      crc32: 0x08074b50
    })
    const first = archive.entries[0]!
    const descriptorOffset = first.local + 30 + first.name.length + 4
    write32(archive.bytes, descriptorOffset + 4, 12345)
    expect(inspectIpadicZip(archive.bytes))
      .toEqual({status: 'invalid', reason: 'data-descriptor'})
  })

  test('rejects bit 3 without a physical data descriptor (regression)', () => {
    const archive = zip()
    const entry = archive.entries[0]!
    write16(archive.bytes, entry.local + 6, 0x0008)
    write16(archive.bytes, entry.central + 8, 0x0008)
    expect(inspectIpadicZip(archive.bytes))
      .toEqual({ status: 'invalid', reason: 'data-descriptor' })
  })

  test('rejects a tampered signed data descriptor, even when central sizes are valid', () => {
    const archive = zip(names, { descriptor: 'signed' })
    const entry = archive.entries[0]!
    const descriptorOffset = entry.local + 30 + entry.name.length + 3
    write32(archive.bytes, descriptorOffset + 8, 0x7fffffff)
    expect(inspectIpadicZip(archive.bytes))
      .toEqual({ status: 'invalid', reason: 'data-descriptor' })
  })

  test('rejects unindexed padding between local files and the central directory', () => {
    const archive = zip()
    const padded = combine([
      archive.bytes.subarray(0, archive.centralStart),
      new Uint8Array([0xab]),
      archive.bytes.subarray(archive.centralStart)
    ])
    write32(padded, archive.eocd + 1 + 16, archive.centralStart + 1)
    expect(inspectIpadicZip(padded))
      .toEqual({ status: 'invalid', reason: 'local-layout' })
  })

  test('rejects a hidden prefix before the first local file record', () => {
    const archive = zip()
    const prefixed = combine([new Uint8Array([0x55]), archive.bytes])
    write32(prefixed, archive.eocd + 1 + 16, archive.centralStart + 1)
    for (const entry of archive.entries) {
      write32(prefixed, entry.central + 1 + 42, entry.local + 1)
    }
    expect(inspectIpadicZip(prefixed))
      .toEqual({ status: 'invalid', reason: 'local-layout' })
  })

  test('accepts a single matching root directory with nested dictionary files', () => {
    const valid = zip(names.map(name => 'lindera-ipadic/' + name), {
      directory: 'lindera-ipadic/'
    })
    const result = inspectIpadicZip(valid.bytes)
    expect(result.status).toBe('valid')
    if (result.status === 'valid') {
      expect(result.index.entries[0]?.zipPath).toBe('lindera-ipadic/metadata.json')
    }
  })

  test('rejects missing, duplicate and unexpected dictionary files', () => {
    expect(inspectIpadicZip(zip(names.slice(0, -1)).bytes).status).toBe('invalid')
    expect(inspectIpadicZip(zip([...names.slice(0, -1), names[0]]).bytes))
      .toMatchObject({status: 'invalid', reason: 'unexpected-or-duplicate-file'})
    expect(inspectIpadicZip(zip([...names, 'unreviewed.js']).bytes).status).toBe('invalid')
  })

  test.each([
    ['parent traversal', ['../metadata.json', ...names.slice(1)]],
    ['absolute path', ['/metadata.json', ...names.slice(1)]],
    ['nested escape', ['lindera-ipadic/../metadata.json', ...names.slice(1)]],
    ['mixed roots', names.map((name, i) => (i === 0 ? 'root-a' : 'root-b') + '/' + name)],
    ['backslash', ['lindera-ipadic\\metadata.json', ...names.slice(1)]],
    ['double slash', ['root//metadata.json', ...names.slice(1)]]
  ])('rejects %s filename', (_name, paths) => {
    expect(inspectIpadicZip(zip(paths).bytes).status).toBe('invalid')
  })

  test('rejects unrelated directory entry', () => {
    const archive = zip(names, {directory: 'unexpected/'})
    expect(inspectIpadicZip(archive.bytes))
      .toEqual({status: 'invalid', reason: 'unsafe-directory'})
  })

  test('rejects mismatched local entry name', () => {
    const archive = zip()
    archive.bytes[archive.entries[0]!.local + 30] = '!'.charCodeAt(0)
    expect(inspectIpadicZip(archive.bytes))
      .toEqual({status: 'invalid', reason: 'local-name'})
  })

  test('rejects encrypted, ZIP64, and symlink entries', () => {
    const a = zip()
    write16(a.bytes, a.entries[0]!.central + 8, 1)
    expect(inspectIpadicZip(a.bytes).status).toBe('invalid')
    const b = zip()
    write32(b.bytes, b.entries[0]!.central + 24, 0xffffffff)
    expect(inspectIpadicZip(b.bytes).status).toBe('invalid')
    const c = zip()
    write32(c.bytes, c.entries[0]!.central + 38, 0xa000 * 65536)
    expect(inspectIpadicZip(c.bytes))
      .toEqual({status: 'invalid', reason: 'unsafe-file-type'})
  })

  test('rejects high compression ratios and invalid local sizes', () => {
    const a = zip()
    write32(a.bytes, a.entries[0]!.central + 24, 1550)
    expect(inspectIpadicZip(a.bytes).status).toBe('invalid')
    const b = zip()
    write32(b.bytes, b.entries[0]!.local + 18, 300)
    expect(inspectIpadicZip(b.bytes))
      .toEqual({status: 'invalid', reason: 'local-size'})
  })

  test('rejects broken central directory, appended data and wrong count', () => {
    const a = zip()
    write32(a.bytes, a.eocd + 16, 9999)
    expect(inspectIpadicZip(a.bytes).status).toBe('invalid')
    const b = zip()
    expect(inspectIpadicZip(combine([b.bytes, new Uint8Array([0])])).status).toBe('invalid')
    const c = zip()
    write16(c.bytes, c.eocd + 10, 8)
    expect(inspectIpadicZip(c.bytes).status).toBe('invalid')
  })

  test('rejects central offsets into unrelated file headers', () => {
    const a = zip()
    write32(a.bytes, a.entries[1]!.central + 42, a.entries[0]!.local)
    expect(inspectIpadicZip(a.bytes).status).toBe('invalid')
  })
})
