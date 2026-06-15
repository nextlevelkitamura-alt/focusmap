import { describe, expect, test } from 'vitest'
import {
  buildMindmapOrganizationHarness,
  formatMindmapOrganizationTree,
  orderMindmapOrganizationNodes,
  suggestMindmapOrganizationCandidates,
  type MindmapOrganizationNodeInput,
} from './mindmap-organization-harness'

const nodes: MindmapOrganizationNodeInput[] = [
  {
    id: 'root-1',
    title: 'プロジェクトチャット',
    parent_task_id: null,
    is_group: true,
    status: 'todo',
    stage: 'plan',
    order_index: 0,
  },
  {
    id: 'node-1',
    title: 'チャット: Focusmapを一意に読む',
    parent_task_id: 'root-1',
    is_group: false,
    status: 'todo',
    stage: 'plan',
    order_index: 0,
  },
  {
    id: 'node-2',
    title: 'チャット: マップ概要を軽量化する',
    parent_task_id: 'root-1',
    is_group: false,
    status: 'done',
    stage: 'done',
    order_index: 1,
  },
  {
    id: 'node-3',
    title: '予定作成後の確認導線',
    parent_task_id: 'root-1',
    is_group: false,
    status: 'todo',
    stage: 'plan',
    order_index: 2,
  },
]

describe('mindmap organization harness', () => {
  test('見出しツリーにはIDと完了状態を含める', () => {
    const ordered = orderMindmapOrganizationNodes(nodes)
    const tree = formatMindmapOrganizationTree(ordered)

    expect(tree).toContain('▣ プロジェクトチャット (3件) [group:root-1]')
    expect(tree).toContain('  • チャット: Focusmapを一意に読む [node:node-1]')
    expect(tree).toContain('  • チャット: マップ概要を軽量化する [完了] [node:node-2]')
  })

  test('同じ接頭辞の兄弟ノードをまとめ候補にする', () => {
    const ordered = orderMindmapOrganizationNodes(nodes)
    const candidates = suggestMindmapOrganizationCandidates(ordered)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      title: 'チャットを整理する',
      parent_task_id: 'root-1',
      parent_title: 'プロジェクトチャット',
      node_ids: ['node-1', 'node-2'],
      confidence: 'medium',
    })
    expect(candidates[0].diagram).toContain('└─ チャットを整理する')
    expect(candidates[0].operation_hint[0]).toContain('addMindmapGroup')
  })

  test('返答ハーネスは承認前のDB変更を禁止する', () => {
    const harness = buildMindmapOrganizationHarness()

    expect(harness.rules.join('\n')).toContain('未配置/未取り込み')
    expect(harness.response_format.join('\n')).toContain('範囲確認')
    expect(harness.response_format.join('\n')).toContain('既存ノードへ入れる案')
    expect(harness.rules.join('\n')).toContain('ユーザー承認前')
    expect(harness.apply_after_approval.join('\n')).toContain('addMindmapGroup')
    expect(harness.diagram_template).toContain('```text')
  })
})
