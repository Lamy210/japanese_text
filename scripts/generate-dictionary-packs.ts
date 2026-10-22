/**
 * Deterministic build for the reviewed, bundled typo dictionary.
 *
 * Run: bun run dict:generate
 * Gate: bun run dict:check
 *
 * Never downloads a third-party corpus; outputs are static public data only.
 */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CURATED_TYPO_MANIFEST } from '../src/core/dictionary/curated-typos'
import { buildCuratedPackArtifacts } from '../src/core/dictionary/pack-codec'

const checkOnly = process.argv.includes('--check')
const help = process.argv.includes('--help')
if (help) {
  console.log('Usage: bun scripts/generate-dictionary-packs.ts [--check]')
  process.exit(0)
}
if (process.argv.some(arg => arg.startsWith('--') && arg !== '--check')) {
  throw new Error('Unknown argument')
}

const root = resolve(import.meta.dir, '..', 'public', 'dictionaries',
  CURATED_TYPO_MANIFEST.packId, CURATED_TYPO_MANIFEST.version)
const { packText, indexText } = await buildCuratedPackArtifacts()
const assets: readonly (readonly [string, string])[] = [
  ['pack.json', packText],
  ['index.json', indexText]
]

if (checkOnly) {
  for (const [name, expected] of assets) {
    const path = resolve(root, name)
    const file = Bun.file(path)
    if (!(await file.exists()) || await file.text() !== expected) {
      throw new Error(`Dictionary artifact is missing or stale: ${path}. Run bun run dict:generate.`)
    }
  }
  console.log(`Dictionary pack verified: ${CURATED_TYPO_MANIFEST.packId}@${CURATED_TYPO_MANIFEST.version}`)
} else {
  await mkdir(root, { recursive: true })
  for (const [name, contents] of assets) {
    await Bun.write(resolve(root, name), contents)
  }
  console.log(`Dictionary pack generated: ${CURATED_TYPO_MANIFEST.packId}@${CURATED_TYPO_MANIFEST.version}`)
}
