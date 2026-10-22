import { describe, expect, test, vi } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import {
  buildRuleRegistry,
  DEFAULT_RULE_PROVIDERS,
  listRuleManifests,
  TEXTLINT_RULE_IDS,
  TEXTLINT_RULE_META
} from '../../src/core/rules/registry'
import { builtinRuleProvider } from '../../src/core/rules/providers/builtin'
import type { RuleProvider } from '../../src/core/rules/providers/types'
import type { CoreRule } from '../../src/core/types'

const nativeRuleIds = [
  'typography/full-width-space', 'typography/unnecessary-space',
  'typography/punctuation', 'typography/brackets', 'typography/alnum-width',
  'wording/ng-word', 'wording/terminology', 'wording/redundancy',
  'wording/common-typo',
  'wording/nominalized-action',
  'style/honorific-consistency',
  'style/meeting-minutes-sections',
  'style/business-document-structure',
  'wording/request-cushion-review', 'markdown/blockquote-spacing',
  'markdown/blockquote-blank-lines',
  'wording/repeated-phrase',
  'wording/double-honorific', 'wording/honorific-request', 'wording/doubled-object-particle', 'wording/tautology', 'wording/ambiguity',
  'style/mixed-tone', 'style/cross-paragraph-tone', 'style/consecutive-conjunction',
  'style/additive-conjunction-density', 'style/mixed-conjunction-density',
  'style/comma-count', 'style/paragraph-density', 'markdown/heading-order',
  'evidence/citation-number', 'evidence/citation-comparison',
  'evidence/citation-external-fact', 'reference/undefined',
  'reference/empty-url', 'reference/malformed-url',
  'reference/broken-anchor', 'reference/duplicate-id',
  'reference/unused', 'reference/duplicate-anchor'
]

describe('Phase 2E-A RuleProvider / RuleManifest', () => {
  test('preserves the complete native registry and metadata parity', () => {
    const config = createDefaultConfig()
    const registry = buildRuleRegistry(config)
    expect([...registry.keys()]).toEqual(nativeRuleIds)
    const manifests = listRuleManifests()
    expect(manifests).toHaveLength(nativeRuleIds.length + TEXTLINT_RULE_IDS.length)
    expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(manifests.length)
    expect(manifests.map((manifest) => manifest.id)).toEqual(
      [...manifests.map((manifest) => manifest.id)].sort((a, b) => {
        const aCategory = a.split('/')[0]!
        const bCategory = b.split('/')[0]!
        return aCategory.localeCompare(bCategory) || a.localeCompare(b)
      })
    )

    for (const rule of registry.values()) {
      const manifest = manifests.find((value) => value.id === rule.id)!
      expect(manifest).toMatchObject({
        providerId: 'builtin', source: 'core', id: rule.id,
        category: rule.category, tier: rule.tier,
        description: rule.description, defaultSeverity: rule.defaultSeverity
      })
      expect(manifest.optionDefs).toEqual(rule.optionDefs)
    }
    expect(manifests.filter((manifest) => manifest.source === 'textlint').map((value) => value.id).sort())
      .toEqual([...TEXTLINT_RULE_IDS].sort())
    for (const [id, meta] of Object.entries(TEXTLINT_RULE_META)) {
      const manifest = manifests.find((value) => value.id === id)!
      expect(manifest.description).toBe(meta.description)
      expect(manifest.defaultSeverity).toBe(meta.defaultSeverity)
      expect(manifest.optionDefs).toEqual(meta.optionDefs)
      expect(manifest.tier).toBe('deep')
    }
  })

  test('does not rebuild default manifests for every lint registry construction', () => {
    const config = createDefaultConfig()
    const listSpy = vi.spyOn(builtinRuleProvider, 'listManifests')
    try {
      buildRuleRegistry(config)
      buildRuleRegistry(config)
      buildRuleRegistry(config)
      expect(listSpy).not.toHaveBeenCalled()
    } finally {
      listSpy.mockRestore()
    }
  })

  test('default providers cannot be mutated after their manifests are cached', () => {
    expect(Object.isFrozen(DEFAULT_RULE_PROVIDERS)).toBe(true)
    expect(DEFAULT_RULE_PROVIDERS.map((provider) => provider.id)).toEqual(['builtin', 'textlint'])
  })

  test('manifest listing returns independent metadata including nested option definitions', () => {
    const first = listRuleManifests()
    const second = listRuleManifests()
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    const firstOption = first.find((item) => item.optionDefs?.length)?.optionDefs?.[0]
    const secondOption = second.find((item) => item.optionDefs?.length)?.optionDefs?.[0]
    expect(firstOption).toBeDefined()
    expect(firstOption).not.toBe(secondOption)
    if (firstOption) firstOption.label = 'modified'
    expect(secondOption?.label).not.toBe('modified')
  })

  test('rejects duplicate provider IDs, duplicate rule IDs, and unadvertised runtime rules', () => {
    const config = createDefaultConfig()
    const nativeRule = buildRuleRegistry(config).get('typography/punctuation')!
    const extensionRule: CoreRule = { ...nativeRule, id: 'extension/demo' }
    const extension: RuleProvider = {
      id: 'extension',
      listManifests: () => [{
        providerId: 'extension', source: 'core',
        id: 'extension/demo', category: extensionRule.category,
        tier: extensionRule.tier, description: extensionRule.description,
        defaultSeverity: extensionRule.defaultSeverity
      }],
      createRules: () => [extensionRule]
    }

    expect([...buildRuleRegistry(config, [builtinRuleProvider, extension]).keys()]).toEqual([
      ...nativeRuleIds, 'extension/demo'
    ])
    expect(() => listRuleManifests([extension, extension])).toThrow(/duplicate provider/i)
    expect(() => buildRuleRegistry(config, [extension, extension])).toThrow(/duplicate provider/i)
    expect(() => listRuleManifests([builtinRuleProvider, {
      ...extension, id: 'another', listManifests: () => [{
        ...extension.listManifests()[0]!, providerId: 'another',
        id: 'typography/punctuation'
      }]
    }])).toThrow(/duplicate rule/i)
    expect(() => buildRuleRegistry(config, [{
      ...extension, listManifests: () => []
    }])).toThrow(/manifest/i)
    expect(() => listRuleManifests([{ ...extension, listManifests: () => [{
      ...extension.listManifests()[0]!, id: 'INVALID'
    }] }])).toThrow(/rule id/i)
  })
})
