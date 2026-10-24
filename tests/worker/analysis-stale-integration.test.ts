import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { LintRequest, WorkerResponse } from '../../src/worker/protocol'
import { createDefaultConfig } from '../../src/core/config/validate'
import { TEXTLINT_RULE_IDS } from '../../src/core/rules/providers/textlint'

const mock = vi.hoisted(() => ({
  onMessage: null as null | ((event: { data: LintRequest }) => void),
  responses: [] as WorkerResponse[],
  textlintStarted: 0,
  textlintModuleImports: 0,
  waitForTextlint: null as null | (() => Promise<void>),
  throwTier: null as null | string,
  ownRuleTiers: [] as string[]
}))

vi.mock('../../src/core/engine/engine', () => ({
  prepareOwnRuleExecution: (text: string, config: unknown) => ({ text, config }),
  runOwnRules: (_text: string, _config: unknown, tier: string) => {
    mock.ownRuleTiers.push(tier)
    if (mock.throwTier === tier) throw new Error('synthetic tier failure')
    return { diagnostics: [], ruleErrors: [], durationMs: 1 }
  }
}))
vi.mock('../../src/core/engine/textlint-adapter', () => {
  mock.textlintModuleImports++
  return {
    runTextlint: async () => {
      mock.textlintStarted++
      await mock.waitForTextlint?.()
      return { diagnostics: [], ruleErrors: [] }
    }
  }
})

let revision = 100
const enabledTextlintConfig = (): LintRequest['config'] => createDefaultConfig()

const disabledTextlintConfig = (): LintRequest['config'] => {
  const config = createDefaultConfig()
  for (const ruleId of TEXTLINT_RULE_IDS) {
    const setting = config.rules[ruleId]
    if (setting !== undefined) config.rules[ruleId] = { ...setting, enabled: false }
  }
  return config
}

const dispatch = (
  tiers: LintRequest['tiers'],
  requestedRevision = ++revision,
  config: LintRequest['config'] = enabledTextlintConfig()
) => {
  const request: LintRequest = {
    type: 'lint',
    revision: requestedRevision,
    text: '資料を確認します。',
    config,
    docType: 'markdown',
    tiers
  }
  const callback = mock.onMessage
  if (!callback) throw new Error('Worker message handler was not registered')
  callback({ data: request })
  return requestedRevision
}
const completion = (rev: number) =>
  mock.responses.filter(r => r.type !== 'ready' && r.revision === rev)

describe('real analysis Worker message protocol for obsolete revisions', () => {
  beforeAll(async () => {
    vi.stubGlobal('self', {
      postMessage: (response: WorkerResponse) => mock.responses.push(response),
      addEventListener: (_type: string, callback: (e: { data: LintRequest }) => void) => {
        mock.onMessage = callback
      }
    })
    await import('../../src/worker/analysis.worker')
  })

  beforeEach(() => {
    mock.responses.length = 0
    mock.ownRuleTiers.length = 0
    mock.textlintStarted = 0
    mock.throwTier = null
    mock.waitForTextlint = null
  })

  afterAll(() => vi.unstubAllGlobals())

  test('does not load textlint when every textlint rule is disabled, yet completes builtin Deep/Idle', async () => {
    const importsBefore = mock.textlintModuleImports
    expect(importsBefore).toBe(0) // First worker Deep request should remain truly lazy.
    const rev = dispatch(['deep', 'idle'], undefined, disabledTextlintConfig())
    await vi.waitFor(() => expect(completion(rev)).toHaveLength(2))
    expect(completion(rev).map(x => x.type)).toEqual(['result', 'result'])
    expect(mock.ownRuleTiers).toEqual(['deep', 'idle'])
    expect(mock.textlintModuleImports).toBe(importsBefore)
    expect(mock.textlintStarted).toBe(0)
    expect(completion(rev)[0]).toMatchObject({ ruleErrors: [] })
  })

  test('loads textlint after it becomes enabled and retains the lazy-loaded adapter', async () => {
    const first = dispatch(['deep'])
    await vi.waitFor(() => expect(completion(first)).toHaveLength(1))
    expect(mock.textlintModuleImports).toBe(1)
    expect(mock.textlintStarted).toBe(1)

    mock.textlintStarted = 0
    const second = dispatch(['deep'], undefined, disabledTextlintConfig())
    await vi.waitFor(() => expect(completion(second)).toHaveLength(1))
    expect(mock.textlintModuleImports).toBe(1)
    expect(mock.textlintStarted).toBe(0)

    const third = dispatch(['deep'])
    await vi.waitFor(() => expect(completion(third)).toHaveLength(1))
    expect(mock.textlintModuleImports).toBe(1)
    expect(mock.textlintStarted).toBe(1)
  })

  test('skips a deep analysis paused in textlint and all its remaining tiers', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    mock.waitForTextlint = () => pending
    const oldRev = dispatch(['deep', 'idle'])
    await vi.waitFor(() => expect(mock.textlintStarted).toBe(1))
    const newRev = dispatch(['fast'])
    await vi.waitFor(() => expect(completion(newRev)).toHaveLength(1))
    release?.()
    await vi.waitFor(() => expect(completion(oldRev)).toHaveLength(2))
    expect(completion(oldRev).map(x => x.type)).toEqual(['skipped', 'skipped'])
    expect(completion(newRev).map(x => x.type)).toEqual(['result'])
    // No stale idle-tier rule work should execute after a newer revision.
    expect(mock.ownRuleTiers).not.toContain('idle')
  })

  test('never aborts formatter shadow lint when newer UI input arrives', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    mock.waitForTextlint = () => pending
    const shadow = dispatch(['deep', 'idle'], -1001)
    await vi.waitFor(() => expect(mock.textlintStarted).toBe(1))
    const current = dispatch(['fast'])
    await vi.waitFor(() => expect(completion(current)).toHaveLength(1))
    release?.()
    await vi.waitFor(() => expect(completion(shadow)).toHaveLength(2))
    expect(completion(shadow).map(x => x.type)).toEqual(['result', 'result'])
    expect(mock.ownRuleTiers).toContain('idle')
  })

  test('immediately completes out-of-order older UI requests as skipped', async () => {
    const current = dispatch(['fast'])
    await vi.waitFor(() => expect(completion(current)).toHaveLength(1))
    const old = dispatch(['fast', 'deep', 'idle'], current - 1)
    await vi.waitFor(() => expect(completion(old)).toHaveLength(3))
    expect(completion(old).map(x => x.type)).toEqual(['skipped', 'skipped', 'skipped'])
  })

  test('emits tier-specific terminal errors and continues with other tiers', async () => {
    mock.throwTier = 'fast'
    const rev = dispatch(['fast', 'idle'])
    await vi.waitFor(() => expect(completion(rev)).toHaveLength(2))
    expect(completion(rev).map(x => x.type)).toEqual(['error', 'result'])
    expect(completion(rev)[0]).toEqual(expect.objectContaining({ type: 'error', tier: 'fast' }))
  })
})
