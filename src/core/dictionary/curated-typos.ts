/**
 * Phase 6A: a single, versioned source of truth for reviewed typo pairs.
 *
 * This module deliberately carries no user settings or remote dictionary data.
 * The original eight spellings and their ordering are part of the regression
 * contract. A new pair requires reviewed positive AND negative corpus cases.
 */
export interface CuratedTypoEntry {
  readonly wrong: string
  readonly preferred: string
}

export const CURATED_TYPO_DICTIONARY_VERSION = 1

const entries: readonly CuratedTypoEntry[] = Object.freeze([
  Object.freeze({ wrong: 'シュミレーション', preferred: 'シミュレーション' }),
  Object.freeze({ wrong: 'コミニュケーション', preferred: 'コミュニケーション' }),
  Object.freeze({ wrong: 'デバック', preferred: 'デバッグ' }),
  Object.freeze({ wrong: 'うる覚え', preferred: 'うろ覚え' }),
  Object.freeze({ wrong: 'コミニュティ', preferred: 'コミュニティ' }),
  Object.freeze({ wrong: 'アクセサビリティ', preferred: 'アクセシビリティ' }),
  Object.freeze({ wrong: 'シュミレーター', preferred: 'シミュレーター' }),
  Object.freeze({ wrong: 'シュミレータ', preferred: 'シミュレータ' })
])

const byWrong = new Map<string, CuratedTypoEntry>()
for (const entry of entries) {
  if (!entry.wrong || !entry.preferred || entry.wrong === entry.preferred || byWrong.has(entry.wrong)) {
    throw new Error('Invalid built-in curated typo dictionary')
  }
  byWrong.set(entry.wrong, entry)
}

/** Stable ordered entries used by the existing deterministic rule. */
export function listCuratedTypos(): readonly CuratedTypoEntry[] {
  return entries
}

/** Exact visible-spelling lookup for the existing "allow this spelling" action. */
export function findCuratedTypo(spelling: string): CuratedTypoEntry | undefined {
  return byWrong.get(spelling)
}
