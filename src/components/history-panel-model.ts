import type { SnapshotReason } from '../core/workspace/types'

export type RestoreDialogFocus = 'cancel' | 'restore'
export type RestoreDialogKeyboardAction = 'none' | 'close' | 'focus-cancel' | 'focus-restore'

export function historyReasonLabel(reason: SnapshotReason): string {
  switch (reason) {
    case 'autosave': return 'Autosave'
    case 'manual': return 'Manual'
    case 'before-format': return 'Before format'
    case 'before-import': return 'Before import'
    case 'before-restore': return 'Before restore'
  }
}

export function restoreDialogKeyboardAction(
  key: string,
  shiftKey: boolean,
  focus: RestoreDialogFocus
): RestoreDialogKeyboardAction {
  if (key === 'Escape') return 'close'
  if (key !== 'Tab') return 'none'
  if (focus === 'cancel') return shiftKey ? 'focus-restore' : 'focus-restore'
  return shiftKey ? 'focus-cancel' : 'focus-cancel'
}

export function shouldDisableHistoryMutation(
  documentMutationPending: boolean,
  workspaceMutationPending: boolean,
  historyMutationPending: boolean
): boolean {
  return documentMutationPending || workspaceMutationPending || historyMutationPending
}
