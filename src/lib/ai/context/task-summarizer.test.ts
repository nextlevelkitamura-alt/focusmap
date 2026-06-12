import { describe, expect, test } from 'vitest'
import { summarizeProjectChatMapBrief } from './task-summarizer'

function createProjectChatBriefSupabase(args: {
  project: unknown
  tasks: unknown[]
  wishlist: unknown[]
  memoItems: unknown[]
}) {
  const projectQuery = {
    select: () => projectQuery,
    eq: () => projectQuery,
    maybeSingle: async () => ({ data: args.project }),
  }
  const makeRowsQuery = (rows: unknown[]) => {
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      in: () => query,
      order: () => query,
      limit: async () => ({ data: rows }),
    }
    return query
  }
  const taskQuery = makeRowsQuery(args.tasks)
  const wishlistQuery = makeRowsQuery(args.wishlist)
  const memoItemsQuery = makeRowsQuery(args.memoItems)

  return {
    from: (table: string) => {
      if (table === 'projects') return projectQuery
      if (table === 'tasks') return taskQuery
      if (table === 'ideal_goals') return wishlistQuery
      if (table === 'memo_items') return memoItemsQuery
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

describe('project chat map brief', () => {
  test('件数と見出しだけを出し、本文やメモ詳細を含めない', async () => {
    const supabase = createProjectChatBriefSupabase({
      project: { title: 'Focus map制作' },
      tasks: [
        {
          id: 'group-1',
          title: 'チャット文脈設計',
          is_group: true,
          parent_task_id: null,
          status: 'todo',
          memo: 'これは初期文脈へ入れたくないノード本文です',
        },
        {
          id: 'task-1',
          title: 'プロジェクト解決',
          is_group: false,
          parent_task_id: 'group-1',
          status: 'done',
        },
        {
          id: 'task-2',
          title: 'ノート見出しだけ読む',
          is_group: false,
          parent_task_id: 'group-1',
          status: 'todo',
        },
      ],
      wishlist: [
        {
          id: 'note-1',
          title: 'フォークスマップ壁打ちメモ',
          status: 'memo',
          memo_status: null,
          is_completed: false,
          description: 'これは初期文脈へ入れたくないメモ本文です',
          updated_at: '2026-06-12T01:00:00Z',
        },
        {
          id: 'note-2',
          title: '完了済みメモ',
          status: 'memo',
          memo_status: 'done',
          is_completed: true,
          updated_at: '2026-06-12T02:00:00Z',
        },
      ],
      memoItems: [
        {
          id: 'memo-item-1',
          title: 'マインドマップ整理の論点',
          status: 'open',
          body: 'これは初期文脈へ入れたくない構造化メモ本文です',
          updated_at: '2026-06-12T03:00:00Z',
        },
      ],
    })

    const brief = await summarizeProjectChatMapBrief(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'user-1',
      'project-1',
    )

    expect(brief).toContain('## マインドマップ/ノート概要: Focus map制作')
    expect(brief).toContain('マインドマップ: 3件（見出し1件 / タスク2件）')
    expect(brief).toContain('- チャット文脈設計 (2件)')
    expect(brief).toContain('ノート/メモ: 2件（メモ1件 / 構造化メモ1件）')
    expect(brief).toContain('- マインドマップ整理の論点')
    expect(brief).toContain('- フォークスマップ壁打ちメモ')
    expect(brief).toContain('初期文脈は件数と見出しだけです')
    expect(brief).not.toContain('これは初期文脈へ入れたくない')
    expect(brief).not.toContain('完了済みメモ')
  })

  test('プロジェクトが見つからない時は空文字を返す', async () => {
    const supabase = createProjectChatBriefSupabase({
      project: null,
      tasks: [],
      wishlist: [],
      memoItems: [],
    })

    const brief = await summarizeProjectChatMapBrief(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'user-1',
      'project-1',
    )

    expect(brief).toBe('')
  })
})
