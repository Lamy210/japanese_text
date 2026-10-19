import { describe, expect, test } from 'vitest'
import { searchDocumentBodies, matchesSearchHit } from '../../src/document/body-search'
import type { EditableDocument } from '../../src/document/types'

function doc(id: string, content: string, createdAt = 1): EditableDocument {
  return {
    id, workspaceId: 'w1', name: id + '.md', docType: 'markdown',
    sourceKind: 'local', createdAt, updatedAt: 1, content
  }
}

describe('body-only workspace search', () => {
  test('finds Japanese substrings, returns original UTF-16 offsets and snippets', () => {
    const text = '😀こんにちは。こんにちは'
    const results = searchDocumentBodies([doc('a', text)], 'こんにちは')
    expect(results.map(hit => [hit.start, hit.end])).toEqual([[2, 7], [8, 13]])
    expect(results[0]?.preview).toContain('こんにちは')
    expect(results.every(hit => text.slice(hit.start, hit.end) === 'こんにちは')).toBe(true)
  })

  test('treats regex syntax literally and supports case-insensitive English', () => {
    const found = searchDocumentBodies([doc('a', 'A+b? and a+B?; [test].')], 'a+b?')
    expect(found.map(hit => hit.start)).toEqual([0, 9])
    expect(searchDocumentBodies([doc('a', '[test].')], '[test].')).toHaveLength(1)
  })

  test('stable document ordering and per-document and global hit caps', () => {
    const docs = [doc('z', 'x x x x', 2), doc('b', 'x x x x', 1), doc('a', 'x x x x', 1)]
    expect(searchDocumentBodies(docs, 'x').map(hit => hit.documentId)).toEqual([
      'a', 'a', 'a', 'b', 'b', 'b', 'z', 'z', 'z'
    ])
    expect(searchDocumentBodies(Array.from({ length: 40 }, (_, i) => doc('doc' + String(i).padStart(2, '0'), 'x x x')), 'x')).toHaveLength(50)
  })

  test('empty input returns zero matches, overlong query throws, and hit validation detects changed text', () => {
    expect(searchDocumentBodies([doc('a', 'hello')], '   ')).toEqual([])
    expect(() => searchDocumentBodies([doc('a', 'hello')], 'あ'.repeat(81))).toThrow(/80/)
    const hit = searchDocumentBodies([doc('a', 'abc hello def')], 'hello')[0]!
    expect(matchesSearchHit('abc hello def', hit, 'hello')).toBe(true)
    expect(matchesSearchHit('abc stale def', hit, 'hello')).toBe(false)
  })

  test('result is a bounded plaintext preview and handles empty document content', () => {
    const results = searchDocumentBodies([doc('a', 'q'.repeat(300) + 'needle' + 'b'.repeat(300)), doc('empty', '')], 'needle')
    expect(results).toHaveLength(1)
    expect(results[0]!.preview.length).toBeLessThan(130)
    expect(results[0]!.preview).toContain('needle')
  })
})
