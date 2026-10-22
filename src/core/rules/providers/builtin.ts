import type { AppConfig } from '../../config/schema'
import type { CoreRule } from '../../types'
import type { RuleManifest, RuleProvider } from './types'

import { fullWidthSpaceRule, unnecessarySpaceRule } from '../fast/whitespace'
import { punctuationRule } from '../fast/punctuation'
import { bracketsRule } from '../fast/brackets'
import { alnumWidthRule } from '../fast/alnum-width'
import { createNgWordRule } from '../fast/ng-word'
import { createTerminologyRule } from '../fast/terminology'
import { redundancyRule } from '../fast/redundancy'
import { createCommonTypoRule } from '../fast/common-typo'
import { nominalizedActionRule } from '../fast/nominalized-action'
import { repeatedPhraseRule, consecutiveConjunctionRule, additiveConjunctionDensityRule } from '../fast/repeated-expression'
import { doubleHonorificRule } from '../fast/double-honorific'
import { honorificRequestRule } from '../fast/honorific-request'
import { doubledObjectParticleRule } from '../fast/doubled-object-particle'
import { ambiguityRule } from '../fast/ambiguity'
import { commaCountRule } from '../deep/comma-count'
import { paragraphDensityRule } from '../fast/paragraph-density'
import { mixedToneRule } from '../fast/mixed-tone'
import { crossParagraphToneRule } from '../fast/cross-paragraph-tone'
import { headingOrderRule } from '../markdown/heading-order'
import {
  createCitationNumberRule,
  createCitationComparisonRule,
  createCitationExternalFactRule
} from '../citation/citation-detector'
import {
  referenceUndefinedRule,
  referenceEmptyUrlRule,
  referenceMalformedUrlRule,
  referenceBrokenAnchorRule,
  referenceDuplicateIdRule,
  referenceUnusedRule,
  referenceDuplicateAnchorRule
} from '../reference/markdown-reference'

type RuntimeRulesConfig = Pick<AppConfig, 'ngWords' | 'terminology' | 'citation'>

/** Keep original insertion order: rule behavior and test fixtures depend on it. */
function buildBuiltinRules(config: RuntimeRulesConfig): CoreRule[] {
  return [
    fullWidthSpaceRule,
    unnecessarySpaceRule,
    punctuationRule,
    bracketsRule,
    alnumWidthRule,
    createNgWordRule(() => config.ngWords),
    createTerminologyRule(() => config.terminology),
    redundancyRule,
    createCommonTypoRule(() => config.terminology),
    nominalizedActionRule,
    repeatedPhraseRule,
    doubleHonorificRule,
    honorificRequestRule,
    doubledObjectParticleRule,
    ambiguityRule,
    mixedToneRule,
    crossParagraphToneRule,
    consecutiveConjunctionRule,
    additiveConjunctionDensityRule,
    commaCountRule,
    paragraphDensityRule,
    headingOrderRule,
    createCitationNumberRule(() => config.citation),
    createCitationComparisonRule(() => config.citation),
    createCitationExternalFactRule(() => config.citation),
    referenceUndefinedRule,
    referenceEmptyUrlRule,
    referenceMalformedUrlRule,
    referenceBrokenAnchorRule,
    referenceDuplicateIdRule,
    referenceUnusedRule,
    referenceDuplicateAnchorRule
  ]
}

/** Metadata only. Rule description/options are independent of user settings. */
const metadataRules = buildBuiltinRules({
  ngWords: [],
  terminology: [],
  citation: { scope: 'paragraph', detectNumbers: true, detectComparison: true, detectExternalFact: true }
})

const metadata: RuleManifest[] = metadataRules.map((rule) => ({
  id: rule.id,
  providerId: 'builtin',
  source: 'core',
  category: rule.category,
  tier: rule.tier,
  description: rule.description,
  defaultSeverity: rule.defaultSeverity,
  ...(rule.optionDefs === undefined ? {} : { optionDefs: structuredClone(rule.optionDefs) })
}))

export const builtinRuleProvider: RuleProvider = {
  id: 'builtin',

  listManifests() {
    return metadata.map((manifest) => structuredClone(manifest))
  },

  createRules(config) {
    return buildBuiltinRules(config)
  }
}
