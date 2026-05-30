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
    .select('id, status, codex_thread_id, cwd, result, created_at')
    .eq('user_id', user.id)
    .eq('source_task_id', taskId)
    .eq('executor', 'codex')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'query failed' }, { status: 500 })
  if (!data) return NextResponse.json({ task: null })

  const result = (data.result ?? {}) as Record<string, unknown>
  const reply =
    typeof result.live_log === 'string' ? result.live_log :
    typeof result.message === 'string' ? result.message : ''

  return NextResponse.json({
    task: {
      id: data.id,
      status: data.status,
      thread_id: data.codex_thread_id,
      cwd: data.cwd,
      reply,
    },
  })
}
