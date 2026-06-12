import { describe, expect, test } from 'vitest'
import {
  loadMindmapGenerationContext,
  loadMindmapStructure,
} from './mindmap-context'

function createTaskOnlySupabase(tasks: unknown[]) {
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    order: async () => ({ data: tasks }),
  }
  return {
    from: (table: string) => {
      expect(table).toBe('tasks')
      return query
    },
  }
}

function createGenerationContextSupabase(args: {
  project: unknown
  contexts: unknown[]
  tasks: unknown[]
}) {
  const taskQuery = {
    select: () => taskQuery,
    eq: () => taskQuery,
    is: () => taskQuery,
    order: async () => ({ data: args.tasks }),
  }
  const projectQuery = {
    select: () => projectQuery,
    eq: () => projectQuery,
    maybeSingle: async () => ({ data: args.project }),
  }
  const contextQuery = {
    select: () => contextQuery,
    eq: () => contextQuery,
    order: () => contextQuery,
    limit: async () => ({ data: args.contexts }),
  }

  return {
    from: (table: string) => {
      if (table === 'tasks') return taskQuery
      if (table === 'projects') return projectQuery
      if (table === 'project_contexts') return contextQuery
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

describe('mindmap prompt context', () => {
  test('既存ノードのメモ冒頭だけをツリーへ含める', async () => {
    const supabase = createTaskOnlySupabase([
      {
        id: 'group-1',
        title: 'AI生成マインドマップ',
        is_group: true,
        parent_task_id: null,
        status: 'todo',
        order_index: 0,
        memo: 'abcdefghijklmnopqrstuvwxyz1234567890',
      },
      {
        id: 'task-1',
        title: 'チャット画面のUI改善',
        is_group: false,
        parent_task_id: 'group-1',
        status: 'done',
        order_index: 0,
        memo: 'スマホで操作しやすいように下部シートでまとめる',
      },
    ])

    const { treeText, nodeCount } = await loadMindmapStructure(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'user-1',
      'project-1',
    )

    expect(nodeCount).toBe(2)
    expect(treeText).toContain('AI生成マインドマップ [group:group-1] / memo: abcdefghijklmnopqrstuvwxyz1234...')
    expect(treeText).toContain('チャット画面のUI改善 ✅ [task:task-1] / memo: スマホで操作しやすいように下部シートでまとめる')
    expect(treeText).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890')
  })

  test('プロジェクト概要、project_contexts、既存マップを生成用文脈にまとめる', async () => {
    const supabase = createGenerationContextSupabase({
      project: {
        id: 'project-1',
        title: 'Focus map制作',
        description: 'AIが管理し、人間が俯瞰するマップ',
        purpose: 'マインドマップからAI実行を整理する',
      },
      contexts: [
        {
          heading: '現在の目的',
          details: 'スマホでマップ整理をしやすくする',
          progress: 'AI生成導線を再設計中',
          progress_status: 'in_progress',
        },
      ],
      tasks: [
        {
          id: 'task-1',
          title: '既存ノードへ統合',
          is_group: false,
          parent_task_id: null,
          status: 'todo',
          order_index: 0,
          memo: '既存ノードの見出しとメモ冒頭を見る',
        },
      ],
    })

    const { contextText, nodeCount } = await loadMindmapGenerationContext(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'user-1',
      'project-1',
    )

    expect(nodeCount).toBe(1)
    expect(contextText).toContain('# プロジェクト概要')
    expect(contextText).toContain('purpose: マインドマップからAI実行を整理する')
    expect(contextText).toContain('1. 現在の目的 (in_progress)')
    expect(contextText).toContain('progress: AI生成導線を再設計中')
    expect(contextText).toContain('既存ノードへ統合 [task:task-1] / memo: 既存ノードの見出しとメモ冒頭を見る')
  })
})
