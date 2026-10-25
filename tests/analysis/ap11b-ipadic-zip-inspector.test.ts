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

function zip(paths: readonly string[] = names, opts: { directory?: string } = {}) {
  const pathsToWrite = opts.directory ? [opts.directory, ...paths] : [...paths]
  let current = 0
  const locals: Uint8Array[] = []
  const centralFiles: Array<{name: string; local: number; data: Uint8Array}> = []
  for (const name of pathsToWrite) {
    const fileName = new TextEncoder().encode(name)
    const data = name.endsWith('/') ? new Uint8Array() : new Uint8Array([1, 2, 3])
    const local = new Uint8Array(30 + fileName.length + data.length)
    write32(local, 0, 0x04034b50)
    write16(local, 4, 20)
    write16(local, 26, fileName.length)
    write32(local, 18, data.length)
    write32(local, 22, data.length)
    local.set(fileName, 30)
    local.set(data, 30 + fileName.length)
    centralFiles.push({name, local: current, data})
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
