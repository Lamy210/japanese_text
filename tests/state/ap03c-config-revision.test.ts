import { describe, expect, test, vi } from 'vitest'

// Verify the real AppState revision handling, without creating a browser Worker.
const relint = vi.fn()
vi.mock('../../src/state/lint-controller', () => ({
  lintController: { relintAll: relint }
}))
vi.mock('../../src/storage/storage', () => ({
  isStorageAvailable: () => false
}))

import { appState } from '../../src/state/app-state'
import { persistAndRelint } from '../../src/state/actions'

describe('AP-03c configuration changes invalidate previous Worker generations', () => {
  test('the next lint gets a new revision even though the document text is unchanged', () => {
    const original = appState.revision()
    const previous = appState.config.analysis.packs.dictionary
    appState.updateConfig(config => {
      config.analysis.packs.dictionary = !previous
    })
    // Updating a setting alone is not the scheduling boundary; persisting/re-linting is.
    expect(appState.revision()).toBe(original)
    persistAndRelint()
    expect(appState.revision()).toBe(original + 1)
    expect(relint).toHaveBeenCalledTimes(1)
    expect(appState.config.analysis.packs.dictionary).toBe(!previous)
  })
})
