import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { applyFixesTransaction, applyReplacement, jumpToPosition, setEditorView } from '../../src/editor/editor-adapter'

function mockEditor() {
  const calls: string[] = []
  const view = {
    state: { doc: { length: 10 } },
    dispatch: () => calls.push('dispatch'),
    focus: () => calls.push('focus')
  } as unknown as EditorView
  setEditorView(view, () => { calls.push('reveal') })
  return { calls, view }
}

afterEach(() => setEditorView(null))

describe('editor visibility before navigation and mutations', () => {
  it('reveals before jumping to a diagnostic or search hit', () => {
    const { calls } = mockEditor()
    jumpToPosition(1, 4)
    expect(calls).toEqual(['reveal', 'dispatch', 'focus'])
  })

  it('reveals before applying a replacement or formatter transaction', () => {
    const { calls } = mockEditor()
    applyReplacement(1, 4, '修正', 'input.quickfix')
    applyFixesTransaction([{ start: 0, end: 1, replacement: '文' }], 'input.format')
    expect(calls).toEqual(['reveal', 'dispatch', 'focus', 'reveal', 'dispatch', 'focus'])
  })

  it('does not retain a previous editor reveal callback', () => {
    const { calls, view } = mockEditor()
    setEditorView(null)
    jumpToPosition(0, 1)
    setEditorView(view)
    applyFixesTransaction([], 'input.format')
    jumpToPosition(0, 1)
    expect(calls).toEqual(['dispatch', 'focus'])
  })
})
