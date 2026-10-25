import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  installVerifiedNlpArchive, readVerifiedNlpArchive,
  type NlpArchiveOptions, type NlpArchiveSpec
} from '../../src/core/nlp/archive-installer'

const payload = new TextEncoder().encode('PK-validated-small-ipadic-fixture')
const hash = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
  return Array.from(digest, v => v.toString(16).padStart(2, '0')).join('')
}

class FakeDirectory {
  readonly dirs = new Map<string, FakeDirectory>()
  readonly files = new Map<string, Uint8Array>()
  rejectWriteName: string | null = null

  async getDirectoryHandle(name: string, options: {create?: boolean} = {}): Promise<FakeDirectory> {
    let dir = this.dirs.get(name)
    if (!dir) {
      if (!options.create) throw new DOMException('not found', 'NotFoundError')
      dir = new FakeDirectory()
      this.dirs.set(name, dir)
    }
    return dir
  }

  async getFileHandle(name: string, options: {create?: boolean} = {}) {
    if (!this.files.has(name) && !options.create) throw new DOMException('not found', 'NotFoundError')
    if (!this.files.has(name)) this.files.set(name, new Uint8Array())
    const scope = this
    return {
      async getFile() {
        return new Blob([new Uint8Array(scope.files.get(name)!)])
      },
      async createWritable() {
        let buffer = new Uint8Array()
        return {
          async write(value: Blob) {
            if (scope.rejectWriteName === name) throw new Error('Quota exceeded')
            buffer = new Uint8Array(await value.arrayBuffer())
          },
          async close() { scope.files.set(name, buffer) },
          async abort() {}
        }
      }
    }
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new DOMException('not found', 'NotFoundError')
  }

  at(...names: string[]): FakeDirectory {
    let directory: FakeDirectory = this
    for (const name of names) {
      const child = directory.dirs.get(name)
      if (!child) throw new Error('Missing fake directory: ' + name)
      directory = child
    }
    return directory
  }
}

function singleLock(): NonNullable<NlpArchiveOptions['withExclusiveLock']> {
  return async (_name, work) => work()
}

function serializedLock(): NonNullable<NlpArchiveOptions['withExclusiveLock']> {
  let previous = Promise.resolve()
  return async (_name, work) => {
    const before = previous
    let release!: () => void
    previous = new Promise<void>(resolve => { release = resolve })
    await before
    try { return await work() } finally { release() }
  }
}

function fixture(root: FakeDirectory, bytes: Uint8Array, overrides: Partial<NlpArchiveOptions> = {}) {
  const requested: Array<{url: string; opts: RequestInit}> = []
  const fetcher = vi.fn(async (url: string, opts: RequestInit) => {
    requested.push({url, opts})
    return new Response(new Uint8Array(bytes), {
      status: 200, headers: { 'Content-Length': String(bytes.length) }
    })
  })
  const options: NlpArchiveOptions = {
    basePath: '/japanese_text/',
    fetcher: fetcher as unknown as typeof fetch,
    getRoot: async () => root as unknown as FileSystemDirectoryHandle,
    withExclusiveLock: singleLock(),
    ...overrides
  }
  return { requested, fetcher, options }
}

let trusted: NlpArchiveSpec
beforeEach(async () => {
  vi.stubGlobal('location', { origin: 'https://example.test' })
  trusted = {
    schemaVersion: 1,
    providerId: 'lindera-ipadic',
    assetId: 'ipadic',
    version: '1.2.3',
    byteLength: payload.byteLength,
    sha256: await hash(payload),
    licenseId: 'MIT',
    licenseReview: 'approved'
  }
})
afterEach(() => vi.unstubAllGlobals())

describe('AP-11a SHA-pinned archive acquisition', () => {
  test('installs verified archive on demand and rechecks SHA on OPFS read', async () => {
    const root = new FakeDirectory()
    const {options, requested} = fixture(root, payload)
    const result = await installVerifiedNlpArchive(trusted, options)
    expect(result).toEqual({status:'installed',sha256:trusted.sha256})
    expect(requested).toHaveLength(1)
    expect(requested[0]?.url)
      .toBe('https://example.test/japanese_text/nlp-dictionaries/lindera-ipadic/1.2.3/ipadic.zip')
    expect(requested[0]?.opts).toMatchObject({credentials:'omit', redirect:'error', cache:'no-store'})
    const reopened = await readVerifiedNlpArchive(trusted, options)
    expect(reopened.status).toBe('ready')
    if (reopened.status === 'ready') expect(reopened.bytes).toEqual(payload)
    const again = await installVerifiedNlpArchive(trusted, options)
    expect(again).toMatchObject({status:'already-installed'})
    expect(requested).toHaveLength(1)
  })

  test('a second tab under an exclusive lock reuses the same verified install', async () => {
    const root = new FakeDirectory()
    const { options, requested } = fixture(root,payload, { withExclusiveLock: serializedLock() })
    const [first,second] = await Promise.all([
      installVerifiedNlpArchive(trusted, options),
      installVerifiedNlpArchive(trusted, options)
    ])
    expect([first.status,second.status]).toEqual(['installed','already-installed'])
    expect(requested).toHaveLength(1)
  })

  test('invalid manifest and hostile path are rejected before any fetch or write', async () => {
    const root = new FakeDirectory()
    const { options, requested } = fixture(root,payload)
    for(const change of [
      {sha256:'F'.repeat(64)},
      {sha256:'0'.repeat(63)},
      {byteLength:1024*1024*1024},
      {version:'../1.0.0'},
      {assetId:'../../evil'},
      {licenseReview:'pending' as 'approved'},
      {providerId:'unsupported' as 'lindera-ipadic'},
      {origin:'https://outside.example'}
    ]) {
      expect((await installVerifiedNlpArchive({...trusted,...change},options)).status).toBe('unavailable')
    }
    expect(await installVerifiedNlpArchive(trusted,{...options,basePath:'//evil.example/'}))
      .toEqual({status:'unavailable',reason:'invalid-spec'})
    expect(requested).toHaveLength(0)
  })

  test('network redirects, content-length mismatch and digest mismatch never write a ready marker', async () => {
    const root = new FakeDirectory()
    const mismatch = fixture(root, new TextEncoder().encode('tampered-content'))
    expect(await installVerifiedNlpArchive(trusted,mismatch.options))
      .toEqual({status:'unavailable',reason:'digest'})
    const badLength = fixture(root, payload, {
      fetcher: vi.fn(async () => new Response(payload, {
        status:200,headers:{'Content-Length':String(payload.length+1)}
      })) as unknown as typeof fetch
    })
    expect(await installVerifiedNlpArchive(trusted,badLength.options))
      .toEqual({status:'unavailable',reason:'digest'})
    const network = fixture(root,payload,{
      fetcher: vi.fn(async () => {throw new Error('network disconnected')}) as unknown as typeof fetch
    })
    expect(await installVerifiedNlpArchive(trusted,network.options))
      .toEqual({status:'unavailable',reason:'fetch'})
    expect((await readVerifiedNlpArchive(trusted,mismatch.options)).status).toBe('unavailable')
  })

  test('failed OPFS commit preserves a previous verified archive', async () => {
    const root = new FakeDirectory()
    const { options } = fixture(root,payload)
    expect((await installVerifiedNlpArchive(trusted,options)).status).toBe('installed')
    const alternative = new TextEncoder().encode('another-archive-version')
    const next = {...trusted, sha256:await hash(alternative),byteLength:alternative.byteLength}
    const folder = root.at('japanese-text-nlp-dictionaries','lindera-ipadic','ipadic','1.2.3')
    folder.rejectWriteName = next.sha256 + '.ready'
    const incoming = fixture(root,alternative)
    expect(await installVerifiedNlpArchive(next,incoming.options))
      .toEqual({status:'unavailable',reason:'storage'})
    expect((await readVerifiedNlpArchive(trusted,options)).status).toBe('ready')
    expect((await readVerifiedNlpArchive(next,options)).status).toBe('unavailable')
    expect(folder.files.has(next.sha256+'.partial')).toBe(false)
  })

  test('a tampered cached archive cannot bypass verification using a ready marker', async () => {
    const root = new FakeDirectory()
    const {options} = fixture(root,payload)
    await installVerifiedNlpArchive(trusted,options)
    const folder = root.at('japanese-text-nlp-dictionaries','lindera-ipadic','ipadic','1.2.3')
    folder.files.set(trusted.sha256+'.zip',new Uint8Array(payload.length))
    expect(await readVerifiedNlpArchive(trusted,options)).toEqual({
      status:'unavailable',reason:'digest'
    })
    expect((await installVerifiedNlpArchive(trusted,options)).status).toBe('installed')
    expect((await readVerifiedNlpArchive(trusted,options)).status).toBe('ready')
  })

  test('aborted downloads do not publish or expose a dictionary', async () => {
    const root = new FakeDirectory()
    const controller = new AbortController()
    controller.abort()
    const {options,requested} = fixture(root,payload,{signal:controller.signal})
    expect(await installVerifiedNlpArchive(trusted,options))
      .toEqual({status:'unavailable',reason:'aborted'})
    expect(requested).toHaveLength(0)
    expect((await readVerifiedNlpArchive(trusted,options)).status).toBe('unavailable')
  })

  test('fails closed when cross-tab Web Locks or OPFS are unavailable', async () => {
    const root = new FakeDirectory()
    const {options,requested} = fixture(root,payload)
    const unsupported: NlpArchiveOptions = {...options,withExclusiveLock:undefined}
    vi.stubGlobal('navigator',{storage:undefined,locks:undefined})
    expect(await installVerifiedNlpArchive(trusted,unsupported))
      .toEqual({status:'unavailable',reason:'storage'})
    expect(requested).toHaveLength(0)
    expect(await readVerifiedNlpArchive(trusted,unsupported))
      .toEqual({status:'unavailable',reason:'storage'})
  })
})
