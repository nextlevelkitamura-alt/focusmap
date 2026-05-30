import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// ノード(task)に紐づく最新の Codex 実行(ai_task)を返す。
//   ノードパネルが「状態・スレッド・最新の返信(live_log)」を表示するために使う。
//   ノード自身も tasks.codex_status/codex_thread_id を持つが、返信本文は ai_tasks.result にあるためここで引く。
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const taskId = req.nextUrl.searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const { data, error } = await supabase
    .from('ai_tasks')
    .select('id, prompt, status, error, codex_thread_id, cwd, result, created_at, started_at, completed_at')
    .eq('user_id', user.id)
    .eq('source_task_id', taskId)
    .in('executor', ['codex', 'codex_app'])
    .order('created_at', { ascending: false })
    .limit(12)

  if (error) return NextResponse.json({ error: 'query failed' }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ task: null, history: [] })

  const history = data.map((row) => {
    const result = (row.result ?? {}) as Record<string, unknown>
    const threadId =
      typeof row.codex_thread_id === 'string' && row.codex_thread_id ? row.codex_thread_id :
      typeof result.codex_thread_id === 'string' ? result.codex_thread_id : null
    const reply =
      typeof result.live_log === 'string' ? result.live_log :
      typeof result.message === 'string' ? result.message : ''

    return {
      id: row.id,
      prompt: row.prompt,
      status: row.status,
      error: row.error,
      thread_id: threadId,
      cwd: row.cwd,
      reply,
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
    }
  })
  const latest = history[0]

  return NextResponse.json({
    task: {
      id: latest.id,
      status: latest.status,
      thread_id: latest.thread_id,
      cwd: latest.cwd,
      reply: latest.reply,
    },
    history,
  })
}
