import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/ai/memo-to-mindmap/undo — AI整理で作成したタスクを削除し、メモ側リンクも外す
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const taskIds: string[] = Array.isArray(body?.taskIds)
      ? Array.from(new Set<string>(body.taskIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)))
      : []
    const projectId = typeof body?.projectId === 'string' ? body.projectId : null
    const deleteProjectIfEmpty = body?.deleteProjectIfEmpty === true
    const restoreTaskTitles: Array<{ taskId: string; title: string }> = Array.isArray(body?.restoreTaskTitles)
      ? body.restoreTaskTitles
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null
          const record = item as Record<string, unknown>
          const taskId = typeof record.taskId === 'string' ? record.taskId : ''
          const title = typeof record.title === 'string' ? record.title.trim() : ''
          if (!taskId || !title) return null
          return { taskId, title }
        })
        .filter((item: { taskId: string; title: string } | null): item is { taskId: string; title: string } => !!item)
      : []

    if (taskIds.length === 0) {
      return NextResponse.json({ error: 'taskIds が必要です' }, { status: 400 })
    }

    await removeMemoLinks(supabase, user.id, taskIds)

    const { error: deleteTasksError } = await supabase
      .from('tasks')
      .delete()
      .eq('user_id', user.id)
      .in('id', taskIds)

    if (deleteTasksError) {
      console.error('[memo-to-mindmap/undo] tasks 削除失敗:', deleteTasksError)
      return NextResponse.json({ error: deleteTasksError.message }, { status: 500 })
    }

    if (deleteProjectIfEmpty && projectId) {
      const { count, error: countError } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('project_id', projectId)

      if (!countError && count === 0) {
        await supabase
          .from('projects')
          .delete()
          .eq('id', projectId)
          .eq('user_id', user.id)
      }
    }

    if (restoreTaskTitles.length > 0) {
      const restoreResults = await Promise.all(
        restoreTaskTitles.map(item =>
          supabase
            .from('tasks')
            .update({ title: item.title, updated_at: new Date().toISOString() })
            .eq('id', item.taskId)
            .eq('user_id', user.id),
        ),
      )
      const restoreError = restoreResults.find(result => result.error)?.error
      if (restoreError) {
        console.error('[memo-to-mindmap/undo] 既存ノード名の復元失敗:', restoreError)
        return NextResponse.json({ error: restoreError.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      deletedTaskIds: taskIds,
      restoredTaskIds: restoreTaskTitles.map(item => item.taskId),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[memo-to-mindmap/undo] error:', msg, error)
    return NextResponse.json({ error: 'マインドマップ整理の取り消しに失敗しました' }, { status: 500 })
  }
}

async function removeMemoLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  taskIds: string[],
) {
  const taskIdSet = new Set(taskIds)
  const { data: memos, error } = await supabase
    .from('ideal_goals')
    .select('id, ai_source_payload')
    .eq('user_id', userId)
    .in('status', ['wishlist', 'memo'])

  if (error) {
    console.error('[memo-to-mindmap/undo] メモリンク取得失敗:', error)
    return
  }

  await Promise.all(
    (memos || []).map(memo => {
      const payload = normalizePayload(memo.ai_source_payload)
      const links = Array.isArray(payload.mindmap_links) ? payload.mindmap_links : []
      const nextLinks = links.filter(link => {
        if (!link || typeof link !== 'object') return true
        const taskId = (link as { task_id?: unknown }).task_id
        return typeof taskId !== 'string' || !taskIdSet.has(taskId)
      })
      if (nextLinks.length === links.length) return Promise.resolve()
      return supabase
        .from('ideal_goals')
        .update({
          ai_source_payload: { ...payload, mindmap_links: nextLinks },
          updated_at: new Date().toISOString(),
        })
        .eq('id', memo.id)
        .eq('user_id', userId)
    }),
  )
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>) }
  }
  if (payload == null) return {}
  return { previous_payload: payload }
}
