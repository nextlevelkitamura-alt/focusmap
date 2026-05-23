import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/mindmap/memo-links?task_id=... — マップノードに対応する元メモ一覧
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const taskId = request.nextUrl.searchParams.get('task_id')
  if (!taskId) return NextResponse.json({ error: 'task_id が必要です' }, { status: 400 })

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id, title, project_id')
    .eq('id', taskId)
    .eq('user_id', user.id)
    .single()

  if (taskError || !task) {
    return NextResponse.json({ error: 'タスクが見つかりません' }, { status: 404 })
  }

  const { data: memos, error: memoError } = await supabase
    .from('ideal_goals')
    .select('*, ideal_items(*)')
    .eq('user_id', user.id)
    .in('status', ['wishlist', 'memo'])
    .order('display_order', { ascending: true })
    .order('created_at', { referencedTable: 'ideal_items', ascending: true })

  if (memoError) return NextResponse.json({ error: memoError.message }, { status: 500 })

  const items = (memos || [])
    .map(memo => ({ memo, link: findTaskLink(memo.ai_source_payload, taskId) }))
    .filter((entry): entry is { memo: typeof memos[number]; link: MindmapLink } => !!entry.link)
    .sort((a, b) => getLinkTime(b.link) - getLinkTime(a.link))
    .map(entry => entry.memo)

  const { data: notes, error: notesError } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', user.id)
    .eq('task_id', taskId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })

  if (notesError) return NextResponse.json({ error: notesError.message }, { status: 500 })

  const { data: structuredLinks, error: structuredError } = await supabase
    .from('memo_node_links')
    .select('*, memo_items(*)')
    .eq('user_id', user.id)
    .eq('task_id', taskId)
    .eq('link_type', 'mindmap_node')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (structuredError) return NextResponse.json({ error: structuredError.message }, { status: 500 })

  const structuredSourceIds = new Set<string>()
  for (const link of structuredLinks ?? []) {
    const memoItem = Array.isArray(link.memo_items) ? link.memo_items[0] : link.memo_items
    if (memoItem?.source_type === 'wishlist' && typeof memoItem.source_id === 'string') {
      structuredSourceIds.add(memoItem.source_id)
    }
  }

  const sourceItems = (memos || []).filter(memo => structuredSourceIds.has(memo.id))

  return NextResponse.json({
    task,
    items,
    notes: notes || [],
    structured_items: structuredLinks || [],
    source_items: sourceItems,
  })
}

interface MindmapLink {
  task_id?: unknown
  linked_at?: unknown
}

function findTaskLink(payload: unknown, taskId: string): MindmapLink | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const links = (payload as { mindmap_links?: unknown }).mindmap_links
  if (!Array.isArray(links)) return null
  for (const link of links) {
    if (!link || typeof link !== 'object') continue
    if ((link as MindmapLink).task_id === taskId) return link as MindmapLink
  }
  return null
}

function getLinkTime(link: MindmapLink): number {
  if (typeof link.linked_at !== 'string') return 0
  const time = new Date(link.linked_at).getTime()
  return Number.isNaN(time) ? 0 : time
}
