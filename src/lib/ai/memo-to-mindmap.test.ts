import { describe, expect, test } from 'vitest'
import {
  buildDraftChildMap,
  isSourceBackedDraftNode,
  type MindmapDraftNode,
} from './memo-to-mindmap'

function node(input: Partial<MindmapDraftNode> & Pick<MindmapDraftNode, 'tempId'>): MindmapDraftNode {
  return {
    tempId: input.tempId,
    title: input.title ?? input.tempId,
    parentTempId: input.parentTempId ?? null,
    sourceNoteIds: input.sourceNoteIds ?? [],
  }
}

describe('memo-to-mindmap draft source nodes', () => {
  test('子を持つまとめ用ノードはsourceNoteIdsがあってもメモ扱いにしない', () => {
    const nodes = [
      node({ tempId: 'n1', sourceNoteIds: ['memo-1', 'memo-2'] }),
      node({ tempId: 'n2', parentTempId: 'n1', sourceNoteIds: ['memo-1'] }),
      node({ tempId: 'n3', parentTempId: 'n1', sourceNoteIds: ['memo-2'] }),
    ]
    const childMap = buildDraftChildMap(nodes)

    expect(isSourceBackedDraftNode(nodes[0], childMap)).toBe(false)
    expect(isSourceBackedDraftNode(nodes[1], childMap)).toBe(true)
    expect(isSourceBackedDraftNode(nodes[2], childMap)).toBe(true)
  })

  test('sourceNoteIdsがない構造ノードは通常ノードとして扱う', () => {
    const nodes = [
      node({ tempId: 'n1' }),
      node({ tempId: 'n2', parentTempId: 'n1', sourceNoteIds: ['memo-1'] }),
    ]
    const childMap = buildDraftChildMap(nodes)

    expect(isSourceBackedDraftNode(nodes[0], childMap)).toBe(false)
    expect(isSourceBackedDraftNode(nodes[1], childMap)).toBe(true)
  })
})
