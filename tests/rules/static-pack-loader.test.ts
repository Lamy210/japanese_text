import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildCuratedPackArtifacts } from '../../src/core/dictionary/pack-codec'
import { loadBundledCuratedTypoPack } from '../../src/core/dictionary/static-pack-loader'

afterEach(() => vi.unstubAllGlobals())

function useOrigin(): void {
  vi.stubGlobal('location', { origin: 'https://example.test' })
}

describe('Phase 6B-3 explicit bundled static pack loading', () => {
  test('loads exactly two static same-origin files and verifies the contents', async () => {
    useOrigin()
    const { indexText, packText } = await buildCuratedPackArtifacts()
    const paths: string[] = []
    const configs: RequestInit[] = []
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      paths.push(url)
      configs.push(init ?? {})
      if (url.endsWith('/index.json')) return new Response(indexText, { status: 200 })
      if (url.endsWith('/pack.json')) return new Response(packText, { status: 200 })
      throw new Error('Unexpected URL')
    })
    const result = await loadBundledCuratedTypoPack({
      basePath: '/japanese_text/',
      fetcher: mock as typeof fetch
    })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.pack.entries).toHaveLength(8)
      expect(result.pack.entries[0]).toEqual({
        wrong: 'シュミレーション',
        preferred: 'シミュレーション'
      })
    }
    expect(paths).toEqual([
      'https://example.test/japanese_text/dictionaries/curated-common-typo-ja/1.0.0/index.json',
      'https://example.test/japanese_text/dictionaries/curated-common-typo-ja/1.0.0/pack.json'
    ])
    expect(configs).toHaveLength(2)
    expect(configs.every(x => x.credentials === 'omit' && x.redirect === 'error')).toBe(true)
  })

  test('rejects tampered published bytes with a degraded result', async () => {
    useOrigin()
    const { indexText, packText } = await buildCuratedPackArtifacts()
    const mock = vi.fn(async (input: RequestInfo | URL) => new Response(
      String(input).endsWith('/index.json') ? indexText : packText.replace('デバック', 'デバッグ')
    ))
    const result = await loadBundledCuratedTypoPack({ basePath: '/', fetcher: mock as typeof fetch })
    expect(result).toEqual({ status: 'unavailable', reason: 'invalid-asset' })
  })

  test('rejects oversized index before fetching the pack', async () => {
    useOrigin()
    const mock = vi.fn(async () => new Response('X'.repeat(17_000)))
    const result = await loadBundledCuratedTypoPack({ basePath: '/', fetcher: mock as typeof fetch })
    expect(result).toEqual({ status: 'unavailable', reason: 'invalid-asset' })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  test.each(['//attacker.invalid/', '/foo/../', '/japanese_text/../../', 'https://attacker.invalid/'])(
    'rejects an untrusted path %s without sending requests',
    async (basePath) => {
      useOrigin()
      const mock = vi.fn(async () => new Response('{}'))
      expect(await loadBundledCuratedTypoPack({ basePath, fetcher: mock as typeof fetch }))
        .toEqual({ status: 'unavailable', reason: 'invalid-base' })
      expect(mock).not.toHaveBeenCalled()
    }
  )

  test('supports an already-aborted signal without network access', async () => {
    useOrigin()
    const controller = new AbortController()
    controller.abort()
    const mock = vi.fn(async () => new Response('{}'))
    expect(await loadBundledCuratedTypoPack({
      basePath: '/',
      signal: controller.signal,
      fetcher: mock as typeof fetch
    })).toEqual({ status: 'unavailable', reason: 'aborted' })
    expect(mock).not.toHaveBeenCalled()
  })

  test('does not trust redirects or server errors', async () => {
    useOrigin()
    const mock = vi.fn(async () => Response.redirect('https://example.test/something-else', 302))
    expect(await loadBundledCuratedTypoPack({ basePath: '/', fetcher: mock as typeof fetch }))
      .toEqual({ status: 'unavailable', reason: 'invalid-asset' })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  test('degrades cleanly on offline/network failure', async () => {
    useOrigin()
    const mock = vi.fn(async (): Promise<Response> => { throw new Error('offline') })
    expect(await loadBundledCuratedTypoPack({ basePath: '/', fetcher: mock as typeof fetch }))
      .toEqual({ status: 'unavailable', reason: 'fetch' })
  })
})
