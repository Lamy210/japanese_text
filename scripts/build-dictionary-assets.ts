/**
 * Generate or verify checked-in, deterministic typo dictionary distribution
 * files. Usage:
 *   bun scripts/build-dictionary-assets.ts
 *   bun scripts/build-dictionary-assets.ts --check
 *
 * This is a build-time process. No user content, external APIs or downloads.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { CURATED_TYPO_MANIFEST, listCuratedTypos } from '../src/core/dictionary/curated-typos'
import {
  serializeTypoAsset,
  validateDictionaryAssetRelease
} from '../src/core/dictionary/asset-integrity'

const check = process.argv.slice(2).includes('--check')
const pack = CURATED_TYPO_MANIFEST
const entries = listCuratedTypos()
if (pack.entryCount !== entries.length) throw new Error('Curated dictionary manifest count is stale')

const bytes = serializeTypoAsset(pack, entries)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const release = validateDictionaryAssetRelease({
  schemaVersion: 1,
  pack,
  asset: {
    path: 'entries.json',
    mediaType: 'application/json',
    encoding: 'utf-8',
    byteLength: bytes.byteLength,
    sha256
  }
})
const releaseBytes = new TextEncoder().encode(JSON.stringify(release, null, 2) + '\n')
const base = new URL(`../public/dictionaries/${pack.packId}/${pack.version}/`, import.meta.url)
const outputs = [
  { url: new URL('entries.json', base), bytes },
  { url: new URL('release.json', base), bytes: releaseBytes }
]

for (const output of outputs) {
  const location = fileURLToPath(output.url)
  if (check) {
    let existing: Uint8Array
    try {
      existing = await readFile(location)
    } catch {
      throw new Error(`Missing generated dictionary asset: ${location}`)
    }
    if (existing.length !== output.bytes.length ||
      !existing.every((byte, index) => byte === output.bytes[index])) {
      throw new Error(`Stale generated dictionary asset: ${location}`)
    }
  } else {
    await mkdir(dirname(location), { recursive: true })
    await writeFile(location, output.bytes)
  }
}
console.info(`Dictionary assets ${check ? 'verified' : 'generated'}: ${pack.packId}@${pack.version} (${entries.length} entries, ${bytes.byteLength} bytes, sha256 ${sha256})`)
