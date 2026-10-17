import { describe, expect, test } from 'vitest'
import {
  historyReasonLabel,
  restoreDialogKeyboardAction,
  shouldDisableHistoryMutation
} from '../../src/components/history-panel-model'

describe('history panel model', () => {
  test('renders stable human-readable reason labels', () => {
    expect(historyReasonLabel('autosave')).toBe('Autosave')
    expect(historyReasonLabel('manual')).toBe('Manual')
    expect(historyReasonLabel('before-format')).toBe('Before format')
    expect(historyReasonLabel('before-import')).toBe('Before import')
    expect(historyReasonLabel('before-restore')).toBe('Before restore')
  })

  test('restore confirmation traps focus, closes on Escape, and preserves activation semantics', () => {
    expect(restoreDialogKeyboardAction('Escape', false, 'cancel')).toBe('close')
    expect(restoreDialogKeyboardAction('Tab', false, 'cancel')).toBe('focus-restore')
    expect(restoreDialogKeyboardAction('Tab', false, 'restore')).toBe('focus-cancel')
    expect(restoreDialogKeyboardAction('Tab', true, 'cancel')).toBe('focus-restore')
    expect(restoreDialogKeyboardAction('Enter', false, 'restore')).toBe('none')
  })

  test('history mutations are disabled while document, workspace, or history mutation is pending', () => {
    expect(shouldDisableHistoryMutation(false, false, false)).toBe(false)
    expect(shouldDisableHistoryMutation(true, false, false)).toBe(true)
    expect(shouldDisableHistoryMutation(false, true, false)).toBe(true)
    expect(shouldDisableHistoryMutation(false, false, true)).toBe(true)
  })
})
