/**
 * AP-09 NLP data shapes. These types are not executable rules and do not
 * enable a tokenizer or change the existing three-tier lint protocol.
 */
export interface ProseRegion {
  readonly id: string
  readonly sourceStartUtf16: number
  readonly sourceEndUtf16: number
  readonly kind: 'paragraph' | 'heading' | 'list' | 'link-label' | 'table-cell' | 'quote'
  /** Must exactly match source.slice(sourceStartUtf16, sourceEndUtf16). */
  readonly text: string
}

/** Provider-neutral contract; POS normalization is deferred to the adapters. */
export interface MorphToken {
  readonly surface: string
  readonly lemma: string | null
  readonly reading: string | null
  readonly pos: 'noun' | 'verb' | 'adjective' | 'particle' |
    'auxiliary' | 'adverb' | 'conjunction' | 'symbol' | 'other'
  readonly posDetails: readonly string[]
  readonly conjugationType: string | null
  readonly conjugationForm: string | null
  readonly isUnknown: boolean | null
  readonly startUtf16: number
  readonly endUtf16: number
  readonly regionId: string
  readonly sentenceId: string
  readonly originalFeatures: readonly string[]
}

/** Minimal raw geometry produced by a byte-based tokenizer (e.g. Lindera). */
export interface RawByteTokenSpan {
  readonly byteStart: number
  readonly byteEnd: number
  readonly surface: string
}

/** Absolute, source-verified geometry; not yet a morphological diagnosis. */
export interface ValidatedTokenSpan extends RawByteTokenSpan {
  readonly startUtf16: number
  readonly endUtf16: number
  readonly regionId: string
}
