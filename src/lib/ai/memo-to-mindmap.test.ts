import { describe, expect, test } from 'vitest'
import {
  buildDraftChildMap,
  getDraftDepthViolations,
  getDraftNodeDepths,
  isSourceBackedDraftNode,
  MAX_MINDMAP_DRAFT_DEPTH,
  MindmapDraftSchema,
  type MindmapDraftNode,
} from './memo-to-mindmap'

function node(input: Partial<MindmapDraftNode> & Pick<MindmapDraftNode, 'tempId'>): MindmapDraftNode {
  return {
    tempId: input.tempId,
    title: input.title ?? input.tempId,
    parentTempId: input.parentTempId ?? null,
    sourceNoteIds: input.sourceNoteIds ?? [],
    attachToExistingTaskId: input.attachToExistingTaskId ?? null,
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

describe('memo-to-mindmap draft depth', () => {
  test('追加ノードの深さを追加ルート基準で計算する', () => {
    const nodes = [
      node({ tempId: 'n1', attachToExistingTaskId: 'existing-1' }),
      node({ tempId: 'n2', parentTempId: 'n1' }),
      node({ tempId: 'n3', parentTempId: 'n2' }),
      node({ tempId: 'n4', parentTempId: 'n3' }),
    ]
    const depths = getDraftNodeDepths(nodes)

    expect(depths.get('n1')).toBe(1)
    expect(depths.get('n4')).toBe(MAX_MINDMAP_DRAFT_DEPTH)
    expect(getDraftDepthViolations(nodes)).toEqual([])
  })

  test('5層目以降を違反として返す', () => {
    const nodes = [
      node({ tempId: 'n1' }),
      node({ tempId: 'n2', parentTempId: 'n1' }),
      node({ tempId: 'n3', parentTempId: 'n2' }),
      node({ tempId: 'n4', parentTempId: 'n3' }),
      node({ tempId: 'n5', parentTempId: 'n4' }),
    ]

    expect(getDraftDepthViolations(nodes).map(n => n.tempId)).toEqual(['n5'])
  })
})

describe('memo-to-mindmap draft schema', () => {
  test('既存フィールドがない古いdraftにも安全なデフォルトを補う', () => {
    const parsed = MindmapDraftSchema.parse({
      projectTitle: 'Project',
      nodes: [
        {
          tempId: 'n1',
          title: 'Node',
          parentTempId: null,
          sourceNoteIds: [],
        },
      ],
    })

    expect(parsed.nodes[0].attachToExistingTaskId).toBeNull()
    expect(parsed.existingNodeRenameSuggestions).toEqual([])
  })
})
